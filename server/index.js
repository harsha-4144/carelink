require('dotenv').config();
const path = require('path');
const express = require('express');
const { getDb } = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
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
    face_enabled: process.env.ENABLE_FACE === 'true',
  });
});

// ROUTES-MOUNT

app.use('/api', (req, res) => res.status(404).json({ message: 'Unknown API route' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

if (require.main === module) {
  getDb();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`CARELINK AI running on http://localhost:${port}`));
}

module.exports = { app, demoCenter };
