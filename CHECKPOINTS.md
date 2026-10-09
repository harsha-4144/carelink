# Checkpoints

## Phase 0 — 2026-10-09 14:08
```
== CHECKPOINT 0 ==
PASS: npm install (node_modules present)
PASS: better-sqlite3 loads
PASS: npm run seed -> 5 patients, 6 hospitals
PASS: GET /api/health ok:true
PASS: git repo with >=1 commit
CHECKPOINT 0: ALL PASS
```
**Try it now:** `npm run seed && npm start`, then `curl localhost:3000/api/health`.

## Phase 1 — 2026-10-09 14:10
```
== CHECKPOINT 1 ==
PASS: npm install (node_modules present)
PASS: better-sqlite3 loads
PASS: npm run seed -> 5 patients, 6 hospitals
PASS: GET /api/health ok:true
PASS: git repo with >=1 commit
PASS: npm test passes (triage, matching, smoke)
PASS: POST /api/emergency -> session 1
PASS: identify CL-1001 found, no secrets
PASS: identify CL-9999 not found
PASS: triage Critical
PASS: match: 3, descending, all with emergency unit
PASS: route numeric eta_min
PASS: alert: 1 hospital + 1 guardian
PASS: session alerted, timeline non-empty
PASS: register w/o consent -> 400
PASS: register with consent -> CL- id + png QR
CHECKPOINT 1: ALL PASS
```
**Try it now:** Run the server (`npm run seed && npm start`) and try the API, e.g. `curl -X POST localhost:3000/api/emergency -H 'Content-Type: application/json' -d '{"triggered_by":"sos"}'`. UI is not built yet (Phase 2).

## Phase 2 — 2026-10-09 14:13
```
== CHECKPOINT 2 ==
PASS: npm install (node_modules present)
PASS: better-sqlite3 loads
PASS: npm run seed -> 5 patients, 6 hospitals
PASS: GET /api/health ok:true
PASS: git repo with >=1 commit
PASS: npm test passes (triage, matching, smoke)
PASS: POST /api/emergency -> session 1
PASS: identify CL-1001 found, no secrets
PASS: identify CL-9999 not found
PASS: triage Critical
PASS: match: 3, descending, all with emergency unit
PASS: route numeric eta_min
PASS: alert: 1 hospital + 1 guardian
PASS: session alerted, timeline non-empty
PASS: register w/o consent -> 400
PASS: register with consent -> CL- id + png QR
PASS: GET / 200
PASS: GET /guardian.html 200
PASS: GET /hospital.html 200
PASS: GET /register.html 200
PASS: node --check public/js/api.js
PASS: node --check public/js/app.js
PASS: node --check public/js/map.js
PASS: node --check public/js/qr.js
PASS: node --check public/js/voice.js
PASS: fetch paths match real routes
PASS: element ids used in JS exist in HTML
CHECKPOINT 2: ALL PASS
```
**Try it now:** Run `npm run seed && npm start`, open http://localhost:3000 (wizard), http://localhost:3000/register.html, http://localhost:3000/hospital.html (pick a hospital), http://localhost:3000/guardian.html?session=1

## Phase 3 — 2026-10-09 14:13
```
== CHECKPOINT 3 ==
PASS: npm install (node_modules present)
PASS: better-sqlite3 loads
PASS: npm run seed -> 5 patients, 6 hospitals
PASS: GET /api/health ok:true
PASS: git repo with >=1 commit
PASS: npm test passes (triage, matching, smoke)
PASS: POST /api/emergency -> session 1
PASS: identify CL-1001 found, no secrets
PASS: identify CL-9999 not found
PASS: triage Critical
PASS: match: 3, descending, all with emergency unit
PASS: route numeric eta_min
PASS: alert: 1 hospital + 1 guardian
PASS: session alerted, timeline non-empty
PASS: register w/o consent -> 400
PASS: register with consent -> CL- id + png QR
PASS: GET / 200
PASS: GET /guardian.html 200
PASS: GET /hospital.html 200
PASS: GET /register.html 200
PASS: node --check public/js/api.js
PASS: node --check public/js/app.js
PASS: node --check public/js/map.js
PASS: node --check public/js/qr.js
PASS: node --check public/js/voice.js
PASS: fetch paths match real routes
PASS: element ids used in JS exist in HTML
PASS: Leaflet + html5-qrcode script tags with fallback message
PASS: voice code guarded by feature detection
PASS: route with MOCK_MODE=false works (source: osrm)
PASS: LLM path returns rule result when no key
PASS: npm test with MOCK_MODE=true
CHECKPOINT 3: ALL PASS
```
**Try it now:** Open http://localhost:3000 (map and QR scanner load from CDNs; with no internet you see the fallback messages). With internet and MOCK_MODE=false, the route step uses the OSRM public server. Set ANTHROPIC_API_KEY in .env to enable AI refinement.
