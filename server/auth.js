const crypto = require('crypto');
const { getDb, httpError } = require('./db');

const COOKIE = 'cl_session';
const TTL_DAYS = 7;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_DAYS * 86400000).toISOString();
  getDb().prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, expires);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${TTL_DAYS * 86400}`);
}

function endSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) getDb().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function publicUser(u) {
  if (!u) return null;
  let hospital_name = null;
  if (u.hospital_id) {
    const h = getDb().prepare('SELECT name FROM hospitals WHERE id = ?').get(u.hospital_id);
    hospital_name = h && h.name;
  }
  return { id: u.id, name: u.name, role: u.role, email: u.email, carelink_id: u.carelink_id, hospital_id: u.hospital_id, hospital_name };
}

// Sets req.user (or null) from the session cookie.
function attachUser(req, res, next) {
  req.user = null;
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const row = getDb().prepare(`SELECT u.* FROM auth_sessions a JOIN users u ON u.id = a.user_id
      WHERE a.token_hash = ? AND a.expires_at > ?`).get(sha(token), new Date().toISOString());
    if (row) req.user = row;
  }
  next();
}

// Pass no roles to require just a login.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(httpError(401, 'Please log in'));
    if (roles.length && !roles.includes(req.user.role)) return next(httpError(403, 'Your account cannot do that'));
    next();
  };
}

module.exports = { hashPassword, verifyPassword, startSession, endSession, attachUser, requireRole, publicUser };
