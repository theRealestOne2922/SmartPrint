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
mkdir -p "$INSTALL_DIR/models"

# Write package.json
cat << 'EOF' > "$INSTALL_DIR/package.json"
{
    "name": "pi-print-agent",
    "version": "4.2.0",
    "description": "Native Raspberry Pi Print Daemon for SmartPrint",
    "main": "index.js",
    "type": "module",
    "scripts": {
        "start": "node index.js",
        "test": "node test-agent.mjs"
    },
    "dependencies": {
        "dotenv": "^16.4.5",
        "mongoose": "^9.9.1",
        "pdf-lib": "^1.17.1"
    }
}
EOF

# Write models/PrintJob.js — index.js imports this, so a fresh install without
# it starts and immediately dies on ERR_MODULE_NOT_FOUND.
cat << 'EOF' > "$INSTALL_DIR/models/PrintJob.js"
import mongoose from 'mongoose';

const printJobSchema = new mongoose.Schema({
    jobId: { type: String, required: true, maxlength: 6 },
    studentName: { type: String, required: true, default: 'Teacher' },
    teacherEmpId: { type: String, default: null },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    pageCount: { type: Number, required: true },
    colorMode: { type: String, required: true, enum: ['bw', 'color'] },
    copies: { type: Number, required: true },
    duplex: { type: Boolean, default: false },
    orientation: { type: String, default: 'portrait', enum: ['portrait', 'landscape'] },
    paperSize: { type: String, default: 'a4', enum: ['a4', 'a3'] },
    pageRange: { type: String, default: 'all' },
    price: { type: Number, required: true },
    status: { type: String, required: true, default: 'uploaded' },
    confidential: { type: Boolean, default: false },
    encrypted: { type: Boolean, default: false },
    // Envelope-encryption metadata written by the backend. These must stay
    // declared here: Mongoose strips schema-undeclared fields when hydrating,
    // so a non-lean read would silently drop them and decryption would fail.
    encIv: { type: String, default: null },
    encAuthTag: { type: String, default: null },
    wrappedKey: { type: String, default: null },
    wrappedKeyIv: { type: String, default: null },
    wrappedKeyAuthTag: { type: String, default: null },
    stripeSessionId: { type: String, default: null },
    // Set by this agent when it takes ownership of a job, so a restart or a
    // duplicate change-stream event cannot send the same exam paper to the
    // printer twice. The backend neither reads nor writes it.
    agentClaimedAt: { type: Date, default: null },
    // Set the moment CUPS accepts the job. Paper is committed from here on, so
    // this job must never be retried even if the agent dies before it can write
    // the final status.
    agentSpooledAt: { type: Date, default: null },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            ret.id = ret._id;
            delete ret.__v;
            return ret;
        }
    }
});

export const PrintJob = mongoose.model('PrintJob', printJobSchema);
EOF

# Write test-agent.mjs so the install can be verified on the Pi itself with
# `npm test` — no database, no printer, no network off the box.
cat << 'EOF' > "$INSTALL_DIR/test-agent.mjs"
#!/usr/bin/env node
// Tests the parts of the agent that run before the printer does: print-option
// construction, the download path, and booklet imposition. It imports the real
// index.js with the startup block cut off at the '// Startup' marker, so it
// tests the shipped source rather than a copy of it.
//
//   node pi-print-agent/test-agent.mjs
//
// No database, no printer, no network beyond a local server on 127.0.0.1.
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const dir = path.dirname(fileURLToPath(import.meta.url));

// --- load the real source, minus the startup block -------------------------
const source = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
const cut = source.indexOf('// Startup');
if (cut === -1) throw new Error("could not find the '// Startup' marker in index.js");

const harness = path.join(dir, `.test-harness-${process.pid}.mjs`);
fs.writeFileSync(
  harness,
  // buildLpArgs is already exported from index.js; the rest are module-private.
  `${source.slice(0, cut)}\nexport { downloadFile, NEEDS_CONVERSION, jobIntegrityMatches };\n`,
  'utf8'
);

let mod;
try {
  process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/never-connected';
  mod = await import(`file://${harness.replace(/\\/g, '/')}`);
} finally {
  fs.unlinkSync(harness);
}
const { downloadFile, buildLpArgs, isAllowedDownloadUrl, jobIntegrityMatches } = mod;

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n       ${detail}`}`);
  if (!ok) failures++;
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);

// ---------------------------------------------------------------- lp options
console.log('\n--- print options ---');
const P = '/tmp/x.pdf';

eq('A4, colour, single-sided',
  buildLpArgs({ colorMode: 'color' }, { copies: 1, paperSize: 'a4', printPath: P, booklet: false }),
  ['-d', 'SmartPrint', '-n', '1', '-o', 'print-color-mode=color', '-o', 'sides=one-sided', '-o', 'media=a4', P]);

eq('A4, B&W, duplex, 30 copies',
  buildLpArgs({ colorMode: 'bw', duplex: true }, { copies: 30, paperSize: 'a4', printPath: P, booklet: false }),
  ['-d', 'SmartPrint', '-n', '30', '-o', 'print-color-mode=monochrome', '-o', 'sides=two-sided-long-edge', '-o', 'media=a4', P]);

eq('landscape adds the flag',
  buildLpArgs({ colorMode: 'bw', orientation: 'landscape' }, { copies: 1, paperSize: 'a4', printPath: P, booklet: false }),
  ['-d', 'SmartPrint', '-n', '1', '-o', 'print-color-mode=monochrome', '-o', 'sides=one-sided', '-o', 'media=a4', '-o', 'landscape', P]);

eq('booklet: short-edge duplex on landscape A3',
  buildLpArgs({ colorMode: 'bw' }, { copies: 2, paperSize: 'a3', printPath: P, booklet: true }),
  ['-d', 'SmartPrint', '-n', '2', '-o', 'fit-to-page', '-o', 'print-color-mode=monochrome',
    '-o', 'media=a3', '-o', 'landscape', '-o', 'sides=two-sided-short-edge', P]);

eq('page range passes through',
  buildLpArgs({ colorMode: 'bw', pageRange: '1-4,7' }, { copies: 1, paperSize: 'a4', printPath: P, booklet: false }),
  ['-d', 'SmartPrint', '-n', '1', '-o', 'print-color-mode=monochrome', '-o', 'sides=one-sided', '-o', 'media=a4', '-P', '1-4,7', P]);

eq('page range "all" is omitted',
  buildLpArgs({ colorMode: 'bw', pageRange: 'all' }, { copies: 1, paperSize: 'a4', printPath: P, booklet: false }),
  ['-d', 'SmartPrint', '-n', '1', '-o', 'print-color-mode=monochrome', '-o', 'sides=one-sided', '-o', 'media=a4', P]);

for (const [range, expected] of [
  ['1-4,7', '1-4,7'],
  ['2', '2'],
  ['1;rm -rf ~', null],   // sanitises to "1-", which lp would reject
  ['-,-', null],
  ['abc', null],
  ['1-4;reboot', '1-4'],  // strips to a valid range; safe, and lp accepts it
]) {
  const args = buildLpArgs({ colorMode: 'bw', pageRange: range }, { copies: 1, paperSize: 'a4', printPath: P, booklet: false });
  const i = args.indexOf('-P');
  const actual = i === -1 ? null : args[i + 1];
  check(`page range ${JSON.stringify(range)} -> ${expected === null ? 'omitted (prints all)' : expected}`,
    actual === expected, `got ${JSON.stringify(actual)}`);
  if (actual !== null) check(`  ${JSON.stringify(actual)} is a range lp accepts`, /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(actual));
}
check('every argument is a string (execFile rejects anything else)',
  buildLpArgs({ colorMode: 'bw' }, { copies: 5, paperSize: 'a4', printPath: P, booklet: false }).every((a) => typeof a === 'string'));

// ----------------------------------------------------------------- downloads
console.log('\n--- download ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
const body = Buffer.from('%PDF-1.4 fake exam paper');

const server = http.createServer((req, res) => {
  if (req.url === '/ok') { res.writeHead(200); res.end(body); return; }
  if (req.url === '/missing') { res.writeHead(404); res.end('nope'); return; }
  if (req.url === '/once') { res.writeHead(302, { Location: `http://127.0.0.1:${port}/ok` }); res.end(); return; }
  if (req.url.startsWith('/loop')) { res.writeHead(302, { Location: `http://127.0.0.1:${port}/loop` }); res.end(); return; }
  if (req.url === '/hang') { res.writeHead(200); /* never ends */ return; }
  res.writeHead(500); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = (p) => `http://127.0.0.1:${port}${p}`;

// Downloads are restricted to the configured origin, so the harness declares
// its own server as that origin — the same thing a real deployment does with
// PUBLIC_BASE_URL. Read at call time, so setting it here is enough.
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${port}`;

const dest = (n) => path.join(tmp, n);

await downloadFile(url('/ok'), dest('a.pdf'));
check('200 writes the file intact', fs.readFileSync(dest('a.pdf')).equals(body));

let err = null;
try { await downloadFile(url('/missing'), dest('b.pdf')); } catch (e) { err = e; }
check('404 rejects', /HTTP 404/.test(err?.message || ''), err?.message);

await downloadFile(url('/once'), dest('c.pdf'));
check('follows a redirect', fs.readFileSync(dest('c.pdf')).equals(body));

err = null;
try { await downloadFile(url('/loop'), dest('d.pdf')); } catch (e) { err = e; }
check('redirect loop terminates instead of hanging', /Too many redirects/.test(err?.message || ''), err?.message);

err = null;
// Point the allowed origin at the dead port too, or this would be refused by
// the source check above and the test would pass without testing anything.
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${port + 1}`;
try { await downloadFile(`http://127.0.0.1:${port + 1}/ok`, dest('e.pdf')); } catch (e) { err = e; }
check('connection refused rejects', !!err && !/unexpected location/.test(err.message), err?.message);
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${port}`;

// ------------------------------------------------- where a document may come from
console.log('\n--- download source restriction ---');
{
  // This agent reads jobs straight from MongoDB, so the server's checks never
  // run for a row written directly into the database. These are what stop such
  // a row pointing the agent — which sits inside the campus network — anywhere
  // it likes.
  const ours = `http://127.0.0.1:${port}`;
  process.env.PUBLIC_BASE_URL = ours;
  check('our own origin is allowed', isAllowedDownloadUrl(`${ours}/uploads/x.pdf`));
  check('a different host is refused', !isAllowedDownloadUrl('http://evil.example.com/x.pdf'));
  check('a host that merely starts with ours is refused',
    !isAllowedDownloadUrl('http://127.0.0.1.evil.example.com/x.pdf'));
  check('cloud metadata is refused', !isAllowedDownloadUrl('http://169.254.169.254/latest/meta-data/'));
  check('a different port on the same host is refused', !isAllowedDownloadUrl(`http://127.0.0.1:${port + 1}/x.pdf`));
  check('file:// is refused', !isAllowedDownloadUrl('file:///etc/passwd'));
  check('garbage is refused', !isAllowedDownloadUrl('not a url at all'));

  // Unconfigured, the guard falls back to refusing what only this machine can reach.
  process.env.PUBLIC_BASE_URL = '';
  check('unconfigured: public host allowed', isAllowedDownloadUrl('https://example.com/x.pdf'));
  check('unconfigured: loopback refused', !isAllowedDownloadUrl('http://127.0.0.1/x.pdf'));
  check('unconfigured: private range refused', !isAllowedDownloadUrl('http://192.168.1.5/x.pdf'));
  check('unconfigured: metadata refused', !isAllowedDownloadUrl('http://169.254.169.254/'));
  process.env.PUBLIC_BASE_URL = ours;

  // And the download path itself enforces it, not just the predicate.
  let e2 = null;
  try { await downloadFile('http://169.254.169.254/latest/meta-data/', dest('f.pdf')); } catch (e) { e2 = e; }
  check('downloadFile refuses an off-origin target', /unexpected location/.test(e2?.message || ''), e2?.message);
}

// ------------------------------------------------------- job tamper-evidence
console.log('\n--- job integrity ---');
{
  // Sign with whatever secret the agent itself is using, so the real check can
  // be exercised. Hardcoding one here passed only where APP_SECRET happened to
  // be unset — on a configured machine the real function used a different key
  // and disagreed, which looked like an agent fault and was a test fault.
  const secret = process.env.APP_SECRET || 'test-app-secret';
  const sign = (job) => crypto.createHmac('sha256', secret).update(`integrity.${JSON.stringify([
    'v1', String(job.jobId ?? ''), String(job.teacherEmpId ?? ''),
    job.confidential === true ? 1 : 0, String(job.fileName ?? ''), String(job.filePath ?? ''),
  ])}`).digest('hex');

  const base = { jobId: '123456', teacherEmpId: 'EMP1', confidential: true, fileName: 'a.pdf', filePath: 'https://x/y.pdf' };
  const signed = { ...base, integrity: sign(base) };

  // jobIntegrityMatches reads APP_SECRET at module load, so it is exercised
  // through the same HMAC rather than by reimporting the module per case.
  const verify = (job) => {
    if (typeof job.integrity !== 'string' || job.integrity.length !== 64) return false;
    const a = Buffer.from(job.integrity, 'hex');
    const b = Buffer.from(sign(job), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  check('an untouched job verifies', verify(signed));
  check('changing the faculty ID breaks it', !verify({ ...signed, teacherEmpId: 'ATTACKER' }));
  check('turning off confidential breaks it', !verify({ ...signed, confidential: false }));
  check('repointing the file breaks it', !verify({ ...signed, filePath: 'http://169.254.169.254/' }));
  check('swapping the file name breaks it', !verify({ ...signed, fileName: 'other.pdf' }));
  check('a missing signature is not a pass', !verify({ ...base }));
  check('a guessed signature is not a pass', !verify({ ...base, integrity: 'f'.repeat(64) }));
  // The real function, not the local re-implementation. With APP_SECRET set it
  // must accept a correctly signed job and refuse a forged one; with it unset
  // it deliberately fails open, warning at startup rather than refusing to
  // print because one variable was missed.
  if (process.env.APP_SECRET) {
    check('the real check accepts a correctly signed job', jobIntegrityMatches(signed) === true);
    check('the real check refuses a forged signature',
      jobIntegrityMatches({ ...base, integrity: 'f'.repeat(64) }) === false);
  } else {
    check('APP_SECRET unset: the real check fails open, by design',
      jobIntegrityMatches({ ...base }) === true);
  }
}

// --------------------------------------------------------- booklet imposition
console.log('\n--- booklet imposition ---');
async function impose(numPages) {
  const src = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) src.addPage([595.28, 841.89]);
  const out = await PDFDocument.create();
  const paddedCount = Math.ceil(numPages / 4) * 4;
  const embedded = await out.embedPdf(src, src.getPageIndices());
  const pageArray = [];
  for (let i = 0; i < paddedCount; i++) pageArray.push(i < numPages ? embedded[i] : null);
  const sheets = paddedCount / 4;
  for (let s = 0; s < sheets; s++) {
    for (const [l, r] of [[paddedCount - 2 * s - 1, 2 * s], [paddedCount - 2 * s - 2, 2 * s + 1]]) {
      const page = out.addPage([595.28 * 2, 841.89]);
      if (pageArray[l]) page.drawPage(pageArray[l], { x: 0, y: 0, width: 595.28, height: 841.89 });
      if (pageArray[r]) page.drawPage(pageArray[r], { x: 595.28, y: 0, width: 595.28, height: 841.89 });
    }
  }
  return out;
}

for (const [pages, expectedSheets] of [[1, 1], [4, 1], [5, 2], [8, 2], [12, 3]]) {
  const out = await impose(pages);
  const got = out.getPageCount();
  check(`${pages} page(s) -> ${expectedSheets} sheet(s) (${expectedSheets * 2} sides)`, got === expectedSheets * 2, `got ${got} sides`);
  if (pages === 4) {
    const [w, h] = [out.getPage(0).getWidth(), out.getPage(0).getHeight()];
    check('  sheet is two A4 pages wide (A3 landscape)', Math.round(w) === 1191 && Math.round(h) === 842, `${Math.round(w)}x${Math.round(h)}`);
  }
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL AGENT TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
EOF

# Write index.js (with orientation support)
cat << 'EOF' > "$INSTALL_DIR/index.js"
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

// Tamper-evidence, checked on the side that actually prints.
//
// The server signs the fields that decide who may print a job — print code,
// faculty ID, confidential flag, file name, file path — and verifies that
// before releasing one. This agent does not go through the server, so that
// check would be skipped entirely for a row written directly into the database.
// Verifying it here is what makes the signature mean something at the printer.
//
// Must stay in step with signJobIntegrity in "student web app/server/security.ts".
const APP_SECRET = process.env.APP_SECRET || '';
if (!APP_SECRET) {
    console.warn('⚠️  APP_SECRET not set — cannot verify that jobs were created by our server.');
    console.warn('    Set it in .env, matching the backend, so altered records are refused.');
}

function jobIntegrityMatches(job) {
    // Without the secret there is nothing to check against. Deliberately not a
    // refusal: an agent that cannot verify should still print, loudly warning,
    // rather than silently stopping every job on an exam morning because one
    // environment variable was missed.
    if (!APP_SECRET) return true;
    if (typeof job.integrity !== 'string' || job.integrity.length !== 64) return false;

    const payload = JSON.stringify([
        'v1',
        String(job.jobId ?? ''),
        String(job.teacherEmpId ?? ''),
        job.confidential === true ? 1 : 0,
        String(job.fileName ?? ''),
        String(job.filePath ?? ''),
    ]);
    const expected = crypto.createHmac('sha256', APP_SECRET).update(`integrity.${payload}`).digest('hex');
    const a = Buffer.from(job.integrity, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extensions that need conversion to PDF before printing.
// IPP Everywhere driver only accepts PDF — images and Office docs must be converted.
const NEEDS_CONVERSION = new Set([
    '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.odt', '.ods', '.odp', '.txt',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'
]);

// Where a document may legitimately come from.
//
// This agent takes its work straight from MongoDB — it never asks the API — so
// none of the server's checks apply to it. The server refuses a filePath that
// is not one of ours when a job is created; a row written directly into the
// database never passes through that. Anyone able to write to this collection
// could therefore insert a job with status 'printing' and any URL at all, and
// this agent, sitting inside the campus network, would fetch it.
//
// So the same rule is enforced here, on the side that actually opens the
// connection, and on every redirect hop rather than only the first.
// Read at call time, not at import. The value is fixed in practice — the agent
// restarts to pick up a changed .env — but reading it here keeps the guard
// testable without the test having to know the port before it opens a socket.
const allowedFileBase = () => (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
if (!allowedFileBase()) {
    console.warn('⚠️  PUBLIC_BASE_URL not set — cannot confirm documents come from our own server.');
    console.warn('    Private and loopback addresses are still refused, but set it in .env.');
}

// Refused whether or not PUBLIC_BASE_URL is configured. A misconfigured agent
// should still not be usable as a way to reach things only it can see.
function isPrivateHost(hostname) {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return true;
    // IPv4 private, loopback, link-local (169.254.x covers cloud metadata), CGNAT.
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
    }
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    return false;
}

export function isAllowedDownloadUrl(url) {
    let u;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

    // Configured: the origin has to be that one, and nothing else matters.
    // Compared as an origin rather than a string prefix, because
    // "https://ours.example.evil.com" starts with the base as text while being
    // an entirely different host. A base pointing at loopback is the operator
    // saying so deliberately — a development server, or the agent's own test
    // harness — and is not the case this guard exists for.
    const base = allowedFileBase();
    if (base) {
        try {
            return u.origin === new URL(base).origin;
        } catch {
            return false;
        }
    }

    // Unconfigured: no way to know what "ours" means, so fall back to refusing
    // the addresses that only this machine can reach. Weaker, but it keeps a
    // misconfigured agent from being a route into the campus network.
    return !isPrivateHost(u.hostname);
}

// Download file from URL (follows redirects)
const DOWNLOAD_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;

function downloadFile(url, destPath, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        if (!isAllowedDownloadUrl(url)) {
            return reject(new Error(`Refusing to download from an unexpected location: ${String(url).slice(0, 120)}`));
        }
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

        // Checked against the record we just re-read, so a row altered between
        // being written and being claimed is caught here rather than printed.
        if (!jobIntegrityMatches(job)) {
            console.error(`[JOB ${job.jobId}] 🛑 Record does not match its signature — refusing to print.`);
            console.error(`[JOB ${job.jobId}]    This job was altered outside the application. Re-issue it from the dashboard.`);
            await PrintJob.updateOne({ _id: job._id }, { status: 'failed' }).catch(() => {});
            activeJobs.delete(jobKey);
            return;
        }
        if (!isAllowedDownloadUrl(job.filePath)) {
            console.error(`[JOB ${job.jobId}] 🛑 Document is not on our own server — refusing to fetch it.`);
            await PrintJob.updateOne({ _id: job._id }, { status: 'failed' }).catch(() => {});
            activeJobs.delete(jobKey);
            return;
        }
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

# Where documents may be fetched from, e.g. https://api.example.edu
# Must match the backend's PUBLIC_BASE_URL.
#
# This agent takes its work straight from MongoDB and never asks the API, so
# none of the server's checks apply to it. Without this, a job row written
# directly into the database could point the agent at any URL at all — and it
# runs inside the campus network. Private and loopback addresses are refused
# either way, but set this so only our own server is accepted.
PUBLIC_BASE_URL=

# Must match the backend's APP_SECRET.
#
# The server signs the fields that decide who may print a job. With this set,
# the agent refuses a record whose signature does not match — so altering a job
# in the database does not get it printed. Left blank, jobs still print and the
# agent warns at startup; it is not a hard requirement, so a missed variable
# cannot stop an exam morning.
APP_SECRET=

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

# This script runs under sudo, so a bare `pm2` here is ROOT's pm2 and saves to
# /root/.pm2/dump.pm2. The boot unit installed below resurrects $REAL_USER's
# pm2, which reads $USER_HOME/.pm2/dump.pm2 — a different file that would never
# have contained the agent. The Pi printed fine until its first reboot and then
# silently stopped. Every pm2 call that owns the process runs as the real user.
pm2_user() {
    sudo -u "$REAL_USER" env HOME="$USER_HOME" PM2_HOME="$USER_HOME/.pm2" /usr/bin/pm2 "$@"
}

pm2_user stop smartprint-agent 2>/dev/null || true
pm2_user delete smartprint-agent 2>/dev/null || true

# Only start if the operator has filled in .env — otherwise the agent would
# exit immediately on a missing MONGODB_URI and PM2 would crash-loop it.
if grep -qE '^MONGODB_URI=.+' "$INSTALL_DIR/.env"; then
    # Ownership first: pm2 runs as $REAL_USER from here on and must be able to
    # read the files npm install just created as root.
    chown -R "$REAL_USER:$REAL_USER" "$INSTALL_DIR"
    pm2_user start "$INSTALL_DIR/index.js" --name smartprint-agent
    pm2_user save
    AGENT_STARTED=1
else
    echo ""
    echo "⚠️  MONGODB_URI is empty in $INSTALL_DIR/.env — agent NOT started."
    echo "    Fill in MONGODB_URI and MASTER_KEY, then run (WITHOUT sudo):"
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

# Clean up PM2 to reload with new default printer.
# Only if it is actually running, and as the user that owns it — `set -e` is on,
# so restarting a process this pm2 has never heard of aborted the installer
# right before the summary and made a good install look like a failed one.
if [ "$AGENT_STARTED" = "1" ]; then
    pm2_user restart smartprint-agent || true
fi

echo ""
echo "==================================================================="
echo "🎉 SMARTPRINT COMPLETE KI-OSK SETUP SUCCESSFUL!"
echo "==================================================================="
if [ "$AGENT_STARTED" = "1" ]; then
    echo "  The database print agent is running in the background (PM2)."
else
    echo "  ⚠️  The print agent is NOT running — $INSTALL_DIR/.env is incomplete."
    echo "     Fill in MONGODB_URI and MASTER_KEY, then (WITHOUT sudo):"
    echo "       cd $INSTALL_DIR && pm2 start index.js --name smartprint-agent && pm2 save"
fi
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
