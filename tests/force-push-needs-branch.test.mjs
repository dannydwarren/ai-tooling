import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findUnnamedForcePush } from '../tools/claude/hooks/force-push-needs-branch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'tools', 'claude', 'hooks', 'force-push-needs-branch.mjs');

function run(command) {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const result = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  return { code: result.status, stderr: result.stderr };
}

test('blocks a force push that names no branch', () => {
  for (const command of [
    'git push --force',
    'git push -f',
    'git push --force-with-lease',
    'git push --force-with-lease=main:abc123',
    'git push -uf origin',
    'git push --force origin',
    'git push --force origin HEAD',
    'git push -f origin HEAD:HEAD',
    'git push --force --all origin',
    'git push --mirror --force origin',
    'git -c core.safecrlf=false push --force',
    'git add -A && git commit -m x && git push --force',
  ]) {
    assert.ok(findUnnamedForcePush(command), `${command} should be blocked`);
  }
});

test('allows a force push that names its branch', () => {
  for (const command of [
    'git push --force origin feature/x',
    'git push --force-with-lease origin dannywarren/arch-1',
    'git push -f origin main',
    'git push origin +feature/x',
    'git push --force origin HEAD:feature/x',
    'git push origin feature/x --force',
    'git push -o ci.skip --force origin feature/x',
  ]) {
    assert.equal(findUnnamedForcePush(command), null, `${command} should be allowed`);
  }
});

test('ignores pushes that are not forced, and commands that are not pushes', () => {
  for (const command of [
    'git push',
    'git push origin',
    'git push -u origin feature/x',
    'git push --follow-tags',
    'git status',
    'git commit -m "push --force later"',
    'echo git push --force',
    undefined,
  ]) {
    assert.equal(findUnnamedForcePush(command), null, `${command} should be ignored`);
  }
});

test('a plus refspec forces without a flag, and still needs a named branch', () => {
  assert.ok(findUnnamedForcePush('git push origin +HEAD'));
  assert.equal(findUnnamedForcePush('git push origin +HEAD:feature/x'), null);
});

test('the script exits 2 with guidance for an unnamed force push, and 0 otherwise', () => {
  const blocked = run('git push --force');
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /git push --force-with-lease origin <branch>/);
  assert.equal(run('git push --force origin feature/x').code, 0);
  assert.equal(run('ls').code, 0);
});

test('an empty or malformed payload passes', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});
