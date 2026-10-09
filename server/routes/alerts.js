const express = require('express');
const { getDb, badRequest, iso } = require('../db');

const router = express.Router();

router.get('/alerts', (req, res, next) => {
  try {
    const { target_type, target_id } = req.query;
    if (!['guardian', 'hospital'].includes(target_type)) throw badRequest('target_type must be guardian or hospital');
    if (!Number.isInteger(Number(target_id))) throw badRequest('target_id must be an integer');
    const rows = getDb().prepare('SELECT * FROM alerts WHERE target_type = ? AND target_id = ? ORDER BY id DESC')
      .all(target_type, Number(target_id));
    res.json({ alerts: rows.map((r) => ({ ...r, sent_at: iso(r.sent_at), payload: JSON.parse(r.payload) })) });
  } catch (e) { next(e); }
});

module.exports = router;
