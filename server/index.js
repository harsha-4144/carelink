require('dotenv').config();
const path = require('path');
const express = require('express');
const { getDb } = require('./db');
const { attachUser } = require('./auth');
const { limiter } = require('./ratelimit');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', attachUser);
// Limits ID guessing on the public break-glass lookup.
app.use('/api/identify', limiter({ windowMs: 60 * 1000, max: 40, message: 'Too many lookups, wait a minute' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function demoCenter() {
  return {
    lat: parseFloat(process.env.DEMO_CENTER_LAT || '17.7231'),
    lng: parseFloat(process.env.DEMO_CENTER_LNG || '83.3013'),
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    demo_center: demoCenter(),
    mock_mode: process.env.MOCK_MODE === 'true',
    demo_mode: process.env.DEMO_MODE !== 'false',
    face_enabled: process.env.ENABLE_FACE === 'true',
  });
});

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/me'));
app.use('/api', require('./routes/guardian'));
app.use('/api', require('./routes/hospital'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/emergency'));
app.use('/api', require('./routes/identify'));
app.use('/api', require('./routes/triage'));
app.use('/api', require('./routes/hospitals'));
app.use('/api', require('./routes/route'));
app.use('/api', require('./routes/alert'));
app.use('/api', require('./routes/alerts'));
app.use('/api', require('./routes/sessions'));
app.use('/api', require('./routes/patients'));

app.use('/api', (req, res) => res.status(404).json({ message: 'Unknown API route' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

if (require.main === module) {
  // A fresh clone has an empty database: seed the demo data on first start so the demo just works.
  const db = getDb();
  if (db.prepare('SELECT COUNT(*) c FROM hospitals').get().c === 0) {
    require('./seed').seed(db);
    console.log('Empty database: seeded demo data (5 patients, 6 hospitals, demo accounts).');
  }
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`CARELINK AI running on http://localhost:${port}`));
}

module.exports = { app, demoCenter };
