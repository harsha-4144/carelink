const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.MOCK_MODE = 'true';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carelink-')), 'test.db');

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

const call = async (method, url, body, cookie) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const login = async (email) => (await call('POST', '/api/auth/login', { email, password: 'demo1234' })).cookie;

test('full emergency flow', async () => {
  const em = await call('POST', '/api/emergency', { lat: 17.72, lng: 83.3, triggered_by: 'sos' });
  assert.strictEqual(em.json.status, 'triggered');
  const sid = em.json.session_id;
  const key = em.json.access_key;
  assert.ok(key);

  const found = await call('POST', '/api/identify', { session_id: sid, method: 'id', value: 'CL-1001' });
  assert.strictEqual(found.json.found, true);
  assert.strictEqual(found.json.patient.name, 'Asha Verma');
  const raw = JSON.stringify(found.json);
  assert.ok(!raw.includes('qr_token') && !raw.includes('face_embedding'));

  const miss = await call('POST', '/api/identify', { session_id: sid, method: 'id', value: 'CL-9999' });
  assert.strictEqual(miss.json.found, false);
  assert.strictEqual(miss.json.reason, 'not_found');

  const tri = await call('POST', '/api/triage', { session_id: sid, symptoms: 'unconscious and not breathing' });
  assert.strictEqual(tri.json.urgency_level, 'Critical');

  const m = await call('GET', `/api/hospitals/match?session_id=${sid}`);
  const hs = m.json.hospitals;
  assert.strictEqual(hs.length, 3);
  for (let i = 1; i < 3; i++) assert.ok(hs[i - 1].score >= hs[i].score);

  const rt = await call('POST', '/api/route', { session_id: sid, hospital_id: hs[0].id });
  assert.strictEqual(typeof rt.json.eta_min, 'number');
  assert.strictEqual(rt.json.source, 'estimate');

  const al = await call('POST', '/api/alert', { session_id: sid, hospital_id: hs[0].id });
  assert.strictEqual(al.json.alerts.filter((a) => a.target_type === 'hospital').length, 1);
  assert.strictEqual(al.json.alerts.filter((a) => a.target_type === 'guardian').length, 1);

  const staff = await login('priya@demo.test');
  const staff2 = await login('kiran@demo.test');
  const hid = hs[0].id; // Heartline (hospital 2) for a Critical cardiac case
  const mine = hid === 2 ? staff2 : staff;
  const list = await call('GET', `/api/alerts?target_type=hospital&target_id=${hid}`, null, mine);
  assert.ok(list.json.alerts.some((a) => a.session_id === sid && a.payload.urgency_level === 'Critical'));

  const ses = await call('GET', `/api/sessions/${sid}?key=${key}`);
  assert.strictEqual(ses.json.status, 'alerted');
  assert.ok(ses.json.timeline.length > 0);
  assert.ok(!('access_key' in ses.json));

  const arr = await call('POST', `/api/sessions/${sid}/arrive`, { key });
  assert.strictEqual(arr.json.status, 'arrived');
});

test('unidentified patient still gets alerted', async () => {
  const sid = (await call('POST', '/api/emergency', { triggered_by: 'voice' })).json.session_id;
  await call('POST', '/api/triage', { session_id: sid, symptoms: 'fracture' });
  const hs = (await call('GET', `/api/hospitals/match?session_id=${sid}`)).json.hospitals;
  const al = await call('POST', '/api/alert', { session_id: sid, hospital_id: hs[0].id });
  assert.strictEqual(al.json.alerts.length, 1);
  const su = await call('POST', '/api/auth/signup', { role: 'hospital_staff', name: 'S', email: `s${hs[0].id}@t.test`, password: 'password123', hospital_id: hs[0].id, staff_code: 'HACKHERS' });
  const list = await call('GET', `/api/alerts?target_type=hospital&target_id=${hs[0].id}`, null, su.cookie);
  assert.strictEqual(list.json.alerts[0].payload.patient_summary, 'Unidentified patient');
});

test('errors: 400 and 404', async () => {
  assert.strictEqual((await call('POST', '/api/emergency', { triggered_by: 'bogus' })).status, 400);
  assert.strictEqual((await call('GET', '/api/sessions/99999')).status, 404);
  assert.strictEqual((await call('GET', '/api/alerts?target_type=hospital&target_id=1')).status, 401);
  assert.strictEqual((await call('POST', '/api/identify', { session_id: 99999, method: 'id', value: 'x' })).status, 404);
  assert.strictEqual((await call('POST', '/api/triage', { session_id: 1 })).status, 400);
  assert.strictEqual((await call('GET', '/api/hospitals/match')).status, 400);
});

test('face identify is disabled by default', async () => {
  const sid = (await call('POST', '/api/emergency', { triggered_by: 'manual' })).json.session_id;
  const r = await call('POST', '/api/identify', { session_id: sid, method: 'face', value: [0.1] });
  assert.deepStrictEqual(r.json, { found: false, reason: 'face_disabled' });
});

test('QR identify works and PNG endpoint serves', async () => {
  const reg = await call('POST', '/api/patients', {
    name: 'Qr Tester', guardian_name: 'G', email: 'qr@t.test', password: 'password123', consent: { medical: true, guardian_alerts: true, face: false },
  });
  assert.match(reg.json.carelink_id, /^CL-\d+$/);
  const sid = (await call('POST', '/api/emergency', {})).json.session_id;
  const r = await call('POST', '/api/identify', { session_id: sid, method: 'qr', value: reg.json.qr_token });
  assert.strictEqual(r.json.found, true);
  assert.strictEqual((await fetch(`${base}/api/patients/${reg.json.carelink_id}/qr`)).status, 401);
  const png = await fetch(`${base}/api/patients/${reg.json.carelink_id}/qr`, { headers: { Cookie: reg.cookie } });
  assert.strictEqual(png.headers.get('content-type'), 'image/png');
});

test('patient registration consent', async () => {
  const body = { name: 'Test Person', blood_group: 'A+', guardian_name: 'G', guardian_phone: '1', guardian_relation: 'Friend', email: 'tp@t.test', password: 'password123' };
  assert.strictEqual((await call('POST', '/api/patients', { ...body, consent: { medical: true, guardian_alerts: false } })).status, 400);
  assert.strictEqual((await call('POST', '/api/patients', body)).status, 400);
  const ok = await call('POST', '/api/patients', { ...body, consent: { medical: true, guardian_alerts: true, face: false } });
  assert.strictEqual(ok.status, 200);
  assert.match(ok.json.carelink_id, /^CL-/);
  assert.ok(ok.json.qr_data_url.startsWith('data:image/png'));
});
