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
