// Hospital staff: own hospital info, ICU availability, queue stats.
const express = require('express');
const { getDb, badRequest } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();
router.use('/hospital', requireRole('hospital_staff'));

function info(hospitalId) {
  const db = getDb();
  const h = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(hospitalId);
  const count = (where) => db.prepare(`SELECT COUNT(*) c FROM alerts a JOIN emergency_sessions s ON s.id = a.session_id
    WHERE a.target_type='hospital' AND a.target_id = ? ${where}`).get(hospitalId).c;
  return {
    hospital: { ...h, specialties: JSON.parse(h.specialties), emergency_facilities: JSON.parse(h.emergency_facilities), icu_available: Boolean(h.icu_available) },
    stats: {
      total: count(''),
      active: count("AND s.status != 'arrived'"),
      critical_active: count("AND s.status != 'arrived' AND s.urgency_level = 'Critical'"),
      arrived: count("AND s.status = 'arrived'"),
    },
  };
}

router.get('/hospital/me', (req, res) => res.json(info(req.user.hospital_id)));

router.post('/hospital/icu', (req, res, next) => {
  try {
    if (typeof (req.body || {}).icu_available !== 'boolean') throw badRequest('icu_available must be true or false');
    const h = getDb().prepare('SELECT emergency_facilities FROM hospitals WHERE id = ?').get(req.user.hospital_id);
    if (!JSON.parse(h.emergency_facilities).includes('icu')) throw badRequest('This hospital has no ICU');
    getDb().prepare('UPDATE hospitals SET icu_available = ? WHERE id = ?').run(req.body.icu_available ? 1 : 0, req.user.hospital_id);
    res.json(info(req.user.hospital_id));
  } catch (e) { next(e); }
});

module.exports = router;
