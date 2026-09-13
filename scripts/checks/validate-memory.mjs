#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, repoPath, isMain } from '../lib/paths.mjs';

export const MEMORY_DIR = repoPath('tools', 'claude', 'memory');

export function memoryFiles(root = MEMORY_DIR) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = path.join(root, project.name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) out.push(`${project.name}/${entry.name}`);
    }
  }
  return out.sort();
}

export function trackedPlaintext(root = REPO_ROOT) {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'tools/claude/memory'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean).filter((f) => f.endsWith('.md'));
}

function main() {
  const present = memoryFiles();
  const tracked = trackedPlaintext();

  console.log(`memory: ${present.length} plaintext file(s) in the working tree`);

  if (tracked.length > 0) {
    console.error(`  ! ${tracked.length} plaintext memory file(s) are TRACKED BY GIT:`);
    for (const file of tracked.slice(0, 10)) console.error(`      ${file}`);
    if (tracked.length > 10) console.error(`      ... and ${tracked.length - 10} more`);
    console.error('');
    console.error('    Auto-memory records employer architecture and, in at least one case,');
    console.error('    assessments of named job candidates. It must never be committed in the');
    console.error('    clear to a public repo. Commit tools/claude/memory.sealed.json instead:');
    console.error('      git rm -r --cached tools/claude/memory');
    console.error('      npm run claude:memory:backup');
    console.error('    See docs/memory-backup.md.');
    process.exit(1);
  }

  console.log('  none tracked by git, which is correct; the sealed bundle is what ships');
}

if (isMain(import.meta.url)) main();
export { main };
