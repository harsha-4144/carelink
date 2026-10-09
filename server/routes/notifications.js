const express = require('express');
const { getDb, iso, httpError } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/notifications', requireRole(), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, kind, title, body, link, session_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id);
  res.json({
    unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).c,
    notifications: rows.map((r) => ({ ...r, created_at: iso(r.created_at), read: Boolean(r.read_at) })),
  });
});

router.post('/notifications/read', requireRole(), (req, res) => {
  getDb().prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').run(req.user.id);
  res.json({ ok: true });
});

// The "SMS log": every text CARELINK would have sent. Shown so the demo is transparent about what is simulated.
router.get('/outbox', (req, res, next) => {
  if (process.env.DEMO_MODE === 'false') return next(httpError(404, 'Not found'));
  const rows = getDb().prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all();
  res.json({ messages: rows.map((r) => ({ ...r, created_at: iso(r.created_at) })) });
});

module.exports = router;
