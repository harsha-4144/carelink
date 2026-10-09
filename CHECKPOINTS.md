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
