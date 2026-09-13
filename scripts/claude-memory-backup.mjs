#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { repoPath, isMain } from './lib/paths.mjs';
import { readText, writeText } from './lib/fsx.mjs';
import { seal, passphrase, KEY_FILE } from './lib/seal.mjs';
import { MEMORY_DIR, memoryFiles } from './checks/validate-memory.mjs';
import { main as capture } from './claude-memory-capture.mjs';

export const BUNDLE = repoPath('tools', 'claude', 'memory.sealed.json');

export function bundle(files = memoryFiles(), root = MEMORY_DIR) {
  const payload = { version: 1, files: {} };
  for (const rel of files) {
    payload.files[rel] = readText(path.join(root, rel.split('/')[0], rel.split('/')[1]));
  }
  return payload;
}

function main() {
  capture({ check: false });
  console.log('');

  const files = memoryFiles();
  if (files.length === 0) {
    console.error(`No memory found under ${MEMORY_DIR}, and none to capture from ~/.claude/projects/*/memory.`);
    process.exit(1);
  }

  const secret = passphrase();
  const payload = bundle(files);
  const envelope = seal(JSON.stringify(payload), secret);
  envelope.note = 'Encrypted Claude auto-memory. AES-256-GCM, scrypt-derived key. Restore with scripts/claude-memory-restore.mjs and the passphrase.';
  envelope.fileCount = files.length;
  envelope.sealedAt = new Date().toISOString();

  writeText(BUNDLE, `${JSON.stringify(envelope, null, 2)}\n`);

  const projects = new Set(files.map((f) => f.split('/')[0]));
  console.log('ai-tooling claude memory backup');
  console.log(`  sealed ${files.length} file(s) across ${projects.size} project(s)`);
  console.log(`  into   ${path.relative(process.cwd(), BUNDLE)}`);
  console.log(`  key    ${fs.existsSync(KEY_FILE) ? KEY_FILE : 'from AI_TOOLING_MEMORY_PASSPHRASE'}`);
  console.log('');
  console.log('  The bundle is useless without the passphrase. Store it in your password manager.');
}

if (isMain(import.meta.url)) main();
export { main };
