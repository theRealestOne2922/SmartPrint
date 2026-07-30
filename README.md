# SmartPrint VIT

A cloud-connected campus printing system: students upload a document from their phone, get a PIN, and walk up to a kiosk next to the printer to release the job.

## Architecture

Three independent apps in one repo:

1. **Student Web App (`/student web app`)**
   - Tech: React, Vite, Tailwind CSS, Express, MongoDB (Mongoose).
   - The upload + print-settings portal for students and teachers.
   - Client-side PDF decryption (`pdfjs-dist`), office file page-count extraction, automatic saddle-stitch booklet layout (`pdf-lib`).
   - Server-side rate limiting on uploads; files are hashed (SHA-256) for dedup and stored on local disk on the backend host.

2. **Kiosk UI (`/kiosk ui`)**
   - Tech: React, Vite, Tailwind CSS.
   - Runs full-screen on the touchscreen next to the printer for PIN entry and job confirmation.
   - Its production build gets copied into the student app's output and served from the same origin, at `/kiosk-app`.

3. **Pi Print Agent (`/pi-print-agent`)**
   - Tech: Node.js, CUPS, LibreOffice.
   - Runs on the Raspberry Pi wired to the printer.
   - Watches MongoDB Change Streams for jobs, converts Office docs/images to PDF via headless LibreOffice, and spools to CUPS (`lp`). GhostScript is intentionally not used — it duplicated pages on our printer.

## Security

- Confidential (exam-paper) jobs require server-side faculty verification before release — the check never happens in the browser.
- Files for confidential jobs are encrypted at rest (AES-256-GCM envelope encryption, per-file key wrapped by a server-only master key).
- Admin/teacher passwords are bcrypt-hashed.
- PINs/OTPs are generated with `crypto.randomInt`, and lookup/verify endpoints are rate-limited.
- Background cleanup job purges old print jobs and their files after a configurable retention window.

## Getting started

Each app has its own `package.json` and runs independently:

```bash
cd "student web app"   # or "kiosk ui"
npm install
npm run dev
```

You'll need a MongoDB connection string and a few other secrets in `.env` — see `.env.example` in each app for what's required.

### Running the print agent

Requires LibreOffice and CUPS on the host:

```bash
cd pi-print-agent
npm install
node index.js
```
