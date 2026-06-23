# SmartPrint — Full Project Handoff & Context Note
> **Date:** June 22, 2026
> **Author:** Antigravity AI (for Kishore)
> **Purpose:** Everything a new Antigravity session needs to understand this project immediately.

---

## 🏗️ What is SmartPrint?

SmartPrint is a **college print management system** built for VIT. Students upload documents from their phone via a web app, receive a 6-digit PIN, then enter that PIN at a physical kiosk (Raspberry Pi) connected to a printer. The kiosk fetches the job and prints it automatically.

---

## 🌐 Live URLs & Infrastructure

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

## 📁 Project Structure

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
│   ├── .env                  ← MONGODB_URI only
│   └── package.json
│
├── deploy-vit.ps1            ← PowerShell: builds both apps → deploys to Firebase
├── install-pi-agent.sh       ← Bash: sets up Raspberry Pi from scratch
├── smartprint_nginx.conf     ← Reference Nginx config
└── _supabase_backup/         ← Old Supabase code (archived, NOT used)
```

---

## 🔄 How the System Works (Data Flow)

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

## 🔑 All Environment Variables

### `student web app/.env` (local dev + Oracle VM)
```
MONGODB_URI=mongodb+srv://smartprintvit_admin:7Stqvs7w3swGSw2R@cluster0.fzbkawi.mongodb.net/smartprint?retryWrites=true&w=majority&appName=Cluster0
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
PORT=5001
```

### `pi-print-agent/.env`
```
MONGODB_URI=mongodb+srv://smartprintvit_admin:7Stqvs7w3swGSw2R@cluster0.fzbkawi.mongodb.net/smartprint?retryWrites=true&w=majority&appName=Cluster0
```

---

## 🚀 Deployment Commands

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
```bash
cd ~/smartprintvit/pi-print-agent
git pull origin main
npm install
pm2 restart print-agent
```

---

## ⚠️ Critical Things to Know

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

## 🛡️ Security Summary
- All traffic encrypted via TLS/SSL (Let's Encrypt certificate on Oracle VM)
- MongoDB Atlas uses `mongodb+srv://` (TLS enforced)
- No credentials exposed to the browser
- Client-side document decryption (passwords never sent to server)
- Rate-limited uploads (5/hour/IP)
- File type validation on server
- Automated data purging (24h default retention)

---

## 📦 What's in the Backup ZIP

This ZIP contains the **entire `d:\smartprintvit\` directory** including:
- ✅ All source code (student web app, kiosk ui, pi-print-agent)
- ✅ All `.env` files (normally gitignored)
- ✅ `.env.production` (build-time vars)
- ✅ `deploy-vit.ps1` (deployment script)
- ✅ `install-pi-agent.sh` (Raspberry Pi setup)
- ✅ `firebase.json` and `.firebaserc` configs
- ❌ `node_modules/` excluded (run `npm install` after extracting)
- ❌ `dist/` excluded (run `npm run build` to regenerate)
- ❌ SSH key NOT included (copy `ssh-key-2026-06-21.key` separately)
