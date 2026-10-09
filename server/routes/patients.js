const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { getDb, badRequest, httpError } = require('../db');
const { hashPassword, startSession, publicUser } = require('../auth');

const router = express.Router();

router.post('/patients', async (req, res, next) => {
  try {
    const b = req.body || {};
    const consent = b.consent || {};
    if (!b.name || typeof b.name !== 'string' || !b.name.trim()) throw badRequest('name is required');
    if (consent.medical !== true) throw badRequest('Consent to store medical information is required');
    if (consent.guardian_alerts !== true) throw badRequest('Consent to alert guardians is required');
    if (!b.guardian_name || !String(b.guardian_name).trim()) throw badRequest('guardian_name is required');
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address');
    if (typeof b.password !== 'string' || b.password.length < 8) throw badRequest('Password must be at least 8 characters');

    const db = getDb();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw httpError(409, 'An account with this email already exists');
    const qr_token = crypto.randomBytes(8).toString('hex');
    let face = null;
    if (consent.face === true && process.env.ENABLE_FACE === 'true' &&
        Array.isArray(b.face_descriptor) && b.face_descriptor.length === 128) {
      face = JSON.stringify(b.face_descriptor);
    }
    const gEmail = String(b.guardian_email || '').trim().toLowerCase() || null;
    const created = db.transaction(() => {
      const row = db.prepare("SELECT MAX(CAST(SUBSTR(carelink_id, 4) AS INTEGER)) m FROM users WHERE carelink_id LIKE 'CL-%'").get();
      const carelink_id = 'CL-' + ((row.m || 1000) + 1);
      const id = db.prepare("INSERT INTO users (name, role, phone, carelink_id, email, password_hash) VALUES (?, 'patient', ?, ?, ?, ?)")
        .run(b.name.trim(), b.phone || null, carelink_id, email, hashPassword(b.password)).lastInsertRowid;
      db.prepare(`INSERT INTO patient_profiles (user_id, blood_group, allergies, conditions, medications, face_embedding, qr_token, consent_flags)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, b.blood_group || null, b.allergies || 'None known', b.conditions || 'None',
        b.medications || 'None', face, qr_token,
        JSON.stringify({ medical: true, guardian_alerts: true, face: consent.face === true }));
      // If that guardian already has an account, link it straight away.
      const gUser = gEmail ? db.prepare("SELECT id FROM users WHERE email = ? AND role = 'guardian'").get(gEmail) : null;
      db.prepare('INSERT INTO guardians (patient_id, guardian_name, phone, relation, priority, email, user_id) VALUES (?,?,?,?,1,?,?)')
        .run(id, String(b.guardian_name).trim(), b.guardian_phone || null, b.guardian_relation || null, gEmail, gUser ? gUser.id : null);
      return { id: Number(id), carelink_id };
    })();
    startSession(res, created.id);
    const qr_data_url = await QRCode.toDataURL(qr_token, { margin: 2, width: 300 });
    res.json({ ...created, qr_token, qr_data_url, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(created.id)) });
  } catch (e) { next(e); }
});

router.get('/patients/:carelink_id/qr', async (req, res, next) => {
  try {
    const row = getDb().prepare(`SELECT pp.qr_token FROM users u JOIN patient_profiles pp ON pp.user_id = u.id
      WHERE u.carelink_id = ?`).get(String(req.params.carelink_id).toUpperCase());
    // The QR is the patient's key: only the patient themselves may fetch it.
    if (!req.user || req.user.role !== 'patient' || req.user.carelink_id !== String(req.params.carelink_id).toUpperCase()) {
      return res.status(req.user ? 403 : 401).json({ message: 'Only the patient can view their QR code' });
    }
    if (!row) return res.status(404).json({ message: 'Patient not found' });
    const png = await QRCode.toBuffer(row.qr_token, { margin: 2, width: 300 });
    res.type('image/png').send(png);
  } catch (e) { next(e); }
});

module.exports = router;
