const express = require('express');
const { getDb, logEvent, badRequest, httpError, iso } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// Hospital staff see their own hospital's queue; guardians see alerts addressed to their own guardian rows.
router.get('/alerts', requireRole('hospital_staff', 'guardian'), (req, res, next) => {
  try {
    const { target_type, target_id } = req.query;
    if (!['guardian', 'hospital'].includes(target_type)) throw badRequest('target_type must be guardian or hospital');
    if (!Number.isInteger(Number(target_id))) throw badRequest('target_id must be an integer');
    const id = Number(target_id);
    const db = getDb();
    if (target_type === 'hospital') {
      if (req.user.role !== 'hospital_staff' || req.user.hospital_id !== id) throw httpError(403, 'This is not your hospital');
    } else {
      const g = db.prepare('SELECT user_id FROM guardians WHERE id = ?').get(id);
      if (req.user.role !== 'guardian' || !g || g.user_id !== req.user.id) throw httpError(403, 'These alerts are not addressed to you');
    }
    const rows = db.prepare(`SELECT a.*, s.status AS session_status, s.urgency_level FROM alerts a JOIN emergency_sessions s ON s.id = a.session_id
      WHERE a.target_type = ? AND a.target_id = ? ORDER BY a.id DESC`).all(target_type, id);
    res.json({ alerts: rows.map((r) => ({ ...r, sent_at: iso(r.sent_at), payload: JSON.parse(r.payload) })) });
  } catch (e) { next(e); }
});

const FLOW = ['new', 'accepted', 'preparing', 'ready'];

// Staff move an incoming patient through accepted -> preparing -> ready; guardians see it live.
router.post('/alerts/:id/status', requireRole('hospital_staff'), (req, res, next) => {
  try {
    const status = (req.body || {}).status;
    if (!FLOW.includes(status) || status === 'new') throw badRequest('status must be accepted, preparing or ready');
    const db = getDb();
    const a = db.prepare("SELECT * FROM alerts WHERE id = ? AND target_type = 'hospital'").get(Number(req.params.id));
    if (!a) throw httpError(404, 'Alert not found');
    if (a.target_id !== req.user.hospital_id) throw httpError(403, 'This is not your hospital');
    db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run(status, a.id);
    const h = db.prepare('SELECT name FROM hospitals WHERE id = ?').get(a.target_id);
    logEvent(a.session_id, `${h.name}: ${status}`);
    res.json({ id: a.id, status });
  } catch (e) { next(e); }
});

module.exports = router;
