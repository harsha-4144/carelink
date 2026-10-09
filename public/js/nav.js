// Account area of the top bar + page guards. Loaded on every page after api.js.
const HOME_BY_ROLE = { patient: '/patient.html', guardian: '/guardian.html', hospital_staff: '/hospital.html' };
const ROLE_LABEL = { patient: 'Patient', guardian: 'Guardian', hospital_staff: 'Hospital staff' };

let currentUser = null;

async function loadUser() {
  try { currentUser = (await api('GET', '/api/auth/me', undefined, { quiet: true })).user; } catch (e) { currentUser = null; }
  return currentUser;
}

function renderNav(user) {
  const nav = $('nav');
  if (!nav) return;
  if (!user) {
    nav.innerHTML = '<a href="/login.html">Log in</a><a class="cta" href="/signup.html">Sign up</a>';
    return;
  }
  nav.innerHTML = `<a href="${HOME_BY_ROLE[user.role]}">Dashboard</a>
    <span class="bell"><button type="button" id="bell-btn" aria-label="Notifications">Alerts<b id="bell-count" hidden>0</b></button><div id="notif-panel" class="notif-panel" hidden></div></span>
    <span class="who">${esc(user.name)} · ${esc(ROLE_LABEL[user.role])}</span><button type="button" id="logout-btn">Log out</button>`;
  startBell();
  $('logout-btn').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout', {}); } catch (e) { /* ignore */ }
    location.href = '/';
  });
}

// For dashboards: resolves to the user, or sends the visitor to the login page.
async function requireLogin(...roles) {
  const user = await loadUser();
  renderNav(user);
  if (!user) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return new Promise(() => {}); }
  if (roles.length && !roles.includes(user.role)) { location.replace(HOME_BY_ROLE[user.role]); return new Promise(() => {}); }
  return user;
}

// ---------- notification bell ----------
let lastUnread = null;
async function pollBell() {
  try {
    const r = await api('GET', '/api/notifications', undefined, { quiet: true });
    const c = $('bell-count');
    if (c) { c.textContent = r.unread; c.hidden = r.unread === 0; }
    if (lastUnread !== null && r.unread > lastUnread) toast(r.notifications[0].title, r.notifications[0].kind === 'emergency' ? 'crit' : '');
    lastUnread = r.unread;
    const panel = $('notif-panel');
    if (panel) panel.innerHTML = r.notifications.length
      ? r.notifications.map((n) => `<a class="n ${n.read ? '' : 'unread'}" href="${esc(n.link || '#')}"><b>${esc(n.title)}</b><small>${esc(n.body || '')} ${esc(fmtTime(n.created_at))}</small></a>`).join('')
      : '<div class="empty"><b>No notifications</b>Alerts about emergencies appear here.</div>';
  } catch (e) { /* ignore: bell is best effort */ }
}
let bellTimer = null;
function startBell() {
  const btn = $('bell-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const panel = $('notif-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { try { await api('POST', '/api/notifications/read', {}, { quiet: true }); lastUnread = 0; $('bell-count').hidden = true; } catch (e) { /* ignore */ } }
  });
  pollBell();
  if (!bellTimer) bellTimer = setInterval(pollBell, 4000);
}

loadUser().then(renderNav);
