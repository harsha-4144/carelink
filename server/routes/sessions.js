const express = require('express');
const { getDb, logEvent, loadSession, iso, patientSummary } = require('../db');

const router = express.Router();

function fullSession(id) {
  const db = getDb();
  const s = loadSession(id);
  const hospital = s.chosen_hospital_id
    ? db.prepare('SELECT id, name, lat, lng, phone FROM hospitals WHERE id = ?').get(s.chosen_hospital_id) : null;
  const alerts = db.prepare('SELECT * FROM alerts WHERE session_id = ? ORDER BY id').all(s.id)
    .map((a) => ({ ...a, sent_at: iso(a.sent_at), payload: JSON.parse(a.payload) }));
  const timeline = db.prepare('SELECT step, at FROM session_events WHERE session_id = ? ORDER BY id').all(s.id)
    .map((e) => ({ step: e.step, at: iso(e.at) }));
  return {
    ...s, created_at: iso(s.created_at), closed_at: iso(s.closed_at),
    patient: s.patient_id ? patientSummary(s.patient_id) : null,
    hospital, alerts, timeline,
  };
}

router.get('/sessions/:id', (req, res, next) => {
  try { res.json(fullSession(req.params.id)); } catch (e) { next(e); }
});

router.post('/sessions/:id/arrive', (req, res, next) => {
  try {
    const s = loadSession(req.params.id);
    if (s.status !== 'arrived') {
      getDb().prepare("UPDATE emergency_sessions SET status='arrived', closed_at=CURRENT_TIMESTAMP WHERE id=?").run(s.id);
      logEvent(s.id, 'arrived');
    }
    res.json(fullSession(s.id));
  } catch (e) { next(e); }
});

module.exports = router;
