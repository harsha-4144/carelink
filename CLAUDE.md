# CARELINK AI: build spec for Claude Code

HackHERS 2.0 project. Emergency coordination web app: Identify, Assess, Match, Route, Alert, Prepare, Arrive.
Tagline: "When the patient can't speak, CARELINK speaks for them."

## How to work (read first)

- All decisions below are final. Do not ask the user questions and do not offer alternatives; implement exactly this.
- Build in the phases in section 12, in order. After each phase run `npm test` and fix failures before moving on. Commit after each green phase.
- The app must run with ZERO API keys and, if the network is down, still complete the full flow (MOCK_MODE fallbacks, section 9).
- Use synthetic demo data only. Never add real personal data, real hospital names, or real SMS.
- Keep code simple and readable. No frontend build step, no framework. If something in this spec is ambiguous, pick the simplest option that keeps the demo flow working and note it in README.md.

## 1. Decisions

| Topic | Decision |
| --- | --- |
| Runtime | Node.js 20+ (global fetch), CommonJS, one repo, one server |
| Backend | Express 4, JSON REST, serves `/public` as static files |
| Database | SQLite via `better-sqlite3`, file at `DB_PATH` (default `./data/carelink.db`) |
| Frontend | Plain HTML + CSS + vanilla JavaScript (matches the slides: HTML5, CSS3, JavaScript) |
| Maps | Leaflet + OpenStreetMap tiles (CDN, no key) |
| Routing / ETA | OSRM public server for the top 3 hospitals only; haversine fallback |
| Traffic | Simulated multiplier by hour of day, labelled "simulated" in the UI (no free live-traffic API) |
| Voice | Web Speech API (`SpeechRecognition`), keywords "emergency" and "help"; SOS button always visible and equal |
| QR | `qrcode` package generates QR on server; `html5-qrcode` (CDN) scans in browser; manual CARELINK ID entry always available |
| AI triage | Rule engine always runs. Optional LLM refinement through Anthropic Messages API when `ANTHROPIC_API_KEY` is set; model from `ANTHROPIC_MODEL` (default `claude-haiku-5-5`); 5 s timeout; any failure falls back to the rule result |
| Face recognition | Optional stretch, OFF by default (`ENABLE_FACE=false`). Built last in Phase 6. Demo never depends on it |
| Alerts | In-app simulated, stored in `alerts` table. Guardian page and hospital dashboard poll every 2 s. No SMS |
| Emergency number | Show a one-tap `tel:112` button (ambulance 108 shown as text) on every screen |
| Demo location | `DEMO_CENTER_LAT=17.7231`, `DEMO_CENTER_LNG=83.3013` in `.env`; used if browser geolocation is denied; hospitals are seeded as offsets around this point so it works anywhere by changing the two values |
| Port | `PORT=3000` |

## 2. Repo layout

```
carelink/
  package.json
  .env.example
  README.md
  CLAUDE.md
  server/
    index.js            express app + start (export app for tests)
    db.js               open db, create tables
    seed.js             insert demo data (idempotent: clears and reinserts)
    routes/
      emergency.js identify.js triage.js hospitals.js route.js alert.js sessions.js patients.js alerts.js
    services/
      geo.js            haversine, offsets
      triage.js         rule engine + optional LLM
      llm.js            Anthropic call with timeout
      matching.js       scoring
      routing.js        OSRM + fallback + traffic multiplier
  public/
    index.html          bystander wizard (main demo screen)
    guardian.html       guardian alert view (?session=ID)
    hospital.html       hospital dashboard (?hospital=ID)
    register.html       patient registration + consent + QR display
    css/app.css
    js/api.js app.js voice.js qr.js map.js
  test/
    triage.test.js matching.test.js smoke.test.js
```

`package.json` scripts: `start` = `node server/index.js`, `seed` = `node server/seed.js`, `test` = `node --test test/`, `dev` = `node --watch server/index.js`.
Dependencies: `express`, `better-sqlite3`, `qrcode`, `dotenv`. No others unless strictly required.

## 3. Environment (`.env.example`)

```
PORT=3000
DB_PATH=./data/carelink.db
DEMO_CENTER_LAT=17.7231
DEMO_CENTER_LNG=83.3013
MOCK_MODE=false
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-5-5
ENABLE_FACE=false
```

`MOCK_MODE=true` means: never call the network (no OSRM, no LLM). Tests set `MOCK_MODE=true` and `DB_PATH=:memory:` style temp file.

## 4. Database schema (create in `db.js`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient','guardian','hospital_staff')),
  phone TEXT, carelink_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  blood_group TEXT, allergies TEXT, conditions TEXT, medications TEXT,
  face_embedding TEXT, qr_token TEXT UNIQUE, consent_flags TEXT
);
CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES users(id),
  guardian_name TEXT NOT NULL, phone TEXT, relation TEXT, priority INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  specialties TEXT NOT NULL,            -- JSON array of strings
  emergency_facilities TEXT NOT NULL,   -- JSON array: "emergency_unit","icu","trauma","cath_lab","stroke_unit","burns_unit"
  icu_available INTEGER DEFAULT 1, phone TEXT
);
CREATE TABLE IF NOT EXISTS emergency_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER REFERENCES users(id),
  triggered_by TEXT, symptoms TEXT, urgency_level TEXT, urgency_reason TEXT,
  needed_specialty TEXT, lat REAL, lng REAL, chosen_hospital_id INTEGER REFERENCES hospitals(id),
  eta_min REAL, status TEXT DEFAULT 'triggered'
    CHECK (status IN ('triggered','assessed','matched','alerted','arrived')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES emergency_sessions(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('guardian','hospital')),
  target_id INTEGER NOT NULL, payload TEXT NOT NULL, sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  delivered INTEGER DEFAULT 1
);
```

## 5. Seed data (`seed.js`, deterministic)

Patients (all synthetic), CARELINK IDs `CL-1001` to `CL-1005`, each with a random 16-hex `qr_token` (generate once at seed time) and one guardian:

| ID | Name | Blood | Allergies | Conditions |
| --- | --- | --- | --- | --- |
| CL-1001 | Asha Verma | B+ | Penicillin | Type 2 diabetes |
| CL-1002 | Ravi Kumar | O+ | None known | Hypertension |
| CL-1003 | Meera Nair | A+ | Sulfa drugs | Asthma |
| CL-1004 | Arjun Rao | AB- | None known | Heart disease |
| CL-1005 | Sana Khan | O- | Latex | None |

Hospitals (fictional names; coordinates = demo center plus offset in km, north/east):

| Name | Offset N,E (km) | Specialties | Facilities |
| --- | --- | --- | --- |
| Riverside General Hospital | 1.5, 1.0 | general, trauma, orthopedics | emergency_unit, icu, trauma |
| Heartline Cardiac Centre | 3.0, -2.0 | cardiology, general | emergency_unit, icu, cath_lab |
| NeuroCare Institute | -2.5, 2.5 | neurology, general | emergency_unit, icu, stroke_unit |
| City Trauma and Burns Centre | 4.5, 3.5 | trauma, burns, orthopedics | emergency_unit, icu, trauma, burns_unit |
| Lakeview Community Clinic | 0.8, -0.8 | general | (none) |
| Sunrise Multispeciality Hospital | -4.0, -3.0 | general, cardiology, pulmonology | emergency_unit, icu |

Offset conversion: `dLat = km / 111`, `dLng = km / (111 * cos(lat))`.
Also insert 2 `hospital_staff` users (one for hospital 1, one for hospital 2) for realism; no login needed.

## 6. API contracts (JSON in/out, status 200 unless noted)

Errors: `400 {"message":"..."}` for bad input, `404 {"message":"..."}` for unknown ids.

1. `POST /api/emergency` body `{lat, lng, triggered_by: "voice"|"sos"|"manual", symptoms?}` -> `{session_id, status:"triggered", lat, lng}`. If lat/lng missing use demo center.
2. `POST /api/identify` body `{session_id, method: "id"|"qr"|"face", value}` -> found: `{found:true, patient:{id,name,carelink_id,blood_group,allergies,conditions,medications,guardians:[{id,guardian_name,phone,relation}]}}`; not found: `{found:false, reason:"not_found"}` (status 200). Face with `ENABLE_FACE=false` -> `{found:false, reason:"face_disabled"}`. Sets `patient_id` on the session when found.
3. `POST /api/triage` body `{session_id, symptoms (string), conscious?: boolean, breathing?: boolean}` -> `{urgency_level:"Critical"|"Urgent"|"Stable", urgency_reason, needed_specialty, source:"rules"|"rules+llm"}`. Saves to the session, status `assessed`.
4. `GET /api/hospitals/match?session_id=ID` -> `{urgency_level, hospitals:[{id,name,lat,lng,score,distance_km,eta_min,traffic:"simulated",reasons:[string],breakdown:{S,F,E,D,T}}]}` top 3, sorted by score desc. Status `matched`.
5. `POST /api/route` body `{session_id, hospital_id}` -> `{eta_min, distance_km, traffic_level:"low"|"moderate"|"high", geometry:[[lat,lng],...], source:"osrm"|"estimate"}`. Saves `chosen_hospital_id` and `eta_min`.
6. `POST /api/alert` body `{session_id, hospital_id}` -> `{alerts:[{id,target_type,target_id,delivered}]}`: one alert per guardian of the patient (if known) plus one for the hospital. Payload (JSON) = `{patient_summary (or "Unidentified patient"), urgency_level, urgency_reason, eta_min, location:{lat,lng}, hospital_name, needed_specialty}`. Status `alerted`.
7. `GET /api/sessions/:id` -> session fields plus `patient`, `hospital`, `alerts`, and `timeline:[{step,at}]`.
8. `POST /api/patients` body `{name, phone, blood_group, allergies, conditions, medications, guardian_name, guardian_phone, guardian_relation, consent:{medical:true, guardian_alerts:true, face:false}}` -> `{id, carelink_id, qr_token, qr_data_url}`. Require `consent.medical` and `consent.guardian_alerts` to be true or return 400. Next `carelink_id` = `CL-` + (max numeric + 1).
9. `GET /api/alerts?target_type=hospital&target_id=ID` -> `{alerts:[...newest first with parsed payload]}` (used by the hospital dashboard and guardian page).
10. `POST /api/sessions/:id/arrive` -> sets status `arrived` and `closed_at`. 
11. `GET /api/patients/:carelink_id/qr` -> PNG of the QR code encoding the `qr_token`.
12. `GET /api/health` -> `{ok:true, demo_center:{lat,lng}, mock_mode:boolean, face_enabled:boolean}`.

Every state change appends to an in-session timeline derived from `created_at` plus alert `sent_at`; simplest approach: store timeline events in a small `session_events(session_id, step, at)` table created in `db.js` and written by each route.

## 7. Triage rules (`services/triage.js`)

Lower-case the symptoms text. `conscious === false` or `breathing === false` is Critical immediately.

- Critical keywords: unconscious, unresponsive, not breathing, no pulse, cardiac arrest, severe bleeding, heavy bleeding, chest pain, collapsed, seizure, stroke, face drooping, slurred speech, choking, overdose, head injury.
- Urgent keywords: fracture, broken bone, burn, high fever, confusion, vomiting blood, difficulty breathing, shortness of breath, deep cut, moderate bleeding, severe pain, allergic reaction.
- Otherwise Stable.
- `urgency_reason` = "Matched: <comma list of matched keywords>" or "No red-flag symptoms reported".
- `needed_specialty` mapping (first match wins): chest pain, cardiac, heart -> cardiology; stroke, face drooping, slurred, seizure, head injury -> neurology; burn -> burns; fracture, broken, accident, crash -> trauma; difficulty breathing, shortness of breath, asthma -> pulmonology; bleeding -> trauma; else general.
- LLM refinement (only if key set and not `MOCK_MODE`): send symptoms + rule result, ask for strict JSON `{"urgency_level","reason"}`; accept only if level is one of the three; never allow the LLM to LOWER a Critical rule result. Timeout 5 s; on any error return rule result with `source:"rules"`.

## 8. Hospital matching (`services/matching.js`)

For the session location compute for every hospital: distance (haversine km), rough ETA = distance * 1.4 / 30 km/h * 60 minutes * traffic multiplier. Exclude hospitals with no `emergency_unit` when urgency is Critical or Urgent. Terms (each 0 to 1):

- S specialty: 1 if the needed specialty is in `specialties`, 0.5 if `general` is, else 0.
- F facilities: 0.5 for `emergency_unit` + 0.3 for `icu` + 0.2 if a facility relevant to the needed specialty exists (cardiology: cath_lab; neurology: stroke_unit; trauma or orthopedics: trauma; burns: burns_unit; others: 0.2 for free).
- E: `1 - min(eta_min, 60) / 60`. D: `1 - min(distance_km, 30) / 30`. T: `1 - traffic_norm` where traffic_norm is 0.2 off-peak, 0.6 in peak hours.

Weights: Stable `S20 F10 E20 D40 T10`; Urgent `S30 F20 E25 D15 T10`; Critical `S25 F25 E35 D10 T5`. `score = round(sum(weight*term))`, range 0 to 100. Sort desc, tie-break by lower ETA. Keep top 3, then refine ETA of those 3 with `routing.js` and recompute E and the score. `reasons` = 2 or 3 short human strings, e.g. "Has cardiology and cath lab", "14 min away", "Emergency unit and ICU".

## 9. Routing and traffic (`services/routing.js`)

- Traffic multiplier by local hour: 8 to 10 and 17 to 20 = 1.4 ("high"), 7, 11 to 16, 21 = 1.2 ("moderate"), else 1.05 ("low"). Always display it as "simulated traffic".
- OSRM: `GET https://router.project-osrm.org/route/v1/driving/{lng},{lat};{lng},{lat}?overview=full&geometries=geojson`, timeout 4 s. Convert GeoJSON `[lng,lat]` to `[lat,lng]`. `eta_min = duration/60 * multiplier`.
- Fallback (MOCK_MODE or any failure): straight-line geometry `[start,end]`, distance = haversine * 1.4, speed 30 km/h, `source:"estimate"`.

## 10. Frontend

Design: mobile-first, high contrast, large tap targets, red/white emergency palette with a calm blue for secondary actions, system font stack. A persistent top bar shows "CARELINK AI" and a `Call 112` button (`tel:112`) on every page.

`index.html` (bystander wizard) is a single page with a 7-step progress bar (Identify, Assess, Match, Route, Alert, Prepare, Arrive):

1. Start screen: huge red SOS button, mic button "Say 'emergency'" (hide if `SpeechRecognition` missing), then `POST /api/emergency` using browser geolocation (fallback to demo center from `GET /api/health` extended with `{demo_center}`).
2. Identify: tabs "Scan QR", "Enter CARELINK ID", "Face (if enabled)", and a "Skip, unknown patient" button. Show a patient card on success (name, blood group, allergies, conditions, guardian).
3. Assess: symptom quick-chips (Unconscious, Not breathing, Chest pain, Severe bleeding, Fracture, Burn, Stroke signs, Breathing difficulty) plus free text, two toggles (Conscious? Breathing?). Result badge Critical (red) / Urgent (orange) / Stable (green) with the reason and the line "AI estimate, not a diagnosis".
4. Match: top 3 hospital cards with score, ETA, distance, reasons and a "Score breakdown" expander (S, F, E, D, T). Select one.
5. Route: Leaflet map with patient marker, hospital marker, route polyline, ETA and "simulated traffic" label.
6. Alert: button "Alert hospital and guardian", then a success panel with links "Open guardian view" and "Open hospital dashboard" (new tabs, with ids in the query string).
7. Arrive: "Patient arrived" button calls `/api/sessions/:id/arrive`; show the timeline.

`guardian.html?session=ID`: polls `/api/sessions/:id` every 2 s; shows patient, hospital, ETA countdown, location link. `hospital.html?hospital=ID`: polls `/api/alerts?target_type=hospital&target_id=ID` every 2 s; table of incoming patients with urgency badge, needed specialty, ETA, summary; new alerts flash. `register.html`: registration form with the three consent checkboxes (medical, guardian alerts, face optional), then shows the QR (from `qr_data_url`) and the CARELINK ID with a print button.

All pages: friendly error banner on any failed request; never leave the user on a blank screen. Every external script (Leaflet, html5-qrcode) loads from a CDN with a visible fallback message if it fails.

## 11. Privacy and safety (implement, do not skip)

- Consent checkboxes enforced server-side (section 6, item 8). Face embedding stored only if `consent.face` is true and `ENABLE_FACE=true`.
- Identify responses return only the emergency summary fields listed in section 6; never return `face_embedding` or `qr_token`.
- Log every identify and alert call into `session_events`.
- Footer text on the assess screen: "Urgency is an advisory estimate and does not replace emergency services."
- No secrets in git: `.env` in `.gitignore`; commit `.env.example` only.

## 12. Build phases (each ends with `npm test` green and a git commit)

**Phase 0, setup.** `npm init`, install deps, create layout, `db.js`, `seed.js`, `GET /api/health`, `.gitignore`, README with run steps. Verify: `npm run seed && npm start` and `curl localhost:3000/api/health`.

**Phase 1, core flow with real logic but no network.** Implement all API routes, `triage.js` (rules only), `matching.js`, `routing.js` fallback, alerts, sessions, patients. Write `test/triage.test.js` (the 5 cases below), `test/matching.test.js`, `test/smoke.test.js`.

**Phase 2, UI.** Build all pages and the wizard against the API. Manually walk the flow in the browser if a browser tool is available; otherwise rely on the smoke test and re-read the HTML for broken ids and fetch paths.

**Phase 3, real services.** Add OSRM routing, Leaflet map, QR scan via `html5-qrcode`, Web Speech voice trigger, optional LLM refinement. Everything must still pass tests with `MOCK_MODE=true`.

**Phase 4, hospital and guardian views polish.** Polling, flash on new alerts, ETA countdown, timeline.

**Phase 5, polish.** Loading and error states, empty states, consistent badge colours, README with demo script. `npm run seed` is the demo data reset.

**Phase 6, stretch (only if everything above is green).** Face recognition behind `ENABLE_FACE`: client-side `face-api.js` (models downloaded by an `npm run models` script into `public/models`), 128-number descriptor sent to `/api/identify` with method `face`, server compares Euclidean distance with threshold 0.6, registration stores the descriptor only with face consent. If the models cannot be downloaded, leave the flag false and document it in README.

### Required tests

`triage.test.js` (rules only, no network):

| Input | Expected level |
| --- | --- |
| "man collapsed, unresponsive" | Critical |
| "chest pain and sweating" | Critical (specialty cardiology) |
| "suspected fracture in leg after fall" | Urgent (specialty trauma) |
| "minor cut on finger, conscious and talking" | Stable |
| any text with `breathing:false` | Critical |

`matching.test.js`: Critical cardiac case ranks Heartline Cardiac Centre first; Lakeview Community Clinic never appears for Critical or Urgent; scores are between 0 and 100 and sorted descending; exactly 3 results.

`smoke.test.js` (start the app on a random port with a temp `DB_PATH` and `MOCK_MODE=true`, seed, then call the real HTTP API): emergency -> identify `CL-1001` (found, no `qr_token` or `face_embedding` in response) -> identify `CL-9999` (found false) -> triage "unconscious and not breathing" (Critical) -> match (3 hospitals, descending) -> route (numeric `eta_min`, `source:"estimate"`) -> alert (one hospital alert plus one guardian alert) -> `GET /api/alerts` for that hospital returns the alert -> `GET /api/sessions/:id` shows status `alerted` and a non-empty timeline -> arrive sets `arrived`. Also: registering a patient without consent returns 400; with consent returns a `CL-` id and a `qr_data_url` starting with `data:image/png`.

## 13. Definition of done

- `npm install && npm run seed && npm test && npm start` works on a clean clone with no `.env` edits.
- The full demo flow completes in under 2 minutes on a phone-size screen and a laptop.
- With the network disabled and `MOCK_MODE=true` the flow still completes.
- README contains: setup, env vars, the 8-step demo script (below), and known limitations (simulated traffic, no real SMS, face optional).

Demo script: 1) tap SOS or say "emergency", 2) enter `CL-1001` or scan the QR from register page, 3) tap "Unconscious" and "Chest pain", 4) show the Critical result, 5) show top 3 hospitals with score breakdown, 6) pick the first and show route and ETA, 7) alert, then show guardian and hospital screens side by side, 8) mark arrived and show the timeline.
