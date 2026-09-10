import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frontmatter, skillsUnder, commandsUnder, enabledPlugins, pluginVersions, inventory, compareVersions } from '../scripts/claude-skill-inventory.mjs';

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

test('parses frontmatter including a wrapped description', () => {
  const fm = frontmatter('---\nname: x\ndescription: first line\n  continued here\n---\nbody');
  assert.equal(fm.name, 'x');
  assert.equal(fm.description, 'first line continued here');
});

test('a file with no frontmatter yields an empty object', () => {
  assert.deepEqual(frontmatter('just a body'), {});
});

test('finds nested skills and namespaces them', () => {
  const root = scratch();
  write(path.join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: does alpha\n---\n');
  write(path.join(root, 'skills', 'group', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: does beta\n---\n');

  const found = skillsUnder(root, 'plug').sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(found.map((s) => s.name), ['plug:alpha', 'plug:group:beta']);
  assert.equal(found[0].description, 'does alpha');
  assert.ok(found[0].bytes > 0);
});

test('skills are found without a namespace too', () => {
  const root = scratch();
  write(path.join(root, 'skills', 'solo', 'SKILL.md'), '---\nname: solo\ndescription: d\n---\n');
  assert.deepEqual(skillsUnder(root, null).map((s) => s.name), ['solo']);
});

test('finds nested commands, which also cost context', () => {
  const root = scratch();
  write(path.join(root, 'commands', 'ship.md'), '---\ndescription: ships it\n---\n');
  write(path.join(root, 'commands', 'utilities', 'debug.md'), '---\ndescription: debugs it\n---\n');

  const found = commandsUnder(root, 'plug').sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(found.map((c) => c.name), ['plug:ship', 'plug:utilities:debug']);
});

test('a missing skills or commands directory yields nothing', () => {
  const root = scratch();
  assert.deepEqual(skillsUnder(root, 'x'), []);
  assert.deepEqual(commandsUnder(root, 'x'), []);
});

test('reads enabled plugin names, stripping the marketplace suffix', () => {
  const root = scratch();
  const file = path.join(root, 'settings.json');
  write(file, JSON.stringify({ enabledPlugins: { 'alpha@mkt': true, 'beta@mkt': false, 'gamma@other': true } }));

  const enabled = enabledPlugins(file);
  assert.deepEqual([...enabled].sort(), ['alpha', 'gamma']);
});

test('missing or malformed settings yields null rather than throwing', () => {
  assert.equal(enabledPlugins(path.join(os.tmpdir(), 'nope-12345.json')), null);
  const root = scratch();
  const bad = path.join(root, 'bad.json');
  write(bad, '{ not json');
  assert.equal(enabledPlugins(bad), null);
});

test('settings with no enabledPlugins key yields null', () => {
  const root = scratch();
  const file = path.join(root, 's.json');
  write(file, '{}');
  assert.equal(enabledPlugins(file), null);
});

test('plugin discovery picks the highest version, comparing numerically', () => {
  const root = scratch();
  for (const v of ['1.0.0', '1.2.0', '1.10.0']) {
    write(path.join(root, 'mkt', 'demo', v, 'skills', 'a', 'SKILL.md'), '---\nname: a\ndescription: d\n---\n');
  }
  const found = pluginVersions(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].version, '1.10.0', 'a lexical sort would wrongly pick 1.2.0');
});

test('version comparison handles the non-semver directories plugins actually use', () => {
  assert.ok(compareVersions('1.10.0', '1.2.0') > 0);
  assert.ok(compareVersions('2.0', '1.9.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '8fbb4b9c36ae') > 0, 'a real version beats a commit sha');
  assert.ok(compareVersions('8fbb4b9c36ae', '1.0.0') < 0);
  assert.equal(compareVersions('abc', 'abc'), 0);
});

test('discovery on a missing cache returns nothing', () => {
  assert.deepEqual(pluginVersions(path.join(os.tmpdir(), 'no-cache-here-12345')), []);
});

test('the real inventory reports this repo and marks it enabled', () => {
  const rows = inventory();
  const mine = rows.find((r) => r.owner === 'ai-tooling');
  assert.ok(mine, 'this repo should appear in the inventory');
  assert.equal(mine.kind, 'personal-repo');
  assert.equal(mine.enabled, true);
  assert.ok(mine.skills.some((s) => s.name === 'pr-review-cycle'));
  assert.ok(mine.skills.some((s) => s.name === 'wip'), 'commands count toward context too');
});

test('stamp renders a local datetime and tolerates junk', async () => {
  const { stamp } = await import('../scripts/claude-skill-inventory.mjs');
  assert.match(stamp('2026-09-08T09:12:04.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(stamp(undefined), '-');
  assert.equal(stamp('not a date'), '-');
  assert.equal(stamp(12345), '-');
});

test('usage is counted per skill with a first and last timestamp', async () => {
  const { usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const map = usageBySkill([
    { ts: '2026-09-09T10:00:00Z', skill: 'a', invocation: 'user' },
    { ts: '2026-09-08T10:00:00Z', skill: 'a', invocation: 'model' },
    { ts: '2026-09-10T10:00:00Z', skill: 'a', invocation: 'user' },
    { ts: '2026-09-09T11:00:00Z', skill: 'b', invocation: 'model' },
  ]);

  const a = map.get('a');
  assert.equal(a.count, 3);
  assert.equal(a.typed, 2);
  assert.equal(a.auto, 1);
  assert.equal(a.first, '2026-09-08T10:00:00Z', 'first must be the earliest, not the first line');
  assert.equal(a.last, '2026-09-10T10:00:00Z');
  assert.equal(map.get('b').count, 1);
});

test('usage ignores PostToolUse records and nameless entries', async () => {
  const { usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const map = usageBySkill([
    { ts: '2026-09-09T10:00:00Z', skill: 'a', event: 'PreToolUse' },
    { ts: '2026-09-09T10:00:01Z', skill: 'a', event: 'PostToolUse' },
    { ts: '2026-09-09T10:00:02Z', skill: null },
  ]);
  assert.equal(map.get('a').count, 1);
  assert.equal(map.size, 1);
});

test('coverage counts distinct enabled names and separates the unavailable', async () => {
  const { coverage, usageBySkill, BUILT_IN } = await import('../scripts/claude-skill-inventory.mjs');
  const rows = [
    { owner: 'p', enabled: true, skills: [{ name: 'p:one' }, { name: 'p:two' }] },
    { owner: 'off', enabled: false, skills: [{ name: 'off:x' }] },
  ];
  const usage = usageBySkill([
    { ts: '2026-09-08T10:00:00Z', skill: 'p:one' },
    { ts: '2026-09-09T10:00:00Z', skill: 'builtin-thing' },
  ]);

  const stats = coverage(rows, usage);
  assert.equal(stats.total, 2, 'a disabled plugin cannot be used, so it is not in the denominator');
  assert.equal(stats.usedCount, 1);
  assert.equal(stats.builtins.length, 1);
  assert.equal(stats.builtins[0].skill, 'builtin-thing');
  assert.equal(stats.builtins[0].owner, BUILT_IN);
  assert.equal(stats.first, '2026-09-08T10:00:00Z');
  assert.equal(stats.last, '2026-09-09T10:00:00Z');
});

test('a bare name is a built-in but a namespaced one is a plugin that went away', async () => {
  const { coverage, usageBySkill, BUILT_IN } = await import('../scripts/claude-skill-inventory.mjs');
  const rows = [{ owner: 'p', enabled: true, skills: [{ name: 'p:one' }] }];
  const stats = coverage(rows, usageBySkill([
    { ts: '2026-09-09T10:00:00Z', skill: 'dataviz' },
    { ts: '2026-09-09T11:00:00Z', skill: 'goneplugin:oldskill' },
  ]));

  assert.deepEqual(stats.builtins.map((s) => s.skill), ['dataviz']);
  assert.equal(stats.builtins[0].owner, BUILT_IN);
  assert.deepEqual(stats.removed.map((s) => s.skill), ['goneplugin:oldskill']);
  assert.match(stats.removed[0].owner, /goneplugin/);
  assert.match(stats.removed[0].owner, /not installed/);
});

test('a skill from a disabled plugin is not credited as used', async () => {
  const { coverage, usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const rows = [{ owner: 'off', enabled: false, skills: [{ name: 'off:x' }] }];
  const stats = coverage(rows, usageBySkill([{ ts: '2026-09-09T10:00:00Z', skill: 'off:x' }]));

  assert.equal(stats.total, 0);
  assert.equal(stats.usedCount, 0);
  assert.equal(stats.removed.length, 1, 'it was invoked before being disabled, so it is not installed now');
});

test('coverage counts a name shipped as both skill and command once', async () => {
  const { coverage, usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const rows = [{ owner: 'p', enabled: true, skills: [{ name: 'p:dup' }, { name: 'p:dup' }] }];
  assert.equal(coverage(rows, usageBySkill([])).total, 1);
});

test('coverage on an empty log reports no usage rather than throwing', async () => {
  const { coverage, usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const stats = coverage([{ owner: 'p', enabled: true, skills: [{ name: 'x' }] }], usageBySkill([]));
  assert.equal(stats.usedCount, 0);
  assert.equal(stats.first, null);
  assert.equal(stats.last, null);
  assert.deepEqual(stats.skills, []);
});

test('usedIn counts only the owner rows own skills', async () => {
  const { usedIn, usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const usage = usageBySkill([{ ts: '2026-09-09T10:00:00Z', skill: 'p:one' }]);
  assert.equal(usedIn({ skills: [{ name: 'p:one' }, { name: 'p:two' }] }, usage), 1);
  assert.equal(usedIn({ skills: [{ name: 'q:one' }] }, usage), 0);
});

test('agents are enumerated from an agents directory', async () => {
  const { agentsUnder } = await import('../scripts/claude-skill-inventory.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'architect.md'), '---\nname: architect\ndescription: designs things\n---\n');
  fs.writeFileSync(path.join(root, 'agents', 'notes.txt'), 'ignored');

  const found = agentsUnder(root, 'plug');
  assert.deepEqual(found.map((a) => a.name), ['plug:architect']);
  assert.equal(found[0].kind, 'agent');
  assert.equal(found[0].description, 'designs things');
});

test('every inventory entry declares which kind it is', async () => {
  const { inventory, KINDS } = await import('../scripts/claude-skill-inventory.mjs');
  for (const row of inventory()) {
    for (const entry of row.skills) {
      assert.ok(KINDS.includes(entry.kind), `${entry.name} has kind ${entry.kind}`);
    }
  }
});

test('coverage is broken down per kind', async () => {
  const { coverage, usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const rows = [{
    owner: 'p',
    enabled: true,
    skills: [
      { name: 'p:s1', kind: 'skill' },
      { name: 'p:s2', kind: 'skill' },
      { name: 'p:c1', kind: 'command' },
      { name: 'p:a1', kind: 'agent' },
    ],
  }];
  const stats = coverage(rows, usageBySkill([
    { ts: '2026-09-10T10:00:00Z', name: 'p:s1' },
    { ts: '2026-09-10T10:00:00Z', name: 'p:a1', kind: 'agent' },
  ]));

  assert.deepEqual(stats.perKind.skill, { total: 2, used: 1 });
  assert.deepEqual(stats.perKind.command, { total: 1, used: 0 });
  assert.deepEqual(stats.perKind.agent, { total: 1, used: 1 });
});

test('a used name is classified by where it lives, not by how it was invoked', async () => {
  const { coverage, usageBySkill } = await import('../scripts/claude-skill-inventory.mjs');
  const rows = [{ owner: 'p', enabled: true, skills: [{ name: 'p:thing', kind: 'command' }] }];

  const viaSkillTool = usageBySkill([
    { ts: '2026-09-10T10:00:00Z', event: 'PreToolUse', tool: 'Skill', name: 'p:thing', invocation: 'model' },
  ]);
  assert.equal(
    coverage(rows, viaSkillTool).skills[0].kind,
    'command',
    'Claude exposes plugin commands through the Skill tool; the definition still decides the kind',
  );

  const viaTyping = usageBySkill([
    { ts: '2026-09-10T10:00:00Z', event: 'UserPromptExpansion', name: 'p:thing', invocation: 'user' },
  ]);
  assert.equal(
    coverage(rows, viaTyping).skills[0].kind,
    'command',
    'the same definition classifies the same way however it was reached',
  );
});
