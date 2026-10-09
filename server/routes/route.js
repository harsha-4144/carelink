const express = require('express');
const { getDb, logEvent, loadSession, badRequest } = require('../db');
const { getRoute } = require('../services/routing');

const router = express.Router();

router.post('/route', async (req, res, next) => {
  try {
    const { session_id, hospital_id } = req.body || {};
    if (session_id == null || hospital_id == null) throw badRequest('session_id and hospital_id are required');
    const s = loadSession(session_id);
    const h = getDb().prepare('SELECT * FROM hospitals WHERE id = ?').get(Number(hospital_id));
    if (!h) return res.status(404).json({ message: 'Hospital not found' });
    const route = await getRoute({ lat: s.lat, lng: s.lng }, h);
    getDb().prepare('UPDATE emergency_sessions SET chosen_hospital_id=?, eta_min=? WHERE id=?').run(h.id, route.eta_min, s.id);
    logEvent(s.id, `Route to ${h.name} planned: ${route.eta_min} min, ${route.distance_km} km`, 'System');
    res.json(route);
  } catch (e) { next(e); }
});

module.exports = router;
