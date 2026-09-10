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
