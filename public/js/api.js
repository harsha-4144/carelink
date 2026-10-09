// Shared helpers for every page: API calls, error banner, toasts, escaping, badges, time.
const $ = (id) => document.getElementById(id);

function showError(msg) {
  const b = $('error-banner');
  if (b) { b.textContent = msg; b.hidden = false; }
}
function clearError() {
  const b = $('error-banner');
  if (b) b.hidden = true;
}

// opts.quiet: do not show the red/yellow banner (caller handles the error).
async function api(method, url, body, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error('Cannot reach the CARELINK server. Check your connection and try again.');
    if (!opts.quiet) showError(err.message);
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed (${res.status})`);
    err.status = res.status;
    if (!opts.quiet) showError(err.message);
    throw err;
  }
  if (!opts.quiet) clearError();
  return data;
}

function toast(msg, kind) {
  let host = $('toast-host');
  if (!host) { host = document.createElement('div'); host.id = 'toast-host'; host.className = 'toast-host'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function badge(level) {
  const l = ['Critical', 'Urgent', 'Stable'].includes(level) ? level : 'Unassessed';
  return `<span class="badge ${l}">${esc(l)}</span>`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderTimeline(items) {
  if (!items || !items.length) return '<p class="empty">No events yet.</p>';
  return '<ul class="timeline">' + items.map((t) => `<li><time>${esc(fmtTime(t.at))}</time>${esc(t.step)}</li>`).join('') + '</ul>';
}

function mapsLink(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

function skeleton(n = 3) {
  return Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}
