const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.MOCK_MODE = 'true';
process.env.RATE_LIMIT = 'off';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carelink-auth-')), 'test.db');

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
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0], raw: r.headers.get('set-cookie') };
};
const login = async (email, password = 'demo1234') => call('POST', '/api/auth/login', { email, password });

test('login: good, bad password, unknown email; cookie is HttpOnly', async () => {
  const ok = await login('asha@demo.test');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.user.role, 'patient');
  assert.match(ok.raw, /HttpOnly/);
  assert.ok(!JSON.stringify(ok.json).includes('password'));
  assert.strictEqual((await login('asha@demo.test', 'wrongpass1')).status, 401);
  assert.strictEqual((await login('nobody@demo.test')).status, 401);
});

test('me and logout', async () => {
  assert.strictEqual((await call('GET', '/api/auth/me')).json.user, null);
  const { cookie } = await login('priya@demo.test');
  const me = await call('GET', '/api/auth/me', null, cookie);
  assert.strictEqual(me.json.user.role, 'hospital_staff');
  assert.strictEqual(me.json.user.hospital_name, 'Riverside General Hospital');
  await call('POST', '/api/auth/logout', {}, cookie);
  assert.strictEqual((await call('GET', '/api/auth/me', null, cookie)).json.user, null);
});

test('signup validation: duplicate email, short password, staff code, guardian must be invited', async () => {
  const base_ = { name: 'T', email: 'new@t.test', password: 'password123' };
  assert.strictEqual((await call('POST', '/api/auth/signup', { ...base_, role: 'guardian', email: 'asha@demo.test' })).status, 409);
  assert.strictEqual((await call('POST', '/api/auth/signup', { ...base_, role: 'guardian', password: 'short' })).status, 400);
  assert.strictEqual((await call('POST', '/api/auth/signup', { ...base_, role: 'guardian' })).status, 400); // not invited
  assert.strictEqual((await call('POST', '/api/auth/signup', { ...base_, role: 'hospital_staff', hospital_id: 1, staff_code: 'nope' })).status, 403);
  const ok = await call('POST', '/api/auth/signup', { ...base_, role: 'hospital_staff', hospital_id: 3, staff_code: 'HACKHERS' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.user.hospital_id, 3);
});

test('patient invites a guardian by email, guardian signs up and sees the patient', async () => {
  const p = await call('POST', '/api/patients', {
    name: 'Nia Patient', email: 'nia@t.test', password: 'password123', guardian_name: 'Gil', guardian_email: 'gil@t.test',
    consent: { medical: true, guardian_alerts: true },
  });
  assert.strictEqual(p.status, 200);
  const g = await call('POST', '/api/auth/signup', { role: 'guardian', name: 'Gil', email: 'gil@t.test', password: 'password123' });
  assert.strictEqual(g.status, 200);
  const ov = await call('GET', '/api/guardian/overview', null, g.cookie);
  assert.deepStrictEqual(ov.json.patients.map((x) => x.name), ['Nia Patient']);
  const prof = await call('GET', '/api/me/profile', null, p.cookie);
  assert.strictEqual(prof.json.guardians[0].linked, true);
});

test('role separation', async () => {
  const patient = (await login('asha@demo.test')).cookie;
  const guardian = (await login('rohan@demo.test')).cookie;
  const staff1 = (await login('priya@demo.test')).cookie;
  assert.strictEqual((await call('GET', '/api/me/profile')).status, 401);
  assert.strictEqual((await call('GET', '/api/me/profile', null, guardian)).status, 403);
  assert.strictEqual((await call('GET', '/api/guardian/overview', null, patient)).status, 403);
  assert.strictEqual((await call('GET', '/api/hospital/me', null, patient)).status, 403);
  assert.strictEqual((await call('GET', '/api/alerts?target_type=hospital&target_id=2', null, staff1)).status, 403);
  assert.strictEqual((await call('GET', '/api/alerts?target_type=hospital&target_id=1', null, staff1)).status, 200);
});

test('emergency visibility and hospital workflow end to end', async () => {
  const em = await call('POST', '/api/emergency', { triggered_by: 'sos' });
  const sid = em.json.session_id, key = em.json.access_key;
  await call('POST', '/api/identify', { session_id: sid, method: 'id', value: 'CL-1001' });
  await call('POST', '/api/triage', { session_id: sid, symptoms: 'fracture' });
  await call('POST', '/api/route', { session_id: sid, hospital_id: 1 });
  const al = await call('POST', '/api/alert', { session_id: sid, hospital_id: 1 });
  const hospAlert = al.json.alerts.find((a) => a.target_type === 'hospital');

  // anonymous without key: denied; with key: ok
  assert.strictEqual((await call('GET', `/api/sessions/${sid}`)).status, 401);
  assert.strictEqual((await call('GET', `/api/sessions/${sid}?key=wrong`)).status, 401);
  assert.strictEqual((await call('GET', `/api/sessions/${sid}?key=${key}`)).status, 200);
  // the right guardian and patient can read; the wrong ones cannot
  const rohan = (await login('rohan@demo.test')).cookie;
  const sunita = (await login('sunita@demo.test')).cookie;
  const ravi = (await login('ravi@demo.test')).cookie;
  assert.strictEqual((await call('GET', `/api/sessions/${sid}`, null, rohan)).status, 200);
  assert.strictEqual((await call('GET', `/api/sessions/${sid}`, null, sunita)).status, 403);
  assert.strictEqual((await call('GET', `/api/sessions/${sid}`, null, ravi)).status, 403);
  assert.strictEqual((await call('GET', `/api/sessions/${sid}`, null, (await login('asha@demo.test')).cookie)).status, 200);

  // staff of hospital 1 move the alert along; staff of hospital 2 cannot touch it
  const priya = (await login('priya@demo.test')).cookie;
  const kiran = (await login('kiran@demo.test')).cookie;
  assert.strictEqual((await call('POST', `/api/alerts/${hospAlert.id}/status`, { status: 'preparing' }, kiran)).status, 403);
  assert.strictEqual((await call('POST', `/api/alerts/${hospAlert.id}/status`, { status: 'bogus' }, priya)).status, 400);
  assert.strictEqual((await call('POST', `/api/alerts/${hospAlert.id}/status`, { status: 'preparing' }, priya)).status, 200);
  const ses = await call('GET', `/api/sessions/${sid}`, null, rohan);
  assert.strictEqual(ses.json.hospital_status, 'preparing');
  assert.ok(ses.json.timeline.some((t) => /preparing/.test(t.step)));

  // staff can mark arrival; a stranger cannot
  assert.strictEqual((await call('POST', `/api/sessions/${sid}/arrive`, {})).status, 401);
  assert.strictEqual((await call('POST', `/api/sessions/${sid}/arrive`, {}, priya)).json.status, 'arrived');

  // patient history and guardian overview reflect it
  const hist = await call('GET', '/api/me/sessions', null, (await login('asha@demo.test')).cookie);
  assert.strictEqual(hist.json.sessions[0].id, sid);
  const ov = await call('GET', '/api/guardian/overview', null, rohan);
  assert.strictEqual(ov.json.patients[0].sessions[0].status, 'arrived');
});

test('ICU toggle changes matching', async () => {
  const kiran = (await login('kiran@demo.test')).cookie;
  const off = await call('POST', '/api/hospital/icu', { icu_available: false }, kiran);
  assert.strictEqual(off.json.hospital.icu_available, false);
  const sid = (await call('POST', '/api/emergency', {})).json.session_id;
  await call('POST', '/api/triage', { session_id: sid, symptoms: 'chest pain' });
  const m = await call('GET', `/api/hospitals/match?session_id=${sid}`);
  const heart = m.json.hospitals.find((h) => h.name.startsWith('Heartline'));
  assert.ok(!heart || !heart.reasons.some((r) => /ICU/.test(r)));
  await call('POST', '/api/hospital/icu', { icu_available: true }, kiran);
});

test('patient edits profile, guardians; consent rules', async () => {
  const c = (await login('meera@demo.test')).cookie;
  assert.strictEqual((await call('PUT', '/api/me/profile', { consent: { medical: false } }, c)).status, 400);
  const up = await call('PUT', '/api/me/profile', { name: 'Meera Nair', blood_group: 'A+', allergies: 'Sulfa drugs, Dust', conditions: 'Asthma', medications: 'Inhaler', consent: { guardian_alerts: false } }, c);
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.consent.guardian_alerts, false);
  const prof = await call('GET', '/api/me/profile', null, c);
  assert.strictEqual(prof.json.profile.allergies, 'Sulfa drugs, Dust');
  assert.ok(!JSON.stringify(prof.json).includes('qr_token'));
  assert.strictEqual((await call('DELETE', `/api/me/guardians/${prof.json.guardians[0].id}`, null, c)).status, 400); // keep one
  const add = await call('POST', '/api/me/guardians', { guardian_name: 'Extra', relation: 'Friend' }, c);
  assert.strictEqual(add.json.guardians.length, 2);
});

test('identify is rate limited', async () => {
  delete process.env.RATE_LIMIT;
  const sid = (await call('POST', '/api/emergency', {})).json.session_id;
  let last;
  for (let i = 0; i < 45; i++) last = await call('POST', '/api/identify', { session_id: sid, method: 'id', value: 'CL-0000' });
  assert.strictEqual(last.status, 429);
  process.env.RATE_LIMIT = 'off';
});
