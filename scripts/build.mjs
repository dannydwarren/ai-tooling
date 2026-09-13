#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, repoPath, isMain } from './lib/paths.mjs';

const STEPS = [
  { name: 'json', script: 'scripts/checks/validate-json.mjs' },
  { name: 'assets', script: 'scripts/checks/validate-assets.mjs' },
  { name: 'links', script: 'scripts/checks/validate-links.mjs' },
  { name: 'memory', script: 'scripts/checks/validate-memory.mjs' },
  { name: 'scan', script: 'scripts/checks/scan.mjs' },
  { name: 'test', node: ['--test', 'tests/**/*.test.mjs'] },
];

function run(step, extraArgs) {
  const args = step.node ?? [repoPath(step.script), ...extraArgs];
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  return result.status ?? 1;
}

function main() {
  const strict = process.argv.includes('--strict');
  const failures = [];

  for (const step of STEPS) {
    console.log(`\n=== ${step.name} ===`);
    const extra = step.name === 'scan' && strict ? ['--strict'] : [];
    const code = run(step, extra);
    if (code !== 0) failures.push(step.name);
  }

  console.log('\n=== build ===');
  if (failures.length === 0) {
    console.log('  all checks passed');
    return;
  }
  console.error(`  failed: ${failures.join(', ')}`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main };
