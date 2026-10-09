// Real-world situations: double tap, false alarm, hospital declines, unknown patient linked later,
// guardian acknowledges, notifications and the SMS outbox, patient access log.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.MOCK_MODE = 'true';
process.env.RATE_LIMIT = 'off';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carelink-flows-')), 'test.db');

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
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const login = async (email) => (await call('POST', '/api/auth/login', { email, password: 'demo1234' })).cookie;

async function emergency({ patient = 'CL-1001', symptoms = 'chest pain', hospital = 2 } = {}) {
  const em = (await call('POST', '/api/emergency', { triggered_by: 'sos' })).json;
  if (patient) await call('POST', '/api/identify', { session_id: em.session_id, method: 'id', value: patient });
  await call('POST', '/api/triage', { session_id: em.session_id, symptoms });
  await call('GET', `/api/hospitals/match?session_id=${em.session_id}`);
  await call('POST', '/api/route', { session_id: em.session_id, hospital_id: hospital });
  return em;
}
const alertHospital = (em, hospital = 2) => call('POST', '/api/alert', { session_id: em.session_id, hospital_id: hospital });
const hospAlertId = async (hospital, sid) => {
  const staff = await login(hospital === 2 ? 'kiran@demo.test' : 'priya@demo.test');
  const list = await call('GET', `/api/alerts?target_type=hospital&target_id=${hospital}`, null, staff);
  return { staff, alert: list.json.alerts.find((a) => a.session_id === sid) };
};

test('double tap on Alert creates one alert set, not two', async () => {
  const em = await emergency();
  const a1 = await alertHospital(em);
  const a2 = await alertHospital(em);
  assert.strictEqual(a2.json.existing, true);
  assert.deepStrictEqual(a2.json.alerts.map((x) => x.id), a1.json.alerts.map((x) => x.id));
  const n = getDb().prepare('SELECT COUNT(*) c FROM alerts WHERE session_id = ?').get(em.session_id).c;
  assert.strictEqual(n, 2); // 1 guardian + 1 hospital
});

test('false alarm cancels alerts and notifies hospital and guardian', async () => {
  const em = await emergency();
  await alertHospital(em);
  assert.strictEqual((await call('POST', `/api/sessions/${em.session_id}/cancel`, {})).status, 401); // needs key or login
  const c = await call('POST', `/api/sessions/${em.session_id}/cancel`, { key: em.access_key });
  assert.strictEqual(c.json.cancelled, true);
  const st = getDb().prepare("SELECT status, COUNT(*) c FROM alerts WHERE session_id = ? GROUP BY status").all(em.session_id);
  assert.deepStrictEqual(st, [{ status: 'cancelled', c: 2 }]);
  const kiran = await login('kiran@demo.test');
  const notes = (await call('GET', '/api/notifications', null, kiran)).json.notifications;
  assert.ok(notes.some((n) => n.kind === 'cancelled' && n.session_id === em.session_id));
  const rohan = await login('rohan@demo.test');
  assert.ok((await call('GET', '/api/notifications', null, rohan)).json.notifications.some((n) => n.kind === 'cancelled' && n.session_id === em.session_id));
  // cannot alert or arrive a cancelled emergency
  assert.strictEqual((await alertHospital(em)).status, 400);
  assert.strictEqual((await call('POST', `/api/sessions/${em.session_id}/arrive`, { key: em.access_key })).status, 400);
});

test('hospital declines; caller picks another hospital; guardians follow the new hospital', async () => {
  const em = await emergency();
  await alertHospital(em, 2);
  const { staff, alert } = await hospAlertId(2, em.session_id);
  assert.strictEqual((await call('POST', `/api/alerts/${alert.id}/decline`, {}, staff)).status, 400); // reason required
  assert.strictEqual((await call('POST', `/api/alerts/${alert.id}/decline`, { reason: 'Cath lab busy' }, staff)).status, 200);
  let ses = (await call('GET', `/api/sessions/${em.session_id}?key=${em.access_key}`)).json;
  assert.strictEqual(ses.hospital_status, 'declined');
  assert.strictEqual(ses.decline_reason, 'Cath lab busy');
  // re-alert another hospital
  const again = await alertHospital(em, 1);
  assert.strictEqual(again.status, 200);
  ses = (await call('GET', `/api/sessions/${em.session_id}?key=${em.access_key}`)).json;
  assert.strictEqual(ses.hospital.id, 1);
  assert.strictEqual(ses.hospital_status, 'new');
  const live = ses.alerts.filter((a) => a.status === 'new');
  assert.strictEqual(live.filter((a) => a.target_type === 'guardian').length, 1);
  assert.ok(ses.alerts.some((a) => a.target_type === 'guardian' && a.status === 'cancelled'));
});

test('switching hospital before any response withdraws the first alert', async () => {
  const em = await emergency();
  await alertHospital(em, 2);
  await alertHospital(em, 1);
  const rows = getDb().prepare("SELECT target_type, target_id, status FROM alerts WHERE session_id = ? ORDER BY id").all(em.session_id);
  assert.deepStrictEqual(rows.filter((r) => r.target_type === 'hospital').map((r) => [r.target_id, r.status]), [[2, 'cancelled'], [1, 'new']]);
});

test('unknown patient: hospital links CARELINK ID, guardians are alerted afterwards', async () => {
  const em = await emergency({ patient: null, symptoms: 'unconscious', hospital: 1 });
  await call('POST', `/api/sessions/${em.session_id}/caller`, { key: em.access_key, name: 'Passer-by Maya', phone: '+91-90000-11111' });
  const al = await alertHospital(em, 1);
  assert.strictEqual(al.json.alerts.length, 1); // hospital only
  const { staff, alert } = await hospAlertId(1, em.session_id);
  assert.strictEqual(alert.payload.caller.name, 'Passer-by Maya');
  assert.strictEqual(alert.payload.patient_summary, 'Unidentified patient');
  assert.strictEqual((await call('POST', `/api/alerts/${alert.id}/link-patient`, { carelink_id: 'CL-9999' }, staff)).status, 404);
  const linked = await call('POST', `/api/alerts/${alert.id}/link-patient`, { carelink_id: 'cl-1002' }, staff);
  assert.strictEqual(linked.json.guardians_alerted, 1);
  assert.strictEqual((await call('POST', `/api/alerts/${alert.id}/link-patient`, { carelink_id: 'CL-1003' }, staff)).status, 400); // already identified
  const sunita = await login('sunita@demo.test'); // Ravi Kumar's guardian
  const notes = (await call('GET', '/api/notifications', null, sunita)).json.notifications;
  assert.ok(notes.some((n) => n.session_id === em.session_id && n.kind === 'emergency'));
  const refreshed = await hospAlertId(1, em.session_id);
  assert.match(refreshed.alert.payload.patient_summary, /Ravi Kumar/);
});

test('guardian acknowledges and says on my way; hospital and timeline show it', async () => {
  const em = await emergency();
  await alertHospital(em, 2);
  const rohan = await login('rohan@demo.test');
  const ov = await call('GET', '/api/guardian/overview', null, rohan);
  const ses = (await call('GET', `/api/sessions/${em.session_id}`, null, rohan)).json;
  const gAlert = ses.alerts.find((a) => a.target_type === 'guardian');
  assert.strictEqual((await call('POST', `/api/alerts/${gAlert.id}/ack`, { note: 'on_my_way' }, await login('sunita@demo.test'))).status, 403);
  assert.strictEqual((await call('POST', `/api/alerts/${gAlert.id}/ack`, { note: 'on_my_way' }, rohan)).json.ack_note, 'on_my_way');
  const { alert } = await hospAlertId(2, em.session_id);
  assert.strictEqual(alert.family[0].ack_note, 'on_my_way');
  assert.ok(alert.family[0].guardian_name);
  const after = (await call('GET', `/api/sessions/${em.session_id}?key=${em.access_key}`)).json;
  assert.ok(after.timeline.some((t) => /on the way/.test(t.step) && t.actor === 'Guardian'));
  assert.ok(ov.json.patients.length >= 1);
});

test('notifications: unread count, mark read; SMS outbox records the texts', async () => {
  const em = await emergency({ patient: 'CL-1003' });
  await alertHospital(em, 2);
  const anil = await login('anil@demo.test');
  const n1 = (await call('GET', '/api/notifications', null, anil)).json;
  assert.ok(n1.unread >= 1);
  await call('POST', '/api/notifications/read', {}, anil);
  assert.strictEqual((await call('GET', '/api/notifications', null, anil)).json.unread, 0);
  assert.strictEqual((await call('GET', '/api/notifications')).status, 401);
  const box = (await call('GET', '/api/outbox')).json.messages;
  assert.ok(box.some((m) => m.session_id === em.session_id && /Meera Nair/.test(m.body)));
  assert.ok(box.some((m) => m.session_id === em.session_id && m.to_name === 'Heartline Cardiac Centre'));
});

test('patient access log shows who looked up the ID', async () => {
  const em = await emergency({ patient: 'CL-1005' });
  const sana = await login('sana@demo.test');
  const log = (await call('GET', '/api/me/access-log', null, sana)).json.entries;
  assert.ok(log.some((e) => e.session_id === em.session_id && /Emergency ID looked up via CARELINK ID/.test(e.step) && e.actor === 'Bystander'));
  assert.strictEqual((await call('GET', '/api/me/access-log')).status, 401);
});

test('hospital arrival notifies guardians; guardian alerts respect withdrawn consent', async () => {
  const meera = await login('meera@demo.test');
  await call('PUT', '/api/me/profile', { name: 'Meera Nair', consent: { guardian_alerts: false } }, meera);
  const em = await emergency({ patient: 'CL-1003' });
  const al = await alertHospital(em, 2);
  assert.strictEqual(al.json.alerts.filter((a) => a.target_type === 'guardian').length, 0);
  const { alert } = await hospAlertId(2, em.session_id);
  assert.strictEqual(alert.payload.guardian_alerts, false);
  const em2 = await emergency({ patient: 'CL-1001' });
  await alertHospital(em2, 2);
  const kiran = await login('kiran@demo.test');
  await call('POST', `/api/sessions/${em2.session_id}/arrive`, {}, kiran);
  const notes = (await call('GET', '/api/notifications', null, await login('rohan@demo.test'))).json.notifications;
  assert.ok(notes.some((n) => n.kind === 'arrived' && n.session_id === em2.session_id));
});
