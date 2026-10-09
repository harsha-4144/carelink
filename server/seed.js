require('dotenv').config();
const crypto = require('crypto');
const { getDb } = require('./db');
const { offset } = require('./services/geo');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'demo1234';

const PATIENTS = [
  ['CL-1001', 'Asha Verma', 'B+', 'Penicillin', 'Type 2 diabetes', 'Metformin', 'Rohan Verma', 'Spouse'],
  ['CL-1002', 'Ravi Kumar', 'O+', 'None known', 'Hypertension', 'Amlodipine', 'Sunita Kumar', 'Spouse'],
  ['CL-1003', 'Meera Nair', 'A+', 'Sulfa drugs', 'Asthma', 'Salbutamol inhaler', 'Anil Nair', 'Father'],
  ['CL-1004', 'Arjun Rao', 'AB-', 'None known', 'Heart disease', 'Aspirin, Atorvastatin', 'Lakshmi Rao', 'Mother'],
  ['CL-1005', 'Sana Khan', 'O-', 'Latex', 'None', 'None', 'Imran Khan', 'Brother'],
];

const HOSPITALS = [
  ['Riverside General Hospital', 1.5, 1.0, ['general', 'trauma', 'orthopedics'], ['emergency_unit', 'icu', 'trauma']],
  ['Heartline Cardiac Centre', 3.0, -2.0, ['cardiology', 'general'], ['emergency_unit', 'icu', 'cath_lab']],
  ['NeuroCare Institute', -2.5, 2.5, ['neurology', 'general'], ['emergency_unit', 'icu', 'stroke_unit']],
  ['City Trauma and Burns Centre', 4.5, 3.5, ['trauma', 'burns', 'orthopedics'], ['emergency_unit', 'icu', 'trauma', 'burns_unit']],
  ['Lakeview Community Clinic', 0.8, -0.8, ['general'], []],
  ['Sunrise Multispeciality Hospital', -4.0, -3.0, ['general', 'cardiology', 'pulmonology'], ['emergency_unit', 'icu']],
];

function seed(db = getDb()) {
  const lat = parseFloat(process.env.DEMO_CENTER_LAT || '17.7231');
  const lng = parseFloat(process.env.DEMO_CENTER_LNG || '83.3013');
  db.transaction(() => {
    for (const t of ['notifications', 'outbox', 'auth_sessions', 'session_events', 'alerts', 'emergency_sessions', 'guardians', 'patient_profiles', 'hospitals', 'users']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM sqlite_sequence");
    const pw = hashPassword(DEMO_PASSWORD);
    const addUser = db.prepare('INSERT INTO users (name, role, phone, carelink_id, email, password_hash, hospital_id) VALUES (?,?,?,?,?,?,?)');
    const addProf = db.prepare('INSERT INTO patient_profiles (user_id, blood_group, allergies, conditions, medications, qr_token, consent_flags) VALUES (?,?,?,?,?,?,?)');
    const addGuard = db.prepare('INSERT INTO guardians (patient_id, guardian_name, phone, relation, priority, email, user_id) VALUES (?,?,?,?,1,?,?)');
    const first = (n) => n.split(' ')[0].toLowerCase();
    PATIENTS.forEach((p, i) => {
      const id = addUser.run(p[1], 'patient', `+91-90000-0${1000 + i}`, p[0], `${first(p[1])}@demo.test`, pw, null).lastInsertRowid;
      addProf.run(id, p[2], p[3], p[4], p[5], crypto.randomBytes(8).toString('hex'),
        JSON.stringify({ medical: true, guardian_alerts: true, face: false }));
      const gPhone = `+91-90000-0${2000 + i}`;
      const gEmail = `${first(p[6])}@demo.test`;
      const gUser = addUser.run(p[6], 'guardian', gPhone, null, gEmail, pw, null).lastInsertRowid;
      addGuard.run(id, p[6], gPhone, p[7], gEmail, gUser);
    });
    const addHosp = db.prepare('INSERT INTO hospitals (name, lat, lng, specialties, emergency_facilities, icu_available, phone) VALUES (?,?,?,?,?,?,?)');
    const hospIds = HOSPITALS.map((h, i) => {
      const pos = offset(lat, lng, h[1], h[2]);
      return addHosp.run(h[0], pos.lat, pos.lng, JSON.stringify(h[3]), JSON.stringify(h[4]),
        h[4].includes('icu') ? 1 : 0, `+91-80000-0${3000 + i}`).lastInsertRowid;
    });
    addUser.run('Priya Menon (Riverside)', 'hospital_staff', null, null, 'priya@demo.test', pw, hospIds[0]);
    addUser.run('Kiran Das (Heartline)', 'hospital_staff', null, null, 'kiran@demo.test', pw, hospIds[1]);
    return hospIds;
  })();
}

module.exports = { seed, DEMO_PASSWORD };

if (require.main === module) {
  const db = getDb();
  seed(db);
  const p = db.prepare("SELECT COUNT(*) c FROM users WHERE role='patient'").get().c;
  const h = db.prepare('SELECT COUNT(*) c FROM hospitals').get().c;
  console.log(`Seeded ${p} patients and ${h} hospitals`);
}
