const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient','guardian','hospital_staff')),
  phone TEXT, carelink_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  blood_group TEXT, allergies TEXT, conditions TEXT, medications TEXT,
  face_embedding TEXT, qr_token TEXT UNIQUE, consent_flags TEXT
);
CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES users(id),
  guardian_name TEXT NOT NULL, phone TEXT, relation TEXT, priority INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  specialties TEXT NOT NULL,
  emergency_facilities TEXT NOT NULL,
  icu_available INTEGER DEFAULT 1, phone TEXT
);
CREATE TABLE IF NOT EXISTS emergency_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER REFERENCES users(id),
  triggered_by TEXT, symptoms TEXT, urgency_level TEXT, urgency_reason TEXT,
  needed_specialty TEXT, lat REAL, lng REAL, chosen_hospital_id INTEGER REFERENCES hospitals(id),
  eta_min REAL, status TEXT DEFAULT 'triggered'
    CHECK (status IN ('triggered','assessed','matched','alerted','arrived')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES emergency_sessions(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('guardian','hospital')),
  target_id INTEGER NOT NULL, payload TEXT NOT NULL, sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  delivered INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
  step TEXT NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

// Columns added after the original spec (accounts, guardian links, alert workflow). Safe on old DB files.
function ensureColumn(d, table, col, ddl) {
  if (!d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
}

function migrate(d) {
  ensureColumn(d, 'users', 'email', 'TEXT');
  ensureColumn(d, 'users', 'password_hash', 'TEXT');
  ensureColumn(d, 'users', 'hospital_id', 'INTEGER');
  ensureColumn(d, 'guardians', 'user_id', 'INTEGER');
  ensureColumn(d, 'guardians', 'email', 'TEXT');
  ensureColumn(d, 'alerts', 'status', "TEXT DEFAULT 'new'");
  ensureColumn(d, 'emergency_sessions', 'access_key', 'TEXT');
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
}

let db = null;

function openDb(file) {
  const p = file || process.env.DB_PATH || './data/carelink.db';
  if (p !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  const d = new Database(p);
  d.pragma('journal_mode = WAL');
  d.exec(SCHEMA);
  migrate(d);
  return d;
}

function getDb() {
  if (!db) db = openDb();
  return db;
}

function logEvent(sessionId, step) {
  getDb().prepare('INSERT INTO session_events (session_id, step) VALUES (?, ?)').run(sessionId, step);
}

const STATUS_ORDER = ['triggered', 'assessed', 'matched', 'alerted', 'arrived'];

// Move a session forward only; never regress (e.g. re-running match after alert).
function advanceStatus(sessionId, status) {
  const row = getDb().prepare('SELECT status FROM emergency_sessions WHERE id = ?').get(sessionId);
  if (row && STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(row.status)) {
    getDb().prepare('UPDATE emergency_sessions SET status = ? WHERE id = ?').run(status, sessionId);
  }
}

// Throws a 404 error (handled by express error middleware) when the session is unknown.
function loadSession(id) {
  const s = getDb().prepare('SELECT * FROM emergency_sessions WHERE id = ?').get(Number(id));
  if (!s) {
    const e = new Error('Session not found');
    e.status = 404;
    throw e;
  }
  return s;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const badRequest = (message) => httpError(400, message);

// SQLite timestamps are UTC without a zone marker; make them ISO so browsers parse them correctly.
function iso(ts) {
  return ts ? ts.replace(' ', 'T') + 'Z' : ts;
}

// Emergency summary only: never includes qr_token or face_embedding.
function patientSummary(patientId) {
  const d = getDb();
  const p = d.prepare(`SELECT u.id, u.name, u.carelink_id, pp.blood_group, pp.allergies, pp.conditions, pp.medications
    FROM users u JOIN patient_profiles pp ON pp.user_id = u.id WHERE u.id = ?`).get(patientId);
  if (!p) return null;
  p.guardians = d.prepare('SELECT id, guardian_name, phone, relation FROM guardians WHERE patient_id = ? ORDER BY priority, id').all(patientId);
  return p;
}

module.exports = { openDb, getDb, logEvent, advanceStatus, loadSession, badRequest, httpError, iso, patientSummary };
