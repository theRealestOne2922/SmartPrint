# SmartPrint VIT - Project Context for AI Agents

Hello fellow AI! If you are reading this, you are picking up development on the **SmartPrint VIT** project on a new machine. The user has transferred this project here to fix bugs and continue development. 

Below is the complete context of the architecture, where we left off, and crucial details you need to know.

## 🏗️ Project Architecture

This is a comprehensive printing kiosk system consisting of three main parts, all stored in this single monorepo:

### 1. Student Web App (`/student web app`)
- **Tech Stack:** React (Vite), Wouter for routing, TailwindCSS, Shadcn UI.
- **Backend:** Express server (`server/`) with Supabase for the database and storage.
- **Purpose:** The main portal where students upload files (PDF, PPT, DOCX, Images), select print settings (color, copies, duplex, paper size), preview their documents, and queue them for printing.
- **Key Features:** Real-time PDF booklet generation preview, Firebase deployment.

### 2. Kiosk UI (`/kiosk ui`)
- **Tech Stack:** React (Vite), TailwindCSS.
- **Purpose:** A dedicated, simplified UI meant to be displayed full-screen on the Raspberry Pi touch display attached to the printer.
- **How it's deployed:** The build output of the Kiosk UI is injected into the `student web app`'s `dist/public/kiosk-app` folder. The `firebase.json` rewrites `/kiosk-app/**` to this folder. It is **hosted on the exact same Firebase URL** as the student app to prevent "Page Not Found" errors.

### 3. Pi Print Agent (`/pi-print-agent`)
- **Tech Stack:** Node.js, PM2.
- **Purpose:** Runs on a Raspberry Pi connected to the physical printer via USB. 
- **How it works:** It listens to the Supabase `print_jobs` table in real-time. When a new job is queued, it downloads the file, converts Office docs/images to PDF via LibreOffice (`soffice`), applies formatting (like N-up A3 side-by-side), and sends it directly to the printer via CUPS (`lp`).

---

## 🛠️ Deployment Workflow

There is a master deployment script in the root directory: **`deploy-vit.ps1`**.
**ALWAYS use this script to deploy.** Do not deploy the sub-folders manually. 
The script does the following:
1. Builds the `student web app`.
2. Builds the `kiosk ui`.
3. Copies the Kiosk UI build into the Student Web App's public distribution folder.
4. Deploys the merged output to Firebase.

---

## 🕒 Where We Left Off (Recent Changes)

Before the project was exported to this laptop, we completed the following critical fixes:

1. **A3 "Booklet / Exam Paper" Hybrid Logic:**
   - **The Problem:** Staff wanted to print 2-page exam papers on A3, but standard saddle-stitch formatting caused massive blank spaces.
   - **The Fix:** Implemented a **Hybrid Logic** in both `student web app/client/src/pages/print-wizard.tsx` and `pi-print-agent/index.js` (and `install-pi-agent.sh`). 
   - If the document is 1-2 pages: It uses 2-up (side-by-side) printing. 
   - If the document is 3+ pages: It uses proper Saddle-Stitch folding logic.
2. **Black & White Previews:**
   - Modified `print-wizard.tsx` so that when a user selects "B&W", the `iframe` preview applies `filter: grayscale(100%)` to visually reflect the setting.
3. **Dynamic Login Navbar:**
   - Updated `layout.tsx` to read `localStorage` (`teacherName` and `adminAuth`). Once logged in, the top-right button shows the username instead of "Login" and includes a working "Log Out" dropdown.
4. **Kiosk 24/7 Uptime Fix:**
   - Modified the Firebase deployment structure to merge the Kiosk UI directly into the main app to prevent routing 404 errors.

---

## ⚠️ Critical Rules & Warnings

1. **Do not use GhostScript in the Pi Agent!** 
   - The printer had issues with GhostScript duplicating pages. We explicitly use `libreoffice --headless` for conversion and native `pdf-lib` for formatting.
2. **Environment Variables:**
   - The `.env` files are fully preserved in this archive. Supabase keys and Firebase configs are intact. Do not lose them.
3. **Pi Agent Updates:**
   - If you ever modify the code in `pi-print-agent/index.js`, remind the user that they MUST update the agent on the physical Raspberry Pi for the physical printer to reflect the changes. They can do this by running the `install-pi-agent.sh` script on the Pi.

Good luck with the bug fixing and future development! You have all the context you need.
