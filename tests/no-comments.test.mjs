import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isCodeFile, commentLines, introducedComments, editPairs, report, addedLines, introducedFromResponse } from '../tools/claude/hooks/no-comments.mjs';

const C = '/' + '/';
const NOTE = `${C} pre-existing note`;
const NEW = `${C} brand new explanation`;
const ORIGINAL = `${NOTE}\nconst a = 1;\nconst b = 2;\n`;

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

test('addedLines takes only the + side of a patch, without the marker', () => {
  const patch = [{ lines: [' context', '-removed', '+added one', '+added two'] }];
  assert.deepEqual(addedLines(patch), ['added one', 'added two']);
});

test('addedLines spans every hunk and tolerates a malformed patch', () => {
  assert.deepEqual(addedLines([{ lines: ['+a'] }, { lines: ['+b'] }]), ['a', 'b']);
  assert.deepEqual(addedLines([]), []);
  assert.deepEqual(addedLines(undefined), []);
  assert.deepEqual(addedLines([{}]), []);
});

test('a Write over an existing file does not re-flag its existing comments', () => {
  const introduced = introducedFromResponse({
    type: 'update',
    originalFile: ORIGINAL,
    structuredPatch: [{ lines: [' ' + NOTE, '-const a = 1;', '+const a = 9;'] }],
  });
  assert.deepEqual(introduced, [], 'this was the false positive that made the hook unusable on real repos');
});

test('a comment merely moved within the file is not treated as introduced', () => {
  const introduced = introducedFromResponse({
    type: 'update',
    originalFile: ORIGINAL,
    structuredPatch: [{ lines: ['-' + NOTE, ' const a = 1;', '+' + NOTE] }],
  });
  assert.deepEqual(introduced, [], 'the line already existed, so relocating it introduces nothing');
});

test('a genuinely new comment in a rewrite is still caught', () => {
  const introduced = introducedFromResponse({
    type: 'update',
    originalFile: ORIGINAL,
    structuredPatch: [{ lines: [' ' + NOTE, '+' + NEW, ' const a = 1;'] }],
  });
  assert.deepEqual(introduced, [NEW]);
});

test('a create falls back to input, since a patch-based check would see nothing', () => {
  assert.equal(
    introducedFromResponse({ type: 'create', originalFile: null, structuredPatch: [] }),
    null,
    'create sends originalFile null and an empty patch; returning [] here would silently stop flagging new files',
  );
});

test('a missing or unusable tool_response falls back rather than passing everything', () => {
  assert.equal(introducedFromResponse(undefined), null);
  assert.equal(introducedFromResponse({}), null);
  assert.equal(introducedFromResponse({ originalFile: ORIGINAL }), null);
  assert.equal(introducedFromResponse({ structuredPatch: [] }), null);
});

test('end to end: a Write over an existing commented file is silent', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: 'a.ts', content: `${NOTE}\nconst a = 9;\n` },
    tool_response: {
      type: 'update',
      originalFile: ORIGINAL,
      structuredPatch: [{ lines: [' ' + NOTE, '-const a = 1;', '+const a = 9;'] }],
    },
  });
  assert.equal(code, 0);
});

test('end to end: creating a file with a comment still blocks', () => {
  const { code, stderr } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: 'a.ts', content: `${NEW}\nconst a = 1;\n` },
    tool_response: { type: 'create', originalFile: null, structuredPatch: [] },
  });
  assert.equal(code, 2);
  assert.match(stderr, /brand new explanation/);
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
