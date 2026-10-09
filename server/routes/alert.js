const express = require('express');
const { getDb, logEvent, loadSession, badRequest, advanceStatus, patientSummary } = require('../db');
const routing = require('../services/routing');
const { buildPayload, createGuardianAlerts } = require('../services/alerting');
const { notifyHospital } = require('../services/notify');

const router = express.Router();

router.post('/alert', (req, res, next) => {
  try {
    const { session_id, hospital_id } = req.body || {};
    if (session_id == null || hospital_id == null) throw badRequest('session_id and hospital_id are required');
    const s = loadSession(session_id);
    if (s.cancelled_at) throw badRequest('This emergency was cancelled');
    if (s.status === 'arrived') throw badRequest('This emergency is already closed');
    const db = getDb();
    const h = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(Number(hospital_id));
    if (!h) return res.status(404).json({ message: 'Hospital not found' });

    // Idempotent: a double tap (or a retry) returns the existing alerts instead of creating new ones.
    const live = db.prepare("SELECT * FROM alerts WHERE session_id = ? AND status NOT IN ('cancelled','declined') ORDER BY id").all(s.id);
    if (live.some((a) => a.target_type === 'hospital' && a.target_id === h.id)) {
      return res.json({ alerts: live.map((a) => ({ id: a.id, target_type: a.target_type, target_id: a.target_id, delivered: a.delivered })), existing: true });
    }
    // The bystander switched hospital: cancel the earlier hospital's alert and tell them.
    for (const a of live.filter((x) => x.target_type === 'hospital')) {
      db.prepare("UPDATE alerts SET status = 'cancelled' WHERE id = ?").run(a.id);
      notifyHospital(s.id, a.target_id, { kind: 'cancelled', title: 'Alert withdrawn', body: 'The caller chose another hospital for this patient.' });
      logEvent(s.id, 'Earlier hospital alert withdrawn (another hospital chosen)', 'Bystander');
    }
    db.prepare("UPDATE alerts SET status = 'cancelled' WHERE session_id = ? AND target_type = 'guardian' AND status NOT IN ('cancelled','declined')").run(s.id);

    let eta = s.eta_min;
    if (eta == null || s.chosen_hospital_id !== h.id) eta = routing.estimate({ lat: s.lat, lng: s.lng }, h).eta_min;
    db.prepare('UPDATE emergency_sessions SET chosen_hospital_id=?, eta_min=? WHERE id=?').run(h.id, eta, s.id);
    const fresh = loadSession(s.id);

    const patient = s.patient_id ? patientSummary(s.patient_id) : null;
    const payload = buildPayload(fresh, patient, h, eta);
    const out = [];
    db.transaction(() => {
      out.push(...createGuardianAlerts(fresh, patient, payload, h));
      const id = db.prepare('INSERT INTO alerts (session_id, target_type, target_id, payload) VALUES (?,?,?,?)').run(s.id, 'hospital', h.id, JSON.stringify(payload)).lastInsertRowid;
      out.push({ id: Number(id), target_type: 'hospital', target_id: h.id, delivered: 1 });
    })();
    notifyHospital(s.id, h.id, {
      kind: 'incoming', title: `Incoming ${payload.urgency_level} patient`,
      body: `${patient ? patient.name : 'Unidentified patient'}, ETA ${Math.round(eta)} min, needs ${payload.needed_specialty}.`,
    });
    advanceStatus(s.id, 'alerted');
    const n = out.length - 1;
    logEvent(s.id, `Alert sent to ${h.name}${patient ? ` and ${n} guardian${n === 1 ? '' : 's'}` : ' (patient not identified, so no guardian alert yet)'}`, 'Bystander');
    res.json({ alerts: out });
  } catch (e) { next(e); }
});

module.exports = router;
