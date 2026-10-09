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
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
  step TEXT NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

let db = null;

function openDb(file) {
  const p = file || process.env.DB_PATH || './data/carelink.db';
  if (p !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  const d = new Database(p);
  d.pragma('journal_mode = WAL');
  d.exec(SCHEMA);
  return d;
}

function getDb() {
  if (!db) db = openDb();
  return db;
}

function logEvent(sessionId, step) {
  getDb().prepare('INSERT INTO session_events (session_id, step) VALUES (?, ?)').run(sessionId, step);
}

module.exports = { openDb, getDb, logEvent };
