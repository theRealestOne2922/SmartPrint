# SmartPrint — Project Handoff & Context Note
> **Last updated:** July 2, 2026

---

## What is SmartPrint?

SmartPrint is a **college print management system** built for VIT. Students upload documents from their phone via a web app, receive a 6-digit PIN, then enter that PIN at a physical kiosk (Raspberry Pi) connected to a printer. The kiosk fetches the job and prints it automatically.

---

## Live URLs & Infrastructure

| Component | URL / Address | Hosting |
|-----------|--------------|---------|
| **Student Web App** | `https://smartprintvit.web.app` | Firebase Hosting (free) |
| **Kiosk Web App** | `https://smartprintvit.web.app/kiosk-app` | Firebase Hosting (embedded) |
| **Backend API** | `https://140.245.224.137.nip.io` | Oracle Cloud VM (free tier) |
| **Database** | MongoDB Atlas (Cluster0) | MongoDB Atlas (free tier) |
| **File Storage** | Local filesystem on Oracle VM (`/uploads/`) | Oracle Cloud VM |
| **SSL Certificate** | Let's Encrypt via Certbot | Auto-renews on Oracle VM |

### Oracle Cloud VM Access
- **IP:** `140.245.224.137`
- **OS:** Ubuntu
- **SSH Key:** `C:\Users\Kishore\Downloads\ssh-key-2026-06-21.key`
- **SSH Command:** `ssh -i <path-to-key> ubuntu@140.245.224.137`
- **Backend Location on VM:** `~/smartprintvit/student web app/`
- **Process Manager:** PM2 (process name: `smartprint`)
- **Reverse Proxy:** Nginx → proxies port 443 to localhost:5000
- **SSL Domain:** `140.245.224.137.nip.io` (nip.io maps to the IP automatically)

### MongoDB Atlas
- **Connection String:** `mongodb+srv://smartprintvit_admin:7Stqvs7w3swGSw2R@cluster0.fzbkawi.mongodb.net/smartprint`
- **Database Name:** `smartprint`
- **Collections:** `printjobs`, `admins`, `teachers`, `systemsettings`

---

## Project Structure

```
smartprintvit/
├── student web app/          ← Main Express + Vite app (Student UI + Backend API)
│   ├── client/               ← React/Vite frontend (Student upload UI)
│   │   └── src/
│   │       ├── hooks/use-print.ts    ← Upload & job creation logic
│   │       ├── lib/api-config.ts     ← API_BASE URL configuration
│   │       └── pages/print-wizard.tsx ← Main upload wizard page
│   ├── server/               ← Express backend
│   │   ├── index.ts          ← Server entry, CORS config, static /uploads serving
│   │   ├── routes.ts         ← All API endpoints (upload, jobs, admin, settings)
│   │   ├── mongodb.ts        ← Mongoose connection
│   │   ├── cleanup.ts        ← Automated job/file cleanup scheduler
│   │   ├── websocket.ts      ← WebSocket relay for realtime updates
│   │   └── models/           ← Mongoose schemas (PrintJob, Admin, Teacher, SystemSetting)
│   ├── .env                  ← Local dev env (MONGODB_URI)
│   ├── .env.production       ← Build-time env (VITE_API_BASE=https://140.245.224.137.nip.io)
│   └── firebase.json         ← Firebase Hosting config
│
├── kiosk ui/                 ← Separate Vite app for the Kiosk touchscreen
│   ├── client/               ← React frontend (PIN entry, job review, print trigger)
│   │   └── src/hooks/use-print-jobs.ts ← All API calls to Express backend
│   ├── server/               ← Its own Express server (for local dev only)
│   ├── .env                  ← MONGODB_URI + PORT=5001
│   └── client/src/lib/api-config.ts   ← API_BASE for kiosk
│
├── pi-print-agent/           ← Node.js agent that runs on Raspberry Pi
│   ├── index.js              ← Listens to MongoDB Change Streams for 'printing' status
│   ├── models/PrintJob.js    ← Mongoose model (mirrors backend)
│   ├── install-pi-agent.sh   ← Bash: sets up a Raspberry Pi from scratch
│   ├── .env                  ← MONGODB_URI + MASTER_KEY
│   └── package.json
│
├── deploy-vit.ps1            ← PowerShell: builds both apps → deploys to Firebase
└── smartprint_nginx.conf     ← Reference Nginx config
```

---

## How the System Works (Data Flow)

```
Student Phone                 Oracle VM                    Raspberry Pi
     │                            │                             │
     │  1. Upload file via        │                             │
     │     POST /api/upload       │                             │
     │  ──────────────────────►   │                             │
     │                            │  Saves file to /uploads/    │
     │                            │  Returns public URL         │
     │  ◄──────────────────────   │                             │
     │                            │                             │
     │  2. Create print job       │                             │
     │     POST /api/print-jobs   │                             │
     │  ──────────────────────►   │                             │
     │                            │  Saves to MongoDB           │
     │                            │  Returns 6-digit PIN        │
     │  ◄──────────────────────   │                             │
     │                            │                             │
     │        3. Student walks to kiosk, enters PIN             │
     │                            │                             │
     │                            │  4. Kiosk fetches job       │
     │                            │  ◄──────────────────────    │
     │                            │  GET /api/jobs/lookup/:pin  │
     │                            │  ──────────────────────►    │
     │                            │                             │
     │                            │  5. Student confirms,       │
     │                            │     kiosk sets status       │
     │                            │     → 'printing'            │
     │                            │                             │
     │                            │  6. Pi Print Agent detects  │
     │                            │     change via MongoDB      │
     │                            │     Change Stream           │
     │                            │                        ──►  │ Downloads file
     │                            │                             │ Sends to CUPS
     │                            │                             │ Prints document
     │                            │  7. Status → 'completed'   │
```

---

## All Environment Variables

> **MASTER_KEY / APP_SECRET must be byte-identical everywhere they appear.**
> `MASTER_KEY` unwraps the per-file key for confidential documents — if the Pi's
> copy differs from the backend's, those jobs fail to decrypt and won't print.
> `APP_SECRET` signs the kiosk release token, so a mismatch makes the token
> issued by one server invalid at the other. Generate each with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### `student web app/.env` (local dev + Oracle VM)
```
MONGODB_URI=mongodb+srv://smartprintvit_admin:7Stqvs7w3swGSw2R@cluster0.fzbkawi.mongodb.net/smartprint?retryWrites=true&w=majority&appName=Cluster0
MASTER_KEY=<64 hex chars>
APP_SECRET=<64 hex chars>
BREVO_API_KEY=<optional, for password-reset OTP email>
```

### `student web app/.env.production` (build-time for Firebase)
```
VITE_API_BASE=https://140.245.224.137.nip.io
```

### Oracle VM `.env` (additional)
```
NODE_ENV=production
PORT=5000
```

### `kiosk ui/.env`
```
MONGODB_URI=mongodb+srv://smartprintvit_admin:7Stqvs7w3swGSw2R@cluster0.fzbkawi.mongodb.net/smartprint?retryWrites=true&w=majority&appName=Cluster0
APP_SECRET=<same value as the student web app>
PORT=5001
```

### `pi-print-agent/.env`
```
MONGODB_URI=mongodb+srv://smartprintvit_admin:7Stqvs7w3swGSw2R@cluster0.fzbkawi.mongodb.net/smartprint?retryWrites=true&w=majority&appName=Cluster0
MASTER_KEY=<same value as the student web app>
CLEANUP_HOURS=24
```

---

## Deployment Commands

### Deploy Frontend (Student App + Kiosk) to Firebase
```powershell
cd d:\smartprintvit
powershell.exe -ExecutionPolicy Bypass -File .\deploy-vit.ps1
```

### Deploy Backend to Oracle VM
```bash
ssh -i C:\Users\Kishore\Downloads\ssh-key-2026-06-21.key ubuntu@140.245.224.137
cd ~/smartprintvit/'student web app'
git pull origin main
npm install
npm run build
pm2 restart smartprint
```

### Update Pi Print Agent (on Raspberry Pi)
The installer registers the PM2 process as `smartprint-agent` and installs to
`~/smartprint-agent`, so use that name — not `print-agent`.
```bash
cd ~/smartprint-agent
git pull origin main
npm install
pm2 restart smartprint-agent
```

---

## Critical Things to Know

1. **NO SUPABASE ANYMORE.** All Supabase code, clients, and dependencies have been completely removed. The `_supabase_backup/` folder is just an archive. Do NOT re-introduce Supabase.

2. **File uploads go to local filesystem.** The Express backend saves uploaded files to `<cwd>/uploads/` on the Oracle VM and serves them via `app.use('/uploads', express.static(...))`. Nginx proxies this through HTTPS.

3. **Mixed Content:** The frontend at `smartprintvit.web.app` (HTTPS) calls the backend at `https://140.245.224.137.nip.io` (also HTTPS via Let's Encrypt). This MUST stay HTTPS or browsers will block the requests.

4. **Rate Limiting:** The `/api/upload` endpoint has a rate limit of 5 uploads per hour per IP.

5. **Automated Cleanup:** A background scheduler runs every hour and deletes print jobs + their files older than the configured retention period (default 24h). This is configured in the admin panel via `jobExpirationHours`.

6. **Default Admin Login:** Username: `vit admin`, Password: `admin123`. This is seeded automatically on first run.

7. **WebSockets:** The backend broadcasts job status changes over WebSocket so the Student status page and Kiosk UI update in real-time without polling.

8. **The kiosk UI is embedded inside the student web app's build output.** During `deploy-vit.ps1`, the kiosk build is copied into `student web app/dist/public/kiosk-app/` before deploying to Firebase. This means both apps are served from the same Firebase project but at different paths (`/` and `/kiosk-app/`).

9. **GitHub Repo:** `https://github.com/theRealestOne2922/SmartPrint` (branch: `main`).

10. **SSH Key Location:** `C:\Users\Kishore\Downloads\ssh-key-2026-06-21.key` — this file is NOT in the git repo. You MUST copy it to the new device manually.

---

## Security Summary
- All traffic encrypted via TLS/SSL (Let's Encrypt certificate on Oracle VM)
- MongoDB Atlas uses `mongodb+srv://` (TLS enforced)
- No credentials exposed to the browser
- Client-side document decryption (passwords never sent to server)
- Rate-limited uploads (5/hour/IP)
- File type validation on server
- Automated data purging (24h default retention)
- **Confidential Print Jobs:** Requires Faculty ID verification at the Kiosk before revealing document details or releasing the print.
- **URL Security:** 6-digit print codes are hidden from URLs and passed via secure session storage to prevent shoulder-surfing.
- **High Volume Warning:** Users are warned before proceeding if a print job contains more than 50 copies.

---

## What's in the Handoff ZIP

This ZIP contains the **entire SmartPrint codebase** prepared for the Software Development Cell (SDC):
- ✅ All source code (`student web app`, `kiosk ui`, `pi-print-agent`)
- ✅ `deploy-vit.ps1` (deployment script)
- ✅ `install-pi-agent.sh` (Raspberry Pi setup script)
- ✅ `smartprint_nginx.conf` (Nginx configuration reference)
- ❌ `node_modules/` excluded
- ❌ `dist/` excluded
- ❌ `.env` files excluded for security. (See below for environment variable setup)
- ❌ `.git/` excluded

---

## VTOP Implementation & Deployment Guide for SDC

When migrating SmartPrint to VTOP infrastructure, the SDC team will need to provision their own environments. Since the `.env` files containing our API keys and database credentials have been stripped for security, here is exactly what SDC needs to configure:

### 1. Environment Variables Setup
You must create `.env` files in three locations:

**A. `student web app/.env`**
```env
MONGODB_URI=mongodb://<vtop-db-user>:<password>@<vtop-mongo-host>:27017/smartprint
BREVO_API_KEY=<your-brevo-or-smtp-api-key>
```
*(Also create `student web app/.env.production` containing `VITE_API_BASE=https://<your-vtop-backend-domain>`)*

**B. `kiosk ui/.env`**
```env
MONGODB_URI=mongodb://<vtop-db-user>:<password>@<vtop-mongo-host>:27017/smartprint
PORT=5001
```

**C. `pi-print-agent/.env`**
```env
MONGODB_URI=mongodb://<vtop-db-user>:<password>@<vtop-mongo-host>:27017/smartprint
```

### 2. Network Restrictions
As requested, the website must only work on the VIT Network (cannot be accessed from outside network or mobile data).
- **Implementation:** SDC should configure the Nginx Reverse Proxy (or VTOP firewall) to only allow inbound connections from the campus IP subnets (e.g., `allow 10.0.0.0/8; deny all;`).

### 3. Database Migration
- Deploy a MongoDB instance within the VTOP intranet.
- Update the `MONGODB_URI` across all apps. Mongoose schemas will automatically initialize the required collections (`printjobs`, `admins`, `teachers`, `systemsettings`) on the first run.
- The server will automatically seed the default admin (`vit admin` / `admin123`) on startup.

### 4. Build and Run
```bash
# Backend (PM2)
cd "student web app"
npm install
npm run build
pm2 start dist/index.cjs --name smartprint

# Frontend (Firebase or internal static hosting)
# Run `npm run build` in 'student web app'. It will automatically build the kiosk UI as well.
# Serve the resulting `dist/public` folder using Nginx or Firebase Hosting.
```
