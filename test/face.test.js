const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.MOCK_MODE = 'true';
process.env.ENABLE_FACE = 'true';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carelink-face-')), 'test.db');

const test = require('node:test');
const assert = require('node:assert');
const { getDb } = require('../server/db');
const { seed } = require('../server/seed');
const { app } = require('../server/index');

let server, base;
test.before(async () => {
  seed(getDb());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const vec = (x) => Array.from({ length: 128 }, (_, i) => (i === 0 ? x : 0));
let n = 0;
const person = () => ({ name: 'Face P', guardian_name: 'G', email: `face${++n}@t.test`, password: 'password123' });

test('descriptor is stored only with face consent', async () => {
  const withC = await call('POST', '/api/patients', { ...person(), face_descriptor: vec(0.5), consent: { medical: true, guardian_alerts: true, face: true } });
  const noC = await call('POST', '/api/patients', { ...person(), face_descriptor: vec(0.5), consent: { medical: true, guardian_alerts: true, face: false } });
  const stored = (id) => getDb().prepare('SELECT face_embedding FROM patient_profiles WHERE user_id = ?').get(id).face_embedding;
  assert.ok(stored(withC.json.id));
  assert.strictEqual(stored(noC.json.id), null);
});

test('face identify matches within 0.6 and never leaks the embedding', async () => {
  const reg = await call('POST', '/api/patients', { ...person(), name: 'Face Match', face_descriptor: vec(2), consent: { medical: true, guardian_alerts: true, face: true } });
  const sid = (await call('POST', '/api/emergency', {})).json.session_id;
  const near = await call('POST', '/api/identify', { session_id: sid, method: 'face', value: vec(2.3) });
  assert.strictEqual(near.json.found, true);
  assert.strictEqual(near.json.patient.carelink_id, reg.json.carelink_id);
  assert.ok(!JSON.stringify(near.json).includes('face_embedding'));
  const far = await call('POST', '/api/identify', { session_id: sid, method: 'face', value: vec(2.9) });
  assert.strictEqual(far.json.found, false);
  const bad = await call('POST', '/api/identify', { session_id: sid, method: 'face', value: [1, 2, 3] });
  assert.strictEqual(bad.json.found, false);
});
