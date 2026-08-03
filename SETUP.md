# SmartPrint — Setup

**Repository:** https://github.com/theRealestOne2922/SmartPrint

```bash
git clone https://github.com/theRealestOne2922/SmartPrint.git
cd SmartPrint
```

Three components, deployed to three places:

| Component | Directory | Runs on |
|---|---|---|
| Backend API + student web app | `student web app/` | Oracle Cloud VM (PM2 behind nginx) |
| Kiosk touchscreen UI | `kiosk ui/` | built into the web app, served at `/kiosk-app` |
| Print agent | `pi-print-agent/` | Raspberry Pi wired to the printer |

Frontend is hosted on Firebase; the API is on the VM; the Pi talks to MongoDB
directly.

---

## Prerequisites

- Node.js 20+ and npm
- A MongoDB database (Atlas or self-hosted)
- For the Pi: Raspberry Pi OS, CUPS, LibreOffice (the installer handles these)

---

## 1. Secrets

Three values must be generated once and then shared **byte-identically** across
components. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Used by | Why it must match |
|---|---|---|
| `MASTER_KEY` | backend + Pi | Unwraps the per-file key for confidential documents. A mismatch means those jobs fail to decrypt and never print. |
| `APP_SECRET` | backend + kiosk + Pi | Signs kiosk release tokens and the job integrity tag. A mismatch rejects valid jobs. |
| `MONGODB_URI` | all three | Same database, or the kiosk finds nothing and codes look invalid. |

Never commit these. Every `.env` is gitignored; `.env.example` in each directory
lists what is needed.

---

## 2. Backend + web app (the VM)

```bash
cd "student web app"
cp .env.example .env      # then fill it in
npm install
npm run build
```

Run it under PM2:

```bash
pm2 start npm --name smartprint -- start
pm2 save && pm2 startup    # run the command it prints, so it survives reboot
```

nginx proxies 443 → `127.0.0.1:5000`. The app binds loopback deliberately —
see `SECURITY.md`.

**First admin:** set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` before the
first start, or a random password is generated and printed to the log once.
Change it afterwards from the dashboard. There is no default credential.

---

## 3. Frontend (Firebase Hosting)

```bash
cd "kiosk ui" && npm install && npm run build
cd "../student web app" && npm run build     # copies the kiosk into dist/public/kiosk-app
npx firebase-tools deploy --only hosting:main --project smartprintvit
```

Build the kiosk **before** the web app — the web app's build copies the kiosk's
output into its own.

`VITE_API_BASE` is baked in at build time and must also appear in
`firebase.json`'s `connect-src`, or the Content-Security-Policy blocks every API
call.

---

## 4. Print agent (the Pi)

Fresh Pi:

```bash
sudo bash pi-print-agent/install-pi-agent.sh
```

That installs Node, CUPS, LibreOffice and fonts, sets up the printer queue and
the PM2 service. It will not overwrite an existing `.env`.

Existing Pi — see `docs/PI_REMOTE_ACCESS_AND_UPDATE.md`, which covers Tailscale,
confirming **which** Pi you are on, and updating the agent.

Verify:

```bash
cd <install-dir> && npm test        # no database or printer needed
pm2 logs smartprint-agent --lines 20
```

The banner must read **v4.2** or later. This line means confidential printing is
broken even though everything else looks healthy:

```
⚠️  MASTER_KEY missing/invalid in .env — confidential jobs will fail to print!
```

Logs alone are not proof. Send one real confidential job end to end.

---

## 5. Managing services

`scripts/services.sh` works on both the VM and the Pi and figures out which it
is on:

```bash
./scripts/services.sh status      # what is running, versions, health
./scripts/services.sh restart     # restart everything for this role
./scripts/services.sh logs        # recent logs
./scripts/services.sh doctor      # common failure checks
```

---

## Local development

`.env.example` in each directory lists what is needed. Point `MONGODB_URI` at
**your own** database, not production: the app writes real jobs, creates
accounts, and runs a retention sweep that deletes on a timer.

```bash
cd "student web app" && npm install && npm run dev
```

Things that surprise people, in order of how much time they cost:

- **New staff accounts need admin approval** before they can sign in. Not a bug.
- Uploading and creating jobs require a signed-in teacher; anonymous calls 401.
- The server takes the faculty identity from the session, so sending
  `teacherEmpId` in a request body does nothing.
- Confidential jobs withhold the filename until faculty verification.
- Files under `/uploads/` need a signed token; a bare filename returns 403.
- Repeated failed logins freeze **that account** for 15 minutes. If you are
  testing login handling, you will hit this.

---

## Where to read next

| | |
|---|---|
| `SECURITY.md` | what each control defends against, and what not to undo |
| `docs/PI_REMOTE_ACCESS_AND_UPDATE.md` | Tailscale, identifying the right Pi, updating the agent |
| `PROJECT_HANDOFF.md` | architecture and data flow |
