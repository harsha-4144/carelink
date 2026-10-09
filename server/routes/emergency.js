const crypto = require('crypto');
const express = require('express');
const { getDb, logEvent, badRequest } = require('../db');

const router = express.Router();

router.post('/emergency', (req, res, next) => {
  try {
    const { triggered_by = 'manual', symptoms = null } = req.body || {};
    if (!['voice', 'sos', 'manual'].includes(triggered_by)) throw badRequest('triggered_by must be voice, sos or manual');
    let { lat, lng } = req.body || {};
    if (lat == null || lng == null) {
      lat = parseFloat(process.env.DEMO_CENTER_LAT || '17.7231');
      lng = parseFloat(process.env.DEMO_CENTER_LNG || '83.3013');
    }
    lat = Number(lat); lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw badRequest('lat and lng must be valid numbers');
    }
    // access_key lets the bystander (who has no account) read and close their own session.
    const access_key = crypto.randomBytes(8).toString('hex');
    const id = getDb().prepare('INSERT INTO emergency_sessions (triggered_by, symptoms, lat, lng, access_key) VALUES (?,?,?,?,?)')
      .run(triggered_by, symptoms, lat, lng, access_key).lastInsertRowid;
    logEvent(id, 'triggered');
    res.json({ session_id: Number(id), status: 'triggered', lat, lng, access_key });
  } catch (e) { next(e); }
});

module.exports = router;
