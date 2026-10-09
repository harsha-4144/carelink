// Building alert payloads and fanning them out to guardians. Shared by POST /alert and "link patient".
const { getDb, patientSummary } = require('../db');
const { notifyGuardians } = require('./notify');

function summaryText(p) {
  return `${p.name} (${p.carelink_id}), blood group ${p.blood_group || 'unknown'}, ` +
    `allergies: ${p.allergies || 'unknown'}, conditions: ${p.conditions || 'unknown'}`;
}

function guardianAlertsAllowed(patient) {
  const prof = getDb().prepare('SELECT consent_flags FROM patient_profiles WHERE user_id = ?').get(patient.id);
  const consent = prof && prof.consent_flags ? JSON.parse(prof.consent_flags) : {};
  return consent.guardian_alerts !== false;
}

function buildPayload(s, patient, hospital, eta) {
  return {
    patient_summary: patient ? summaryText(patient) : 'Unidentified patient',
    urgency_level: s.urgency_level || 'Unassessed',
    urgency_reason: s.urgency_reason || 'Not assessed',
    eta_min: eta,
    location: { lat: s.lat, lng: s.lng },
    hospital_name: hospital.name,
    needed_specialty: s.needed_specialty || 'general',
    caller: s.bystander_name || s.bystander_phone ? { name: s.bystander_name || null, phone: s.bystander_phone || null } : null,
    guardian_alerts: patient ? guardianAlertsAllowed(patient) : null,
  };
}

// Creates one alert row per guardian (if the patient consented) and notifies them. Returns the new alert rows.
function createGuardianAlerts(s, patient, payload, hospital) {
  if (!patient || !guardianAlertsAllowed(patient)) return [];
  const db = getDb();
  const add = db.prepare('INSERT INTO alerts (session_id, target_type, target_id, payload) VALUES (?,?,?,?)');
  const rows = patient.guardians.map((g) => ({
    id: Number(add.run(s.id, 'guardian', g.id, JSON.stringify(payload)).lastInsertRowid), target_type: 'guardian', target_id: g.id, delivered: 1,
  }));
  notifyGuardians(s.id, patient.id, {
    kind: 'emergency', title: `Emergency: ${patient.name} is being taken to ${hospital.name}`,
    body: `${payload.urgency_level}, arriving in about ${Math.round(payload.eta_min)} min. Open CARELINK for live status.`,
  });
  return rows;
}

module.exports = { summaryText, buildPayload, createGuardianAlerts, patientSummary };
