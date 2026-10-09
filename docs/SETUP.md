# CARELINK AI: setup and demo commands

Repo: `git@github.com:harsha-4144/carelink.git` (HTTPS: `https://github.com/harsha-4144/carelink.git`)

---

## Part 1. Push from this laptop (once)

```bash
cd /home/harsha/carelink
git status                      # should say "nothing to commit, working tree clean"
git remote add origin git@github.com:harsha-4144/carelink.git
git branch -M main
git push -u origin main
```

If `git remote add` says `remote origin already exists`:
```bash
git remote set-url origin git@github.com:harsha-4144/carelink.git
```

### If the push says "Permission denied (publickey)"
The SSH URL needs an SSH key registered on GitHub. Either set up a key:
```bash
ssh-keygen -t ed25519 -C "harsha@dharanova.com"      # press Enter 3 times
cat ~/.ssh/id_ed25519.pub                             # copy the whole line
```
Then GitHub, Settings, SSH and GPG keys, New SSH key, paste, save. Test with:
```bash
ssh -T git@github.com                                 # "Hi harsha-4144! You've successfully authenticated"
git push -u origin main
```
Or skip SSH and use HTTPS (GitHub asks for a personal access token as the password):
```bash
git remote set-url origin https://github.com/harsha-4144/carelink.git
git push -u origin main
```

### Pushing later changes
```bash
git add -A
git commit -m "describe the change"
git push
```

---

## Part 2. Brand-new laptop with a fresh WSL (Ubuntu)

Run these inside the WSL terminal.

### 2.1 Install the tools (one time)
```bash
sudo apt update
sudo apt install -y git curl build-essential python3
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```
Close the terminal and open a new WSL terminal (so `nvm` loads), then:
```bash
nvm install 20
node -v          # must print v20.x or higher
npm -v
```

### 2.2 Get the project (clone into the Linux home, not /mnt/c)
```bash
cd ~
git clone https://github.com/harsha-4144/carelink.git
cd carelink
```
(Use the HTTPS URL on a new laptop unless you set up an SSH key there. If the repo is private, git asks for your GitHub
username and a personal access token as the password.)

### 2.3 Install and run
```bash
npm install            # 1 to 2 minutes the first time
npm start              # seeds the demo data automatically on the first start
```
Open **http://localhost:3000** in the Windows browser (Chrome or Edge).

If that page does not load from Windows, find the WSL address and use it instead:
```bash
hostname -I            # then open http://<that-ip>:3000
```

### 2.4 Check that everything is healthy (optional)
```bash
npm test                                   # expect: 42 pass, 0 fail
curl localhost:3000/api/health             # expect: {"ok":true,...}
```

---

## Part 3. Run the demo

### Accounts (password for all: `demo1234`)
| Role | Email |
| --- | --- |
| Patient | `asha@demo.test` (CL-1001), `ravi@demo.test`, `meera@demo.test`, `arjun@demo.test`, `sana@demo.test` |
| Guardian | `rohan@demo.test` (Asha's), `sunita@demo.test`, `anil@demo.test`, `lakshmi@demo.test`, `imran@demo.test` |
| Hospital staff | `kiran@demo.test` (Heartline), `priya@demo.test` (Riverside) |

Staff sign-up code: `HACKHERS`. Patient IDs for the bystander: `CL-1001` to `CL-1005`.

### Three windows
1. **Bystander:** http://localhost:3000/emergency.html (use a phone-size window if you like).
2. **Hospital:** http://localhost:3000/login.html, tap "Heartline staff".
3. **Guardian:** a second browser profile or an incognito window, http://localhost:3000/login.html, log in as `rohan@demo.test`.
   (Each browser profile holds one login, so use different profiles or incognito for different people.)

### Script (about 2 minutes)
1. Bystander: tap **SOS**, then **Start now** (or wait 5 seconds).
2. Enter `CL-1001`, **Look up patient**, **Continue**.
3. Tap **Unconscious** and **Chest pain**, **Assess urgency**: shows **Critical**.
4. **Find best hospitals**: three cards with score breakdown; pick the first (Heartline).
5. **Confirm and alert**. Watch the hospital queue and guardian screen react.
6. Hospital: **Accept**, then **Preparing**, then **Ready**. Guardian: **I'm on my way**. The bystander screen shows both.
7. Bystander: **Patient arrived**. Show the timeline.

Extra moments: **False alarm**, refresh the page and **Resume emergency**, hospital **Decline** (bystander is re-matched),
skip identification and let the hospital **Identify patient** (guardians then alerted), the bell, the patient's **Access log**,
`/outbox.html` (simulated SMS), `/about.html`.

### Reset between runs
Stop the server (Ctrl+C), then:
```bash
npm run seed           # resets patients, hospitals, accounts and history
npm start
```

---

## Part 4. Show it on phones (HTTPS tunnel)

Camera (QR), microphone and location only work on `localhost` or HTTPS. For a phone, use a tunnel.
```bash
npm start                                     # terminal 1
```
Install cloudflared once (WSL, Ubuntu):
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```
Then in a second terminal:
```bash
cloudflared tunnel --url http://localhost:3000
```
It prints an `https://something.trycloudflare.com` address. Open it on the phone. Stop it with Ctrl+C when done.

---

## Part 5. Useful options

```bash
MOCK_MODE=true npm start          # no internet used at all (route becomes a straight line)
PORT=4000 npm start               # different port
DEMO_MODE=false npm start         # hides demo-account buttons and the SMS log
STAFF_CODE=mysecret npm start     # change the hospital staff sign-up code
```
Optional AI refinement of triage: copy `.env.example` to `.env`, put your key after `ANTHROPIC_API_KEY=`, restart.
Never commit `.env` (it is already git-ignored).

Browser walk-through of all personas (needs Playwright, installed only when you want it):
```bash
npm i --no-save playwright
npx playwright install chromium
# terminal 1:  RATE_LIMIT=off PORT=3997 npm start
# terminal 2:  BASE=http://localhost:3997 node scripts/e2e-flows.js
```

---

## Part 6. Troubleshooting

| Problem | Fix |
| --- | --- |
| `node: command not found` after installing nvm | Close and reopen the WSL terminal, then `nvm install 20` |
| `npm install` fails building `better-sqlite3` | `sudo apt install -y build-essential python3`, then `npm install` again |
| `EADDRINUSE: port 3000 already in use` | `PORT=3001 npm start`, or `fuser -k 3000/tcp` |
| Page does not open from Windows | Use `hostname -I` and open `http://<ip>:3000` |
| Map or QR scanner shows a "failed to load" message | No internet for the CDN. The rest of the flow still works. Type the ID instead of scanning |
| Camera, mic or location blocked | Use `http://localhost:3000` on the same machine, or the HTTPS tunnel on a phone |
| Page looks broken or old | Hard refresh: Ctrl+Shift+R |
| Too many login attempts message | Wait a few minutes, or restart the server |
| Want a totally clean start | `rm -rf data && npm start` |
| Slow or odd file errors | Make sure the project is under `~` (Linux), not `/mnt/c` |

More: [JUDGES_QA.md](JUDGES_QA.md) (answers to likely questions), `/about.html` in the running app, and `README.md`.
