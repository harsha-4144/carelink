#!/usr/bin/env bash
# From-scratch verification: wipe node_modules and the DB, install, seed, test, start, curl health.
cd "$(dirname "$0")/.."
set -e
rm -rf node_modules data
npm install --no-audit --no-fund >/dev/null 2>&1
test -d node_modules/better-sqlite3
npm run seed --silent | grep -q "Seeded 5 patients and 6 hospitals"
npm test --silent >/dev/null 2>&1
PORT=3996 DB_PATH=./data/carelink.db node server/index.js >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s localhost:3996/api/health | grep -q '"ok":true' && echo "clean run OK" && exit 0; sleep 0.3; done
echo "health check failed after clean run"; exit 1
