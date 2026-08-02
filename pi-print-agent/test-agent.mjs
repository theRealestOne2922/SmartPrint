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
  const secret = 'test-app-secret';
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
  check('the real check agrees on an untouched job', jobIntegrityMatches(signed) === true);
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
