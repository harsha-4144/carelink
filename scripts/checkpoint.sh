#!/usr/bin/env bash
# Usage: bash scripts/checkpoint.sh <phase 0-6>
# Starts the server on a spare port with a temp DB, runs checks for phases 0..N.
cd "$(dirname "$0")/.."
N="${1:-0}"
PORT_CP=3999
TMP="$(mktemp -d)"
export DB_PATH="$TMP/cp.db" MOCK_MODE=true PORT=$PORT_CP
FAILS=0
BASE="http://localhost:$PORT_CP"
SERVER_PID=""

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1 -- $2"; FAILS=$((FAILS+1)); }
check() { # name, command...
  local name="$1"; shift
  local out
  if out=$("$@" 2>&1); then pass "$name"; else fail "$name" "$(echo "$out" | tail -3 | tr '\n' ' ')"; fi
}
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

start_server() {
  node server/index.js > "$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 30); do
    curl -s "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 0.3
  done
  return 1
}
stop_server() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }

# JSON helpers via node
jq_() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const r=($1);if(!r){console.error('assertion failed: '+JSON.stringify(d).slice(0,300));process.exit(1)}"; }
# login_as <email>: stores a cookie jar in $TMP and echoes its path
login_as() { local jar="$TMP/$1.jar"; curl -s -c "$jar" -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"demo1234\"}" "$BASE/api/auth/login" >/dev/null; echo "$jar"; }
getj() { curl -s -b "$1" "$BASE$2"; }
post() { curl -s -X POST -H 'Content-Type: application/json' -d "$2" "$BASE$1"; }
get() { curl -s "$BASE$1"; }

# ---------- Phase 0 ----------
phase0() {
  check "npm install (node_modules present)" test -d node_modules/express
  check "better-sqlite3 loads" node -e "require('better-sqlite3')"
  check "npm run seed -> 5 patients, 6 hospitals" bash -c "npm run seed --silent | grep -q 'Seeded 5 patients and 6 hospitals'"
  start_server || { fail "server starts" "$(tail -3 $TMP/server.log)"; return; }
  check "GET /api/health ok:true" bash -c "curl -s $BASE/api/health | node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(d.ok===true&&d.demo_center?0:1)\""
  check "git repo with >=1 commit" bash -c "[ \$(git rev-list --count HEAD 2>/dev/null || echo 0) -ge 1 ]"
}

# ---------- Phase 1 ----------
phase1() {
  check "npm test passes (triage, matching, smoke)" bash -c "npm test --silent"
  local S H R
  S=$(post /api/emergency '{"lat":17.7231,"lng":83.3013,"triggered_by":"sos"}')
  SID=$(echo "$S" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).session_id)")
  KEY=$(echo "$S" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).access_key)")
  [ -n "$SID" ] && [ "$SID" != "undefined" ] && pass "POST /api/emergency -> session $SID" || fail "POST /api/emergency" "$S"
  R=$(post /api/identify "{\"session_id\":$SID,\"method\":\"id\",\"value\":\"CL-1001\"}")
  echo "$R" | jq_ "d.found===true && d.patient.name==='Asha Verma' && !JSON.stringify(d).includes('qr_token') && !JSON.stringify(d).includes('face_embedding')" && pass "identify CL-1001 found, no secrets" || fail "identify CL-1001" "$R"
  R=$(post /api/identify "{\"session_id\":$SID,\"method\":\"id\",\"value\":\"CL-9999\"}")
  echo "$R" | jq_ "d.found===false" && pass "identify CL-9999 not found" || fail "identify CL-9999" "$R"
  # re-identify so the session has a patient
  post /api/identify "{\"session_id\":$SID,\"method\":\"id\",\"value\":\"CL-1001\"}" >/dev/null
  R=$(post /api/triage "{\"session_id\":$SID,\"symptoms\":\"unconscious and not breathing\"}")
  echo "$R" | jq_ "d.urgency_level==='Critical'" && pass "triage Critical" || fail "triage" "$R"
  R=$(get "/api/hospitals/match?session_id=$SID")
  echo "$R" | jq_ "d.hospitals.length===3 && d.hospitals.every((h,i,a)=>i===0||a[i-1].score>=h.score) && !d.hospitals.some(h=>/Lakeview/.test(h.name))" && pass "match: 3, descending, all with emergency unit" || fail "match" "$R"
  H=$(echo "$R" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).hospitals[0].id)")
  R=$(post /api/route "{\"session_id\":$SID,\"hospital_id\":$H}")
  echo "$R" | jq_ "typeof d.eta_min==='number'" && pass "route numeric eta_min" || fail "route" "$R"
  R=$(post /api/alert "{\"session_id\":$SID,\"hospital_id\":$H}")
  echo "$R" | jq_ "d.alerts.filter(a=>a.target_type==='hospital').length===1 && d.alerts.filter(a=>a.target_type==='guardian').length===1" && pass "alert: 1 hospital + 1 guardian" || fail "alert" "$R"
 R=$(get "/api/sessions/$SID"); echo "$R" | jq_ "d.message" && pass "session without key/login is refused (401)" || fail "session access control" "$R"
  R=$(get "/api/sessions/$SID?key=$KEY")
  echo "$R" | jq_ "d.status==='alerted' && d.timeline.length>0" && pass "session alerted, timeline non-empty" || fail "session" "$R"
  R=$(post /api/patients '{"name":"X","consent":{"medical":false,"guardian_alerts":true}}')
  [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"name":"X","consent":{"medical":false,"guardian_alerts":true}}' $BASE/api/patients)" = "400" ] && pass "register w/o consent -> 400" || fail "register w/o consent" "not 400"
  R=$(post /api/patients '{"name":"Test Person","email":"cp@test.dev","password":"password123","phone":"1","blood_group":"A+","allergies":"None","conditions":"None","medications":"None","guardian_name":"G","guardian_phone":"2","guardian_relation":"Friend","consent":{"medical":true,"guardian_alerts":true,"face":false}}')
  echo "$R" | jq_ "/^CL-/.test(d.carelink_id) && d.qr_data_url.startsWith('data:image/png')" && pass "register with consent -> CL- id + png QR" || fail "register" "$R"
}

# ---------- Phase 2 ----------
phase2() {
  for p in / /emergency.html /login.html /signup.html /register.html /patient.html /guardian.html /hospital.html; do
    c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")
    [ "$c" = "200" ] && pass "GET $p 200" || fail "GET $p" "status $c"
  done
  for f in public/js/*.js; do check "node --check $f" node --check "$f"; done
  check "fetch paths match real routes" node scripts/check-frontend.js routes "$BASE"
  check "element ids used in JS exist in HTML" node scripts/check-frontend.js ids
}

# ---------- Phase 3 ----------
phase3() {
  check "Leaflet + html5-qrcode script tags with fallback message" bash -c "grep -q leaflet public/emergency.html && grep -q html5-qrcode public/emergency.html && grep -qi 'map library' public/emergency.html && grep -qi 'scanner' public/emergency.html"
  check "voice code guarded by feature detection" bash -c "grep -q 'SpeechRecognition' public/js/voice.js && grep -q 'webkitSpeechRecognition' public/js/voice.js && grep -q 'supported' public/js/voice.js"
  stop_server
  MOCK_MODE=false start_server || { fail "server (MOCK_MODE=false)" "$(tail -3 $TMP/server.log)"; return; }
  local S R H
  S=$(post /api/emergency '{"triggered_by":"manual"}'); SID=$(echo "$S" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).session_id)")
  post /api/triage "{\"session_id\":$SID,\"symptoms\":\"chest pain\"}" >/dev/null
  R=$(get "/api/hospitals/match?session_id=$SID"); H=$(echo "$R" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).hospitals[0].id)")
  R=$(post /api/route "{\"session_id\":$SID,\"hospital_id\":$H}")
  echo "$R" | jq_ "(d.source==='osrm'||d.source==='estimate') && typeof d.eta_min==='number' && d.geometry.length>=2" && pass "route with MOCK_MODE=false works (source: $(echo $R | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).source)"))" || fail "route live" "$R"
  stop_server
  check "LLM path returns rule result when no key" env -u ANTHROPIC_API_KEY ANTHROPIC_API_KEY= MOCK_MODE=false node -e "
    const t=require('./server/services/triage');
    t.triage({symptoms:'chest pain'}).then(r=>{ if(r.urgency_level!=='Critical'||r.source!=='rules') process.exit(1); });"
  start_server
  check "npm test with MOCK_MODE=true" bash -c "MOCK_MODE=true npm test --silent"
}

# ---------- Phase 4 ----------
phase4() {
  local S R H
  S=$(post /api/emergency '{"triggered_by":"voice"}'); SID=$(echo "$S" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).session_id)"); KEY=$(echo "$S" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).access_key)")
  post /api/identify "{\"session_id\":$SID,\"method\":\"id\",\"value\":\"CL-1004\"}" >/dev/null
  post /api/triage "{\"session_id\":$SID,\"symptoms\":\"chest pain\"}" >/dev/null
  R=$(get "/api/hospitals/match?session_id=$SID"); H=$(echo "$R" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).hospitals[0].id)")
  post /api/route "{\"session_id\":$SID,\"hospital_id\":$H}" >/dev/null
  post /api/alert "{\"session_id\":$SID,\"hospital_id\":$H}" >/dev/null
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/alerts?target_type=hospital&target_id=$H")" = "401" ] && pass "alerts without login -> 401" || fail "alerts access control" "not 401"
  KIRAN=$(login_as kiran@demo.test)
  R=$(getj "$KIRAN" "/api/alerts?target_type=hospital&target_id=$H")
  echo "$R" | jq_ "d.alerts.length>=1 && typeof d.alerts[0].payload==='object' && d.alerts[0].payload.urgency_level==='Critical'" && pass "GET /api/alerts returns parsed payload" || fail "alerts list" "$R"
  check "guardian.html polls every 2s" bash -c "grep -q '2000' public/js/app.js public/guardian.html && grep -q 'setInterval' public/guardian.html"
  check "hospital.html polls every 2s" bash -c "grep -q '2000' public/hospital.html && grep -q 'setInterval' public/hospital.html"
  R=$(post "/api/sessions/$SID/arrive" "{\"key\":\"$KEY\"}")
  echo "$R" | jq_ "d.status==='arrived'" && pass "arrive sets arrived" || fail "arrive" "$R"
  R=$(get "/api/sessions/$SID?key=$KEY")
  echo "$R" | jq_ "d.status==='arrived' && d.closed_at && d.timeline.some(t=>t.step==='arrived')" && pass "session arrived + timeline has arrival" || fail "session arrived" "$R"
}

# ---------- Phase 5 ----------
phase5() {
  check "README has setup/env/demo script/limitations" bash -c "grep -qi 'setup' README.md && grep -q 'ANTHROPIC_API_KEY' README.md && grep -qi 'demo script' README.md && grep -qi 'limitations' README.md && grep -qi 'decisions' README.md"
  check "no .env committed; .env.example committed" bash -c "! git ls-files | grep -qx '.env' && git ls-files | grep -qx '.env.example'"
  check "footer disclaimer on assess screen" grep -q "does not replace emergency services" public/emergency.html
  check "tel:112 on every page" bash -c "for f in public/*.html; do grep -q 'tel:112' \$f || exit 1; done"
  check "clean run: fresh install + seed + test (scripts/clean-run.sh)" bash scripts/clean-run.sh
}

# ---------- Phase 6 ----------
phase6() {
  local S R
  S=$(post /api/emergency '{"triggered_by":"manual"}'); SID=$(echo "$S" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).session_id)")
  R=$(post /api/identify "{\"session_id\":$SID,\"method\":\"face\",\"value\":[0.1]}")
  echo "$R" | jq_ "d.found===false && d.reason==='face_disabled'" && pass "face disabled -> face_disabled" || fail "face disabled" "$R"
  check "face descriptor stored only with face consent" node --test test/face.test.js
}

# ---------- Run ----------
echo "== CHECKPOINT $N =="
SID=""
if [ "$N" -ge 5 ]; then
  : # phase 5 clean run is executed last (it wipes node_modules)
fi
phase0
if [ -n "$SERVER_PID" ]; then
  [ "$N" -ge 1 ] && phase1
  [ "$N" -ge 2 ] && phase2
  [ "$N" -ge 3 ] && phase3
  [ "$N" -ge 4 ] && phase4
  [ "$N" -ge 6 ] && phase6
  [ "$N" -ge 5 ] && { stop_server; phase5; }
fi
if [ "$FAILS" -eq 0 ]; then echo "CHECKPOINT $N: ALL PASS"; exit 0; else echo "CHECKPOINT $N: FAILED ($FAILS)"; exit 1; fi
