import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, rewriteRoot, toCatalogEntry, discover } from '../scripts/claude-plugin-hooks.mjs';

const SOURCE = { marketplace: 'mkt', plugin: 'demo', version: '1.0.0', root: 'C:\\cache\\demo\\1.0.0' };

test('flattens the nested settings hook shape into one entry per hook', () => {
  const flat = flatten({
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'c' }] }],
  });

  assert.equal(flat.length, 3);
  assert.deepEqual(flat[0], { event: 'PreToolUse', matcher: 'Bash', hook: { type: 'command', command: 'a' } });
  assert.equal(flat[2].matcher, null);
});

test('flattening tolerates a missing or empty manifest', () => {
  assert.deepEqual(flatten(undefined), []);
  assert.deepEqual(flatten({}), []);
  assert.deepEqual(flatten({ PreToolUse: [{ matcher: 'x' }] }), []);
});

test('rewrites the plugin root variable in both spellings, with forward slashes', () => {
  assert.equal(
    rewriteRoot('node "${CLAUDE_PLUGIN_ROOT}/hooks/x.js"', SOURCE.root),
    'node "C:/cache/demo/1.0.0/hooks/x.js"',
  );
  assert.equal(
    rewriteRoot('$CLAUDE_PLUGIN_ROOT/run.sh', SOURCE.root),
    'C:/cache/demo/1.0.0/run.sh',
  );
});

test('rewriting leaves an unrelated command alone', () => {
  assert.equal(rewriteRoot('echo hi', SOURCE.root), 'echo hi');
  assert.equal(rewriteRoot(undefined, SOURCE.root), undefined);
});

test('an imported entry is disabled, identifiable and carries a review warning', () => {
  const entry = toCatalogEntry(SOURCE, { event: 'PreToolUse', matcher: 'Bash', hook: { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/x.js' } }, 0);

  assert.equal(entry.enabled, false, 'an imported third-party hook must never install itself');
  assert.equal(entry.id, 'demo-pretooluse-0');
  assert.equal(entry.event, 'PreToolUse');
  assert.equal(entry.matcher, 'Bash');
  assert.match(entry.description, /demo plugin/);
  assert.match(entry.description, /Review before enabling/);
  assert.equal(entry.hook.command, 'C:/cache/demo/1.0.0/x.js');
});

test('an entry without a matcher omits the key rather than emitting null', () => {
  const entry = toCatalogEntry(SOURCE, { event: 'SessionStart', matcher: null, hook: { type: 'command', command: 'x' } }, 1);
  assert.ok(!('matcher' in entry));
});

test('discovery on a missing cache directory returns nothing rather than throwing', () => {
  assert.deepEqual(discover('C:\\definitely\\not\\here'), []);
});
