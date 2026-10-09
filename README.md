# CARELINK AI

*When the patient can't speak, CARELINK speaks for them.*

Emergency coordination web app (HackHERS 2.0). A bystander taps SOS (or says "emergency"), identifies the patient by
QR or CARELINK ID, gets an AI-assisted urgency estimate, sees the 3 best hospitals with a score breakdown, gets a route
and ETA, and alerts the hospital and the patient's guardian. All data is synthetic.

Flow: **Identify, Assess, Match, Route, Alert, Prepare, Arrive.**

## Setup

Requires Node.js 20+.

```
npm install
npm run seed      # creates ./data/carelink.db with 5 patients (CL-1001..CL-1005) and 6 hospitals; also the demo reset
npm test          # triage, matching, services and API smoke tests (no network needed)
npm start         # http://localhost:3000
```

No `.env` is needed. Optionally `cp .env.example .env` to change settings. `npm run dev` restarts on file changes.

Pages: `/` (landing), `/emergency.html` (bystander wizard, no login), `/register.html` (patient sign-up, shows QR),
`/signup.html` (guardian and hospital staff), `/login.html`, `/patient.html`, `/guardian.html`, `/hospital.html`.

## Accounts and personas

| Persona | Account? | What they get |
| --- | --- | --- |
| Bystander | none | The 7-step emergency wizard. Gets a private link to the live guardian view |
| Patient | email + password (`/register.html`) | Emergency ID and QR, edit medical profile and consent, manage guardians, emergency history with timelines |
| Guardian | email + password (`/signup.html`) | Live view of emergencies for the patients who added their email as a guardian; hospital readiness stepper; ETA countdown |
| Hospital staff | email + password + staff code | Own hospital's incoming queue, Accept / Preparing / Ready / Arrived actions, ICU availability switch (affects matching), sound and toast on critical alerts |

Demo accounts, all with password `demo1234`: patients `asha@demo.test`, `ravi@`, `meera@`, `arjun@`, `sana@`;
guardians `rohan@`, `sunita@`, `anil@`, `lakshmi@`, `imran@`; hospital staff `priya@demo.test` (Riverside),
`kiran@demo.test` (Heartline). Staff sign-up code: `HACKHERS` (override with `STAFF_CODE`). Accounts are reset by `npm run seed`.

Security: passwords hashed with scrypt, random session tokens (stored hashed) in an HttpOnly cookie, login and ID-lookup
rate limits, role checks on every dashboard API. An emergency session can be read only by the bystander link holder
(`key`), the patient, a linked guardian, or staff of the chosen hospital. Emergency start, identify, triage, match,
route and alert stay public by design (break-glass: the bystander has no account).

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | HTTP port |
| `DB_PATH` | `./data/carelink.db` | SQLite file |
| `DEMO_CENTER_LAT`, `DEMO_CENTER_LNG` | 17.7231, 83.3013 | Fallback location; hospitals are seeded as offsets around it. Change both and re-run `npm run seed` to run the demo anywhere |
| `MOCK_MODE` | false | `true` = never touch the network (no OSRM, no LLM). Tests use it |
| `ANTHROPIC_API_KEY` | empty | If set (and not MOCK_MODE) the LLM may refine the triage level. It can never lower a Critical result. 5 s timeout, any failure falls back to rules |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Model for the refinement |
| `ENABLE_FACE` | false | Optional face recognition (see Phase 6 notes below) |

## Demo script (under 2 minutes)

0. (Optional) Log in as `kiran@demo.test` on a second window (hospital) and `rohan@demo.test` on a third (guardian, Asha's family).
1. Open `/emergency.html` and tap **SOS** (or say "emergency" in a browser that supports speech recognition).
2. Enter `CL-1001`, or scan the QR from `/register.html`.
3. Tap **Unconscious** and **Chest pain**, then **Assess urgency**.
4. Show the **Critical** result with its reason and the "AI estimate, not a diagnosis" line.
5. Show the top 3 hospitals and expand **Score breakdown** (S, F, E, D, T).
6. Pick the first one (Heartline Cardiac Centre) and show the route and ETA.
7. **Alert hospital and guardian**, then watch the hospital queue and the guardian view update live. At the hospital tap Accept, Preparing, Ready: the guardian stepper follows.
8. Tap **Patient arrived** (bystander or hospital) and show the timeline. The patient's history shows it too.

Reset between runs with `npm run seed` (restart not required).

## Decisions (where the spec left room)

- **Progress bar vs screens.** The bar has 7 labels but there is a start screen first. "Prepare" is highlighted once the alert succeeds (the hospital is preparing); "Arrive" on the last screen.
- **Peak traffic term.** `traffic_norm` is 0.6 in "high" hours (8-10, 17-20) and 0.2 otherwise.
- **Hours are inclusive** (8 to 10 means 08:00 through 10:59).
- **Specialty "general".** A hospital listing `general` gets S=1 when the needed specialty is `general`, and 0.5 when the need is something else.
- **Substring keyword matching** for triage, after lower-casing; `conscious:false` / `breathing:false` are always Critical.
- **Status never goes backwards** (re-running match after alert does not reset `alerted`).
- **Guardian alerts respect consent**: if a patient's stored consent has `guardian_alerts` false, no guardian alert is created.
- **Accounts added after the original spec** (login, personas, access control, hospital workflow); the bystander flow stays account-free.
- **Extra endpoint** `GET /api/hospitals` (id, name, location) lets the hospital dashboard show a hospital picker and title.
- **Timestamps** from SQLite are converted to ISO UTC strings in API responses.
- **Alert for unidentified patients** is sent to the hospital only, with "Unidentified patient".
- **Maps/QR libraries** load from cdnjs (Leaflet 1.9.4) and unpkg (html5-qrcode 2.3.8) with visible fallbacks. QR scanning needs a camera and HTTPS or localhost.
- `GET /api/health` also reports `demo_center`, `mock_mode` and `face_enabled`.

## Face recognition (optional stretch, off by default)

`npm run models` downloads face-api.js and the model weights into `public/models` (gitignored; weights come from the
vladmandic/face-api GitHub repo because the original repo's weight paths no longer resolve). Then set `ENABLE_FACE=true`.
The browser computes a 128-number descriptor and sends only that; the server compares Euclidean distance with a 0.6
threshold. Registration stores a descriptor only when the patient ticks the face consent box. With `ENABLE_FACE=false`
(default) `/api/identify` with method `face` returns `{found:false, reason:"face_disabled"}`.
The server side is covered by `test/face.test.js`; the in-browser camera/model code could not be exercised in the
headless build environment, so treat it as untested on a real camera.

## Known limitations

- **Traffic is simulated** (multiplier by hour of day), labelled as such in the UI. No free live-traffic API.
- **No real SMS or push.** Alerts are rows in the database, shown by pages that poll every 2 s.
- **Face recognition is optional** and off by default; the demo never depends on it.
- Voice trigger works only in browsers with the Web Speech API (Chrome, Edge, Safari); elsewhere the mic button is hidden and SOS still works.
- OSRM public server has no SLA; if it is slow or down the route is a straight-line estimate (`source: "estimate"`).
- Hospitals, patients and phone numbers are fictional. Auth is demo-grade (no email verification, no password reset, in-memory rate limits, cookie not `Secure` over plain http).
- Not a medical device. Urgency is an advisory estimate and does not replace emergency services (call 112; ambulance 108).

## Checks

`bash scripts/checkpoint.sh <0-6>` runs the phase checks against a throwaway server and DB. `CHECKPOINTS.md` has the log.
