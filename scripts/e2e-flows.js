// Browser walk-through of every persona flow. Needs Playwright (not a project dependency):
//   npm i --no-save playwright && npx playwright install chromium
//   npm run seed && PORT=3997 RATE_LIMIT=off npm start   (separate terminal)
//   BASE=http://localhost:3997 node scripts/e2e-flows.js [screenshotDir]
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://localhost:3997';
const out = process.argv[2] || require('os').tmpdir();
const ok = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const b = await chromium.launch();
  const mk = async (opts = {}) => { const c = await b.newContext({ geolocation: { latitude: 17.7231, longitude: 83.3013 }, permissions: ['geolocation'], ...opts }); const p = await c.newPage(); p.on('pageerror', (e) => console.log('  PAGEERROR', e.message)); return p; };
  const phone = await mk({ viewport: { width: 390, height: 844 }, isMobile: true });
  const hosp = await mk({ viewport: { width: 1280, height: 800 } });
  const guard = await mk({ viewport: { width: 1280, height: 800 } });
  const login = async (p, email) => { await p.goto(base + '/login.html'); await p.fill('#email', email); await p.fill('#password', 'demo1234'); await p.click('#login-btn'); await p.waitForURL(/\/(hospital|guardian|patient)\.html/); };
  await login(hosp, 'kiran@demo.test'); await login(guard, 'rohan@demo.test');
  await hosp.goto(base + '/hospital.html'); await guard.goto(base + '/guardian.html');

  console.log('A. accidental SOS');
  await phone.goto(base + '/emergency.html'); await phone.click('#sos-btn');
  ok(await phone.isVisible('#countdown'), 'countdown shown'); await phone.click('#cd-cancel');
  ok(/Nothing was sent/.test(await phone.textContent('#start-status')), 'cancelled, nothing sent');
  ok(!(await phone.isVisible('#console')), 'console not opened');

  console.log('B. full emergency');
  await phone.click('#sos-btn'); await phone.click('#cd-now'); await phone.waitForSelector('#console:not([hidden])');
  await phone.click('[data-tab="id"]'); await phone.fill('#carelink-id', 'CL-1001'); await phone.click('#id-submit');
  await phone.waitForSelector('#patient-card:not([hidden])'); await phone.screenshot({ path: `${out}/f-identify.png`, fullPage: true });
  await phone.click('#identify-next'); await phone.click('[data-symptom="unconscious"]'); await phone.click('[data-symptom="chest pain"]'); await phone.click('#assess-btn');
  await phone.waitForSelector('#triage-result:not([hidden])'); ok(/Critical/.test(await phone.textContent('#triage-result')), 'Critical');
  await phone.click('#to-match'); await phone.waitForSelector('#hospital-list .card'); await phone.click('#hospital-list .card');
  await phone.waitForSelector('#confirm-bar:not([hidden])'); await phone.waitForTimeout(1500);
  await phone.screenshot({ path: `${out}/f-match.png`, fullPage: true });
  await phone.click('#confirm-bar summary'); await phone.fill('#caller-name', 'Maya (passer-by)'); await phone.fill('#caller-phone', '+91-90000-11111');
  await phone.dblclick('#alert-btn'); // double tap on purpose
  await phone.waitForSelector('#sc-live[data-state=active]'); await phone.waitForTimeout(800);
  ok(/Heartline/.test(await phone.textContent('#live-head')), 'live status names Heartline');
  const n = await (await phone.request.get(base + '/api/health')).json(); ok(n.ok, 'server healthy');

  console.log('C. hospital + guardian react');
  await hosp.waitForSelector('#h-rows tr', { timeout: 8000 }); ok(/Asha/.test(await hosp.textContent('#h-rows')), 'hospital queue shows Asha');
  ok((await hosp.$$('#h-rows tr')).length === 1, 'double tap created only one alert');
  ok(/Maya/.test(await hosp.textContent('#h-rows')), 'hospital sees caller details');
  await guard.waitForSelector('text=ACTIVE EMERGENCY', { timeout: 8000 });
  await hosp.click('button[data-act="accepted"]'); await phone.waitForFunction(() => /accepted/.test(document.getElementById('live-head').textContent), null, { timeout: 8000 });
  ok(true, 'bystander sees "accepted"');
  await guard.click('text=Open live view'); await guard.waitForSelector('#g-respond:not([hidden])', { timeout: 8000 }); await guard.click('#g-omw');
  await hosp.waitForFunction(() => /is on the way/.test(document.getElementById('h-rows').textContent), null, { timeout: 8000 }); ok(true, 'hospital sees "family on the way"');
  await phone.waitForFunction(() => /On the way/.test(document.getElementById('family').textContent), null, { timeout: 8000 }); ok(true, 'bystander sees family on the way');
  await guard.screenshot({ path: `${out}/f-guardian-live.png`, fullPage: true });
  await hosp.screenshot({ path: `${out}/f-hospital.png`, fullPage: true });
  await phone.screenshot({ path: `${out}/f-live.png`, fullPage: true });

  console.log('E. refresh and resume');
  await phone.reload(); await phone.waitForSelector('#resume-box:not([hidden])'); await phone.click('#resume-btn');
  await phone.waitForSelector('#sc-live[data-state=active]'); ok(true, 'resumed into live status');

  console.log('D. hospital declines, caller re-matches');
  await hosp.click('button[data-act="decline"]'); await hosp.waitForSelector('#decline-dlg[open]'); await hosp.click('#decline-ok');
  await phone.waitForSelector('#decline-note:not([hidden])', { timeout: 8000 }); ok(/ICU full/.test(await phone.textContent('#decline-note')), 'bystander told: ICU full');
  await phone.waitForSelector('#hospital-list .card');
  ok(!(await phone.textContent('#hospital-list')).includes('Heartline'), 'declined hospital not offered again');
  await phone.screenshot({ path: `${out}/f-declined.png`, fullPage: true });
  await phone.click('#hospital-list .card'); await phone.waitForSelector('#confirm-bar:not([hidden])'); await phone.waitForTimeout(1200); await phone.click('#alert-btn');
  await phone.waitForSelector('#sc-live[data-state=active]'); ok(!/Heartline/.test(await phone.textContent('#live-head')), 'now alerting a different hospital');

  console.log('F. false alarm');
  await phone.click('#cancel-btn'); await phone.click('#cancel-btn');
  await phone.waitForFunction(() => /cancelled/i.test(document.getElementById('live-head').textContent), null, { timeout: 8000 }); ok(true, 'cancelled');
  await guard.waitForFunction(() => /cancelled/i.test(document.body.textContent), null, { timeout: 8000 }); ok(true, 'guardian told it was a false alarm');

  console.log('G. unknown patient identified by hospital');
  await phone.goto(base + '/emergency.html'); await phone.click('#sos-btn'); await phone.click('#cd-now'); await phone.waitForSelector('#console:not([hidden])');
  await phone.click('#skip-identify'); await phone.click('[data-symptom="chest pain"]'); await phone.click('#assess-btn'); await phone.waitForSelector('#triage-result:not([hidden])');
  await phone.click('#to-match'); await phone.waitForSelector('#hospital-list .card'); await phone.click('#hospital-list .card'); await phone.waitForSelector('#confirm-bar:not([hidden])'); await phone.waitForTimeout(1200);
  await phone.click('#alert-btn'); await phone.waitForSelector('#sc-live[data-state=active]');
  ok(/not identified/.test(await phone.textContent('#family')), 'bystander told family not alerted yet');
  await hosp.reload(); await hosp.waitForSelector('#h-rows tr');
  await hosp.click('button[data-act="link"]'); await hosp.waitForSelector('#link-dlg[open]'); await hosp.fill('#link-id', 'CL-1002'); await hosp.click('#link-ok');
  await phone.waitForFunction(() => /Sunita/.test(document.getElementById('family').textContent), null, { timeout: 8000 }); ok(true, 'after linking, family (Sunita) is alerted and shown');
  await phone.click('#arrive-btn'); await phone.waitForFunction(() => /arrived/i.test(document.getElementById('live-head').textContent), null, { timeout: 8000 }); ok(true, 'arrived closes the incident');

  console.log('H. notifications and SMS log');
  const g2 = await mk(); await login(g2, 'sunita@demo.test'); await g2.goto(base + '/guardian.html'); await g2.waitForSelector('#bell-btn');
  ok(await g2.isVisible('#bell-count'), 'guardian bell shows unread count'); await g2.click('#bell-btn'); await g2.screenshot({ path: `${out}/f-bell.png` });
  await g2.goto(base + '/outbox.html'); await g2.waitForSelector('.sms'); await g2.screenshot({ path: `${out}/f-outbox.png`, fullPage: true }); ok(true, 'SMS log lists messages');
  const pat = await mk(); await login(pat, 'asha@demo.test'); await pat.goto(base + '/patient.html'); await pat.click('[data-tab="access"]'); await pat.waitForSelector('#a-list .card'); ok(/looked up/.test(await pat.textContent('#a-list')), 'patient sees access log');
  await b.close(); console.log('ALL FLOWS PASSED');
})().catch((e) => { console.error('FLOW FAIL:', e.message); process.exit(1); });
