import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isCodeFile, commentLines, introducedComments, editPairs, report } from '../tools/claude/hooks/no-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'tools', 'claude', 'hooks', 'no-comments.mjs');

function runHook(payload) {
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: result.status, stderr: result.stderr };
}

test('recognises code file extensions and ignores everything else', () => {
  for (const ok of ['a.ts', 'a.tsx', 'b.cs', 'c.js', 'd.mjs', 'e.go', 'f.rs', 'g.cpp', 'H.JAVA']) {
    assert.ok(isCodeFile(ok), `${ok} should be a code file`);
  }
  for (const no of ['README.md', 'settings.json', 'notes.txt', 'Makefile', '', undefined, 'a.mdx']) {
    assert.ok(!isCodeFile(no), `${no} should not be a code file`);
  }
});

test('detects leading line, block and jsdoc comment markers', () => {
  assert.deepEqual(commentLines('// hi'), ['// hi']);
  assert.deepEqual(commentLines('  /* block */'), ['  /* block */']);
  assert.deepEqual(commentLines('   */'), ['   */']);
  assert.deepEqual(commentLines(' * jsdoc line'), [' * jsdoc line']);
});

test('detects trailing comments after code', () => {
  assert.deepEqual(commentLines('const a = 1; // why'), ['const a = 1; // why']);
});

test('does not treat urls as comments', () => {
  assert.deepEqual(commentLines('const u = "https://example.com";'), []);
  assert.deepEqual(commentLines('fetch("http://a/b//c")'), []);
});

test('does not flag division or multiplication', () => {
  assert.deepEqual(commentLines('const half = total / 2;'), []);
  assert.deepEqual(commentLines('const x = a * b;'), []);
});

test('comments already present in old_string are not counted as introduced', () => {
  const introduced = introducedComments({
    old_string: '// keep\nconst a = 1;',
    new_string: '// keep\nconst a = 2;',
  });
  assert.deepEqual(introduced, []);
});

test('a genuinely new comment is reported', () => {
  const introduced = introducedComments({
    old_string: 'const a = 1;',
    new_string: '// explain\nconst a = 2;',
  });
  assert.deepEqual(introduced, ['// explain']);
});

test('Write content is treated as entirely new', () => {
  const introduced = introducedComments({ content: 'const a = 1; // new file' });
  assert.deepEqual(introduced, ['const a = 1; // new file']);
});

test('multi-edit payloads are handled', () => {
  const pairs = editPairs({ edits: [{ old_string: 'a', new_string: '// one' }, { old_string: 'b', new_string: '// two' }] });
  assert.equal(pairs.length, 2);
  const introduced = introducedComments({ edits: [{ old_string: 'a', new_string: '// one' }, { old_string: 'b', new_string: '// two' }] });
  assert.deepEqual(introduced, ['// one', '// two']);
});

test('the report names the file and caps the listing at eight lines', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `// c${i}`);
  const text = report('src/a.ts', lines);
  assert.ok(text.includes('src/a.ts'));
  assert.equal(text.split('\n').length, 2 + 8);
});

test('end to end: passes a non-code file', () => {
  const { code } = runHook({ tool_name: 'Write', tool_input: { file_path: 'notes.md', content: '// not code' } });
  assert.equal(code, 0);
});

test('end to end: passes clean code', () => {
  const { code } = runHook({ tool_name: 'Write', tool_input: { file_path: 'a.ts', content: 'const a = 1;\n' } });
  assert.equal(code, 0);
});

test('end to end: blocks with exit 2 and explains on stderr', () => {
  const { code, stderr } = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: 'a.ts', old_string: 'const a = 1;', new_string: '// why\nconst a = 2;' },
  });
  assert.equal(code, 2);
  assert.match(stderr, /a\.ts/);
  assert.match(stderr, /\/\/ why/);
});

test('end to end: malformed input fails open rather than blocking', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('end to end: empty stdin fails open', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: '', encoding: 'utf8' });
  assert.equal(result.status, 0);
});
