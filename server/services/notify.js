// One place that tells people things: an in-app notification and a simulated SMS (the "outbox").
// A real SMS provider would be plugged in here; nothing leaves the machine today.
const { getDb } = require('../db');

function notifyUser(userId, { kind, title, body, link, sessionId }) {
  if (!userId) return;
  getDb().prepare('INSERT INTO notifications (user_id, kind, title, body, link, session_id) VALUES (?,?,?,?,?,?)')
    .run(userId, kind || 'info', title, body || null, link || null, sessionId || null);
}

function sms(sessionId, toName, toPhone, body) {
  getDb().prepare('INSERT INTO outbox (session_id, to_name, to_phone, body) VALUES (?,?,?,?)').run(sessionId || null, toName || null, toPhone || null, body);
}

// Every guardian of the patient: in-app if they have an account, SMS to their phone always.
function notifyGuardians(sessionId, patientId, { kind, title, body, link }) {
  if (!patientId) return 0;
  const rows = getDb().prepare('SELECT * FROM guardians WHERE patient_id = ? ORDER BY priority, id').all(patientId);
  for (const g of rows) {
    notifyUser(g.user_id, { kind, title, body, link: link || `/guardian.html?session=${sessionId}`, sessionId });
    sms(sessionId, g.guardian_name, g.phone, `${title}. ${body || ''}`.trim());
  }
  return rows.length;
}

// All staff of the hospital, plus an SMS to the hospital's emergency line.
function notifyHospital(sessionId, hospitalId, { kind, title, body }) {
  const db = getDb();
  for (const u of db.prepare("SELECT id FROM users WHERE role = 'hospital_staff' AND hospital_id = ?").all(hospitalId)) {
    notifyUser(u.id, { kind, title, body, link: '/hospital.html', sessionId });
  }
  const h = db.prepare('SELECT name, phone FROM hospitals WHERE id = ?').get(hospitalId);
  if (h) sms(sessionId, h.name, h.phone, `${title}. ${body || ''}`.trim());
}

module.exports = { notifyUser, notifyGuardians, notifyHospital, sms };
