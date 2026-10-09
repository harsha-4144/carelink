const express = require('express');
const { getDb, logEvent, loadSession, badRequest, httpError, iso, patientSummary } = require('../db');
const { requireRole } = require('../auth');
const { buildPayload, createGuardianAlerts } = require('../services/alerting');
const { notifyHospital, notifyUser } = require('../services/notify');

const router = express.Router();

// Hospital staff see their own hospital's queue; guardians see alerts addressed to their own guardian rows.
router.get('/alerts', requireRole('hospital_staff', 'guardian'), (req, res, next) => {
  try {
    const { target_type, target_id } = req.query;
    if (!['guardian', 'hospital'].includes(target_type)) throw badRequest('target_type must be guardian or hospital');
    if (!Number.isInteger(Number(target_id))) throw badRequest('target_id must be an integer');
    const id = Number(target_id);
    const db = getDb();
    if (target_type === 'hospital') {
      if (req.user.role !== 'hospital_staff' || req.user.hospital_id !== id) throw httpError(403, 'This is not your hospital');
    } else {
      const g = db.prepare('SELECT user_id FROM guardians WHERE id = ?').get(id);
      if (req.user.role !== 'guardian' || !g || g.user_id !== req.user.id) throw httpError(403, 'These alerts are not addressed to you');
    }
    const rows = db.prepare(`SELECT a.*, s.status AS session_status, s.urgency_level, s.cancelled_at, s.patient_id FROM alerts a JOIN emergency_sessions s ON s.id = a.session_id
      WHERE a.target_type = ? AND a.target_id = ? ORDER BY a.id DESC`).all(target_type, id);
    const family = db.prepare(`SELECT g.guardian_name, g.relation, a.ack_at, a.ack_note FROM alerts a JOIN guardians g ON g.id = a.target_id
      WHERE a.session_id = ? AND a.target_type = 'guardian' AND a.status != 'cancelled'`);
    res.json({
      alerts: rows.map((r) => ({
        ...r, sent_at: iso(r.sent_at), payload: JSON.parse(r.payload),
        family: target_type === 'hospital' ? family.all(r.session_id).map((f) => ({ ...f, ack_at: iso(f.ack_at) })) : undefined,
      })),
    });
  } catch (e) { next(e); }
});

const FLOW = ['new', 'accepted', 'preparing', 'ready'];

function ownedHospitalAlert(req) {
  const a = getDb().prepare("SELECT * FROM alerts WHERE id = ? AND target_type = 'hospital'").get(Number(req.params.id));
  if (!a) throw httpError(404, 'Alert not found');
  if (a.target_id !== req.user.hospital_id) throw httpError(403, 'This is not your hospital');
  return a;
}

// Staff move an incoming patient through accepted -> preparing -> ready; guardians see it live.
router.post('/alerts/:id/status', requireRole('hospital_staff'), (req, res, next) => {
  try {
    const status = (req.body || {}).status;
    if (!FLOW.includes(status) || status === 'new') throw badRequest('status must be accepted, preparing or ready');
    const a = ownedHospitalAlert(req);
    if (['cancelled', 'declined'].includes(a.status)) throw badRequest(`This alert was ${a.status}`);
    const db = getDb();
    db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run(status, a.id);
    const h = db.prepare('SELECT name FROM hospitals WHERE id = ?').get(a.target_id);
    const s = loadSession(a.session_id);
    logEvent(a.session_id, `${h.name}: ${{ accepted: 'accepted the patient', preparing: 'is preparing', ready: 'is ready' }[status]}`, 'Hospital staff');
    if (s.patient_id) {
      const text = { accepted: 'accepted the patient', preparing: 'is preparing for arrival', ready: 'is ready' }[status];
      for (const g of db.prepare('SELECT user_id FROM guardians WHERE patient_id = ? AND user_id IS NOT NULL').all(s.patient_id)) {
        notifyUser(g.user_id, { kind: 'status', title: `${h.name} ${text}`, link: `/guardian.html?session=${s.id}`, sessionId: s.id });
      }
    }
    res.json({ id: a.id, status });
  } catch (e) { next(e); }
});

// The hospital cannot take this patient (ICU full, no specialist...). The caller is told to choose again.
router.post('/alerts/:id/decline', requireRole('hospital_staff'), (req, res, next) => {
  try {
    const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
    if (!reason) throw badRequest('Give a short reason so the caller can choose another hospital');
    const a = ownedHospitalAlert(req);
    if (['cancelled', 'declined'].includes(a.status)) throw badRequest(`This alert was already ${a.status}`);
    const db = getDb();
    db.prepare("UPDATE alerts SET status = 'declined', decline_reason = ? WHERE id = ?").run(reason, a.id);
    const h = db.prepare('SELECT name FROM hospitals WHERE id = ?').get(a.target_id);
    logEvent(a.session_id, `${h.name} cannot take the patient: ${reason}`, 'Hospital staff');
    res.json({ id: a.id, status: 'declined' });
  } catch (e) { next(e); }
});

// Hospital identifies an unknown patient (ID card, relatives at the desk): link the CARELINK ID, then alert the guardians.
router.post('/alerts/:id/link-patient', requireRole('hospital_staff'), (req, res, next) => {
  try {
    const a = ownedHospitalAlert(req);
    const id = String((req.body || {}).carelink_id || '').trim().toUpperCase();
    if (!id) throw badRequest('carelink_id is required');
    const s = loadSession(a.session_id);
    if (s.patient_id) throw badRequest('This patient is already identified');
    const db = getDb();
    const u = db.prepare("SELECT id FROM users WHERE carelink_id = ? AND role = 'patient'").get(id);
    if (!u) throw httpError(404, 'No patient with that CARELINK ID');
    const patient = patientSummary(u.id);
    const h = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(a.target_id);
    db.prepare('UPDATE emergency_sessions SET patient_id = ? WHERE id = ?').run(u.id, s.id);
    const fresh = loadSession(s.id);
    const payload = buildPayload(fresh, patient, h, fresh.eta_min);
    db.prepare('UPDATE alerts SET payload = ? WHERE id = ?').run(JSON.stringify(payload), a.id);
    const created = createGuardianAlerts(fresh, patient, payload, h);
    logEvent(s.id, `${h.name} identified the patient as ${patient.name} (${patient.carelink_id}); ${created.length} guardian${created.length === 1 ? '' : 's'} alerted`, 'Hospital staff');
    res.json({ patient, guardians_alerted: created.length });
  } catch (e) { next(e); }
});

// A guardian answers the alert: "acknowledged" or "on_my_way". The hospital and the bystander see it.
router.post('/alerts/:id/ack', requireRole('guardian'), (req, res, next) => {
  try {
    const note = (req.body || {}).note === 'on_my_way' ? 'on_my_way' : 'acknowledged';
    const db = getDb();
    const a = db.prepare(`SELECT a.*, g.user_id, g.guardian_name, g.relation FROM alerts a JOIN guardians g ON g.id = a.target_id
      WHERE a.id = ? AND a.target_type = 'guardian'`).get(Number(req.params.id));
    if (!a) throw httpError(404, 'Alert not found');
    if (a.user_id !== req.user.id) throw httpError(403, 'This alert is not addressed to you');
    if (a.status === 'cancelled') throw badRequest('This emergency was cancelled');
    db.prepare('UPDATE alerts SET ack_at = CURRENT_TIMESTAMP, ack_note = ? WHERE id = ?').run(note, a.id);
    const s = loadSession(a.session_id);
    const who = `${a.guardian_name}${a.relation ? ` (${a.relation})` : ''}`;
    const text = note === 'on_my_way' ? `${who} is on the way to the hospital` : `${who} saw the alert`;
    logEvent(s.id, text, 'Guardian');
    const hosp = db.prepare("SELECT target_id FROM alerts WHERE session_id = ? AND target_type = 'hospital' AND status NOT IN ('cancelled','declined') ORDER BY id DESC LIMIT 1").get(s.id);
    if (hosp) notifyHospital(s.id, hosp.target_id, { kind: 'family', title: 'Family responding', body: text });
    res.json({ id: a.id, ack_note: note });
  } catch (e) { next(e); }
});

module.exports = router;
