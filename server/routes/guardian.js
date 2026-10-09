// Guardian dashboard data: the patients linked to this guardian account and their recent emergencies.
const express = require('express');
const { getDb, iso } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/guardian/overview', requireRole('guardian'), (req, res, next) => {
  try {
    const db = getDb();
    const links = db.prepare(`SELECT g.id AS guardian_id, g.relation, u.id AS patient_id, u.name, u.carelink_id,
        pp.blood_group, pp.allergies, pp.conditions, pp.medications
      FROM guardians g JOIN users u ON u.id = g.patient_id JOIN patient_profiles pp ON pp.user_id = u.id
      WHERE g.user_id = ? ORDER BY u.name`).all(req.user.id);
    const sess = db.prepare(`SELECT s.id, s.status, s.urgency_level, s.urgency_reason, s.eta_min, s.created_at, s.closed_at, h.name AS hospital_name,
        (SELECT status FROM alerts a WHERE a.session_id = s.id AND a.target_type = 'hospital' ORDER BY a.id DESC LIMIT 1) AS hospital_status
      FROM emergency_sessions s LEFT JOIN hospitals h ON h.id = s.chosen_hospital_id
      WHERE s.patient_id = ? ORDER BY s.id DESC LIMIT 5`);
    res.json({
      patients: links.map((l) => ({
        ...l,
        sessions: sess.all(l.patient_id).map((s) => ({ ...s, created_at: iso(s.created_at), closed_at: iso(s.closed_at) })),
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
