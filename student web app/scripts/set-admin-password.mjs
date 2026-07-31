#!/usr/bin/env node
// Sets an admin's password. Prompts for it with the terminal echo turned off, so
// the password never lands in your shell history, in a command line another user
// could see in `ps`, or in a chat log.
//
// Run it from the "student web app" directory, on a machine that can reach the
// database (the Oracle VM, or locally with the same MONGODB_URI):
//
//   node scripts/set-admin-password.mjs
//
// Over SSH, give it a terminal or the prompts cannot work:
//
//   ssh -t <host> 'cd ~/smartprintvit/student\ web\ app && node scripts/set-admin-password.mjs'
//
// It updates an existing admin, or creates one if none exists, and never prints
// the password back.
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import readline from 'readline';
import { Writable } from 'stream';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run this from the directory holding the .env file.');
  process.exit(1);
}

if (!process.stdin.isTTY) {
  console.error('No terminal attached, so the password cannot be typed without being echoed.');
  console.error('Re-run over SSH with -t:');
  console.error("  ssh -t <host> 'cd ~/smartprintvit/student\\ web\\ app && node scripts/set-admin-password.mjs'");
  process.exit(1);
}

// Matches server/models/Admin.ts. Declared here so this script stays runnable
// without building the TypeScript server.
const Admin = mongoose.model(
  'Admin',
  new mongoose.Schema({ username: String, passwordHash: String }, { timestamps: true })
);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

// readline echoes what you type, so the password is read through an output
// stream that drops whatever is written to it once the prompt has been shown.
// The first version of this redrew the line with ANSI escapes instead, which did
// not survive an SSH session: it returned the wrong value, the length check
// rejected it, and the password silently never changed.
function askHidden(question) {
  return new Promise((resolve) => {
    let muted = false;
    const mutedOut = new Writable({
      write(chunk, encoding, cb) {
        if (!muted) process.stdout.write(chunk, encoding);
        cb();
      },
    });

    const rl = readline.createInterface({ input: process.stdin, output: mutedOut, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true; // everything typed after the prompt is swallowed
  });
}

await mongoose.connect(uri);

const admins = await Admin.find().select('username').lean();
if (admins.length) {
  console.log(`Existing admin account(s): ${admins.map((a) => a.username).join(', ')}`);
} else {
  console.log('No admin accounts exist yet — this will create one.');
}

const typed = (await ask(`Username${admins.length ? ` [${admins[0].username}]` : ''}: `)).trim();
const username = typed || (admins.length ? admins[0].username : '');
if (!username) {
  console.error('A username is required. Nothing was changed.');
  await mongoose.disconnect();
  process.exit(1);
}

// Creating a second admin by mistyping the username would leave the original
// account — and its old password — working. Make that an explicit choice.
const isNew = !admins.some((a) => a.username === username);
if (isNew && admins.length) {
  const confirmNew = (await ask(`"${username}" does not exist. Create a NEW admin? The existing account keeps its password. [y/N]: `)).trim().toLowerCase();
  if (confirmNew !== 'y') {
    console.log('Nothing was changed.');
    await mongoose.disconnect();
    process.exit(0);
  }
}

const password = await askHidden('New password (hidden, 12+ characters): ');
const confirm = await askHidden('Confirm password: ');

if (!password) {
  console.error('Nothing was typed. Nothing was changed.');
  await mongoose.disconnect();
  process.exit(1);
}
if (password !== confirm) {
  console.error('Those did not match. Nothing was changed.');
  await mongoose.disconnect();
  process.exit(1);
}
if (password.length < 12) {
  console.error(`Too short (${password.length} characters, need 12). Nothing was changed.`);
  await mongoose.disconnect();
  process.exit(1);
}

// Same cost factor as server/security.ts hashPassword.
const passwordHash = await bcrypt.hash(password, 12);
await Admin.findOneAndUpdate({ username }, { username, passwordHash }, { upsert: true });

// Read it back and verify, so a silent failure can't look like success — which
// is exactly what happened the first time this script was run.
const saved = await Admin.findOne({ username }).lean();
const verified = saved && (await bcrypt.compare(password, saved.passwordHash));

if (verified) {
  console.log(`✅ Password updated for "${username}" and verified against the database.`);
  console.log('   Sessions already signed in stay valid until their token expires (8h).');
} else {
  console.error('❌ The password did not verify after saving. Nothing can be assumed — check the database.');
  process.exitCode = 1;
}

await mongoose.disconnect();
