// Static checks for the vanilla frontend.
//   node scripts/check-frontend.js routes <baseUrl>   every api(...) path used by the UI hits a real route
//   node scripts/check-frontend.js ids                every element id used in JS exists in the HTML
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const htmlFiles = fs.readdirSync(pub).filter((f) => f.endsWith('.html'));
const jsFiles = fs.readdirSync(path.join(pub, 'js')).filter((f) => f.endsWith('.js'));

const read = (p) => fs.readFileSync(path.join(pub, p), 'utf8');
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

const sources = [
  ...jsFiles.map((f) => ({ name: 'js/' + f, code: read('js/' + f) })),
  ...htmlFiles.flatMap((f) => inlineScripts(read(f)).map((code) => ({ name: f + ' (inline)', code }))),
];

async function routes(base) {
  const found = [];
  for (const s of sources) {
    for (const m of s.code.matchAll(/api\(\s*'(GET|POST)'\s*,\s*([`'"])(\/api\/[^`'"]*)\2/g)) found.push({ src: s.name, method: m[1], raw: m[3] });
  }
  if (!found.length) throw new Error('no api() calls found; checker is broken');
  let bad = 0;
  for (const f of found) {
    let url = f.raw.replace(/\$\{[^}]*\}/g, '1').replace(/\?.*$/, '');
    if (url.endsWith('/')) url += '1';
    const q = f.raw.includes('?') ? '?' + f.raw.split('?')[1].replace(/\$\{[^}]*\}/g, '1') : '';
    const r = await fetch(base + url + (f.method === 'GET' ? q : ''), {
      method: f.method, headers: { 'Content-Type': 'application/json' }, body: f.method === 'POST' ? '{}' : undefined,
    });
    let msg = '';
    try { msg = (await r.json()).message; } catch (e) { /* binary or empty */ }
    if (msg === 'Unknown API route' || r.status === 405) { console.error(`MISSING ROUTE ${f.method} ${f.raw} (${f.src})`); bad++; }
  }
  console.log(`${found.length} api() calls checked, ${bad} unknown`);
  if (bad) process.exit(1);
}

function ids() {
  const allIds = new Set();
  const perPage = {};
  for (const f of htmlFiles) {
    perPage[f] = new Set([...read(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    perPage[f].forEach((i) => allIds.add(i));
  }
  const usedIn = (code) => [...code.matchAll(/(?:\$|getElementById)\(\s*'([^']+)'\s*\)|querySelector(?:All)?\(\s*'#([\w-]+)[^']*'\s*\)/g)].map((m) => m[1] || m[2]);
  let bad = 0;
  for (const f of jsFiles) {
    for (const id of usedIn(read('js/' + f))) {
      if (!allIds.has(id)) { console.error(`js/${f}: id "${id}" not found in any HTML`); bad++; }
    }
  }
  // index.html's wizard must find all its ids on that very page
  for (const id of usedIn(read('js/app.js'))) {
    if (!perPage['index.html'].has(id)) { console.error(`app.js: id "${id}" missing from index.html`); bad++; }
  }
  for (const f of htmlFiles) {
    for (const code of inlineScripts(read(f))) {
      for (const id of usedIn(code)) {
        if (!perPage[f].has(id)) { console.error(`${f} inline script: id "${id}" missing`); bad++; }
      }
    }
  }
  console.log(`ids checked, ${bad} missing`);
  if (bad) process.exit(1);
}

const [mode, base] = process.argv.slice(2);
if (mode === 'routes') routes(base).catch((e) => { console.error(e.message); process.exit(1); });
else if (mode === 'ids') ids();
else { console.error('usage: check-frontend.js routes <base> | ids'); process.exit(2); }
