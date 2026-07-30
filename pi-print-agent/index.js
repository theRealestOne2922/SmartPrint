// SmartPrint Pi Print Agent v4.2 — MongoDB Edition
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
import { exec, execFile } from 'child_process';
import util from 'util';
import https from 'https';
import http from 'http';
import crypto from 'crypto';

import { PrintJob } from './models/PrintJob.js';

const execAsync = util.promisify(exec);
// execFile takes an argv array and spawns without a shell. Anything built from
// job data (file paths, print options) goes through this, never through
// execAsync — a filename is attacker-controlled all the way from the upload
// form, and interpolating it into a shell string is remote code execution.
const execFileAsync = util.promisify(execFile);
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
const DOWNLOAD_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;

function downloadFile(url, destPath, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = createWriteStream(destPath, { mode: 0o600 });
        let settled = false;

        const fail = (err) => {
            if (settled) return;
            settled = true;
            file.destroy();
            reject(err);
        };

        const request = proto.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                if (redirectsLeft <= 0) return fail(new Error('Too many redirects'));
                response.resume();
                file.destroy();
                settled = true;
                downloadFile(response.headers.location, destPath, redirectsLeft - 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                return fail(new Error(`Download failed: HTTP ${response.statusCode}`));
            }
            response.on('error', fail);
            file.on('error', fail);
            response.pipe(file);
            file.on('finish', () => {
                if (settled) return;
                settled = true;
                file.close((err) => (err ? reject(err) : resolve()));
            });
        });

        // A stalled backend used to wedge the job in "printing" forever while its
        // entry in activeJobs blocked every retry, including the restart catch-up.
        request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            request.destroy(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`));
        });
        request.on('error', fail);
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
    const args = [
        '--headless', '--norestore',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to', pdfFilter,
        '--outdir', outputDir,
        inputPath,
    ];
    console.log(`     CMD: libreoffice --headless --convert-to pdf (high-fidelity) → ${path.basename(inputPath)}`);

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (attempt === 2) {
                console.log(`  🔄 Retry #2: Resetting LibreOffice profile...`);
                await execAsync(`rm -rf "${profileDir}" 2>/dev/null || true`);
                await execAsync(`killall -9 soffice.bin 2>/dev/null || true`);
                await new Promise(r => setTimeout(r, 1000));
            }

            const { stdout, stderr } = await execFileAsync('libreoffice', args, { timeout: 120000 });
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
// PDFs go directly to CUPS. No extra processing needed.
// (Document passwords are stripped in the browser at upload time; the envelope
// encryption on confidential jobs is undone in processJob above.)

// Builds the argv for lp. Pure and separate from processJob so the print
// options can be tested — a silent mistake here is an exam paper that comes out
// single-sided, in colour, or on the wrong tray, which nobody notices until the
// papers are already in someone's hands.
export function buildLpArgs(job, { copies, paperSize, printPath, booklet }) {
    const args = ['-d', 'SmartPrint', '-n', String(copies)];
    if (booklet) args.push('-o', 'fit-to-page');

    args.push('-o', job.colorMode === 'bw' ? 'print-color-mode=monochrome' : 'print-color-mode=color');

    if (booklet) {
        // The spine runs along the short edge, and two A4 pages sit side by side
        // on a landscape A3 sheet.
        args.push('-o', 'media=a3', '-o', 'landscape', '-o', 'sides=two-sided-short-edge');
    } else {
        args.push('-o', job.duplex ? 'sides=two-sided-long-edge' : 'sides=one-sided');
        args.push('-o', `media=${paperSize}`);
        if (job.orientation === 'landscape') args.push('-o', 'landscape');
    }

    if (job.pageRange && String(job.pageRange).toLowerCase() !== 'all') {
        const sanitizedRange = String(job.pageRange).replace(/[^0-9,\-]/g, '');
        // Only pass a range lp will actually accept. Stripping non-digits alone
        // could leave something like "1-" or "-,-", and lp rejects a malformed
        // range by failing the whole job — better to print every page than to
        // hand back nothing.
        if (/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(sanitizedRange)) {
            args.push('-P', sanitizedRange);
        } else if (sanitizedRange) {
            console.warn(`[JOB ${job.jobId}] Ignoring unusable page range "${job.pageRange}" — printing all pages.`);
        }
    }

    args.push(printPath);
    return args;
}

// Lock set — prevents the same job from being processed twice
const activeJobs = new Set();

// How long a claim is trusted. Past this the job is assumed abandoned (agent
// killed mid-print) and may be retried; under it, a restart will not reprint.
const STALE_CLAIM_MS = 10 * 60 * 1000;

// Takes ownership of a job in a single atomic update. The in-memory activeJobs
// set only dedups within one process, so it did nothing about the case that
// actually loses paper: the agent spools a confidential job, dies before
// marking it completed, and the restart catch-up finds it still 'printing' and
// prints it again — a second copy of an exam paper into an unattended tray.
async function claimJob(job) {
    const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS);
    const claimed = await PrintJob.findOneAndUpdate(
        {
            _id: job._id,
            status: 'printing',
            // Once CUPS has the file, paper is committed. Such a job is never
            // reclaimed, however stale the claim looks — reconcileSpooledJobs
            // finishes it off instead.
            $and: [
                { $or: [{ agentSpooledAt: null }, { agentSpooledAt: { $exists: false } }] },
                {
                    $or: [
                        { agentClaimedAt: null },
                        { agentClaimedAt: { $exists: false } },
                        { agentClaimedAt: { $lt: staleCutoff } },
                    ],
                },
            ],
        },
        { $set: { agentClaimedAt: new Date() } },
        { returnDocument: 'after' }
    ).lean();
    return claimed;
}

async function processJob(job) {
    // Use MongoDB's _id as the unique key for dedup
    const jobKey = String(job._id || job.id);

    // Guard against duplicate processing
    if (activeJobs.has(jobKey)) {
        console.log(`[JOB ${job.jobId}] [FILE ${jobKey}] ⚠️  Already in progress — skipping duplicate.`);
        return;
    }
    activeJobs.add(jobKey);

    try {
        const claimed = await claimJob(job);
        if (!claimed) {
            console.log(`[JOB ${job.jobId}] ⏭️  Already claimed or no longer printing — skipping.`);
            activeJobs.delete(jobKey);
            return;
        }
        // Use the freshly-read document: a change-stream payload can be stale if
        // the job was edited between the update and this handler running.
        job = claimed;
    } catch (err) {
        console.error(`[JOB ${job.jobId}] Failed to claim job:`, err.message);
        activeJobs.delete(jobKey);
        return;
    }

    console.log(`\n-----------------------------------`);
    console.log(`[JOB ${job.jobId}] Processing: "${job.fileName}"`);

    // fileName is whatever the uploader's browser sent, so the extension can be
    // any string at all — path.extname("exam.pdf$(id)") is ".pdf$(id)". It ends
    // up in a filesystem path and, historically, in a shell command, so pin it
    // to a plain alphanumeric suffix. Anything else prints as a PDF, which is
    // what the old code did for unrecognised extensions anyway.
    const rawExt = path.extname(job.fileName || '').toLowerCase();
    const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.pdf';
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
            await fs.writeFile(tempFilePath, decryptedBuffer, { mode: 0o600 });
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
        // The wizard caps copies at 500, but /api/jobs/:id/details ran an
        // unvalidated update, so the stored value could be anything. Clamp here
        // too — a bad number means a jammed printer and a ream of wasted paper.
        const copies = Math.min(500, Math.max(1, parseInt(job.copies) || 1));
        console.log(`[JOB ${job.jobId}] Copies: ${copies}, Color: ${job.colorMode}, Duplex: ${job.duplex}`);

        // Paper size (default A4). The schema restricts this to a4/a3, but the
        // agent reads raw documents, so re-check rather than trust it.
        const requested = (job.paperSize || 'a4').toLowerCase();
        const paperSize = requested === 'a3' ? 'a3' : 'a4';
        let lpArgs; // Declared here so it's accessible after the if/else blocks

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
                // Build the name from the path, not a string replace on '.pdf' —
                // that replaced the first match anywhere in the path.
                const bookletPath = path.join(
                    path.dirname(printPath),
                    `${path.basename(printPath, path.extname(printPath))}_booklet.pdf`
                );
                await fs.writeFile(bookletPath, outBytes, { mode: 0o600 });
                
                // Swap the print path to the new booklet
                if (printPath !== tempFilePath) {
                    try { await fs.unlink(printPath); } catch {}
                }
                printPath = bookletPath;
                lpArgs = buildLpArgs(job, { copies, paperSize, printPath, booklet: true });
                console.log(`[JOB ${job.jobId}] Booklet generation successful.`);
            } catch (err) {
                console.error(`[JOB ${job.jobId}] Booklet generation failed:`, err);
                // Fall back to a plain A3 print rather than losing the job.
                lpArgs = buildLpArgs(job, { copies, paperSize, printPath, booklet: false });
            }
        } else {
            lpArgs = buildLpArgs(job, { copies, paperSize, printPath, booklet: false });
        }

        console.log(`[JOB ${job.jobId}] Printing: lp ${lpArgs.join(' ')}`);
        const { stdout, stderr } = await execFileAsync('lp', lpArgs);
        if (stderr) console.warn(`[PRINTER WARNING]: ${stderr}`);
        console.log(`[JOB ${job.jobId}] Spooled: ${stdout.trim()}`);

        // Record this before anything else can fail. Everything below — the
        // spool wait, the unlinks, the status write — can be interrupted, and
        // without this marker a restart would treat the job as never printed.
        // A database blip here must not throw: the paper is already coming out,
        // and falling into the catch would mark a printed job 'failed'.
        try {
            await PrintJob.updateOne({ _id: job._id }, { $set: { agentSpooledAt: new Date() } });
        } catch (markErr) {
            console.error(`[JOB ${job.jobId}] Printed, but could not record spool time:`, markErr.message);
        }

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

let catchUpRunning = false;

async function catchUpMissedJobs(quiet = false) {
    if (catchUpRunning) return;
    catchUpRunning = true;
    if (!quiet) console.log('[SYSTEM] Scanning for missed jobs...');
    try {
        const jobs = await PrintJob.find({ status: 'printing' }).lean();

        if (jobs && jobs.length > 0) {
            console.log(`[SYSTEM] Found ${jobs.length} job(s) awaiting print. Processing...`);
            for (const job of jobs) {
                await processJob(job);
            }
        } else if (!quiet) {
            console.log('[SYSTEM] No missed jobs. Queue is clean.');
        }
    } catch (err) {
        console.error('[SYSTEM] Failed to fetch missed jobs:', err.message);
    } finally {
        catchUpRunning = false;
    }
}

// MongoDB Change Stream listener
let changeStream = null;
let reconnectTimer = null;
let shuttingDown = false;

// A dropped stream emits 'error' and then 'close', and closing the old stream
// inside startListener emitted 'close' again — so each reconnect scheduled two
// or three more, every one of them creating another live stream. After a few
// network blips the Pi held a fistful of streams all replaying the same events.
// One reconnect may be in flight at a time, and the old stream's handlers come
// off before it is closed.
function scheduleReconnect(reason) {
    if (shuttingDown || reconnectTimer) return;
    console.warn(`[SYSTEM] Change Stream ${reason}. Reconnecting in 5s...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startListener();
    }, 5000);
}

function startListener() {
    if (changeStream) {
        changeStream.removeAllListeners();
        Promise.resolve(changeStream.close()).catch(() => {});
        changeStream = null;
    }

    console.log('[SYSTEM] Starting MongoDB Change Stream listener...');

    let stream;
    try {
        stream = PrintJob.watch(
            [{ $match: { 'updateDescription.updatedFields.status': 'printing' } }],
            { fullDocument: 'updateLookup' }
        );
    } catch (err) {
        // watch() throws outright if the connection is down. Reaching this from
        // inside the reconnect timer would otherwise be an uncaught exception,
        // which now takes the whole process with it.
        scheduleReconnect(`could not be opened: ${err.message}`);
        return;
    }
    changeStream = stream;

    stream.on('change', (change) => {
        if (change.operationType === 'update' && change.fullDocument) {
            const job = change.fullDocument;
            if (job.status === 'printing') {
                console.log(`[REALTIME] Job ${job.jobId} → printing. Processing...`);
                processJob(job);
            }
        }
    });

    stream.on('error', (err) => {
        if (stream !== changeStream) return; // superseded, not ours to react to
        scheduleReconnect(`error: ${err.message}`);
    });

    stream.on('close', () => {
        if (stream !== changeStream) return;
        scheduleReconnect('closed');
    });

    console.log('[SYSTEM] ✅ Connected & listening for new jobs via Change Stream!');
}

// Jobs that reached the printer but whose agent died before writing the final
// status would otherwise sit at 'printing' on the dashboard forever: the claim
// guard correctly refuses to reprint them, so nothing else would ever move
// them. The paper already came out, so record what actually happened.
const SPOOL_SETTLE_MS = 2 * 60 * 1000;

async function reconcileSpooledJobs() {
    try {
        const cutoff = new Date(Date.now() - SPOOL_SETTLE_MS);
        const { modifiedCount } = await PrintJob.updateMany(
            { status: 'printing', agentSpooledAt: { $ne: null, $lt: cutoff } },
            { $set: { status: 'completed' } }
        );
        if (modifiedCount) {
            console.log(`[SYSTEM] Marked ${modifiedCount} already-printed job(s) as completed.`);
        }
    } catch (err) {
        console.error('[SYSTEM] Reconcile failed:', err.message);
    }
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

        // Never delete a job this agent is printing right now — the old code
        // could remove the record mid-run, so the completion write silently hit
        // nothing and the job vanished from the dashboard as if it never ran.
        const inFlight = Array.from(activeJobs)
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        // One deleteMany instead of a find plus a deleteOne per row: the Pi is
        // often on flaky campus wifi, and this was a round trip per job.
        // (File cleanup is handled by the Express backend.)
        const filter = { createdAt: { $lt: cutoffDate } };
        if (inFlight.length) filter._id = { $nin: inFlight };

        const { deletedCount } = await PrintJob.deleteMany(filter);

        if (!deletedCount) {
            console.log(`[CLEANUP] No old jobs found. System is clean.`);
            return;
        }
        console.log(`[CLEANUP] ✅ Deleted ${deletedCount} expired job record(s).`);
    } catch (err) {
        console.error(`[CLEANUP] ❌ Cleanup routine failed:`, err.message);
    }
}

// Decrypted exam papers pass through /tmp. Everything this process and its
// children (LibreOffice) create is owner-only, instead of the world-readable
// 0644 the default umask produces on a Pi that may have other logins.
process.umask(0o077);

// Anything left in /tmp from a previous run is a decrypted document that
// outlived the process that was printing it. Clear it before doing anything.
async function sweepTempFiles() {
    try {
        const leftovers = (await fs.readdir('/tmp')).filter((f) => f.startsWith('smartprint_'));
        for (const name of leftovers) {
            try { await fs.unlink(path.join('/tmp', name)); } catch {}
        }
        if (leftovers.length) {
            console.log(`🧹 Removed ${leftovers.length} leftover document(s) from a previous run`);
        }
    } catch {}
}

// Startup
console.log('=============================================');
console.log('   SMARTPRINT: PI PRINT AGENT v4.2');
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

// Clear decrypted documents orphaned by a previous run
await sweepTempFiles();

// Assigned below. Declared up here so the signal handlers can be installed
// before the startup catch-up, which can take a while with a full queue — a
// restart during it used to hard-kill the process mid-job.
let cleanupInterval = null;
let sweepInterval = null;

function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down...');
    clearInterval(cleanupInterval);
    clearInterval(sweepInterval);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (changeStream) {
        changeStream.removeAllListeners();
        Promise.resolve(changeStream.close()).catch(() => {});
    }
    mongoose.disconnect().finally(() => process.exit(code));
}

process.on('SIGINT', () => shutdown(0));
// PM2 and systemd both stop services with SIGTERM; without this the agent was
// killed outright and left its temp files behind.
process.on('SIGTERM', () => shutdown(0));

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED PROMISE REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
    // This used to log and carry on. A process in an unknown state that still
    // looks alive to PM2 is the worst outcome for a print daemon — it stops
    // printing and nothing restarts it. Exit and let PM2 bring up a clean one.
    shutdown(1);
});

// Run cleanup immediately on startup, then hourly
cleanupOldJobs();
cleanupInterval = setInterval(cleanupOldJobs, 60 * 60 * 1000);

// Start Change Stream listener + catch up missed jobs
startListener();
await reconcileSpooledJobs();
await catchUpMissedJobs();

// The change stream is the fast path, not the only path. It can miss events
// while reconnecting, and a job whose claim went stale needs someone to look
// again — startup-only catch-up meant nothing ever did.
sweepInterval = setInterval(async () => {
    await reconcileSpooledJobs();
    await catchUpMissedJobs(true);
}, 5 * 60 * 1000);

console.log('[SYSTEM] Agent ready.');
