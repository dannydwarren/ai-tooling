#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { REPO_ROOT, repoPath, isMain } from './lib/paths.mjs';

const STEPS = [
  { name: 'json', script: 'scripts/checks/validate-json.mjs' },
  { name: 'assets', script: 'scripts/checks/validate-assets.mjs' },
  { name: 'links', script: 'scripts/checks/validate-links.mjs' },
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

function prePushInstalled() {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const hook = path.resolve(REPO_ROOT, dir, 'pre-push');
    return fs.existsSync(hook) && fs.readFileSync(hook, 'utf8').includes('managed by ai-tooling');
  } catch {
    return false;
  }
}

function warnIfUnguarded() {
  if (process.env.CI) return;
  if (prePushInstalled()) return;
  console.error('');
  console.error('  ! No pre-push guard is installed in this clone.');
  console.error('    The private-value scan only works here, never on a runner, so nothing');
  console.error('    stops an internal identifier reaching the remote if you forget to run');
  console.error('    this build. Install the guard once:');
  console.error('');
  console.error('      npm run install-git-hooks');
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
    warnIfUnguarded();
    return;
  }
  console.error(`  failed: ${failures.join(', ')}`);
  warnIfUnguarded();
  process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main };
