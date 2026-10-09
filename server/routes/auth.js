const express = require('express');
const { getDb, badRequest, httpError } = require('../db');
const { hashPassword, verifyPassword, startSession, endSession, publicUser } = require('../auth');
const { limiter } = require('../ratelimit');

const router = express.Router();
const loginLimit = limiter({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many attempts, try again in a few minutes' });

const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function checkCredentials(email, password) {
  if (!validEmail(email)) throw badRequest('Enter a valid email address');
  if (typeof password !== 'string' || password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (getDb().prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw httpError(409, 'An account with this email already exists');
}

// Guardian and hospital staff sign-up. Patients sign up through POST /api/patients.
router.post('/auth/signup', (req, res, next) => {
  try {
    const b = req.body || {};
    const email = normEmail(b.email);
    const name = String(b.name || '').trim();
    if (!name) throw badRequest('name is required');
    checkCredentials(email, b.password);
    const db = getDb();

    if (b.role === 'guardian') {
      // A guardian can only join once a patient has added their email as a guardian.
      const rows = db.prepare('SELECT id FROM guardians WHERE lower(email) = ? AND user_id IS NULL').all(email);
      if (!rows.length) throw badRequest('No patient has added this email as a guardian yet. Ask them to add you from their CARELINK profile.');
      const id = db.transaction(() => {
        const uid = db.prepare("INSERT INTO users (name, role, phone, email, password_hash) VALUES (?, 'guardian', ?, ?, ?)")
          .run(name, b.phone || null, email, hashPassword(b.password)).lastInsertRowid;
        db.prepare('UPDATE guardians SET user_id = ? WHERE lower(email) = ?').run(uid, email);
        return uid;
      })();
      startSession(res, id);
      return res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
    }

    if (b.role === 'hospital_staff') {
      const code = process.env.STAFF_CODE || 'HACKHERS';
      if (b.staff_code !== code) throw httpError(403, 'Invalid hospital staff access code');
      const h = db.prepare('SELECT id FROM hospitals WHERE id = ?').get(Number(b.hospital_id));
      if (!h) throw badRequest('Choose your hospital');
      const id = db.prepare("INSERT INTO users (name, role, phone, email, password_hash, hospital_id) VALUES (?, 'hospital_staff', ?, ?, ?, ?)")
        .run(name, b.phone || null, email, hashPassword(b.password), h.id).lastInsertRowid;
      startSession(res, id);
      return res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
    }
    throw badRequest('role must be guardian or hospital_staff (patients register at /register.html)');
  } catch (e) { next(e); }
});

router.post('/auth/login', loginLimit, (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const u = getDb().prepare('SELECT * FROM users WHERE email = ?').get(normEmail(email));
    // Same message for unknown email and wrong password.
    if (!u || typeof password !== 'string' || !verifyPassword(password, u.password_hash)) throw httpError(401, 'Wrong email or password');
    startSession(res, u.id);
    res.json({ user: publicUser(u) });
  } catch (e) { next(e); }
});

router.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

// 200 with user:null when logged out, so pages can call it without error banners.
router.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
