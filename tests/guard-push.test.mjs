import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isPush, report } from '../.claude/hooks/guard-push.mjs';
import { REPO_ROOT } from '../scripts/lib/paths.mjs';

const GUARD = path.join(REPO_ROOT, '.claude', 'hooks', 'guard-push.mjs');

function run(toolInput) {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: toolInput });
  const result = spawnSync(process.execPath, [GUARD], { input: payload, encoding: 'utf8' });
  return { code: result.status, stderr: result.stderr };
}

test('recognises a push in the shapes it actually arrives in', () => {
  assert.ok(isPush('git push'));
  assert.ok(isPush('git push origin main'));
  assert.ok(isPush('git push --force-with-lease'));
  assert.ok(isPush('git -c core.safecrlf=false push origin main'));
  assert.ok(isPush('git add -A && git commit -q -m "x" && git push origin main'));
  assert.ok(isPush('(git push)'));
});

test('leaves everything that is not a push alone', () => {
  for (const command of [
    'git status',
    'git commit -m "push the button"',
    'npm run build',
    'git log --oneline',
    'gh pr list',
    '',
    undefined,
  ]) {
    assert.ok(!isPush(command), `${command} should not be treated as a push`);
  }
});

test('a commit mentioning push in its message is not a push', () => {
  assert.ok(!isPush('git commit -m "describe the push guard"'));
});

test('the denial explains itself and says not to work around it', () => {
  const text = report('=== scan ===\nSECRET (1)\n  a.ts:1  [jwt] JSON Web Token\n  failed: scan, test\n');
  assert.match(text, /Push blocked/);
  assert.match(text, /SECRET/);
  assert.match(text, /failed: scan/);
  assert.match(text, /Do not work around this/);
});

test('a denial with no recognisable lines still shows the tail of the output', () => {
  const text = report('something\nunexpected\nhappened\n');
  assert.match(text, /happened/);
});

test('end to end: a non-push command is allowed without running the build', () => {
  const started = Date.now();
  const { code } = run({ command: 'git status' });
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 3000, 'it must not run the build for unrelated commands');
});

test('end to end: malformed input fails open rather than blocking work', () => {
  const result = spawnSync(process.execPath, [GUARD], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('end to end: a real push runs the build and allows it while the tree is green', () => {
  const { code } = run({ command: 'git push origin main' });
  assert.equal(code, 0, 'the build passes right now, so the push must be permitted');
});
