const express = require('express');
const { getDb, logEvent, loadSession, badRequest, advanceStatus } = require('../db');
const { triage } = require('../services/triage');

const router = express.Router();

router.post('/triage', async (req, res, next) => {
  try {
    const { session_id, symptoms, conscious, breathing } = req.body || {};
    if (session_id == null) throw badRequest('session_id is required');
    if (typeof symptoms !== 'string') throw badRequest('symptoms must be a string');
    const session = loadSession(session_id);
    const r = await triage({
      symptoms,
      conscious: typeof conscious === 'boolean' ? conscious : undefined,
      breathing: typeof breathing === 'boolean' ? breathing : undefined,
    });
    getDb().prepare('UPDATE emergency_sessions SET symptoms=?, urgency_level=?, urgency_reason=?, needed_specialty=? WHERE id=?')
      .run(symptoms, r.urgency_level, r.urgency_reason, r.needed_specialty, session.id);
    advanceStatus(session.id, 'assessed');
    logEvent(session.id, `Assessed as ${r.urgency_level}: ${r.urgency_reason.replace(/^Matched: /, '')}`, 'System');
    res.json(r);
  } catch (e) { next(e); }
});

module.exports = router;
