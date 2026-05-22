import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
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

// Polyfill for Node.js
global.WebSocket = WebSocket;

const execAsync = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables! Please check your .env file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Extensions that need conversion to PDF before printing.
// IPP Everywhere driver only accepts PDF — images and Office docs must be converted.
const NEEDS_CONVERSION = new Set([
    '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.odt', '.ods', '.odp', '.txt',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'
]);

// ─── Download file from URL (follows redirects) ───
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

// ─── Convert to PDF using LibreOffice ───
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

// ─────────────────────────────────────────────────────────
// NO GHOSTSCRIPT! GhostScript duplicates pages on this printer.
// Files are already decrypted client-side (browser).
// PDFs go directly to CUPS. No extra processing needed.
// ─────────────────────────────────────────────────────────

// Lock set — prevents the same job from being processed twice
const activeJobs = new Set();

async function processJob(job) {
    // Guard against duplicate processing
    if (activeJobs.has(job.id)) {
        console.log(`[JOB ${job.job_id}] [FILE ${job.id}] ⚠️  Already in progress — skipping duplicate.`);
        return;
    }
    activeJobs.add(job.id);

    console.log(`\n-----------------------------------`);
    console.log(`[JOB ${job.job_id}] Processing: "${job.file_name}"`);

    const ext = path.extname(job.file_name || '').toLowerCase() || '.pdf';
    const tempFilePath = path.join('/tmp', `smartprint_${job.job_id}_${Date.now()}${ext}`);
    let printPath = tempFilePath;

    try {
        // 1. Download
        console.log(`[JOB ${job.job_id}] Downloading (${ext})...`);
        await downloadFile(job.file_path, tempFilePath);
        const dlStat = await fs.stat(tempFilePath);
        console.log(`[JOB ${job.job_id}] Downloaded: ${(dlStat.size / 1024).toFixed(1)} KB`);

        // 2. Convert to PDF if needed (Office docs + images)
        if (NEEDS_CONVERSION.has(ext)) {
            const isImage = ['.jpg','.jpeg','.png','.gif','.bmp','.webp','.tiff','.tif'].includes(ext);
            console.log(`[JOB ${job.job_id}] ${isImage ? 'Image' : 'Office doc'} — converting to PDF...`);
            printPath = await convertToPdf(tempFilePath);
        } else {
            console.log(`[JOB ${job.job_id}] PDF — sending directly`);
        }

        // 3. Print — simple, clean command. Just -n for copies.
        const copies = Math.max(1, parseInt(job.copies) || 1);
        console.log(`[JOB ${job.job_id}] Copies: ${copies}, Color: ${job.color_mode}, Duplex: ${job.duplex}`);

        // Paper size (default A4)
        const paperSize = (job.paper_size || 'a4').toLowerCase();
        let lpCommand; // Declared here so it's accessible after the if/else blocks
        
        // --- BOOKLET FORMATTING FOR A3 ---
        if (paperSize === 'a3') {
            console.log(`[JOB ${job.job_id}] Formatting as A3 Booklet...`);
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
                    
                    // Back side: the printer's short-edge duplex mechanism does TWO things:
                    // 1) Flips the page upside-down → we counter with 180° rotation
                    // 2) Swaps left/right halves → we counter by swapping the page indices
                    //
                    // For a 4-page doc (s=0, paddedCount=4):
                    //   Front: Page 4 (left), Page 1 (right)
                    //   Back PDF layout: Page 3 (left pos), Page 2 (right pos)
                    //   After printer flips: becomes Page 2 (left), Page 3 (right) ✓
                    const backPage = outDoc.addPage([a4Width * 2, a4Height]);
                    
                    // SWAPPED: put the higher-index page on left, lower on right
                    // so the printer's physical left/right swap produces correct order
                    const leftBackIdx = paddedCount - 2 * s - 2;  // Was rightBackIdx (e.g., Page 3)
                    const rightBackIdx = 2 * s + 1;               // Was leftBackIdx (e.g., Page 2)
                    
                    // Draw on left half, rotated 180° to counter upside-down flip
                    if (pageArray[leftBackIdx]) {
                        backPage.drawPage(pageArray[leftBackIdx], {
                            x: a4Width, y: a4Height,
                            width: a4Width, height: a4Height,
                            rotate: degrees(180)
                        });
                    }
                    // Draw on right half, rotated 180° to counter upside-down flip
                    if (pageArray[rightBackIdx]) {
                        backPage.drawPage(pageArray[rightBackIdx], {
                            x: a4Width * 2, y: a4Height,
                            width: a4Width, height: a4Height,
                            rotate: degrees(180)
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
                // -o fit-to-page: scales content to fit within printable area (prevents top/edge cutoff)
                lpCommand = `lp -d SmartPrint -n ${copies} -o fit-to-page`;
                if (job.color_mode === 'bw') lpCommand += ` -o print-color-mode=monochrome`;
                else lpCommand += ` -o print-color-mode=color`;
                // Short-edge duplex for booklet: the spine is along the short edge.
                // Back content is pre-rotated 180° in the PDF to compensate for the flip.
                lpCommand += ` -o media=a3 -o landscape -o sides=two-sided-short-edge`;
                console.log(`[JOB ${job.job_id}] Booklet generation successful.`);
            } catch (err) {
                console.error(`[JOB ${job.job_id}] Booklet generation failed:`, err);
                // Fallback to normal a3
                lpCommand = `lp -d SmartPrint -n ${copies} -o fit-to-page`;
                if (job.color_mode === 'bw') lpCommand += ` -o print-color-mode=monochrome`;
                else lpCommand += ` -o print-color-mode=color`;
                lpCommand += ` -o media=a3`;
                if (job.orientation === 'landscape') lpCommand += ` -o landscape`;
                if (job.duplex) lpCommand += ` -o sides=two-sided-long-edge`;
                else lpCommand += ` -o sides=one-sided`;
            }
        } else {
            lpCommand = `lp -d SmartPrint -n ${copies} -o fit-to-page`;
            if (job.color_mode === 'bw') lpCommand += ` -o print-color-mode=monochrome`;
            else lpCommand += ` -o print-color-mode=color`;
            if (job.duplex) lpCommand += ` -o sides=two-sided-long-edge`;
            else lpCommand += ` -o sides=one-sided`;
            lpCommand += ` -o media=${paperSize}`;
            if (job.orientation === 'landscape') lpCommand += ` -o landscape`;
        }

        if (job.page_range && job.page_range.toLowerCase() !== 'all') {
            const sanitizedRange = job.page_range.replace(/[^0-9,\-]/g, '');
            if (sanitizedRange) lpCommand += ` -P ${sanitizedRange}`;
        }
        lpCommand += ` "${printPath}"`;

        console.log(`[JOB ${job.job_id}] Printing: ${lpCommand}`);
        const { stdout, stderr } = await execAsync(lpCommand);
        if (stderr) console.warn(`[PRINTER WARNING]: ${stderr}`);
        console.log(`[JOB ${job.job_id}] Spooled: ${stdout.trim()}`);

        // Small delay to ensure CUPS spooling has completely finished reading the file
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Cleanup + mark completed
        try { await fs.unlink(tempFilePath); } catch {}
        if (printPath !== tempFilePath) {
            try { await fs.unlink(printPath); } catch {}
        }

        await supabase.from('print_jobs').update({ status: 'completed' }).eq('id', job.id);
        console.log(`[JOB ${job.job_id}] ✅ Completed: "${job.file_name}"`);

    } catch (error) {
        console.error(`[JOB ${job.job_id}] ❌ ERROR with "${job.file_name}":`, error.message);
        try { await fs.unlink(tempFilePath); } catch {}
        if (printPath !== tempFilePath) {
            try { await fs.unlink(printPath); } catch {}
        }
        await supabase.from('print_jobs').update({ status: 'failed' }).eq('id', job.id);
    } finally {
        activeJobs.delete(job.id);
    }
}

async function catchUpMissedJobs() {
    console.log('[SYSTEM] Scanning for missed jobs...');
    const { data: jobs, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('status', 'printing');

    if (error) {
        console.error('[SYSTEM] Failed to fetch missed jobs:', error.message);
        return;
    }

    if (jobs && jobs.length > 0) {
        console.log(`[SYSTEM] Found ${jobs.length} missed jobs. Processing...`);
        for (const job of jobs) {
            await processJob(job);
        }
    } else {
        console.log('[SYSTEM] No missed jobs. Queue is clean.');
    }
}

let activeChannel = null;

function startListener() {
    if (activeChannel) {
        supabase.removeChannel(activeChannel);
    }

    console.log('[SYSTEM] Connecting real-time listener...');

    activeChannel = supabase
        .channel('print_agent_v2')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'print_jobs'
        }, (payload) => {
            if (payload.new.status === 'printing' && payload.old.status !== 'printing') {
                processJob(payload.new);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[SYSTEM] ✅ Connected & listening for new jobs!');
                await catchUpMissedJobs();
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                console.error(`[SYSTEM] Listener dropped (${status}). Reconnecting in 5s...`);
                setTimeout(startListener, 5000);
            }
        });
}

// ─── Automated Cleanup Routine ───
async function cleanupOldJobs() {
    try {
        // Allow overriding cleanup time via .env for testing (e.g., CLEANUP_HOURS=0.01 for ~36 seconds)
        const hoursToKeep = parseFloat(process.env.CLEANUP_HOURS) || 24;
        
        console.log(`[CLEANUP] Running routine to delete files older than ${hoursToKeep} hours...`);
        
        // Calculate the cutoff date
        const cutoffDate = new Date(Date.now() - hoursToKeep * 60 * 60 * 1000).toISOString();

        // Find old jobs
        const { data: oldJobs, error: fetchError } = await supabase
            .from('print_jobs')
            .select('id, file_path')
            .lt('created_at', cutoffDate);

        if (fetchError) throw fetchError;

        if (!oldJobs || oldJobs.length === 0) {
            console.log(`[CLEANUP] No old jobs found. System is clean.`);
            return;
        }

        console.log(`[CLEANUP] Found ${oldJobs.length} old jobs. Deleting...`);

        let deletedCount = 0;
        for (const job of oldJobs) {
            try {
                // Extract filename from the Supabase storage URL
                if (job.file_path && job.file_path.includes('/storage/v1/object/public/pdfs/')) {
                    const storagePath = job.file_path.split('/storage/v1/object/public/pdfs/')[1];
                    if (storagePath) {
                        // Delete from storage bucket
                        await supabase.storage.from('pdfs').remove([storagePath]);
                    }
                }
                
                // Delete from database
                await supabase.from('print_jobs').delete().eq('id', job.id);
                deletedCount++;
            } catch (err) {
                console.error(`[CLEANUP] Failed to delete job ${job.id}:`, err.message);
            }
        }

        console.log(`[CLEANUP] ✅ Successfully deleted ${deletedCount} old files and database records.`);
    } catch (err) {
        console.error(`[CLEANUP] ❌ Cleanup routine failed:`, err.message);
    }
}

// ─── Startup ───
console.log('=============================================');
console.log('   SMARTPRINT: PI PRINT AGENT v3.0');
console.log('   Clean & simple — no GhostScript');
console.log('=============================================');

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

startListener();

process.on('SIGINT', () => {
    console.log('Shutting down...');
    clearInterval(cleanupInterval);
    if (activeChannel) supabase.removeChannel(activeChannel);
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
});
