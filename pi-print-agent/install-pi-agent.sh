#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SmartPrint — Full Raspberry Pi Print Agent Installer & Setup
# ═══════════════════════════════════════════════════════════════
# This script performs a complete, zero-to-hero installation:
#   1. Clean broken apt packages/keys and update repositories
#   2. Install Node.js v20 via official precompiled binaries (bypassing GPG/SHA1 errors)
#      and create global symlinks in /usr/bin to resolve PATH issues.
#   3. Install CUPS and hard-disable ghost queues
#   4. Install LibreOffice for headless PDF conversions
#   5. Install MS compatibility fonts & rebuild font caches
#   6. Deploy agent files and pre-configure database keys
#   7. Set up PM2 globally, symlink to /usr/bin, and start background daemon
#   8. Set up universal Chromium autostart kiosk mode (Full-Screen)
#   9. Disable screen blanking/sleep
#
# RUNNING THIS SCRIPT:
#   Simply run on your Pi:
#     sudo bash install-pi-agent.sh
# ═══════════════════════════════════════════════════════════════

set -e

# Make sure we run with root privileges
if [ "$EUID" -ne 0 ]; then
    echo "❌ ERROR: Please run this script with sudo!"
    echo "Usage: sudo bash install-pi-agent.sh"
    exit 1
fi

# Detect actual user running sudo to determine home directory
REAL_USER=$SUDO_USER
if [ -z "$REAL_USER" ]; then
    REAL_USER="pi"
fi
USER_HOME=$(eval echo "~$REAL_USER")
INSTALL_DIR="$USER_HOME/smartprint-agent"

# Print modern installer banner
clear
echo "==================================================================="
echo "       ███████╗███╗   ███╗ █████╗ ██████╗ ████████╗                "
echo "       ██╔════╝████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝                "
echo "       ███████╗██╔████╔██║███████║██████╔╝   ██║                   "
echo "       ╚════██║██║╚██╔╝██║██╔══██║██╔══██╗   ██║                   "
echo "       ███████║██║ ╚═╝ ██║██║  ██║██║  ██║   ██║                   "
echo "       ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝                   "
echo "  ██████╗ ██████╗ ██╗███╗   ██╗████████╗ █████╗  ██████╗ ███████╗  "
echo "  ██╔══██╗██╔══██╗██║████╗  ██║╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝  "
echo "  ██████╔╝██████╔╝██║██╔██╗ ██║   ██║   ███████║██║  ███╗█████╗    "
echo "  ██╔═══╝ ██╔══██╗██║██║╚██╗██║   ██║   ██╔══██║██║   ██║██╔══╝    "
echo "  ██║     ██║  ██║██║██║ ╚████║   ██║   ██║  ██║╚██████╔╝███████╗  "
echo "  ╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝  "
echo "==================================================================="
echo "        Raspberry Pi Complete Automation & Kiosk Setup v3.2"
echo "==================================================================="
echo ""
echo "  Target Directory:      $INSTALL_DIR"
echo "  Kiosk Autostart User:  $REAL_USER ($USER_HOME)"
echo ""
read -p "Press [ENTER] to begin the complete installation..."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 1: Clean Broken Repos & Update Systems
# ─────────────────────────────────────────────────────────
echo "🧹 [1/9] Cleaning up broken apt repositories & keys..."
# Remove broken NodeSource references from previous attempts to fix update block
rm -f /etc/apt/sources.list.d/nodesource.list
rm -f /etc/apt/keyrings/nodesource.gpg

echo "   Updating system package lists..."
apt-get update || true

echo "   Installing system core utilities..."
apt-get install -y wget curl git unzip cabextract gnupg2 x11-xserver-utils || true
echo "   Done."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 2: Install Node.js v20 (Precompiled Binary + Symlinks)
# ─────────────────────────────────────────────────────────
echo "🟢 [2/9] Installing Node.js via official precompiled binaries..."
ARCH=$(uname -m)
NODE_ARCH=""

if [ "$ARCH" = "x86_64" ]; then
    NODE_ARCH="linux-x64"
elif [ "$ARCH" = "aarch64" ]; then
    NODE_ARCH="linux-arm64"
elif [[ "$ARCH" =~ ^armv7 ]]; then
    NODE_ARCH="linux-armv7l"
elif [[ "$ARCH" =~ ^armv6 ]]; then
    NODE_ARCH="linux-armv6l"
else
    echo "❌ Unsupported architecture: $ARCH"
    exit 1
fi

NODE_VER="v20.12.2"
NODE_DIR="node-$NODE_VER-$NODE_ARCH"

echo "   Auto-detected architecture: $ARCH → Fetching Node.js $NODE_VER..."
cd /tmp
wget -q "https://nodejs.org/dist/$NODE_VER/$NODE_DIR.tar.xz" || {
    echo "❌ Node.js download failed! Check internet connection."
    exit 1
}

echo "   Installing to /usr/local..."
tar -xJf "$NODE_DIR.tar.xz"
cp -R "$NODE_DIR"/{bin,include,lib,share} /usr/local/
rm -rf "$NODE_DIR" "$NODE_DIR.tar.xz"
cd - >/dev/null

# Bulletproof global symlinks in /usr/bin to resolve sudo/path resolution issues
echo "   Creating global symlinks in /usr/bin..."
ln -sf /usr/local/bin/node /usr/bin/node
ln -sf /usr/local/bin/npm /usr/bin/npm
ln -sf /usr/local/bin/npx /usr/bin/npx

echo "   Verifying Node.js environment..."
echo "   Node: $(node -v)"
echo "   NPM:  $(npm -v)"
echo "✅ Node.js successfully configured."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 3: Install and Configure CUPS (Print Server)
# ─────────────────────────────────────────────────────────
echo "🖨️  [3/9] Installing CUPS & configuring print server..."
apt-get install -y cups cups-client printer-driver-cups-pdf

# Disabling cups-browsed to completely prevent duplicate ghost queues
echo "   Disabling cups-browsed permanently..."
systemctl stop cups-browsed 2>/dev/null || true
systemctl disable cups-browsed 2>/dev/null || true
systemctl mask cups-browsed 2>/dev/null || true

# Start/enable CUPS daemon
systemctl enable cups
systemctl restart cups
sleep 1

# Allow admin operations
usermod -a -G lpadmin "$REAL_USER"
echo "✅ CUPS setup complete. Remote/local printing enabled."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 4: Install LibreOffice (Headless Document Conversion)
# ─────────────────────────────────────────────────────────
echo "📄 [4/9] Installing LibreOffice for headless PDF rendering..."
apt-get install -y libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress
echo "✅ LibreOffice configured."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 5: Install High-Fidelity & MS Compatibility Fonts
# ─────────────────────────────────────────────────────────
echo "🔤 [5/9] Installing MS Core Fonts & compatibility typography..."

# Automatically accept MS Core Fonts EULA
echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections
apt-get install -y ttf-mscorefonts-installer 2>/dev/null || {
    echo "   ⚠️  MS Core Fonts failed via apt. Attempting manual download..."
    mkdir -p /tmp/msfonts && cd /tmp/msfonts
    wget -q https://downloads.sourceforge.net/corefonts/arial32.exe \
            https://downloads.sourceforge.net/corefonts/times32.exe \
            https://downloads.sourceforge.net/corefonts/calibri.zip 2>/dev/null || true
    cabextract -q *.exe 2>/dev/null || true
    mkdir -p /usr/share/fonts/truetype/msttcorefonts
    cp *.ttf *.TTF /usr/share/fonts/truetype/msttcorefonts/ 2>/dev/null || true
    cd - >/dev/null
}

# Install metrically identical compatibility fonts (Calibri/Cambria clones)
apt-get install -y fonts-liberation fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core

# Rebuild font cache
echo "   Rebuilding font cache (this may take a minute)..."
fc-cache -f -v >/dev/null 2>&1
echo "✅ Font configuration loaded."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 6: Create Application Files in $INSTALL_DIR
# ─────────────────────────────────────────────────────────
echo "📂 [6/9] Writing SmartPrint application files into $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

# Write package.json
cat << 'EOF' > "$INSTALL_DIR/package.json"
{
    "name": "pi-print-agent",
    "version": "1.0.0",
    "description": "Native Raspberry Pi Print Daemon for SmartPrint",
    "main": "index.js",
    "type": "module",
    "scripts": {
        "start": "node index.js"
    },
    "dependencies": {
        "dotenv": "^16.4.5",
        "mongoose": "^9.6.3",
        "pdf-lib": "^1.17.1"
    }
}
EOF

# Write index.js (with orientation support)
cat << 'EOF' > "$INSTALL_DIR/index.js"
// SmartPrint Pi Print Agent v4.1 — MongoDB Edition
// Database: MongoDB (Mongoose)
// Realtime: MongoDB Change Streams
// Storage: Files are served from the backend host's local disk
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { PDFDocument, degrees } from 'pdf-lib';
import { exec } from 'child_process';
import util from 'util';
import https from 'https';
import http from 'http';
import crypto from 'crypto';

import { PrintJob } from './models/PrintJob.js';

const execAsync = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
    console.error('Missing MONGODB_URI! Please check your .env file.');
    process.exit(1);
}

// Confidential document decryption (envelope: per-file DEK wrapped by MASTER_KEY)
// Mirrors "student web app/server/security.ts" encryptFileEnvelope. The DEK is never
// derived from job data (unlike the old sha256(teacherEmpId + jobId) scheme) — it only
// exists wrapped in the job document, unwrappable solely with this agent's MASTER_KEY.
const MASTER_KEY_HEX = process.env.MASTER_KEY || '';
const MASTER_KEY = MASTER_KEY_HEX.length === 64 ? Buffer.from(MASTER_KEY_HEX, 'hex') : null;
if (!MASTER_KEY) {
    console.error('⚠️  MASTER_KEY missing/invalid in .env — confidential jobs will fail to print!');
}

function decryptFileEnvelope(ciphertext, fields) {
    if (!MASTER_KEY) throw new Error('MASTER_KEY not configured');
    const wrapDecipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, Buffer.from(fields.wrappedKeyIv, 'hex'));
    wrapDecipher.setAuthTag(Buffer.from(fields.wrappedKeyAuthTag, 'hex'));
    const dek = Buffer.concat([wrapDecipher.update(Buffer.from(fields.wrappedKey, 'hex')), wrapDecipher.final()]);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(fields.encIv, 'hex'));
    decipher.setAuthTag(Buffer.from(fields.encAuthTag, 'hex'));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Extensions that need conversion to PDF before printing.
// IPP Everywhere driver only accepts PDF — images and Office docs must be converted.
const NEEDS_CONVERSION = new Set([
    '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.odt', '.ods', '.odp', '.txt',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'
]);

// Download file from URL (follows redirects)
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = createWriteStream(destPath);
        proto.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close();
                downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                file.close();
                reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => { file.close(); reject(err); });
    });
}

// Convert to PDF using LibreOffice
async function convertToPdf(inputPath) {
    const outputDir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const expectedPdf = path.join(outputDir, `${baseName}.pdf`);
    const profileDir = '/tmp/libreoffice_profile';

    console.log(`  📄 Converting to PDF via LibreOffice...`);

    // Clean up stale lock files and zombie processes before converting
    try {
        await execAsync(`rm -f "${profileDir}/.~lock."* 2>/dev/null || true`);
        await execAsync(`killall -9 soffice.bin 2>/dev/null || true`);
        await new Promise(r => setTimeout(r, 500));
    } catch {}

    // Use high-fidelity PDF export: lossless images, no form field flattening issues,
    // and EmbedStandardFonts to prevent font substitution mismatches.
    const pdfFilter = 'pdf:writer_pdf_Export:{"MaxImageResolution":{"type":"long","value":"300"},"UseLosslessCompression":{"type":"boolean","value":"true"},"EmbedStandardFonts":{"type":"boolean","value":"true"}}';
    const cmd = `libreoffice --headless --norestore "-env:UserInstallation=file://${profileDir}" --convert-to "${pdfFilter}" --outdir "${outputDir}" "${inputPath}"`;
    console.log(`     CMD: libreoffice --headless --convert-to pdf (high-fidelity) → ${path.basename(inputPath)}`);

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (attempt === 2) {
                console.log(`  🔄 Retry #2: Resetting LibreOffice profile...`);
                await execAsync(`rm -rf "${profileDir}" 2>/dev/null || true`);
                await execAsync(`killall -9 soffice.bin 2>/dev/null || true`);
                await new Promise(r => setTimeout(r, 1000));
            }

            const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
            if (stdout) console.log(`     ${stdout.trim()}`);
            if (stderr && !stderr.includes('javaldx')) {
                console.log(`     stderr: ${stderr.trim()}`);
            }
            break;
        } catch (err) {
            if (attempt === 2) {
                throw new Error(`LibreOffice conversion failed after 2 attempts: ${err.message}`);
            }
            console.log(`  ⚠️ Attempt ${attempt} failed, retrying...`);
        }
    }

    // Verify the PDF was created
    try {
        await fs.access(expectedPdf);
    } catch {
        const files = await fs.readdir(outputDir);
        console.error(`  ❌ Expected PDF not found! Dir contents:`, files);
        throw new Error('LibreOffice produced no output');
    }

    const stat = await fs.stat(expectedPdf);
    console.log(`  ✅ Converted: ${expectedPdf} (${(stat.size / 1024).toFixed(1)} KB)`);
    return expectedPdf;
}

// NO GHOSTSCRIPT! GhostScript duplicates pages on this printer.
// Files are already decrypted client-side (browser).
// PDFs go directly to CUPS. No extra processing needed.

// Lock set — prevents the same job from being processed twice
const activeJobs = new Set();

async function processJob(job) {
    // Use MongoDB's _id as the unique key for dedup
    const jobKey = String(job._id || job.id);

    // Guard against duplicate processing
    if (activeJobs.has(jobKey)) {
        console.log(`[JOB ${job.jobId}] [FILE ${jobKey}] ⚠️  Already in progress — skipping duplicate.`);
        return;
    }
    activeJobs.add(jobKey);

    console.log(`\n-----------------------------------`);
    console.log(`[JOB ${job.jobId}] Processing: "${job.fileName}"`);

    const ext = path.extname(job.fileName || '').toLowerCase() || '.pdf';
    const tempFilePath = path.join('/tmp', `smartprint_${job.jobId}_${Date.now()}${ext}`);
    let printPath = tempFilePath;

    try {
        // 1. Download
        console.log(`[JOB ${job.jobId}] Downloading (${ext})...`);
        await downloadFile(job.filePath, tempFilePath);
        const dlStat = await fs.stat(tempFilePath);
        console.log(`[JOB ${job.jobId}] Downloaded: ${(dlStat.size / 1024).toFixed(1)} KB`);

        // 1.5 Decrypt if encrypted
        if (job.encrypted) {
            if (!job.wrappedKey || !job.encIv || !job.encAuthTag) {
                throw new Error('Job is marked encrypted but is missing envelope metadata — refusing to print.');
            }
            console.log(`[JOB ${job.jobId}] 🔒 File is encrypted. Decrypting...`);
            const fileBuffer = await fs.readFile(tempFilePath);

            const decryptedBuffer = decryptFileEnvelope(fileBuffer, {
                encIv: job.encIv,
                encAuthTag: job.encAuthTag,
                wrappedKey: job.wrappedKey,
                wrappedKeyIv: job.wrappedKeyIv,
                wrappedKeyAuthTag: job.wrappedKeyAuthTag,
            });
            await fs.writeFile(tempFilePath, decryptedBuffer);
            console.log(`[JOB ${job.jobId}] 🔓 Decryption successful.`);
        }

        // 2. Convert to PDF if needed (Office docs + images)
        if (NEEDS_CONVERSION.has(ext)) {
            const isImage = ['.jpg','.jpeg','.png','.gif','.bmp','.webp','.tiff','.tif'].includes(ext);
            console.log(`[JOB ${job.jobId}] ${isImage ? 'Image' : 'Office doc'} — converting to PDF...`);
            printPath = await convertToPdf(tempFilePath);
        } else {
            console.log(`[JOB ${job.jobId}] PDF — sending directly`);
        }

        // 3. Print — simple, clean command. Just -n for copies.
        const copies = Math.max(1, parseInt(job.copies) || 1);
        console.log(`[JOB ${job.jobId}] Copies: ${copies}, Color: ${job.colorMode}, Duplex: ${job.duplex}`);

        // Paper size (default A4)
        const paperSize = (job.paperSize || 'a4').toLowerCase();
        let lpCommand; // Declared here so it's accessible after the if/else blocks
        
        // --- BOOKLET FORMATTING FOR A3 ---
        if (paperSize === 'a3') {
            console.log(`[JOB ${job.jobId}] Formatting as A3 Booklet...`);
            try {
                const pdfBytes = await fs.readFile(printPath);
                const srcDoc = await PDFDocument.load(pdfBytes);
                const outDoc = await PDFDocument.create();
                
                const srcPages = srcDoc.getPages();
                const numPages = srcPages.length;
                
                const a4Width = 595.28;
                const a4Height = 841.89;
                
                // Standard Saddle-Stitch Booklet logic
                const paddedCount = Math.ceil(numPages / 4) * 4;
                const embeddedPages = await outDoc.embedPdf(srcDoc, srcDoc.getPageIndices());
                
                const pageArray = [];
                for (let i = 0; i < paddedCount; i++) {
                    pageArray.push(i < numPages ? embeddedPages[i] : null);
                }
                
                const sheets = paddedCount / 4;
                for (let s = 0; s < sheets; s++) {
                    // Front side: last page on left, first page on right
                    const frontPage = outDoc.addPage([a4Width * 2, a4Height]);
                    const leftFrontIdx = paddedCount - 2 * s - 1;
                    const rightFrontIdx = 2 * s;
                    
                    if (pageArray[leftFrontIdx]) {
                        frontPage.drawPage(pageArray[leftFrontIdx], { x: 0, y: 0, width: a4Width, height: a4Height });
                    }
                    if (pageArray[rightFrontIdx]) {
                        frontPage.drawPage(pageArray[rightFrontIdx], { x: a4Width, y: 0, width: a4Width, height: a4Height });
                    }
                    
                    // Back side
                    const backPage = outDoc.addPage([a4Width * 2, a4Height]);
                    
                    const leftBackIdx = paddedCount - 2 * s - 2;
                    const rightBackIdx = 2 * s + 1;
                    
                    if (pageArray[leftBackIdx]) {
                        backPage.drawPage(pageArray[leftBackIdx], {
                            x: 0, y: 0,
                            width: a4Width, height: a4Height
                        });
                    }
                    if (pageArray[rightBackIdx]) {
                        backPage.drawPage(pageArray[rightBackIdx], {
                            x: a4Width, y: 0,
                            width: a4Width, height: a4Height
                        });
                    }
                }
                
                const outBytes = await outDoc.save();
                const bookletPath = printPath.replace('.pdf', '_booklet.pdf');
                await fs.writeFile(bookletPath, outBytes);
                
                // Swap the print path to the new booklet
                if (printPath !== tempFilePath) {
                    try { await fs.unlink(printPath); } catch {}
                }
                printPath = bookletPath;
                
                // Build a clean lp command specifically for booklet printing
                lpCommand = `lp -d SmartPrint -n ${copies} -o fit-to-page`;
                if (job.colorMode === 'bw') lpCommand += ` -o print-color-mode=monochrome`;
                else lpCommand += ` -o print-color-mode=color`;
                // Short-edge duplex for booklet: the spine is along the short edge.
                lpCommand += ` -o media=a3 -o landscape -o sides=two-sided-short-edge`;
                console.log(`[JOB ${job.jobId}] Booklet generation successful.`);
            } catch (err) {
                console.error(`[JOB ${job.jobId}] Booklet generation failed:`, err);
                // Fallback to normal a3
                lpCommand = `lp -d SmartPrint -n ${copies}`;
                if (job.colorMode === 'bw') lpCommand += ` -o print-color-mode=monochrome`;
                else lpCommand += ` -o print-color-mode=color`;
                lpCommand += ` -o media=a3`;
                if (job.orientation === 'landscape') lpCommand += ` -o landscape`;
                if (job.duplex) lpCommand += ` -o sides=two-sided-long-edge`;
                else lpCommand += ` -o sides=one-sided`;
            }
        } else {
            lpCommand = `lp -d SmartPrint -n ${copies}`;
            if (job.colorMode === 'bw') lpCommand += ` -o print-color-mode=monochrome`;
            else lpCommand += ` -o print-color-mode=color`;
            if (job.duplex) lpCommand += ` -o sides=two-sided-long-edge`;
            else lpCommand += ` -o sides=one-sided`;
            lpCommand += ` -o media=${paperSize}`;
            if (job.orientation === 'landscape') lpCommand += ` -o landscape`;
        }

        if (job.pageRange && job.pageRange.toLowerCase() !== 'all') {
            const sanitizedRange = job.pageRange.replace(/[^0-9,\-]/g, '');
            if (sanitizedRange) lpCommand += ` -P ${sanitizedRange}`;
        }
        lpCommand += ` "${printPath}"`;

        console.log(`[JOB ${job.jobId}] Printing: ${lpCommand}`);
        const { stdout, stderr } = await execAsync(lpCommand);
        if (stderr) console.warn(`[PRINTER WARNING]: ${stderr}`);
        console.log(`[JOB ${job.jobId}] Spooled: ${stdout.trim()}`);

        // Small delay to ensure CUPS spooling has completely finished reading the file
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Cleanup + mark completed (MongoDB)
        try { await fs.unlink(tempFilePath); } catch {}
        if (printPath !== tempFilePath) {
            try { await fs.unlink(printPath); } catch {}
        }

        await PrintJob.updateOne({ _id: job._id }, { status: 'completed' });
        console.log(`[JOB ${job.jobId}] ✅ Completed: "${job.fileName}"`);

    } catch (error) {
        console.error(`[JOB ${job.jobId}] ❌ ERROR with "${job.fileName}":`, error.message);
        try { await fs.unlink(tempFilePath); } catch {}
        if (printPath !== tempFilePath) {
            try { await fs.unlink(printPath); } catch {}
        }
        await PrintJob.updateOne({ _id: job._id }, { status: 'failed' });
    } finally {
        activeJobs.delete(jobKey);
    }
}

async function catchUpMissedJobs() {
    console.log('[SYSTEM] Scanning for missed jobs...');
    try {
        const jobs = await PrintJob.find({ status: 'printing' }).lean();

        if (jobs && jobs.length > 0) {
            console.log(`[SYSTEM] Found ${jobs.length} missed jobs. Processing...`);
            for (const job of jobs) {
                await processJob(job);
            }
        } else {
            console.log('[SYSTEM] No missed jobs. Queue is clean.');
        }
    } catch (err) {
        console.error('[SYSTEM] Failed to fetch missed jobs:', err.message);
    }
}

// MongoDB Change Stream listener
let changeStream = null;

function startListener() {
    if (changeStream) {
        changeStream.close();
    }

    console.log('[SYSTEM] Starting MongoDB Change Stream listener...');

    changeStream = PrintJob.watch(
        [{ $match: { 'updateDescription.updatedFields.status': 'printing' } }],
        { fullDocument: 'updateLookup' }
    );

    changeStream.on('change', (change) => {
        if (change.operationType === 'update' && change.fullDocument) {
            const job = change.fullDocument;
            if (job.status === 'printing') {
                console.log(`[REALTIME] Job ${job.jobId} → printing. Processing...`);
                processJob(job);
            }
        }
    });

    changeStream.on('error', (err) => {
        console.error(`[SYSTEM] Change Stream error: ${err.message}. Reconnecting in 5s...`);
        setTimeout(startListener, 5000);
    });

    changeStream.on('close', () => {
        console.warn('[SYSTEM] Change Stream closed. Reconnecting in 5s...');
        setTimeout(startListener, 5000);
    });

    console.log('[SYSTEM] ✅ Connected & listening for new jobs via Change Stream!');
}

// Retention is owned by the admin dashboard (systemsettings.jobExpirationHours),
// the same value the backend's cleanup uses. Reading it here keeps the two in
// step — this agent used to use only CLEANUP_HOURS, so raising retention in the
// dashboard had no effect and the Pi kept deleting records at 24h.
// CLEANUP_HOURS stays as an explicit local override for testing.
async function getRetentionHours() {
    const override = parseFloat(process.env.CLEANUP_HOURS);
    if (!isNaN(override) && override > 0) return override;
    try {
        const doc = await mongoose.connection.db
            .collection('systemsettings')
            .findOne({ key: 'jobExpirationHours' });
        const hours = parseInt(doc?.value, 10);
        return isNaN(hours) ? 24 : hours;
    } catch {
        return 24;
    }
}

// Automated Cleanup Routine
async function cleanupOldJobs() {
    try {
        const hoursToKeep = await getRetentionHours();

        console.log(`[CLEANUP] Running routine to delete files older than ${hoursToKeep} hours...`);
        
        // Calculate the cutoff date
        const cutoffDate = new Date(Date.now() - hoursToKeep * 60 * 60 * 1000);

        // Find old jobs (MongoDB)
        const oldJobs = await PrintJob.find({ createdAt: { $lt: cutoffDate } })
            .select('_id filePath')
            .lean();

        if (!oldJobs || oldJobs.length === 0) {
            console.log(`[CLEANUP] No old jobs found. System is clean.`);
            return;
        }

        console.log(`[CLEANUP] Found ${oldJobs.length} old jobs. Deleting...`);

        let deletedCount = 0;
        for (const job of oldJobs) {
            try {
                // Delete from MongoDB (file cleanup is handled by the Express backend)
                await PrintJob.deleteOne({ _id: job._id });
                deletedCount++;
            } catch (err) {
                console.error(`[CLEANUP] Failed to delete job ${job._id}:`, err.message);
            }
        }

        console.log(`[CLEANUP] ✅ Successfully deleted ${deletedCount} old files and database records.`);
    } catch (err) {
        console.error(`[CLEANUP] ❌ Cleanup routine failed:`, err.message);
    }
}

// Startup
console.log('=============================================');
console.log('   SMARTPRINT: PI PRINT AGENT v4.1');
console.log('   MongoDB Edition — no GhostScript');
console.log('=============================================');

// Connect to MongoDB
try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected');
} catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
}

// Check LibreOffice
try {
    const { stdout } = await execAsync('libreoffice --version');
    console.log(`✅ LibreOffice: ${stdout.trim()}`);
} catch {
    console.error('⚠️  LibreOffice NOT found!');
    console.error('   Install: sudo apt-get install libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress');
}

// Clear stuck CUPS jobs from previous runs
try {
    const { stdout: queueBefore } = await execAsync('lpstat -o 2>/dev/null || true');
    if (queueBefore && queueBefore.trim()) {
        console.log('🧹 Clearing stuck CUPS jobs...');
        await execAsync('cancel -a 2>/dev/null || true');
        console.log('✅ CUPS queue cleared');
    } else {
        console.log('✅ CUPS queue is clean');
    }
} catch {
    console.warn('⚠️  Could not check CUPS queue');
}

// Run cleanup immediately on startup
cleanupOldJobs();

// Schedule cleanup to run every 1 hour (3600000 ms)
const cleanupInterval = setInterval(cleanupOldJobs, 60 * 60 * 1000);

// Start Change Stream listener + catch up missed jobs
startListener();
await catchUpMissedJobs();

process.on('SIGINT', () => {
    console.log('Shutting down...');
    clearInterval(cleanupInterval);
    if (changeStream) changeStream.close();
    mongoose.disconnect();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
});
EOF

# Write setup-printer.sh
cat << 'EOF' > "$INSTALL_DIR/setup-printer.sh"
#!/bin/bash
set -e
ARG="$1"
PRINTER_NAME="SmartPrint"

if [ -z "$ARG" ]; then
    echo ""
    echo "  ❌ ERROR: You must specify a connection type!"
    echo "  Usage:"
    echo "    sudo bash setup-printer.sh usb            ← USB printer"
    echo "    sudo bash setup-printer.sh 192.168.1.50   ← Network printer"
    echo "    sudo bash setup-printer.sh virtual        ← Virtual/Fake PDF printer"
    echo ""
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  SmartPrint — Printer Setup"
echo "═══════════════════════════════════════════════════════"

# Disable ghost queues
echo "[1/4] Disabling cups-browsed..."
sudo systemctl stop cups-browsed 2>/dev/null || true
sudo systemctl disable cups-browsed 2>/dev/null || true
sudo systemctl mask cups-browsed 2>/dev/null || true

# Remove all existing printer queues
echo "[2/4] Wiping all existing printer queues..."
lpstat -p 2>/dev/null | awk '{print $2}' | while read printer; do
    echo "  Removing: $printer"
    sudo lpadmin -x "$printer" 2>/dev/null || true
done
rm -f ~/.cups/lpoptions 2>/dev/null || true
sudo rm -f /root/.cups/lpoptions 2>/dev/null || true
sudo rm -f /etc/cups/lpoptions 2>/dev/null || true

# Add printer
PRINTER_URI=""

if [ "$ARG" = "usb" ] || [ "$ARG" = "USB" ]; then
    echo "[3/4] Auto-detecting USB printer..."
    USB_URI=$(lpinfo -v 2>/dev/null | grep "^direct usb://" | head -1 | awk '{print $2}')
    if [ -z "$USB_URI" ]; then
        echo "  ❌ No USB printer found! Make sure it is connected and turned ON."
        echo "  Detected direct connections:"
        lpinfo -v 2>/dev/null | grep -i usb || echo "    (none)"
        exit 1
    fi
    PRINTER_URI="$USB_URI"
    echo "  Found USB device: $PRINTER_URI"
    
    echo "  Installing printer driver..."
    sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m everywhere -o printer-is-shared=false -E 2>/dev/null || {
        echo "  ⚠️ IPP Everywhere failed. Trying auto-PPD mapping..."
        BEST_DRIVER=$(lpinfo --make-and-model "$(echo "$USB_URI" | sed 's/usb:\/\/\([^/]*\)\/.*/\1/' | sed 's/%20/ /g')" -m 2>/dev/null | head -1 | awk '{print $1}')
        if [ -n "$BEST_DRIVER" ]; then
            sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m "$BEST_DRIVER" -o printer-is-shared=false -E
        else
            echo "  Using Raw connection fallback..."
            sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m raw -o printer-is-shared=false -E
        fi
    }
elif [ "$ARG" = "virtual" ] || [ "$ARG" = "fake" ] || [ "$ARG" = "VIRTUAL" ]; then
    echo "[3/4] Setting up Virtual PDF printer..."
    PRINTER_URI="cups-pdf:/"
    
    # Try to find standard CUPS-PDF driver, fallback to raw/everywhere if not found
    PDF_DRIVER=$(lpinfo -m 2>/dev/null | grep -i "cups-pdf" | head -1 | awk '{print $1}')
    if [ -n "$PDF_DRIVER" ]; then
        echo "  Found CUPS-PDF driver: $PDF_DRIVER"
        sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m "$PDF_DRIVER" -o printer-is-shared=false -E
    else
        echo "  ⚠️ CUPS-PDF driver not found. Falling back to everywhere driver..."
        sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m everywhere -o printer-is-shared=false -E 2>/dev/null || {
            echo "  Using Raw fallback..."
            sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m raw -o printer-is-shared=false -E
        }
    fi
else
    PRINTER_IP="$ARG"
    echo "[3/4] Connecting to network printer at IP: $PRINTER_IP..."
    PRINTER_URI="ipp://${PRINTER_IP}/ipp/print"
    
    sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m everywhere -o printer-is-shared=false -E 2>/dev/null || {
        echo "  ⚠️ IPP Everywhere failed. Trying driverless fallback..."
        sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m driverless:"$PRINTER_URI" -o printer-is-shared=false -E 2>/dev/null || {
            echo "  ⚠️ Driverless failed. Trying direct Socket:9100..."
            PRINTER_URI="socket://${PRINTER_IP}:9100"
            sudo lpadmin -p "$PRINTER_NAME" -v "$PRINTER_URI" -m raw -o printer-is-shared=false -E
        }
    }
fi

# Set default
echo "[4/4] Setting '$PRINTER_NAME' as system default..."
sudo lpadmin -d "$PRINTER_NAME"
sudo cupsenable "$PRINTER_NAME"
sudo cupsaccept "$PRINTER_NAME"
echo "  ✅ Default set."

echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  Default Printer:  $(lpstat -d 2>/dev/null | awk '{print $NF}')"
echo "  │  Connection URI:    $PRINTER_URI"
echo "  │  Status:            $(lpstat -p "$PRINTER_NAME" 2>/dev/null | head -1)"
echo "  └─────────────────────────────────────────────────┘"
echo ""
read -p "  Print a test page? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "  Spooiling test page..."
    echo "SmartPrint Live Printer Test - $(date)" | lp -d "$PRINTER_NAME" -n 1
    echo "  ✅ Test page sent!"
fi
EOF

# Write fix-printer.sh
cat << 'EOF' > "$INSTALL_DIR/fix-printer.sh"
#!/bin/bash
echo "============================================"
echo "  SmartPrint Printer Reset & Queue Fix"
echo "============================================"
/usr/bin/pm2 stop smartprint-agent 2>/dev/null || true
cancel -a 2>/dev/null || true
for p in $(lpstat -p 2>/dev/null | awk '{print $2}'); do
    sudo lpadmin -x "$p" 2>/dev/null || true
done
rm -f ~/.cups/lpoptions 2>/dev/null || true
sudo rm -f /root/.cups/lpoptions 2>/dev/null || true
sudo rm -f /etc/cups/lpoptions 2>/dev/null || true
sudo systemctl restart cups
sleep 1
echo "✅ Printer systems fully reset. Please re-run setup-printer.sh to rebind printer."
EOF

# Write fix-fonts.sh
cat << 'EOF' > "$INSTALL_DIR/fix-fonts.sh"
#!/bin/bash
set -e
echo "   Reinstalling MS & compatibility fonts..."
echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | sudo debconf-set-selections
sudo apt-get install -y ttf-mscorefonts-installer fonts-liberation fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core 2>/dev/null || true
sudo fc-cache -f -v > /dev/null 2>&1
echo "✅ Font rendering configuration reloaded!"
EOF

# Write .env.example
cat << 'EOF' > "$INSTALL_DIR/.env.example"
# MongoDB connection string — same database as the backend
MONGODB_URI=

# 64 hex chars. MUST be byte-identical to the student web app's MASTER_KEY —
# this is what unwraps the key for confidential documents. If it differs,
# confidential jobs fail to decrypt and will not print.
MASTER_KEY=

# Hours to retain completed jobs before cleanup (default 24)
CLEANUP_HOURS=24
EOF

# Make helper scripts executable
chmod +x "$INSTALL_DIR/setup-printer.sh"
chmod +x "$INSTALL_DIR/fix-printer.sh"
chmod +x "$INSTALL_DIR/fix-fonts.sh"

# Write the .env template, but never over an existing one — re-running this
# installer to update an agent must not wipe a working config. Secrets are
# deliberately NOT baked into this script.
if [ -f "$INSTALL_DIR/.env" ]; then
    echo "🔑 Existing .env found — leaving it untouched."
    # Warn if this install predates envelope encryption, since confidential
    # jobs silently fail to decrypt without a MASTER_KEY.
    if ! grep -qE '^MASTER_KEY=.+' "$INSTALL_DIR/.env"; then
        echo ""
        echo "⚠️  MASTER_KEY is missing from $INSTALL_DIR/.env"
        echo "    Confidential documents will NOT decrypt or print until you add it."
        echo "    It must match the backend's MASTER_KEY exactly (64 hex chars)."
        echo ""
    fi
else
    echo "🔑 Writing .env template (you must fill it in before the agent runs)..."
    cat << 'EOF' > "$INSTALL_DIR/.env"
# MongoDB connection string — same database as the backend
MONGODB_URI=

# 64 hex chars. MUST be byte-identical to the student web app's MASTER_KEY —
# this is what unwraps the key for confidential documents. If it differs,
# confidential jobs fail to decrypt and will not print.
MASTER_KEY=

# Hours to retain completed jobs before cleanup (default 24)
CLEANUP_HOURS=24
EOF
fi

echo "✅ App files successfully written to $INSTALL_DIR"
echo ""

# ─────────────────────────────────────────────────────────
# STEP 7: Install Node Modules & PM2 Service
# ─────────────────────────────────────────────────────────
echo "📦 [7/9] Resolving NPM dependencies & global services..."
cd "$INSTALL_DIR"
/usr/bin/npm install

# PM2 background runner setup
echo "   Installing PM2 daemon manager..."
/usr/bin/npm install -g pm2

# Create direct global symlink in /usr/bin for PM2 to guarantee PATH resolution
ln -sf /usr/local/bin/pm2 /usr/bin/pm2

# Make sure PM2 is configured to start up automatically on boot
echo "   Configuring persistent auto-start..."
/usr/bin/pm2 stop smartprint-agent 2>/dev/null || true
/usr/bin/pm2 delete smartprint-agent 2>/dev/null || true

# Only start if the operator has filled in .env — otherwise the agent would
# exit immediately on a missing MONGODB_URI and PM2 would crash-loop it.
if grep -qE '^MONGODB_URI=.+' "$INSTALL_DIR/.env"; then
    /usr/bin/pm2 start index.js --name smartprint-agent
    /usr/bin/pm2 save
    AGENT_STARTED=1
else
    echo ""
    echo "⚠️  MONGODB_URI is empty in $INSTALL_DIR/.env — agent NOT started."
    echo "    Fill in MONGODB_URI and MASTER_KEY, then run:"
    echo "      cd $INSTALL_DIR && pm2 start index.js --name smartprint-agent && pm2 save"
    echo ""
    AGENT_STARTED=0
fi

# Setup PM2 startup script on system boot automatically
/usr/bin/pm2 startup systemd -u "$REAL_USER" --hp "$USER_HOME" || true

# Ensure file ownership is restored to the real system user
chown -R "$REAL_USER:$REAL_USER" "$INSTALL_DIR"
chown -R "$REAL_USER:$REAL_USER" "$USER_HOME/.pm2" 2>/dev/null || true

echo "✅ Node services running in background daemon."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 8: Create Universal Kiosk Autostart for Chromium
# ─────────────────────────────────────────────────────────
echo "🖥️  [8/9] Configuring Chromium Kiosk mode on startup..."

# 1. Standard XDG Desktop entry autostart (works on Openbox/LXDE X11 and some Wayland environments)
AUTOSTART_DIR="$USER_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat << 'EOF' > "$AUTOSTART_DIR/smartprint-kiosk.desktop"
[Desktop Entry]
Type=Application
Name=SmartPrint Kiosk
Exec=chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app
X-GNOME-Autostart-enabled=true
EOF

# 2. Wayfire Desktop Environment autostart (modern Raspberry Pi OS Bookworm early builds)
WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ] || [ -d "$USER_HOME/.config" ]; then
    mkdir -p "$USER_HOME/.config"
    # Ensure file exists
    touch "$WAYFIRE_INI"
    if ! grep -q "smartprintvit.web.app" "$WAYFIRE_INI"; then
        if grep -q "^\[autostart\]" "$WAYFIRE_INI"; then
            sed -i '/^\[autostart\]/a smartprint_kiosk = chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app' "$WAYFIRE_INI"
        else
            echo -e "\n[autostart]\nsmartprint_kiosk = chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app" >> "$WAYFIRE_INI"
        fi
    fi
fi

# 3. Labwc Autostart (Raspberry Pi OS Bookworm / Trixie late builds, Pi 5 active default)
LABWC_DIR="$USER_HOME/.config/labwc"
mkdir -p "$LABWC_DIR"
if [ -f "$LABWC_DIR/autostart" ]; then
    if ! grep -q "smartprintvit.web.app" "$LABWC_DIR/autostart"; then
        echo "chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app &" >> "$LABWC_DIR/autostart"
    fi
else
    echo "#!/bin/sh" > "$LABWC_DIR/autostart"
    echo "chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app &" >> "$LABWC_DIR/autostart"
    chmod +x "$LABWC_DIR/autostart"
fi

# 4. LXDE-pi session autostart (legacy Buster/Bullseye Pi OS)
LXDE_DIR="$USER_HOME/.config/lxsession/LXDE-pi"
mkdir -p "$LXDE_DIR"
if [ -f "$LXDE_DIR/autostart" ]; then
    if ! grep -q "smartprintvit.web.app" "$LXDE_DIR/autostart"; then
        echo "@chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app" >> "$LXDE_DIR/autostart"
    fi
else
    if [ -f "/etc/xdg/lxsession/LXDE-pi/autostart" ]; then
        cp /etc/xdg/lxsession/LXDE-pi/autostart "$LXDE_DIR/autostart"
    fi
    echo "@chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-features=Translate https://smartprintvit.web.app/kiosk-app" >> "$LXDE_DIR/autostart"
fi

# Restore full ownership of user configuration files and directories
chown -R "$REAL_USER:$REAL_USER" "$USER_HOME/.config"

# Disable screen blanking/sleep (raspi-config nonint standard command)
echo "   Disabling screen sleep / blanking..."
if command -v raspi-config &>/dev/null; then
    raspi-config nonint do_blanking 0 || true
fi

# Disable on-screen virtual touch keyboard (Squeekboard) on modern Pi OS
echo "   Disabling on-screen touch keyboard..."
if command -v raspi-config &>/dev/null; then
    raspi-config nonint do_squeekboard S3 || true
fi
echo "✅ Kiosk autostart successfully configured."
echo ""

# ─────────────────────────────────────────────────────────
# STEP 9: Run Printer Setup
# ─────────────────────────────────────────────────────────
echo "⚙️  [9/9] Automated Printer Detection & Configuration..."
echo "==================================================================="
echo "  Choose your connection method for the main printer:"
echo "    [1] USB-connected printer (Auto-detect)"
echo "    [2] Network IP-connected printer"
echo "    [3] Virtual/Fake printer (Debugging & Local Testing)"
echo "==================================================================="
read -p "Select [1], [2], or [3]: " -n 1 -r
echo ""

if [[ $REPLY =~ ^[2]$ ]]; then
    read -p "Enter your printer's IP Address (e.g., 192.168.1.50): " -r IP_ADDR
    if [ -n "$IP_ADDR" ]; then
        bash ./setup-printer.sh "$IP_ADDR"
    else
        echo "❌ Invalid IP. Defaulting to raw/usb fallback mode..."
        bash ./setup-printer.sh usb || true
    fi
elif [[ $REPLY =~ ^[3]$ ]]; then
    echo "   Setting up Virtual PDF debugging printer..."
    bash ./setup-printer.sh virtual || true
else
    echo "   Searching for USB printer..."
    bash ./setup-printer.sh usb || true
fi

# Clean up PM2 to reload with new default printer
/usr/bin/pm2 restart smartprint-agent

echo ""
echo "==================================================================="
echo "🎉 SMARTPRINT COMPLETE KI-OSK SETUP SUCCESSFUL!"
echo "==================================================================="
echo "  The database print agent is running in the background (PM2)."
echo "  Keep track of logs with:   pm2 logs smartprint-agent"
echo "  Restart agent with:        pm2 restart smartprint-agent"
echo ""
echo "🖥️  KIOSK INTERFACE CONFIGURATION:"
echo "  - Chromium is set to autostart directly into the kiosk site:"
echo "    https://smartprintvit.web.app/kiosk-app"
echo "  - Full-screen and auto-restores on boot are enabled."
echo "  - Screen sleep/blanking is completely disabled."
echo "  - Just reboot your Raspberry Pi to see it launch automatically!"
echo "==================================================================="
echo ""
