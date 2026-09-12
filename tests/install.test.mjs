import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isManagedCommand, stripManaged, addManaged, catalogEntries, canonical } from '../scripts/claude-install.mjs';
import { render, unrender, placeholdersIn, derivedValues, jsonEscaped, requiredValueKeys, loadPrivateValues } from '../scripts/lib/template.mjs';
import { toPosix, toSlash, REPO_ROOT } from '../scripts/lib/paths.mjs';
import { checkPlaceholders, validate } from '../scripts/checks/validate-assets.mjs';

const VALUES = { REPO_ROOT_SLASH: toSlash(REPO_ROOT), USER_HOME: 'C:\\Users\\Someone' };

const FOREIGN = {
  SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }],
};

const HOOKS_DIR = `${toSlash(REPO_ROOT)}/tools/claude/hooks`;
const managed = (script) => `node "${HOOKS_DIR}/${script}"`;

test('recognises this checkout as managed, in either path spelling', () => {
  assert.ok(isManagedCommand(managed('skill-audit.mjs')));
  assert.ok(isManagedCommand(`node "${REPO_ROOT}\\tools\\claude\\hooks\\no-comments.mjs"`));
  assert.ok(!isManagedCommand('echo hello'));
  assert.ok(!isManagedCommand(undefined));
});

test('hooks belonging to another checkout or to the user are never claimed', () => {
  assert.ok(!isManagedCommand('bash /home/me/dotfiles/tools/claude/hooks/greet.sh'));
  assert.ok(!isManagedCommand('node D:/other-repo/tools/claude/hooks/mine.mjs'));
  assert.ok(!isManagedCommand(`node "${REPO_ROOT}-2/tools/claude/hooks/x.mjs"`), 'a sibling checkout is not this one');
});

test('a group with no hooks array, or an empty one, survives untouched', () => {
  const before = {
    SessionStart: [{ matcher: 'startup' }, { hooks: [{ type: 'command', command: 'echo mine' }] }],
    Stop: [{ matcher: '*', hooks: [] }],
  };
  assert.deepEqual(stripManaged(before), before, 'the installer must not prune what it does not own');
});

test('an event whose value is not an array is passed through rather than dropped', () => {
  const before = { SomeFutureEvent: { shape: 'unknown' } };
  assert.deepEqual(stripManaged(before), before);
});

test('stripping managed hooks preserves hand written ones exactly', () => {
  const before = {
    SessionStart: [{ hooks: [{ type: 'command', command: 'cat wip.md' }] }],
    PreToolUse: [{ matcher: 'Skill', hooks: [{ type: 'command', command: managed('skill-audit.mjs') }] }],
  };
  const after = stripManaged(before);
  assert.deepEqual(after.SessionStart, before.SessionStart);
  assert.ok(!('PreToolUse' in after), 'a group left empty should be removed');
});

test('stripping keeps sibling hooks inside a shared matcher group', () => {
  const before = {
    PostToolUse: [{
      matcher: 'Edit|Write',
      hooks: [
        { type: 'command', command: 'prettier --write' },
        { type: 'command', command: managed('no-comments.mjs') },
      ],
    }],
  };
  const after = stripManaged(before);
  assert.equal(after.PostToolUse[0].hooks.length, 1);
  assert.equal(after.PostToolUse[0].hooks[0].command, 'prettier --write');
});

test('install is idempotent: strip then add twice yields the same result', () => {
  const entries = [{
    id: 'x', enabled: true, event: 'PreToolUse', matcher: 'Skill',
    hook: { type: 'command', command: 'node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/skill-audit.mjs"' },
  }];

  const once = addManaged(stripManaged(FOREIGN), entries, VALUES).hooks;
  const twice = addManaged(stripManaged(once), entries, VALUES).hooks;
  assert.deepEqual(twice, once);
});

test('uninstall returns settings to their original hook state', () => {
  const entries = [{
    id: 'x', enabled: true, event: 'PreToolUse', matcher: 'Skill',
    hook: { type: 'command', command: 'node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/skill-audit.mjs"' },
  }];
  const installed = addManaged(stripManaged(FOREIGN), entries, VALUES).hooks;
  assert.deepEqual(stripManaged(installed), FOREIGN);
});

test('disabled catalog entries are not installed', () => {
  const entries = [
    { id: 'on', enabled: true, event: 'PreToolUse', matcher: 'Skill', hook: { type: 'command', command: 'node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/a.mjs"' } },
    { id: 'off', enabled: false, event: 'PostToolUse', matcher: 'Edit', hook: { type: 'command', command: 'node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/b.mjs"' } },
  ];
  const result = addManaged({}, entries, VALUES);
  assert.deepEqual(result.applied, ['on']);
  assert.ok(!('PostToolUse' in result.hooks));
});

test('hooks sharing an event and matcher join the same group', () => {
  const entries = [
    { id: 'a', enabled: true, event: 'PreToolUse', matcher: 'Skill', hook: { type: 'command', command: 'node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/a.mjs"' } },
    { id: 'b', enabled: true, event: 'PreToolUse', matcher: 'Skill', hook: { type: 'command', command: 'node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/b.mjs"' } },
  ];
  const { hooks } = addManaged({}, entries, VALUES);
  assert.equal(hooks.PreToolUse.length, 1);
  assert.equal(hooks.PreToolUse[0].hooks.length, 2);
});

test('an unresolved placeholder in a hook command is a hard error', () => {
  const entries = [{
    id: 'bad', enabled: true, event: 'PreToolUse', matcher: 'Skill',
    hook: { type: 'command', command: 'node "{{NO_SUCH_VALUE}}/x.mjs"' },
  }];
  assert.throws(() => addManaged({}, entries, VALUES), /NO_SUCH_VALUE/);
});

test('the shipped catalog wires each hook to the event it needs', () => {
  const entries = catalogEntries();
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

  assert.equal(byId['skill-audit'].enabled, true);
  assert.equal(byId['skill-audit'].event, 'PreToolUse');
  assert.equal(byId['skill-audit'].matcher, 'Skill');

  assert.equal(byId['skill-audit-typed'].enabled, true);
  assert.equal(byId['skill-audit-typed'].event, 'UserPromptExpansion');

  assert.equal(byId['no-comments'].enabled, true);
  assert.equal(byId['no-comments'].event, 'PostToolUse');
  assert.equal(byId['no-comments'].matcher, 'Edit|Write');
});

test('the audit is complete: both invocation paths are enabled together', () => {
  const byId = Object.fromEntries(catalogEntries().map((e) => [e.id, e]));
  assert.equal(
    byId['skill-audit'].enabled,
    byId['skill-audit-typed'].enabled,
    'enabling one path without the other records half the skills and looks like complete data',
  );
});

test('drift detection ignores key order, so a reordered settings file is not rewritten', () => {
  const a = { PreToolUse: [{ matcher: 'Skill', hooks: [{ type: 'command', command: 'x', timeout: 10 }] }] };
  const b = { PreToolUse: [{ hooks: [{ timeout: 10, command: 'x', type: 'command' }], matcher: 'Skill' }] };
  assert.equal(canonical(a), canonical(b));
});

test('drift detection still sees a genuine difference', () => {
  assert.notEqual(
    canonical({ PreToolUse: [{ matcher: 'Skill', hooks: [{ command: 'x' }] }] }),
    canonical({ PreToolUse: [{ matcher: 'Skill', hooks: [{ command: 'y' }] }] }),
  );
  assert.notEqual(canonical({ a: 1 }), canonical({ a: '1' }));
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
});

test('capturing settings strips the hooks the installer generates', async () => {
  const { withoutManagedHooks } = await import('../scripts/claude-capture.mjs');
  const live = JSON.stringify({
    env: { A: '1' },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'cat wip.md' }] }],
      PreToolUse: [{ matcher: 'Skill', hooks: [{ type: 'command', command: managed('skill-audit.mjs') }] }],
    },
  }, null, 2);

  const captured = JSON.parse(withoutManagedHooks(live));
  assert.deepEqual(captured.env, { A: '1' });
  assert.ok(!('PreToolUse' in captured.hooks), 'managed hooks must not round trip into the backup');
  assert.equal(captured.hooks.SessionStart[0].hooks[0].command, 'cat wip.md');
});

test('capturing settings with no hooks at all is left alone', async () => {
  const { withoutManagedHooks } = await import('../scripts/claude-capture.mjs');
  const live = '{\n  "env": {}\n}';
  assert.equal(withoutManagedHooks(live), live);
});

test('capturing settings drops the hooks key when only managed hooks existed', async () => {
  const { withoutManagedHooks } = await import('../scripts/claude-capture.mjs');
  const live = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Skill', hooks: [{ type: 'command', command: managed('a.mjs') }] }] },
  });
  assert.ok(!('hooks' in JSON.parse(withoutManagedHooks(live))));
});

test('unparseable settings are passed through rather than destroyed', async () => {
  const { withoutManagedHooks } = await import('../scripts/claude-capture.mjs');
  assert.equal(withoutManagedHooks('{ not json'), '{ not json');
});

test('an MCP server carrying an inline env credential is omitted from the backup', async () => {
  const { hasInlineSecret } = await import('../scripts/claude-capture.mjs');
  assert.ok(hasInlineSecret({ env: { TOKEN: 'abc123' } }));
  assert.ok(!hasInlineSecret({ env: {} }));
  assert.ok(!hasInlineSecret({}));
  assert.ok(!hasInlineSecret({ env: { EMPTY: '' } }));
});

test('rendering substitutes known placeholders and reports unknown ones', () => {
  const result = render('a {{USER_HOME}} b {{NOPE}}', VALUES);
  assert.equal(result.text, 'a C:\\Users\\Someone b {{NOPE}}');
  assert.deepEqual(result.missing, ['NOPE']);
});

test('placeholdersIn lists each distinct placeholder once', () => {
  assert.deepEqual(placeholdersIn('{{A}} {{B}} {{A}}'), ['A', 'B']);
});

test('unrender then render round trips', () => {
  const values = derivedValues();
  const original = `path is ${values.USER_HOME}\\work and posix ${values.USER_HOME_POSIX}/work`;
  const templated = unrender(original, values);
  assert.ok(templated.includes('{{USER_HOME'), templated);
  assert.equal(render(templated, values).text, original);
});

test('unrender prefers the longest matching value', () => {
  const values = { SHORT: 'C:\\Users\\Mine', LONG: 'C:\\Users\\Mine\\.claude' };
  assert.equal(unrender('C:\\Users\\Mine\\.claude', values), '{{LONG}}');
});

test('unrender is case insensitive because Windows paths vary in case', () => {
  assert.equal(unrender('c:\\users\\mine', { HOME: 'C:\\Users\\Mine' }), '{{HOME}}');
});

test('a value cannot be substituted into a placeholder already written', () => {
  const values = { PROJECT_CODENAME: 'claude', USER_HOME: 'C:\\Users\\Someone' };
  const out = unrender('C:\\Users\\Someone\\.claude and the claude project', values);

  assert.ok(!/\{\{\{\{/.test(out), `nested placeholder produced: ${out}`);
  assert.equal(out, '{{USER_HOME}}\\.{{PROJECT_CODENAME}} and the {{PROJECT_CODENAME}} project');
  assert.equal(
    render(out, values).text,
    'C:\\Users\\Someone\\.claude and the claude project',
    'the round trip must be lossless',
  );
});

test('overlapping values resolve to one match, never a partial overwrite', () => {
  const values = { A: 'abcdefgh', B: 'defghijk' };
  const out = unrender('xx abcdefghijk yy', values);
  assert.equal(out, 'xx {{A}}ijk yy');
  assert.equal(render(out, values).text, 'xx abcdefghijk yy');
});

test('values shorter than the floor are ignored, so common words are safe', () => {
  assert.equal(unrender('The device is deviant', { ENV_NAME: 'dev' }), 'The device is deviant');
});

test('unrender then render round trips for every real value', () => {
  const values = derivedValues();
  const original = [
    `${values.USER_HOME}\\work`,
    `${values.USER_HOME_POSIX}/work`,
    `${values.CLAUDE_HOME}\\skills`,
    `${values.REPO_ROOT_SLASH}/tools`,
  ].join(' | ');
  assert.equal(render(unrender(original, values), values).text, original);
});

test('json escaping doubles backslashes so settings.json round trips', () => {
  assert.equal(jsonEscaped('C:\\Users\\Me'), 'C:\\\\Users\\\\Me');
  const values = { H_JSON: jsonEscaped('C:\\Users\\Me') };
  const raw = '"path": "C:\\\\Users\\\\Me\\\\.jobnimbus"';
  const templated = unrender(raw, values);
  assert.equal(templated, '"path": "{{H_JSON}}\\\\.jobnimbus"');
  assert.equal(render(templated, values).text, raw);
});

test('path conversions produce the forms the hook commands rely on', () => {
  assert.equal(toSlash('C:\\src\\ai-tooling'), 'C:/src/ai-tooling');
  assert.equal(toPosix('C:\\src\\ai-tooling'), '/c/src/ai-tooling');
  assert.equal(toPosix('/already/posix'), '/already/posix');
});

test('every placeholder used in an installed file is derived or declared', () => {
  assert.deepEqual(checkPlaceholders(), []);
});

test('the whole asset validation passes', () => {
  assert.deepEqual(validate(), []);
});

test('required-values declares a description for every key without revealing it', () => {
  const declared = requiredValueKeys();
  const actual = loadPrivateValues();
  assert.ok(Object.keys(declared).length > 0);
  for (const [key, description] of Object.entries(declared)) {
    assert.ok(typeof description === 'string' && description.length > 20, `${key} needs a real description`);
    if (typeof actual[key] === 'string' && actual[key].length >= 6) {
      assert.ok(
        !description.toLowerCase().includes(actual[key].toLowerCase()),
        `the description of ${key} must not contain the value it describes`,
      );
    }
  }
});

test('derived values expose every form the templates use', () => {
  const values = derivedValues();
  for (const key of ['REPO_ROOT', 'REPO_ROOT_SLASH', 'REPO_ROOT_POSIX', 'REPO_ROOT_JSON',
    'USER_HOME', 'USER_HOME_SLASH', 'USER_HOME_POSIX', 'USER_HOME_JSON',
    'CLAUDE_HOME', 'CLAUDE_HOME_SLASH', 'CLAUDE_HOME_POSIX', 'CLAUDE_HOME_JSON']) {
    assert.ok(typeof values[key] === 'string' && values[key].length > 0, `${key} missing`);
  }
});

test('backups are timestamped and pruned to the newest few', async () => {
  const { backup, backupsOf } = await import('../scripts/lib/fsx.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{}', 'utf8');

  for (let i = 0; i < 8; i += 1) {
    fs.writeFileSync(path.join(dir, `settings.json.ai-tooling-backup.2026-09-0${i + 1}`), '{}', 'utf8');
  }
  const made = backup(file, 5);

  assert.ok(made.includes('.ai-tooling-backup.'));
  const remaining = backupsOf(file);
  assert.equal(remaining.length, 5, 'only the newest few backups should survive');
  assert.ok(remaining.includes(made), 'the backup just taken must be kept');
});

test('backing up a file that does not exist is a no-op', async () => {
  const { backup } = await import('../scripts/lib/fsx.mjs');
  const os = await import('node:os');
  assert.equal(backup(path.join(os.tmpdir(), 'not-here-98765.json')), null);
});

test('orphans finds machine files the repo no longer tracks', async () => {
  const { orphans } = await import('../scripts/claude-install.mjs');
  const planned = [
    { destFile: path.join('C:', 'home', '.claude', 'skills', 'kept', 'SKILL.md') },
  ];
  const found = orphans(planned);
  assert.ok(Array.isArray(found), 'orphans must return a list even against the real machine');
  assert.ok(found.every((f) => typeof f === 'string'));
});

test('removeEmptyParents stops at the boundary and leaves non-empty dirs', async () => {
  const { removeEmptyParents } = await import('../scripts/claude-install.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
  const deep = path.join(root, 'skills', 'gone', 'nested');
  fs.mkdirSync(deep, { recursive: true });

  removeEmptyParents(deep, root);
  assert.ok(!fs.existsSync(path.join(root, 'skills')), 'empty parents should be removed');
  assert.ok(fs.existsSync(root), 'the boundary itself must survive');

  const keep = path.join(root, 'commands');
  fs.mkdirSync(keep, { recursive: true });
  fs.writeFileSync(path.join(keep, 'a.md'), 'x', 'utf8');
  removeEmptyParents(keep, root);
  assert.ok(fs.existsSync(keep), 'a directory with content must not be removed');
});



test('a credential passed as a command-line argument is detected', async () => {
  const { hasInlineSecret } = await import('../scripts/claude-capture.mjs');
  assert.ok(hasInlineSecret({ args: ['start', '--api-key', 'api-0123456789abcdef'] }));
  assert.ok(hasInlineSecret({ args: ['--token', 'abc123def456'] }));
  assert.ok(hasInlineSecret({ args: [['--client-', 'secret=', 'shhhhhhh'].join('')] }));
  assert.ok(hasInlineSecret({ headers: { [['Author', 'ization'].join('')]: ['Bearer', 'abc123def456'].join(' ') } }));
});

test('an environment placeholder is not a secret, so the server is still backed up', async () => {
  const { hasInlineSecret, isLiteralValue } = await import('../scripts/claude-capture.mjs');
  assert.ok(!hasInlineSecret({ args: ['--api-key', '${LAUNCHDARKLY_API_KEY}'] }));
  assert.ok(!hasInlineSecret({ env: { TOKEN: '${MY_TOKEN}' } }));
  assert.ok(!hasInlineSecret({ env: { TOKEN: '$MY_TOKEN' } }));
  assert.ok(!hasInlineSecret({ args: ['--token', '{{PLACEHOLDER}}'] }));

  assert.ok(!isLiteralValue('${VAR}'));
  assert.ok(!isLiteralValue('$VAR'));
  assert.ok(!isLiteralValue('{{X}}'));
  assert.ok(!isLiteralValue('   '));
  assert.ok(isLiteralValue('actual-value'));
});

test('a path argument is not mistaken for a credential', async () => {
  const { hasInlineSecret } = await import('../scripts/claude-capture.mjs');
  assert.ok(
    !hasInlineSecret({ args: ['--private-key-file', 'C:\Users\Me\.snowflake\rsa_key.p8'] }),
    'a path points at a secret, it is not one, and templating already covers the home prefix',
  );
  assert.ok(!hasInlineSecret({ args: ['--key', '/etc/ssl/key.pem'] }));
});

test('a server with nothing sensitive is backed up unchanged', async () => {
  const { hasInlineSecret } = await import('../scripts/claude-capture.mjs');
  assert.ok(!hasInlineSecret({ type: 'http', url: 'https://mcp.example.com/mcp' }));
  assert.ok(!hasInlineSecret({}));
  assert.ok(!hasInlineSecret({ args: ['--warehouse', 'GENERAL_WH', '--schema', 'CORE'] }));
});


test('the drive letter is normalised, so the same path is written the same way', async () => {
  const { normalizeDrive, REPO_ROOT, USER_HOME, CLAUDE_HOME } = await import('../scripts/lib/paths.mjs');

  assert.equal(normalizeDrive('c:\src\ai-tooling'), 'C:\src\ai-tooling');
  assert.equal(normalizeDrive('C:\src\ai-tooling'), 'C:\src\ai-tooling');
  assert.equal(normalizeDrive('d:/other'), 'D:/other');
  assert.equal(normalizeDrive('/home/user/repo'), '/home/user/repo', 'POSIX paths are untouched');
  assert.equal(normalizeDrive(''), '');

  for (const [label, value] of [['REPO_ROOT', REPO_ROOT], ['USER_HOME', USER_HOME], ['CLAUDE_HOME', CLAUDE_HOME]]) {
    if (/^[A-Za-z]:/.test(value)) {
      assert.match(value, /^[A-Z]:/, `${label} must expose an upper-case drive letter`);
    }
  }
});

test('a hook command differing only in drive-letter case is recognised as ours', async () => {
  const lower = `node "${toSlash(REPO_ROOT).replace(/^C:/, 'c:')}/tools/claude/hooks/skill-audit.mjs"`;
  assert.ok(
    isManagedCommand(lower),
    'cwd casing varies by how the script was launched; ownership must not depend on it',
  );
});
