// Bystander incident console. `state` holds the emergency; the server (session + key) is the source of truth
// once an alert is sent, so a refresh can resume from localStorage.
const state = { sessionId: null, key: null, lat: null, lng: null, patient: null, triage: null, hospitals: [], hospital: null, route: null, step: 'identify', startedAt: null, session: null };

const STORE = 'carelink_incident';
const STEPS = ['identify', 'assess', 'hospital', 'live'];
const PROGRESS_ORDER = ['identify', 'assess', 'match', 'route', 'alert', 'prepare', 'arrive'];
const READINESS = [['Alert sent', 'new'], ['Accepted', 'accepted'], ['Preparing', 'preparing'], ['Ready', 'ready'], ['Arrived', 'arrived']];

const store = {
  save() { try { localStorage.setItem(STORE, JSON.stringify({ sessionId: state.sessionId, key: state.key, startedAt: state.startedAt })); } catch (e) { /* private mode */ } },
  load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } },
};

// ---------- step cards ----------
function setStep(name) {
  state.step = name;
  const idx = STEPS.indexOf(name);
  STEPS.forEach((s, i) => { $('sc-' + s).dataset.state = i < idx ? 'done' : i === idx ? 'active' : 'locked'; });
  updateProgress();
}

// Finished cards can be reopened by tapping their header (identify and assess only, before an alert exists).
['identify', 'assess'].forEach((s) => $('sc-' + s).querySelector('.sc-head').addEventListener('click', () => {
  const card = $('sc-' + s);
  if (card.dataset.state === 'done' && state.step !== 'live') setStep(s);
}));

function updateProgress() {
  let key = state.step === 'hospital' ? (state.hospital ? 'route' : 'match') : state.step;
  if (state.step === 'live') {
    const hs = state.session && state.session.hospital_status;
    key = state.session && state.session.status === 'arrived' ? 'arrive' : (['accepted', 'preparing', 'ready'].includes(hs) ? 'prepare' : 'alert');
  }
  const idx = PROGRESS_ORDER.indexOf(key);
  document.querySelectorAll('#progress li').forEach((li) => {
    const i = PROGRESS_ORDER.indexOf(li.dataset.p);
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', i < idx);
  });
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { /* api() already showed the banner */ } finally { btn.disabled = false; }
}

// ---------- 1. start, with a 5 second cancel window ----------
function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 60000 });
  });
}

let cdTimer = null;
function beginCountdown(triggeredBy) {
  if (state.sessionId || cdTimer) return;
  let n = 5;
  $('cd-num').textContent = n;
  $('countdown').hidden = false;
  const finish = () => { clearInterval(cdTimer); cdTimer = null; $('countdown').hidden = true; startEmergency(triggeredBy); };
  cdTimer = setInterval(() => { n -= 1; $('cd-num').textContent = n; if (n <= 0) finish(); }, 1000);
  $('cd-now').onclick = finish;
  $('cd-cancel').onclick = () => { clearInterval(cdTimer); cdTimer = null; $('countdown').hidden = true; $('start-status').textContent = 'Cancelled. Nothing was sent.'; };
}

async function startEmergency(triggeredBy) {
  $('start-status').textContent = 'Getting your location…';
  let pos = await getLocation();
  if (!pos) {
    try { pos = (await api('GET', '/api/health')).demo_center; $('start-status').textContent = 'Location blocked: using demo location.'; } catch (e) { pos = null; }
  }
  try {
    const r = await api('POST', '/api/emergency', Object.assign({ triggered_by: triggeredBy }, pos || {}));
    Object.assign(state, { sessionId: r.session_id, key: r.access_key, lat: r.lat, lng: r.lng, startedAt: Date.now() });
    store.save();
    Voice.stop();
    openConsole();
    setStep('identify');
    refreshTimeline();
    drawCandidatesPlaceholder();
    if (state.faceEnabled) initFaceTab();
  } catch (e) {
    $('start-status').textContent = 'Could not start. Please try again, or call 112.';
  }
}

function openConsole() {
  $('start-panel').hidden = true;
  $('incident-bar').hidden = false;
  $('console').hidden = false;
  $('inc-id').textContent = '#' + state.sessionId;
  window.scrollTo(0, 0);
  tickTimer();
  if (!openConsole.timer) openConsole.timer = setInterval(tickTimer, 1000);
}

function tickTimer() {
  const s = Math.max(0, Math.floor((Date.now() - (state.startedAt || Date.now())) / 1000));
  $('inc-timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  if (state.step === 'live') tickEta();
}

$('sos-btn').addEventListener('click', () => beginCountdown('sos'));

if (Voice.supported) {
  const mic = $('mic-btn');
  mic.hidden = false;
  mic.addEventListener('click', () => {
    if (Voice.active) { Voice.stop(); mic.classList.remove('listening'); mic.textContent = 'Say "emergency"'; return; }
    Voice.listen(
      () => { mic.classList.remove('listening'); beginCountdown('voice'); },
      (s, detail) => {
        mic.classList.toggle('listening', s === 'listening');
        mic.textContent = s === 'listening' ? 'Listening… say "emergency" or "help"' : 'Say "emergency"';
        if (s === 'error') $('start-status').textContent = 'Microphone unavailable (' + detail + '). Use the SOS button.';
      });
  });
}

api('GET', '/api/health').then((h) => { state.faceEnabled = h.face_enabled; }).catch(() => {});

async function refreshTimeline() {
  if (!state.sessionId) return;
  try {
    const s = await api('GET', `/api/sessions/${state.sessionId}?key=${state.key}`, undefined, { quiet: true });
    $('timeline').innerHTML = renderTimeline(s.timeline);
    return s;
  } catch (e) { /* timeline is best effort */ }
}

function drawCandidatesPlaceholder() {
  const ok = CareMap.showCandidates('map', { lat: state.lat, lng: state.lng }, []);
  $('map-fallback').hidden = ok;
  $('map').hidden = !ok;
}

// ---------- resume after refresh / phone lock ----------
async function offerResume() {
  const saved = store.load();
  if (!saved || !saved.sessionId) return;
  try {
    const s = await api('GET', `/api/sessions/${saved.sessionId}?key=${saved.key}`, undefined, { quiet: true });
    if (s.status === 'arrived' || s.cancelled) { store.clear(); return; }
    $('resume-text').textContent = `Emergency #${s.id} started ${fmtTime(s.created_at)}${s.patient ? ' for ' + s.patient.name : ''}.`;
    $('resume-box').hidden = false;
    $('resume-btn').onclick = () => resume(saved, s);
    $('resume-discard').onclick = () => { store.clear(); $('resume-box').hidden = true; };
  } catch (e) { store.clear(); }
}

async function resume(saved, s) {
  Object.assign(state, { sessionId: s.id, key: saved.key, lat: s.lat, lng: s.lng, startedAt: new Date(s.created_at).getTime(), patient: s.patient || null });
  openConsole();
  if (s.patient) fillPatient(s.patient);
  if (s.urgency_level) showTriage({ urgency_level: s.urgency_level, urgency_reason: s.urgency_reason, needed_specialty: s.needed_specialty, source: 'rules' });
  if (s.hospital_status) { state.hospital = s.hospital; setStep('live'); beginLive(); }
  else if (s.urgency_level) { setStep('hospital'); loadMatches(); }
  else setStep(s.patient ? 'assess' : 'identify');
  refreshTimeline();
}
offerResume();

// ---------- 2. identify ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab !== 'qr') QrScan.stop();
}));

if (window.__qrFailed || typeof Html5Qrcode === 'undefined') $('qr-fallback').hidden = false;

$('qr-start').addEventListener('click', () => {
  $('qr-fallback').hidden = true;
  QrScan.start('qr-reader', (text) => identify('qr', text), (msg) => { $('qr-fallback').textContent = msg; $('qr-fallback').hidden = false; });
});

$('id-submit').addEventListener('click', () => {
  const v = $('carelink-id').value.trim();
  if (!v) { $('identify-msg').textContent = 'Type a CARELINK ID first.'; return; }
  withBusy($('id-submit'), () => identify('id', v));
});
$('carelink-id').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('id-submit').click(); });

function fillPatient(p) {
  const guardians = p.guardians.map((g) => `${esc(g.guardian_name)} (${esc(g.relation || 'guardian')})${g.phone ? ` <a href="tel:${esc(g.phone)}">Call</a>` : ''}`).join(' · ');
  $('patient-card').innerHTML = `<h3>${esc(p.name)} <small>(${esc(p.carelink_id)})</small></h3>
    <p><strong>Blood group:</strong> ${esc(p.blood_group)}<br><strong>Allergies:</strong> ${esc(p.allergies)}<br>
    <strong>Conditions:</strong> ${esc(p.conditions)}<br><strong>Medications:</strong> ${esc(p.medications)}<br>
    <strong>Guardian:</strong> ${guardians || 'none on file'}</p>`;
  $('patient-card').hidden = false;
  $('identify-next').hidden = false;
  $('sc-identify-sum').textContent = `${p.name} · ${p.blood_group || '?'}`;
  $('inc-badge').innerHTML = '';
}

async function identify(method, value) {
  const r = await api('POST', '/api/identify', { session_id: state.sessionId, method, value });
  if (!r.found) {
    $('patient-card').hidden = true;
    $('identify-next').hidden = true;
    $('identify-msg').textContent = r.reason === 'face_disabled' ? 'Face recognition is turned off.' : 'No patient found. Try again or skip.';
    return;
  }
  state.patient = r.patient;
  QrScan.stop();
  $('identify-msg').textContent = '';
  fillPatient(r.patient);
  refreshTimeline();
}

$('identify-next').addEventListener('click', () => { QrScan.stop(); setStep('assess'); });
$('skip-identify').addEventListener('click', () => {
  QrScan.stop();
  state.patient = null;
  $('sc-identify-sum').textContent = 'Unknown patient';
  setStep('assess');
});

// ---------- 3. assess ----------
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
}));

function showTriage(r) {
  state.triage = r;
  $('triage-result').innerHTML = `${badge(r.urgency_level)}
    <p><strong>${esc(r.urgency_reason)}</strong><br>Suggested specialty: ${esc(r.needed_specialty)}</p>
    <p class="note">AI estimate, not a diagnosis. (${r.source === 'rules+llm' ? 'rules + AI refinement' : 'rule-based'})</p>`;
  $('triage-result').hidden = false;
  $('to-match').hidden = false;
  $('inc-badge').innerHTML = badge(r.urgency_level);
  $('sc-assess-sum').textContent = `${r.urgency_level} · ${r.needed_specialty}`;
}

$('assess-btn').addEventListener('click', () => withBusy($('assess-btn'), async () => {
  const chips = [...document.querySelectorAll('.chip[aria-pressed=true]')].map((c) => c.dataset.symptom);
  const symptoms = [...chips, $('symptoms').value.trim()].filter(Boolean).join(', ');
  showTriage(await api('POST', '/api/triage', {
    session_id: state.sessionId, symptoms, conscious: $('conscious').checked, breathing: $('breathing').checked,
  }));
  refreshTimeline();
}));

$('to-match').addEventListener('click', () => withBusy($('to-match'), async () => { setStep('hospital'); await loadMatches(); }));

// ---------- 4. hospital: match, route preview, confirm ----------
async function loadMatches() {
  $('hospital-list').innerHTML = '<p class="empty">Finding the best hospitals…</p>';
  state.hospital = null;
  $('confirm-bar').hidden = true;
  try {
    state.hospitals = (await api('GET', '/api/hospitals/match?session_id=' + state.sessionId)).hospitals;
  } catch (e) {
    $('hospital-list').innerHTML = '<p class="empty"><b>Could not load hospitals</b>Call 112 now, or go back and try again.</p>';
    return;
  }
  if (!state.hospitals.length) { $('hospital-list').innerHTML = '<p class="empty"><b>No suitable hospital nearby</b>Call 112.</p>'; return; }
  const ok = CareMap.showCandidates('map', { lat: state.lat, lng: state.lng }, state.hospitals);
  $('map-fallback').hidden = ok;
  $('map').hidden = !ok;
  $('hospital-list').innerHTML = state.hospitals.map((h, i) => `
    <label class="card selectable" data-id="${h.id}">
      ${i === 0 ? '<span class="rec">RECOMMENDED</span>' : ''}
      <input type="radio" name="hospital" value="${h.id}">
      <h3>${i + 1}. ${esc(h.name)} <span class="score" title="Match score out of 100">${h.score}</span></h3>
      <div class="meta"><span>${esc(h.eta_min)} min</span><span>${esc(h.distance_km)} km</span><span class="note">simulated traffic</span></div>
      <ul>${h.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <details><summary>Score breakdown</summary>
        ${['S', 'F', 'E', 'D', 'T'].map((k) => `<div class="bar"><b>${k}</b><i style="width:${Math.round(h.breakdown[k] * 100)}%"></i><span>${h.breakdown[k]}</span></div>`).join('')}
        <p class="note">S specialty, F facilities, E ETA, D distance, T traffic. Each term is 0 to 1.</p>
      </details>
    </label>`).join('');
  document.querySelectorAll('#hospital-list .card').forEach((card) => {
    card.querySelector('input').addEventListener('change', () => selectHospital(card));
  });
  updateProgress();
}

async function selectHospital(card) {
  document.querySelectorAll('#hospital-list .card').forEach((c) => c.classList.toggle('selected', c === card));
  state.hospital = state.hospitals.find((h) => String(h.id) === card.dataset.id);
  updateProgress();
  $('confirm-bar').hidden = false;
  $('confirm-note').textContent = 'Calculating route…';
  try {
    const r = await api('POST', '/api/route', { session_id: state.sessionId, hospital_id: state.hospital.id });
    state.route = r;
    const ok = CareMap.show('map', { lat: state.lat, lng: state.lng }, state.hospital, r.geometry);
    $('map-fallback').hidden = ok;
    $('map').hidden = !ok;
    $('route-line').textContent = `${r.eta_min} min · ${r.distance_km} km · traffic ${r.traffic_level} (simulated) · route: ${r.source}`;
    $('confirm-note').textContent = `${state.hospital.name}: about ${r.eta_min} min away. Guardians are alerted too.`;
    $('sc-hospital-sum').textContent = state.hospital.name;
    refreshTimeline();
  } catch (e) { $('confirm-note').textContent = 'Route unavailable. You can still send the alert.'; }
}

$('alert-btn').addEventListener('click', () => withBusy($('alert-btn'), async () => {
  const name = $('caller-name').value.trim(), phone = $('caller-phone').value.trim();
  if (name || phone) await api('POST', `/api/sessions/${state.sessionId}/caller`, { key: state.key, name, phone }, { quiet: true }).catch(() => {});
  await api('POST', '/api/alert', { session_id: state.sessionId, hospital_id: state.hospital.id });
  $('decline-note').hidden = true;
  setStep('live');
  beginLive();
}));

// ---------- 5. live status ----------
let liveTimer = null;
function beginLive() {
  $('guardian-link').href = `/guardian.html?session=${state.sessionId}&key=${state.key}`;
  $('arrive-btn').hidden = false;
  $('arrive-done').hidden = true;
  pollLive();
  if (!liveTimer) liveTimer = setInterval(pollLive, 2000);
}

let arrivalAt = null;
function tickEta() {
  const s = state.session;
  if (!s || s.status === 'arrived' || s.cancelled || !arrivalAt) { $('live-eta').textContent = s && s.status === 'arrived' ? 'Arrived' : '--:--'; return; }
  const left = Math.max(0, Math.round((arrivalAt - Date.now()) / 1000));
  $('live-eta').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
}

function renderLive(s) {
  state.session = s;
  const hs = s.hospital_status;
  const hname = s.hospital ? s.hospital.name : 'the hospital';
  const head = $('live-head');
  head.className = 'live-head';
  if (s.cancelled) { head.classList.add('bad'); head.textContent = 'Emergency cancelled. Hospital and guardians were told it was a false alarm.'; }
  else if (s.status === 'arrived') { head.classList.add('good'); head.textContent = 'The patient has arrived. Emergency closed.'; }
  else if (hs === 'declined') { head.classList.add('bad'); head.textContent = `${hname} cannot take the patient: ${s.decline_reason || 'no reason given'}.`; }
  else if (hs === 'ready') { head.classList.add('good'); head.textContent = `${hname} is ready and waiting.`; }
  else if (hs === 'preparing') head.textContent = `${hname} is preparing for the patient.`;
  else if (hs === 'accepted') head.textContent = `${hname} accepted the patient.`;
  else head.textContent = `Alert sent to ${hname}. Waiting for them to accept.`;

  const reached = s.status === 'arrived' ? 4 : READINESS.findIndex((x) => x[1] === hs);
  $('live-stepper').innerHTML = READINESS.map((x, i) => `<span class="${s.status === 'arrived' || i < reached ? 'on' : i === reached ? 'cur' : ''}">${x[0]}</span>`).join('');

  const fam = s.alerts.filter((a) => a.target_type === 'guardian' && a.status !== 'cancelled');
  $('family').innerHTML = s.patient
    ? (fam.length ? fam.map((a) => `<div><span>${esc(a.guardian_name)} <span class="muted">${esc(a.relation || '')}</span></span>
        <span class="pill ${a.ack_note ? 'ready' : ''}">${a.ack_note === 'on_my_way' ? 'On the way' : a.ack_note ? 'Saw the alert' : 'Alert sent'}</span></div>`).join('')
        : '<p class="note">Guardian alerts are switched off for this patient.</p>')
    : '<p class="note">Patient not identified yet, so no family was alerted. The hospital can link the patient when they are identified; then family is alerted automatically.</p>';

  const a = s.alerts.find((x) => x.target_type === 'hospital' && x.status !== 'cancelled');
  arrivalAt = a && s.eta_min != null ? new Date(a.sent_at).getTime() + s.eta_min * 60000 : null;
  $('live-hospital').textContent = s.hospital && s.hospital.phone ? `${s.hospital.name} · ${s.hospital.phone}` : '';
  $('sc-live-sum').textContent = hs === 'declined' ? 'Declined' : s.status === 'arrived' ? 'Arrived' : (hs || 'new');
  $('timeline').innerHTML = renderTimeline(s.timeline);
  if (s.status === 'arrived' || s.cancelled) {
    clearInterval(liveTimer); liveTimer = null; store.clear();
    $('arrive-btn').hidden = true; $('cancel-btn').hidden = true;
    $('arrive-done').hidden = false;
    $('arrive-text').textContent = s.cancelled ? 'Emergency cancelled.' : 'Patient has arrived. Emergency closed.';
  }
  if (hs === 'declined') {
    // Offer to choose again; the server will not offer the declined hospital.
    clearInterval(liveTimer); liveTimer = null;
    $('decline-note').textContent = `${hname} declined: ${s.decline_reason}. Choose another hospital below.`;
    $('decline-note').hidden = false;
    $('sc-live').dataset.state = 'locked';
    setStep('hospital');
    loadMatches();
  }
  updateProgress();
  tickEta();
}

async function pollLive() {
  try { renderLive(await api('GET', `/api/sessions/${state.sessionId}?key=${state.key}`, undefined, { quiet: true })); clearError(); }
  catch (e) { showError('Connection problem. Retrying… If this is urgent, call 112.'); }
}

$('arrive-btn').addEventListener('click', () => withBusy($('arrive-btn'), async () => {
  renderLive(await api('POST', `/api/sessions/${state.sessionId}/arrive`, { key: state.key }));
}));

let cancelArmed = null;
$('cancel-btn').addEventListener('click', () => {
  if (!cancelArmed) {
    $('cancel-btn').textContent = 'Tap again to confirm false alarm';
    cancelArmed = setTimeout(() => { cancelArmed = null; $('cancel-btn').textContent = 'False alarm'; }, 4000);
    return;
  }
  clearTimeout(cancelArmed); cancelArmed = null;
  withBusy($('cancel-btn'), async () => { renderLive(await api('POST', `/api/sessions/${state.sessionId}/cancel`, { key: state.key })); });
});

$('copy-link').addEventListener('click', async () => {
  const url = location.origin + $('guardian-link').getAttribute('href');
  try { await navigator.clipboard.writeText(url); toast('Guardian link copied'); } catch (e) { toast(url); }
});

$('restart').addEventListener('click', () => { store.clear(); location.reload(); });
