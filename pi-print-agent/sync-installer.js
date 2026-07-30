#!/usr/bin/env node
// Re-embeds the real agent files into install-pi-agent.sh.
//
// The installer ships the agent inline via heredoc so it can run on a bare Pi
// with no checkout. That copy went stale once already — it was still the
// pre-MongoDB agent months after the migration — so run this after editing
// index.js, package.json or .env.example, and commit the result.
//
//   node pi-print-agent/sync-installer.js
//   node pi-print-agent/sync-installer.js --check   (verify only, non-zero if stale)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(dir, 'install-pi-agent.sh');
const checkOnly = process.argv.includes('--check');

const sources = [
  { marker: '$INSTALL_DIR/index.js', file: 'index.js' },
  { marker: '$INSTALL_DIR/package.json', file: 'package.json' },
  { marker: '$INSTALL_DIR/.env.example', file: '.env.example' },
];

let lines = fs.readFileSync(installer, 'utf8').split('\n');
let stale = [];

for (const { marker, file } of sources) {
  const start = lines.findIndex(l => l.includes(`cat << 'EOF' > "${marker}"`));
  if (start === -1) throw new Error(`no heredoc found for ${marker}`);

  const end = lines.findIndex((l, i) => i > start && l === 'EOF');
  if (end === -1) throw new Error(`unterminated heredoc for ${marker}`);

  const body = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\s*$/, '').split('\n');
  if (body.some(l => l === 'EOF')) {
    throw new Error(`${file} contains a bare EOF line, which would end the heredoc early`);
  }

  const embedded = lines.slice(start + 1, end);
  if (embedded.join('\n') !== body.join('\n')) {
    stale.push(file);
    if (!checkOnly) lines.splice(start + 1, end - start - 1, ...body);
  }
}

if (checkOnly) {
  if (stale.length) {
    console.error(`installer is stale for: ${stale.join(', ')}`);
    console.error('run: node pi-print-agent/sync-installer.js');
    process.exit(1);
  }
  console.log('installer matches the real agent files.');
  process.exit(0);
}

if (stale.length) {
  fs.writeFileSync(installer, lines.join('\n'), 'utf8');
  console.log(`re-embedded: ${stale.join(', ')}`);
} else {
  console.log('already in sync, nothing to do.');
}
