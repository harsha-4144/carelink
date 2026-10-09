// Shared helpers for every page: API calls, error banner, escaping, badges, time.
const $ = (id) => document.getElementById(id);

function showError(msg) {
  const b = $('error-banner');
  if (b) { b.textContent = msg; b.hidden = false; }
}
function clearError() {
  const b = $('error-banner');
  if (b) b.hidden = true;
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error('Cannot reach the CARELINK server. Check your connection and try again.');
    showError(err.message);
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed (${res.status})`);
    showError(err.message);
    throw err;
  }
  clearError();
  return data;
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

function renderTimeline(items) {
  if (!items || !items.length) return '<p class="empty">No events yet.</p>';
  return '<ul class="timeline">' + items.map((t) => `<li><time>${esc(fmtTime(t.at))}</time>${esc(t.step)}</li>`).join('') + '</ul>';
}

function mapsLink(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}
