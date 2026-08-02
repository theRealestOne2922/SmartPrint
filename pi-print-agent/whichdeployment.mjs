#!/usr/bin/env node
// Which deployment is this machine part of?
//
// There is more than one SmartPrint install, on more than one tailnet, and the
// Pis look identical over SSH — same OS, same paths, same agent. Connecting to
// the wrong one and "fixing" it is a real way to break a system that was
// working. This answers the question before anything else is done.
//
//   node whichdeployment.mjs                    # print this machine's fingerprint
//   node whichdeployment.mjs --expect <hash>    # verify, exit 1 if it differs
//
// The expected hash is supplied by whoever is running this, or put in a
// .deployment-expect file next to the agent, which is gitignored. It is
// deliberately NOT hardcoded here: this repository is public, and a committed
// hash lets anyone holding a candidate key check it against the real one
// offline. It is also exactly the shape a secret scanner flags, which buries
// real findings in noise. Keep it out of the repo.
//
// MASTER_KEY is the discriminator that matters. It is what decrypts confidential
// documents, so every machine in one deployment shares it and no machine in
// another can — a hostname or a Tailscale name is a label anyone can change,
// but this either matches or the machine cannot do the job at all.
//
// Secrets are hashed, never printed, so the output is safe to paste anywhere.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const short = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };

const args = process.argv.slice(2);
const expectIdx = args.indexOf('--expect');
const expect =
  (expectIdx !== -1 && args[expectIdx + 1]) ||
  process.env.DEPLOYMENT_EXPECT ||
  read(path.join(dir, '.deployment-expect')) ||
  null;
const envPath = args.find((a, i) => !a.startsWith('--') && i !== expectIdx + 1) || path.join(dir, '.env');

const text = read(envPath) === null ? null : fs.readFileSync(envPath, 'utf8');
if (text === null) {
  console.error(`No .env found at ${path.resolve(envPath)} — cannot identify this machine.`);
  process.exit(2);
}

const env = {};
for (const line of text.split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const machineId = read('/etc/machine-id');
const fp = {
  cluster: (env.MONGODB_URI && env.MONGODB_URI.match(/@([^/?]+)/)?.[1]) || null,
  baseUrl: env.PUBLIC_BASE_URL || null,
  masterKey: env.MASTER_KEY ? short(env.MASTER_KEY) : null,
  appSecret: env.APP_SECRET ? short(env.APP_SECRET) : null,
  hostname: read('/etc/hostname'),
  machineId: machineId ? short(machineId) : null,
};

console.log('deployment fingerprint');
console.log(`  mongo cluster    : ${fp.cluster ?? '(no MONGODB_URI)'}`);
console.log(`  PUBLIC_BASE_URL  : ${fp.baseUrl ?? '(unset)'}`);
console.log(`  MASTER_KEY  hash : ${fp.masterKey ?? '(unset)'}`);
console.log(`  APP_SECRET  hash : ${fp.appSecret ?? '(unset)'}`);
console.log(`  hostname         : ${fp.hostname ?? '(n/a)'}`);
console.log(`  machine-id  hash : ${fp.machineId ?? '(n/a)'}`);

if (!expect) {
  console.log('\nNo expected fingerprint given, so nothing was verified.');
  console.log('Compare MASTER_KEY hash against the deployment you meant, or pass');
  console.log('--expect <hash> to have this check it and fail if it differs.');
  process.exit(0);
}

if (!fp.masterKey) {
  console.error('\nREFUSE: MASTER_KEY is not set here, so this machine cannot be identified.');
  process.exit(1);
}
if (fp.masterKey !== expect.trim()) {
  console.error(`\nREFUSE: expected MASTER_KEY hash ${expect.trim()}, found ${fp.masterKey}.`);
  console.error('This is NOT the machine you meant. Change nothing here.');
  process.exit(1);
}

console.log('\nCONFIRMED: this machine matches the expected deployment.');
