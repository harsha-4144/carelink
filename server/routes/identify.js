const express = require('express');
const { getDb, logEvent, loadSession, badRequest, patientSummary } = require('../db');

const router = express.Router();

// Euclidean distance between two face descriptors (used only when ENABLE_FACE=true).
function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function findPatientId(method, value) {
  const db = getDb();
  if (method === 'id') {
    const r = db.prepare("SELECT id FROM users WHERE carelink_id = ? AND role = 'patient'").get(String(value).trim().toUpperCase());
    return r && r.id;
  }
  if (method === 'qr') {
    const r = db.prepare('SELECT user_id FROM patient_profiles WHERE qr_token = ?').get(String(value).trim());
    return r && r.user_id;
  }
  // face
  if (!Array.isArray(value) || value.length !== 128 || !value.every((n) => typeof n === 'number')) return null;
  let best = null;
  for (const row of db.prepare('SELECT user_id, face_embedding FROM patient_profiles WHERE face_embedding IS NOT NULL').all()) {
    const d = distance(value, JSON.parse(row.face_embedding));
    if (d < 0.6 && (!best || d < best.d)) best = { d, id: row.user_id };
  }
  return best && best.id;
}

router.post('/identify', (req, res, next) => {
  try {
    const { session_id, method, value } = req.body || {};
    if (session_id == null) throw badRequest('session_id is required');
    if (!['id', 'qr', 'face'].includes(method)) throw badRequest('method must be id, qr or face');
    if (value == null || value === '') throw badRequest('value is required');
    const session = loadSession(session_id);

    if (method === 'face' && process.env.ENABLE_FACE !== 'true') {
      logEvent(session.id, 'identify (face): disabled');
      return res.json({ found: false, reason: 'face_disabled' });
    }
    const patientId = findPatientId(method, value);
    const patient = patientId ? patientSummary(patientId) : null;
    if (!patient) {
      logEvent(session.id, `identify (${method}): not found`);
      return res.json({ found: false, reason: 'not_found' });
    }
    getDb().prepare('UPDATE emergency_sessions SET patient_id = ? WHERE id = ?').run(patient.id, session.id);
    logEvent(session.id, `identify (${method}): found ${patient.carelink_id}`);
    res.json({ found: true, patient });
  } catch (e) { next(e); }
});

module.exports = router;
