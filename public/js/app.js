// Bystander wizard. State lives in `state`; each step is a <section id="step-NAME">.
const state = { sessionId: null, lat: null, lng: null, patient: null, triage: null, hospitals: [], hospital: null, route: null };

const STEP_PROGRESS = { start: null, identify: 'identify', assess: 'assess', match: 'match', route: 'route', alert: 'alert', arrive: 'arrive' };
const PROGRESS_ORDER = ['identify', 'assess', 'match', 'route', 'alert', 'prepare', 'arrive'];

function goStep(name, progressKey) {
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', s.id === 'step-' + name));
  setProgress(progressKey || STEP_PROGRESS[name]);
  window.scrollTo(0, 0);
}

function setProgress(key) {
  const idx = PROGRESS_ORDER.indexOf(key);
  document.querySelectorAll('#progress li').forEach((li) => {
    const i = PROGRESS_ORDER.indexOf(li.dataset.p);
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', idx >= 0 && i < idx);
  });
}

async function withBusy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  try { await fn(); } catch (e) { /* api() already showed the banner */ } finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- 1. Start ----------
function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 60000 });
  });
}

async function startEmergency(triggeredBy) {
  if (state.sessionId) return;
  $('start-status').textContent = 'Getting your location…';
  let pos = await getLocation();
  if (!pos) {
    try { pos = (await api('GET', '/api/health')).demo_center; $('start-status').textContent = 'Location blocked: using demo location.'; } catch (e) { pos = null; }
  }
  try {
    const r = await api('POST', '/api/emergency', Object.assign({ triggered_by: triggeredBy }, pos || {}));
    Object.assign(state, { sessionId: r.session_id, lat: r.lat, lng: r.lng });
    Voice.stop();
    goStep('identify');
    if (state.faceEnabled) initFace();
  } catch (e) {
    $('start-status').textContent = 'Could not start. Please try again, or call 112.';
  }
}

$('sos-btn').addEventListener('click', () => startEmergency('sos'));

if (Voice.supported) {
  const mic = $('mic-btn');
  mic.hidden = false;
  mic.addEventListener('click', () => {
    if (Voice.active) { Voice.stop(); mic.classList.remove('listening'); mic.textContent = '🎤 Say "emergency"'; return; }
    Voice.listen(
      () => { mic.classList.remove('listening'); startEmergency('voice'); },
      (s, detail) => {
        mic.classList.toggle('listening', s === 'listening');
        mic.textContent = s === 'listening' ? '🎤 Listening… say "emergency" or "help"' : '🎤 Say "emergency"';
        if (s === 'error') $('start-status').textContent = 'Microphone unavailable (' + detail + '). Use the SOS button.';
      });
  });
}

api('GET', '/api/health').then((h) => { state.faceEnabled = h.face_enabled; }).catch(() => {});

// ---------- 2. Identify ----------
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
  const p = r.patient;
  const g = p.guardians[0];
  $('identify-msg').textContent = '';
  $('patient-card').innerHTML = `<h3>${esc(p.name)} <small>(${esc(p.carelink_id)})</small></h3>
    <p><strong>Blood group:</strong> ${esc(p.blood_group)}<br><strong>Allergies:</strong> ${esc(p.allergies)}<br>
    <strong>Conditions:</strong> ${esc(p.conditions)}<br><strong>Medications:</strong> ${esc(p.medications)}<br>
    <strong>Guardian:</strong> ${g ? esc(g.guardian_name) + ' (' + esc(g.relation) + ')' : 'none on file'}</p>`;
  $('patient-card').hidden = false;
  $('identify-next').hidden = false;
}

$('identify-next').addEventListener('click', () => { QrScan.stop(); goStep('assess'); });
$('skip-identify').addEventListener('click', () => { QrScan.stop(); state.patient = null; goStep('assess'); });

// ---------- Face (optional, only when the server enables it) ----------
function initFace() {
  if (typeof initFaceTab === 'function') initFaceTab();
}

// ---------- 3. Assess ----------
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
}));

$('assess-btn').addEventListener('click', () => withBusy($('assess-btn'), async () => {
  const chips = [...document.querySelectorAll('.chip[aria-pressed=true]')].map((c) => c.dataset.symptom);
  const symptoms = [...chips, $('symptoms').value.trim()].filter(Boolean).join(', ');
  const r = await api('POST', '/api/triage', {
    session_id: state.sessionId, symptoms, conscious: $('conscious').checked, breathing: $('breathing').checked,
  });
  state.triage = r;
  $('triage-result').innerHTML = `${badge(r.urgency_level)}
    <p><strong>${esc(r.urgency_reason)}</strong><br>Suggested specialty: ${esc(r.needed_specialty)}</p>
    <p class="note">AI estimate, not a diagnosis. (${r.source === 'rules+llm' ? 'rules + AI refinement' : 'rule-based'})</p>`;
  $('triage-result').hidden = false;
  $('to-match').hidden = false;
}));

$('to-match').addEventListener('click', () => withBusy($('to-match'), loadMatches));

// ---------- 4. Match ----------
async function loadMatches() {
  goStep('match');
  $('hospital-list').innerHTML = '<p class="empty">Finding the best hospitals…</p>';
  state.hospital = null;
  $('to-route').disabled = true;
  try {
    const r = await api('GET', '/api/hospitals/match?session_id=' + state.sessionId);
    state.hospitals = r.hospitals;
  } catch (e) {
    $('hospital-list').innerHTML = '<p class="empty">Could not load hospitals. Call 112 now, or go back and try again.</p>';
    return;
  }
  if (!state.hospitals.length) { $('hospital-list').innerHTML = '<p class="empty">No suitable hospital found nearby. Call 112.</p>'; return; }
  $('hospital-list').innerHTML = state.hospitals.map((h, i) => `
    <label class="card selectable" data-id="${h.id}">
      <input type="radio" name="hospital" value="${h.id}" ${i === 0 ? '' : ''}>
      <h3>${esc(h.name)} <span class="score" title="Match score out of 100">${h.score}</span></h3>
      <div class="meta"><span>${esc(h.eta_min)} min</span><span>${esc(h.distance_km)} km</span><span class="note">simulated traffic</span></div>
      <ul>${h.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <details><summary>Score breakdown</summary>
        ${['S', 'F', 'E', 'D', 'T'].map((k) => `<div class="bar"><b>${k}</b><i style="width:${Math.round(h.breakdown[k] * 100)}%"></i><span>${h.breakdown[k]}</span></div>`).join('')}
        <p class="note">S specialty, F facilities, E ETA, D distance, T traffic. Each term is 0 to 1.</p>
      </details>
    </label>`).join('');
  document.querySelectorAll('#hospital-list .card').forEach((card) => {
    card.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('#hospital-list .card').forEach((c) => c.classList.toggle('selected', c === card));
      state.hospital = state.hospitals.find((h) => String(h.id) === card.dataset.id);
      $('to-route').disabled = false;
    });
  });
}

// ---------- 5. Route ----------
$('to-route').addEventListener('click', () => withBusy($('to-route'), async () => {
  const r = await api('POST', '/api/route', { session_id: state.sessionId, hospital_id: state.hospital.id });
  state.route = r;
  goStep('route');
  $('route-summary').innerHTML = `<p><span class="big">${esc(r.eta_min)} min</span> to <strong>${esc(state.hospital.name)}</strong><br>
    ${esc(r.distance_km)} km · traffic ${esc(r.traffic_level)} <span class="note">(simulated traffic)</span> · route source: ${esc(r.source)}</p>`;
  const ok = CareMap.show('map', { lat: state.lat, lng: state.lng }, state.hospital, r.geometry);
  $('map-fallback').hidden = ok;
  $('map').hidden = !ok;
}));

$('to-alert').addEventListener('click', () => goStep('alert'));

// ---------- 6. Alert / Prepare ----------
$('alert-btn').addEventListener('click', () => withBusy($('alert-btn'), async () => {
  const r = await api('POST', '/api/alert', { session_id: state.sessionId, hospital_id: state.hospital.id });
  const guardians = r.alerts.filter((a) => a.target_type === 'guardian').length;
  $('alert-detail').textContent = `${state.hospital.name} and ${guardians} guardian(s) have been notified (in-app, simulated; no SMS is sent).`;
  $('guardian-link').href = '/guardian.html?session=' + state.sessionId;
  $('hospital-link').href = '/hospital.html?hospital=' + state.hospital.id;
  $('alert-success').hidden = false;
  $('alert-btn').hidden = true;
  $('to-arrive').hidden = false;
  setProgress('prepare');
}));

$('to-arrive').addEventListener('click', () => goStep('arrive'));

// ---------- 7. Arrive ----------
$('arrive-btn').addEventListener('click', () => withBusy($('arrive-btn'), async () => {
  const s = await api('POST', `/api/sessions/${state.sessionId}/arrive`);
  $('arrive-done').hidden = false;
  $('arrive-btn').hidden = true;
  $('timeline').innerHTML = '<h3>Timeline</h3>' + renderTimeline(s.timeline);
  $('restart').hidden = false;
  setProgress('arrive');
}));

$('restart').addEventListener('click', () => location.reload());
