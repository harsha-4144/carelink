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
    <span class="who">${esc(user.name)} · ${esc(ROLE_LABEL[user.role])}</span><button type="button" id="logout-btn">Log out</button>`;
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

loadUser().then(renderNav);
