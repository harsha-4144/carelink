const express = require('express');
const { getDb, logEvent, loadSession, badRequest, advanceStatus } = require('../db');
const { matchHospitals } = require('../services/matching');

const router = express.Router();

router.get('/hospitals', (req, res) => {
  const rows = getDb().prepare('SELECT id, name, lat, lng, phone FROM hospitals ORDER BY id').all();
  res.json({ hospitals: rows });
});

router.get('/hospitals/match', async (req, res, next) => {
  try {
    if (!req.query.session_id) throw badRequest('session_id is required');
    const s = loadSession(req.query.session_id);
    if (!s.urgency_level) throw badRequest('Run triage before matching hospitals');
    const hospitals = await matchHospitals({
      hospitals: getDb().prepare('SELECT * FROM hospitals').all(),
      lat: s.lat, lng: s.lng,
      urgency_level: s.urgency_level, needed_specialty: s.needed_specialty,
    });
    advanceStatus(s.id, 'matched');
    logEvent(s.id, 'matched');
    res.json({ urgency_level: s.urgency_level, hospitals });
  } catch (e) { next(e); }
});

module.exports = router;
