#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, isMain } from '../lib/paths.mjs';
import { candidateFiles } from './scan.mjs';

export function jsonFiles(root = REPO_ROOT) {
  return candidateFiles(root).filter((rel) => rel.toLowerCase().endsWith('.json'));
}

export function validate(root = REPO_ROOT) {
  const problems = [];
  for (const rel of jsonFiles(root)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      problems.push({ file: rel, message: err.message });
    }
  }
  return problems;
}

function main() {
  const problems = validate();
  const total = jsonFiles().length;
  console.log(`json: ${total} file(s) checked`);
  for (const p of problems) console.error(`  ! ${p.file}: ${p.message}`);
  if (problems.length > 0) process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main };
