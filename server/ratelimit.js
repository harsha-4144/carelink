// Tiny in-memory fixed-window limiter (no dependency). One process, demo scale.
const { httpError } = require('./db');

function limiter({ windowMs, max, message = 'Too many requests, slow down' }) {
  const hits = new Map();
  return (req, res, next) => {
    if (process.env.RATE_LIMIT === 'off') return next();
    const now = Date.now();
    const key = req.ip;
    const e = hits.get(key);
    if (!e || now - e.start > windowMs) { hits.set(key, { start: now, n: 1 }); return next(); }
    if (++e.n > max) return next(httpError(429, message));
    next();
  };
}

module.exports = { limiter };
