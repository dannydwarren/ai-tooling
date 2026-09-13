#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, isMain } from './lib/paths.mjs';
import { readJson, writeText, sameText, readText } from './lib/fsx.mjs';
import { open, passphrase } from './lib/seal.mjs';
import { BUNDLE } from './claude-memory-backup.mjs';

export function targetFor(rel) {
  const [project, name] = rel.split('/');
  return path.join(CLAUDE_HOME, 'projects', project, 'memory', name);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const force = args.includes('--force');

  const envelope = readJson(BUNDLE, null);
  if (!envelope) {
    console.error(`No sealed bundle at ${BUNDLE}. Run: npm run claude:memory:backup`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(open(envelope, passphrase()));
  } catch (err) {
    console.error(`ai-tooling claude memory restore\n  ! ${err.message}`);
    process.exit(1);
  }

  const entries = Object.entries(payload.files ?? {});
  const changes = [];
  const conflicts = [];

  for (const [rel, content] of entries) {
    const dest = targetFor(rel);
    const exists = fs.existsSync(dest);
    if (exists && !sameText(readText(dest), content)) {
      if (!force) {
        conflicts.push(rel);
        continue;
      }
      changes.push(rel);
    } else if (!exists) {
      changes.push(rel);
    } else {
      continue;
    }
    if (!check) writeText(dest, content);
  }

  console.log(`ai-tooling claude memory restore${check ? ' (check)' : ''}`);
  console.log(`  bundle sealed at ${envelope.sealedAt ?? 'unknown time'}, ${entries.length} file(s)`);
  console.log(`  into ${path.join(CLAUDE_HOME, 'projects', '<project>', 'memory')}`);
  if (changes.length === 0 && conflicts.length === 0) console.log('  the machine already matches the bundle');
  else if (changes.length > 0) console.log(`  ${check ? 'would write' : 'wrote'} ${changes.length} file(s)`);

  if (conflicts.length > 0) {
    console.error(`  ! ${conflicts.length} file(s) differ on this machine and were left alone.`);
    console.error('    Claude may have updated them since the bundle was sealed. --force overwrites.');
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
export { main };
