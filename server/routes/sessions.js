const express = require('express');
const { getDb, logEvent, loadSession, httpError, iso, patientSummary } = require('../db');
const { notifyGuardians, notifyHospital } = require('../services/notify');

const router = express.Router();

// Who may read or close a session: the bystander holding its access key, the patient, a linked
// guardian, or staff of the chosen hospital.
function canAccess(req, s, key, { staffOnly = false } = {}) {
  const u = req.user;
  if (u && u.role === 'hospital_staff' && s.chosen_hospital_id === u.hospital_id) return true;
  if (staffOnly) return false;
  if (key && s.access_key && key === s.access_key) return true;
  if (u && u.role === 'patient' && s.patient_id === u.id) return true;
  if (u && u.role === 'guardian' && s.patient_id &&
      getDb().prepare('SELECT 1 FROM guardians WHERE patient_id = ? AND user_id = ?').get(s.patient_id, u.id)) return true;
  return false;
}

function guard(req, s, key) {
  if (!canAccess(req, s, key)) throw httpError(req.user ? 403 : 401, req.user ? 'You do not have access to this emergency' : 'Log in or use the link from the alert to view this emergency');
}

function fullSession(id) {
  const db = getDb();
  const { access_key, ...s } = loadSession(id);
  const hospital = s.chosen_hospital_id
    ? db.prepare('SELECT id, name, lat, lng, phone FROM hospitals WHERE id = ?').get(s.chosen_hospital_id) : null;
  const gname = db.prepare('SELECT guardian_name, relation FROM guardians WHERE id = ?');
  const alerts = db.prepare('SELECT * FROM alerts WHERE session_id = ? ORDER BY id').all(s.id)
    .map((a) => ({ ...a, sent_at: iso(a.sent_at), ack_at: iso(a.ack_at), payload: JSON.parse(a.payload), ...(a.target_type === 'guardian' ? gname.get(a.target_id) : {}) }));
  const hosp = alerts.filter((a) => a.target_type === 'hospital' && a.status !== 'cancelled').pop();
  const timeline = db.prepare('SELECT step, at, actor FROM session_events WHERE session_id = ? ORDER BY id').all(s.id)
    .map((e) => ({ step: e.step, at: iso(e.at), actor: e.actor }));
  return {
    ...s, created_at: iso(s.created_at), closed_at: iso(s.closed_at),
    patient: s.patient_id ? patientSummary(s.patient_id) : null,
    hospital, alerts, hospital_status: hosp ? hosp.status : null, decline_reason: hosp ? hosp.decline_reason : null,
    cancelled: Boolean(s.cancelled_at), timeline,
  };
}

router.get('/sessions/:id', (req, res, next) => {
  try {
    guard(req, loadSession(req.params.id), req.query.key);
    res.json(fullSession(req.params.id));
  } catch (e) { next(e); }
});

router.post('/sessions/:id/arrive', (req, res, next) => {
  try {
    const s = loadSession(req.params.id);
    guard(req, s, (req.body || {}).key);
    if (s.cancelled_at) throw httpError(400, 'This emergency was cancelled');
    if (s.status !== 'arrived') {
      getDb().prepare("UPDATE emergency_sessions SET status='arrived', closed_at=CURRENT_TIMESTAMP WHERE id=?").run(s.id);
      logEvent(s.id, 'Patient arrived at the hospital', req.user && req.user.role === 'hospital_staff' ? 'Hospital staff' : 'Bystander');
      const h = s.chosen_hospital_id ? getDb().prepare('SELECT name FROM hospitals WHERE id = ?').get(s.chosen_hospital_id) : null;
      if (s.patient_id) notifyGuardians(s.id, s.patient_id, { kind: 'arrived', title: 'Patient has arrived', body: h ? `${h.name} has received the patient.` : 'The patient reached the hospital.' });
    }
    res.json(fullSession(s.id));
  } catch (e) { next(e); }
});

// False alarm / accidental SOS: closes the emergency and tells everyone who was alerted.
router.post('/sessions/:id/cancel', (req, res, next) => {
  try {
    const s = loadSession(req.params.id);
    guard(req, s, (req.body || {}).key);
    if (s.status === 'arrived') throw httpError(400, 'This emergency is already closed');
    const db = getDb();
    if (!s.cancelled_at) {
      db.prepare("UPDATE emergency_sessions SET cancelled_at = CURRENT_TIMESTAMP, closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(s.id);
      const live = db.prepare("SELECT * FROM alerts WHERE session_id = ? AND status NOT IN ('cancelled','declined')").all(s.id);
      db.prepare("UPDATE alerts SET status = 'cancelled' WHERE session_id = ? AND status NOT IN ('declined')").run(s.id);
      for (const a of live.filter((x) => x.target_type === 'hospital')) {
        notifyHospital(s.id, a.target_id, { kind: 'cancelled', title: 'Emergency cancelled', body: 'The caller reported a false alarm. No patient is coming.' });
      }
      if (live.some((a) => a.target_type === 'guardian')) {
        notifyGuardians(s.id, s.patient_id, { kind: 'cancelled', title: 'False alarm', body: 'The emergency alert was cancelled. Everything is fine.' });
      }
      logEvent(s.id, 'Emergency cancelled (false alarm)', 'Bystander');
    }
    res.json(fullSession(s.id));
  } catch (e) { next(e); }
});

// Optional callback details so the hospital can reach the person who called.
router.post('/sessions/:id/caller', (req, res, next) => {
  try {
    const s = loadSession(req.params.id);
    guard(req, s, (req.body || {}).key);
    const b = req.body || {};
    getDb().prepare('UPDATE emergency_sessions SET bystander_name = ?, bystander_phone = ? WHERE id = ?')
      .run(String(b.name || '').trim().slice(0, 80) || null, String(b.phone || '').trim().slice(0, 30) || null, s.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
