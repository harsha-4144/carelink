// Patient self-service: profile, consent, guardians, emergency history.
const express = require('express');
const QRCode = require('qrcode');
const { getDb, badRequest, httpError, iso } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();
router.use('/me', requireRole('patient'));

function guardianRows(patientId) {
  return getDb().prepare('SELECT id, guardian_name, phone, relation, email, user_id IS NOT NULL AS linked FROM guardians WHERE patient_id = ? ORDER BY priority, id')
    .all(patientId).map((g) => ({ ...g, linked: Boolean(g.linked) }));
}

router.get('/me/profile', async (req, res, next) => {
  try {
    const p = getDb().prepare('SELECT blood_group, allergies, conditions, medications, qr_token, consent_flags FROM patient_profiles WHERE user_id = ?').get(req.user.id);
    const { qr_token, consent_flags, ...profile } = p;
    res.json({
      user: { name: req.user.name, phone: req.user.phone, email: req.user.email, carelink_id: req.user.carelink_id },
      profile, consent: JSON.parse(consent_flags || '{}'),
      qr_data_url: await QRCode.toDataURL(qr_token, { margin: 2, width: 300 }),
      guardians: guardianRows(req.user.id),
    });
  } catch (e) { next(e); }
});

router.put('/me/profile', (req, res, next) => {
  try {
    const b = req.body || {};
    const consent = b.consent || {};
    if (consent.medical === false) throw badRequest('Medical consent is required to keep an emergency profile');
    const db = getDb();
    const cur = JSON.parse(db.prepare('SELECT consent_flags FROM patient_profiles WHERE user_id = ?').get(req.user.id).consent_flags || '{}');
    const next_consent = { medical: true, guardian_alerts: consent.guardian_alerts !== undefined ? consent.guardian_alerts === true : cur.guardian_alerts !== false, face: consent.face !== undefined ? consent.face === true : cur.face === true };
    const s = (v, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : d);
    db.transaction(() => {
      if (b.name !== undefined) {
        if (!s(b.name)) throw badRequest('name cannot be empty');
        db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(s(b.name), b.phone || null, req.user.id);
      }
      db.prepare('UPDATE patient_profiles SET blood_group = ?, allergies = ?, conditions = ?, medications = ?, consent_flags = ? WHERE user_id = ?')
        .run(b.blood_group || null, s(b.allergies, 'None known'), s(b.conditions, 'None'), s(b.medications, 'None'), JSON.stringify(next_consent), req.user.id);
      // Withdrawing face consent deletes the stored descriptor.
      if (!next_consent.face) db.prepare('UPDATE patient_profiles SET face_embedding = NULL WHERE user_id = ?').run(req.user.id);
    })();
    res.json({ ok: true, consent: next_consent });
  } catch (e) { next(e); }
});

router.post('/me/guardians', (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.guardian_name || !String(b.guardian_name).trim()) throw badRequest('guardian_name is required');
    const email = String(b.email || '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid guardian email');
    const db = getDb();
    if (db.prepare('SELECT COUNT(*) c FROM guardians WHERE patient_id = ?').get(req.user.id).c >= 5) throw badRequest('You can add up to 5 guardians');
    const gUser = email ? db.prepare("SELECT id FROM users WHERE email = ? AND role = 'guardian'").get(email) : null;
    const prio = db.prepare('SELECT COALESCE(MAX(priority), 0) + 1 p FROM guardians WHERE patient_id = ?').get(req.user.id).p;
    db.prepare('INSERT INTO guardians (patient_id, guardian_name, phone, relation, priority, email, user_id) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, String(b.guardian_name).trim(), b.phone || null, b.relation || null, prio, email, gUser ? gUser.id : null);
    res.json({ guardians: guardianRows(req.user.id) });
  } catch (e) { next(e); }
});

router.delete('/me/guardians/:id', (req, res, next) => {
  try {
    const db = getDb();
    if (db.prepare('SELECT COUNT(*) c FROM guardians WHERE patient_id = ?').get(req.user.id).c <= 1) throw badRequest('Keep at least one guardian');
    const r = db.prepare('DELETE FROM guardians WHERE id = ? AND patient_id = ?').run(Number(req.params.id), req.user.id);
    if (!r.changes) throw httpError(404, 'Guardian not found');
    res.json({ guardians: guardianRows(req.user.id) });
  } catch (e) { next(e); }
});

router.get('/me/sessions', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT s.id, s.triggered_by, s.symptoms, s.urgency_level, s.urgency_reason, s.needed_specialty, s.status,
        s.eta_min, s.created_at, s.closed_at, h.name AS hospital_name
      FROM emergency_sessions s LEFT JOIN hospitals h ON h.id = s.chosen_hospital_id
      WHERE s.patient_id = ? ORDER BY s.id DESC LIMIT 20`).all(req.user.id);
    const ev = db.prepare('SELECT step, at FROM session_events WHERE session_id = ? ORDER BY id');
    res.json({ sessions: rows.map((r) => ({ ...r, created_at: iso(r.created_at), closed_at: iso(r.closed_at), timeline: ev.all(r.id).map((e) => ({ step: e.step, at: iso(e.at) })) })) });
  } catch (e) { next(e); }
});

module.exports = router;
