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
// It only ever updates an existing admin, or creates one if none exists. It
// never prints the password back.
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import readline from 'readline';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run this from the directory holding the .env file.');
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

// readline echoes what you type, so for the password we mute the output stream
// ourselves and print nothing back.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) {
        process.stdin.removeListener('data', onData);
      } else {
        process.stdout.write('\x1B[2K\x1B[200D' + question);
      }
    };
    process.stdout.write(question);
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

await mongoose.connect(uri);

const admins = await Admin.find().select('username').lean();
if (admins.length) {
  console.log(`Existing admin account(s): ${admins.map((a) => a.username).join(', ')}`);
} else {
  console.log('No admin accounts exist yet — this will create one.');
}

const username = (await ask(`Username${admins.length ? ` [${admins[0].username}]` : ''}: `)).trim()
  || (admins.length ? admins[0].username : '');
if (!username) {
  console.error('A username is required.');
  await mongoose.disconnect();
  process.exit(1);
}

const password = await askHidden('New password (hidden): ');
const confirm = await askHidden('Confirm password: ');

if (password !== confirm) {
  console.error('Those did not match. Nothing was changed.');
  await mongoose.disconnect();
  process.exit(1);
}
if (password.length < 12) {
  console.error('Use at least 12 characters. Nothing was changed.');
  await mongoose.disconnect();
  process.exit(1);
}

// Same cost factor as server/security.ts hashPassword.
const passwordHash = await bcrypt.hash(password, 12);
await Admin.findOneAndUpdate({ username }, { username, passwordHash }, { upsert: true });

console.log(`✅ Password updated for "${username}". Existing admin sessions stay valid until they expire (8h).`);
await mongoose.disconnect();
