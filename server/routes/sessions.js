const express = require('express');
const { getDb, logEvent, loadSession, httpError, iso, patientSummary } = require('../db');

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
  const alerts = db.prepare('SELECT * FROM alerts WHERE session_id = ? ORDER BY id').all(s.id)
    .map((a) => ({ ...a, sent_at: iso(a.sent_at), payload: JSON.parse(a.payload) }));
  const hosp = alerts.filter((a) => a.target_type === 'hospital').pop();
  const timeline = db.prepare('SELECT step, at FROM session_events WHERE session_id = ? ORDER BY id').all(s.id)
    .map((e) => ({ step: e.step, at: iso(e.at) }));
  return {
    ...s, created_at: iso(s.created_at), closed_at: iso(s.closed_at),
    patient: s.patient_id ? patientSummary(s.patient_id) : null,
    hospital, alerts, hospital_status: hosp ? hosp.status : null, timeline,
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
    if (s.status !== 'arrived') {
      getDb().prepare("UPDATE emergency_sessions SET status='arrived', closed_at=CURRENT_TIMESTAMP WHERE id=?").run(s.id);
      logEvent(s.id, 'arrived');
    }
    res.json(fullSession(s.id));
  } catch (e) { next(e); }
});

module.exports = router;
