# CARELINK AI: questions judges ask, and honest answers

## The pitch in one line
When the patient can't speak, CARELINK speaks for them: scan a QR or type an ID, and the right hospital and the family know in seconds.

## Product and flow
**Who uses it?** Four people: the **bystander** (no account, one-tap SOS), the **patient** (owns the ID and consent), the **guardian** (live status, responds "on my way"), and **hospital staff** (accept, prepare, decline, identify the patient).

**What if the patient has no ID?** The bystander skips identification. The hospital still gets the alert. When someone identifies the patient, staff press *Identify patient*, enter the CARELINK ID, and the guardians are alerted automatically.

**Accidental SOS?** 5 second cancel countdown before anything is created. Afterwards a *False alarm* button cancels the incident and tells the hospital and guardians.

**Hospital can't take the patient?** Staff decline with a reason; the bystander sees it, the declined hospital is never offered again, and guardians follow the new hospital.

**Two emergencies at once?** The hospital queue is sorted Critical first, then by ETA.

**Phone locks or the page refreshes?** The incident is saved in the browser and offers *Resume emergency*; the server keeps the state.

**Double tap on Alert?** The alert endpoint is idempotent: one alert set, no duplicates.

## AI and accuracy
**How does triage work, how accurate is it?** A transparent rule engine over red-flag symptoms (collapsed, chest pain, stroke signs, severe bleeding...), plus "not conscious / not breathing" which is always Critical. It is an *advisory estimate, not a diagnosis*, and says so on screen. We have not clinically validated it; the roadmap is validation against a standard triage protocol with clinicians.

**Where is the LLM?** Optional refinement only. It may raise urgency, it can **never lower a Critical rating**, it has a 5 second timeout, and any failure falls back to the rules. With no API key the whole app works identically.

**How is the hospital chosen?** A published score, 0 to 100: specialty match, facilities, ETA, distance, traffic, with weights that change by urgency (see `/about.html`). The top 3 are shown with a score breakdown so the choice is explainable. Hospitals without an emergency unit are excluded for Critical and Urgent cases.

## Privacy, security, law
**What can a stranger see?** Only an emergency summary (name, blood group, allergies, conditions, medications, guardian contacts), only after a QR scan or ID entry, and every lookup is logged. The QR contains a random token, not medical data.

**Can the patient see who looked?** Yes: *Access log* on the patient dashboard.

**Consent?** Required at sign-up (medical data, guardian alerts); face recognition is a separate optional consent. Guardian alerts can be switched off later and the system respects that. Withdrawing face consent deletes the stored descriptor.

**Account security?** Passwords hashed with scrypt, random session tokens (stored hashed) in an HttpOnly SameSite cookie, role checks on every API, an emergency session readable only by the bystander link holder, the patient, a linked guardian, or staff of the chosen hospital, and rate limits on login and ID lookup.

**Regulation?** Designed around consent, data minimisation, purpose limitation and audit, which map to India's DPDP Act 2023 and HIPAA principles. This is a hackathon prototype on synthetic data; a real deployment needs a legal review, hospital agreements and a hosting/data-residency plan.

**Can someone brute-force IDs?** Lookups are rate limited and logged; IDs are not secret on their own in the product design (the emergency summary is deliberately minimal), and the roadmap adds break-glass verification for responders.

## What is real and what is simulated
| Part | Status |
| --- | --- |
| Triage rules, scoring, alerts, accounts, dashboards, access control | Real and tested |
| Road routing and ETA | Real (OSRM public server), straight-line fallback |
| Traffic | **Simulated** by time of day (no free live-traffic API) |
| SMS | **Simulated**: every message appears in the SMS log (`/outbox.html`) |
| Hospitals, patients, phones | **Synthetic** demo data |
| Face recognition | Optional, off by default, not part of the demo |

## Engineering
**Real-time?** Dashboards poll every 2 seconds today. Next step: server-sent events.

**Scale?** SQLite is right for a prototype. Path: Postgres, a job queue for notifications, SSE/WebSockets, a real SMS provider.

**Integration with 112/108 and hospital systems?** Roadmap: dispatch hand-off to the national emergency number, and FHIR export to hospital systems.

**Offline or bad network?** The app never shows a blank screen: OSRM falls back to a straight-line estimate, the AI falls back to rules, the incident can resume, and *Call 112* is on every screen.

**How is it tested?** 42 automated tests (triage, scoring, access control, every real-world flow) plus phase checkpoints (`scripts/checkpoint.sh`), and a browser walk-through of all personas (`scripts/e2e-flows.js`) covering cancel, double tap, resume, decline, unknown patient, guardian response, notifications, SMS log and access log.

## Business and adoption (be ready)
**Who pays?** Hospitals and emergency networks (SaaS), insurers and employers (members' emergency ID), with free patient accounts.
**Why would hospitals use it?** Earlier warning, a structured patient summary on arrival, and fewer wasted diversions.
**First customers?** City emergency services and private hospital chains; schools and elder-care homes as pilots.
**Biggest risks?** Clinical validity of triage, trust in who may view data, and hospital adoption. Mitigations: advisory framing, audit log, pilot with clinicians.
