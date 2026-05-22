# SmartPrint VIT

A complete, modern college project / prototype for a smart, cloud-connected campus printing solution. 

This repository contains the full end-to-end stack, including a student-facing web app, a physical kiosk interface, and a Raspberry Pi-based printing agent that communicates directly with campus printers.

## 🏗️ Architecture & Project Structure

The project is divided into three distinct, decoupled components:

1. **Student Web App (`/student web app`)**
   - **Role:** The primary interface for students and teachers to upload documents and configure print settings.
   - **Tech Stack:** React, Vite, Tailwind CSS, Express, Drizzle ORM, Supabase (PostgreSQL).
   - **Key Features:**
     - Client-side PDF decryption (via `pdfjs-dist`).
     - Office file page-count extraction by parsing ZIP metadata (`docProps/app.xml`).
     - Automatic saddle-stitch booklet generation with live preview (`pdf-lib`).
     - Rate-limited, secure file uploads directly to Supabase Storage with SHA-256 deduplication.

2. **Kiosk UI (`/kiosk ui`)**
   - **Role:** A touch-friendly interface designed to run on a physical kiosk next to the printer for job confirmation and payment.
   - **Tech Stack:** React, Vite, Tailwind CSS.
   - **Key Features:**
     - Sleek, modern UI with Framer Motion animations.
     - Real-time job status polling and confirmation workflows.
     - Abstracts storage with support for both in-memory and database backends.

3. **Pi Print Agent (`/pi-print-agent`)**
   - **Role:** A lightweight Node.js daemon meant to run on a Raspberry Pi connected directly to the printer via USB/Network.
   - **Tech Stack:** Node.js, CUPS, LibreOffice.
   - **Key Features:**
     - Listens to Supabase real-time subscriptions for instant job triggering.
     - Converts Office documents and images to PDF using headless LibreOffice with auto-recovery/retry logic.
     - Spools jobs directly to CUPS (`lp` command) for high-fidelity printing.
     - Avoids GhostScript to prevent page duplication issues.

## 🔐 Security & Reliability

- **Graceful File Handling:** Validates extensions, MIME types, and file sizes.
- **Orphan Cleanup Scheduler:** A background cron routine that automatically purges old jobs from the database and orphaned files from cloud storage after a 3-hour grace period to save space.
- **Real-time Sync:** Uses Supabase's real-time Postgres changes to sync state between the web app, the kiosk, and the physical printer agent.

## 🚀 Getting Started

Each component has its own `package.json` and can be run independently.

*Note: You will need to set up a Supabase project and provide the appropriate `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` files for the components.*

### Running the Web Apps
Navigate into either the `student web app` or `kiosk ui` directory:
```bash
npm install
npm run dev
```

### Running the Print Agent
Ensure LibreOffice and CUPS are installed on the host machine.
```bash
cd pi-print-agent
npm install
node index.js
```
