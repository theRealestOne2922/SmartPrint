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
  new mongoose.Schema(
    { username: String, passwordHash: String, sessionsValidFrom: Date },
    { timestamps: true }
  )
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

// Pick the account without asking wherever the answer is obvious. Asking for a
// username people have to retype exactly — "vit admin" has a space in it — just
// created a way to mistype it, get offered a new account, decline, and end up
// having changed nothing while believing the rotation was done.
let username;
if (admins.length === 1) {
  username = admins[0].username;
  console.log(`Changing the password for the only admin account: "${username}"`);
} else if (admins.length === 0) {
  console.log('No admin accounts exist yet — this will create one.');
  username = (await ask('Username for the new admin: ')).trim();
  if (!username) {
    console.error('A username is required. Nothing was changed.');
    await mongoose.disconnect();
    process.exit(1);
  }
} else {
  console.log(`Admin accounts: ${admins.map((a) => a.username).join(', ')}`);
  username = (await ask(`Which one? [${admins[0].username}]: `)).trim() || admins[0].username;
  if (!admins.some((a) => a.username === username)) {
    console.error(`"${username}" is not one of those accounts. Nothing was changed.`);
    await mongoose.disconnect();
    process.exit(1);
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
await Admin.findOneAndUpdate(
  { username },
  {
    username,
    passwordHash,
    // Sign out every admin session already open. You usually run this because
    // the old password should stop working — leaving an issued token valid for
    // another eight hours would defeat the point.
    sessionsValidFrom: new Date(),
  },
  { upsert: true },
);

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
