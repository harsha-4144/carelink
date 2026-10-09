process.env.MOCK_MODE = 'true';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../server/db');
const { seed } = require('../server/seed');
const { matchHospitals } = require('../server/services/matching');

const db = openDb(':memory:');
seed(db);
const hospitals = db.prepare('SELECT * FROM hospitals').all();
const center = { lat: 17.7231, lng: 83.3013 };

const run = (urgency_level, needed_specialty, hour = 12) =>
  matchHospitals({ hospitals, ...center, urgency_level, needed_specialty, now: new Date(2026, 0, 1, hour) });

test('Critical cardiac case ranks Heartline first', async () => {
  for (const hour of [3, 9, 12, 18]) {
    const r = await run('Critical', 'cardiology', hour);
    assert.strictEqual(r[0].name, 'Heartline Cardiac Centre', `hour ${hour}`);
  }
});

test('Lakeview never appears for Critical or Urgent', async () => {
  for (const [u, s] of [['Critical', 'general'], ['Urgent', 'general'], ['Urgent', 'trauma'], ['Critical', 'neurology']]) {
    const r = await run(u, s);
    assert.ok(!r.some((h) => h.name.includes('Lakeview')), `${u}/${s}`);
  }
});

test('exactly 3 results, scores within 0-100 and descending', async () => {
  for (const u of ['Critical', 'Urgent', 'Stable']) {
    const r = await run(u, 'trauma');
    assert.strictEqual(r.length, 3);
    for (let i = 0; i < r.length; i++) {
      assert.ok(r[i].score >= 0 && r[i].score <= 100);
      if (i) assert.ok(r[i - 1].score >= r[i].score);
      assert.strictEqual(r[i].traffic, 'simulated');
      assert.ok(r[i].reasons.length >= 2 && r[i].reasons.length <= 3);
      assert.deepStrictEqual(Object.keys(r[i].breakdown), ['S', 'F', 'E', 'D', 'T']);
    }
  }
});
