const express = require('express');
const { getDb, logEvent, loadSession, badRequest, advanceStatus, patientSummary } = require('../db');
const routing = require('../services/routing');

const router = express.Router();

function summaryText(p) {
  return `${p.name} (${p.carelink_id}), blood group ${p.blood_group || 'unknown'}, ` +
    `allergies: ${p.allergies || 'unknown'}, conditions: ${p.conditions || 'unknown'}`;
}

router.post('/alert', (req, res, next) => {
  try {
    const { session_id, hospital_id } = req.body || {};
    if (session_id == null || hospital_id == null) throw badRequest('session_id and hospital_id are required');
    const s = loadSession(session_id);
    const db = getDb();
    const h = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(Number(hospital_id));
    if (!h) return res.status(404).json({ message: 'Hospital not found' });

    let eta = s.eta_min;
    if (eta == null || s.chosen_hospital_id !== h.id) {
      eta = routing.estimate({ lat: s.lat, lng: s.lng }, h).eta_min;
    }
    db.prepare('UPDATE emergency_sessions SET chosen_hospital_id=?, eta_min=? WHERE id=?').run(h.id, eta, s.id);

    const patient = s.patient_id ? patientSummary(s.patient_id) : null;
    const payload = JSON.stringify({
      patient_summary: patient ? summaryText(patient) : 'Unidentified patient',
      urgency_level: s.urgency_level || 'Unassessed',
      urgency_reason: s.urgency_reason || 'Not assessed',
      eta_min: eta,
      location: { lat: s.lat, lng: s.lng },
      hospital_name: h.name,
      needed_specialty: s.needed_specialty || 'general',
    });

    const add = db.prepare('INSERT INTO alerts (session_id, target_type, target_id, payload) VALUES (?,?,?,?)');
    const out = [];
    db.transaction(() => {
      let guardians = [];
      if (patient) {
        const prof = db.prepare('SELECT consent_flags FROM patient_profiles WHERE user_id = ?').get(patient.id);
        const consent = prof && prof.consent_flags ? JSON.parse(prof.consent_flags) : {};
        if (consent.guardian_alerts !== false) guardians = patient.guardians;
      }
      for (const g of guardians) out.push({ id: Number(add.run(s.id, 'guardian', g.id, payload).lastInsertRowid), target_type: 'guardian', target_id: g.id, delivered: 1 });
      out.push({ id: Number(add.run(s.id, 'hospital', h.id, payload).lastInsertRowid), target_type: 'hospital', target_id: h.id, delivered: 1 });
    })();
    advanceStatus(s.id, 'alerted');
    logEvent(s.id, `alerted hospital ${h.name} and ${out.length - 1} guardian(s)`);
    res.json({ alerts: out });
  } catch (e) { next(e); }
});

module.exports = router;
