#!/usr/bin/env node
// Which deployment is this machine part of?
//
// There is more than one SmartPrint install, on more than one tailnet, and the
// Pis look identical over SSH — same OS, same paths, same agent. Connecting to
// the wrong one and "fixing" it is a real way to break a system that was
// working. This answers the question before anything else is done.
//
//   node whichdeployment.mjs                      # print the fingerprint
//   node whichdeployment.mjs --expect vit         # verify, exit 1 if it differs
//   node whichdeployment.mjs --expect <keyhash>   # verify against a given hash
//
// Secrets are hashed, never printed, so the output is safe to paste anywhere.
//
// MASTER_KEY is the discriminator that actually matters. It is what decrypts
// confidential documents, so every machine in one deployment shares it and no
// machine in another can — a hostname or a Tailscale name is a label anyone can
// change, but this either matches or the machine cannot do the job at all.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const KNOWN = {
  // VIT Chennai — smartprintvit.web.app, API on 140.245.224.137.nip.io
  vit: {
    masterKey: '21bab032b8acabbf',
    appSecret: 'de60283ea11228f2',
    cluster: 'cluster0.fzbkawi.mongodb.net',
    baseUrl: 'https://140.245.224.137.nip.io',
  },
};

const short = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);
const dir = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const expectIdx = args.indexOf('--expect');
const expect = expectIdx === -1 ? null : args[expectIdx + 1];
const envPath = args.find((a) => !a.startsWith('--') && a !== expect) || path.join(dir, '.env');

let text;
try {
  text = fs.readFileSync(envPath, 'utf8');
} catch {
  console.error(`No .env found at ${path.resolve(envPath)} — cannot identify this machine.`);
  process.exit(2);
}

const env = {};
for (const line of text.split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const clusterOf = (uri) => (uri && uri.match(/@([^/?]+)/)?.[1]) || null;

const fp = {
  cluster: clusterOf(env.MONGODB_URI),
  baseUrl: env.PUBLIC_BASE_URL || null,
  masterKey: env.MASTER_KEY ? short(env.MASTER_KEY) : null,
  appSecret: env.APP_SECRET ? short(env.APP_SECRET) : null,
  hostname: read('/etc/hostname'),
  machineId: read('/etc/machine-id') ? short(read('/etc/machine-id')) : null,
};

console.log('deployment fingerprint');
console.log(`  mongo cluster    : ${fp.cluster ?? '(no MONGODB_URI)'}`);
console.log(`  PUBLIC_BASE_URL  : ${fp.baseUrl ?? '(unset)'}`);
console.log(`  MASTER_KEY  hash : ${fp.masterKey ?? '(unset)'}`);
console.log(`  APP_SECRET  hash : ${fp.appSecret ?? '(unset)'}`);
console.log(`  hostname         : ${fp.hostname ?? '(n/a)'}`);
console.log(`  machine-id  hash : ${fp.machineId ?? '(n/a)'}`);

const named = Object.entries(KNOWN).find(([, k]) => k.masterKey === fp.masterKey);
console.log(`\n  identified as    : ${named ? named[0].toUpperCase() : 'UNKNOWN — not a deployment this script knows'}`);

if (!expect) process.exit(0);

const want = KNOWN[expect] ? KNOWN[expect].masterKey : expect;
if (!fp.masterKey) {
  console.error(`\nREFUSE: MASTER_KEY is not set here, so this machine cannot be identified.`);
  process.exit(1);
}
if (fp.masterKey !== want) {
  console.error(`\nREFUSE: expected MASTER_KEY hash ${want}, found ${fp.masterKey}.`);
  console.error(`This is NOT the machine you meant. Change nothing here.`);
  process.exit(1);
}

// Secondary signals. A mismatch here is not necessarily the wrong machine —
// it can be a half-finished config — so it warns rather than refusing.
const k = KNOWN[expect];
if (k) {
  if (fp.cluster && fp.cluster !== k.cluster) console.warn(`\nWARNING: mongo cluster is ${fp.cluster}, expected ${k.cluster}.`);
  if (fp.baseUrl && fp.baseUrl !== k.baseUrl) console.warn(`WARNING: PUBLIC_BASE_URL is ${fp.baseUrl}, expected ${k.baseUrl}.`);
  if (fp.appSecret && fp.appSecret !== k.appSecret) console.warn(`WARNING: APP_SECRET hash is ${fp.appSecret}, expected ${k.appSecret}.`);
}

console.log(`\nCONFIRMED: this is the ${expect.toUpperCase()} deployment.`);
