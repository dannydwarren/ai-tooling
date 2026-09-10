#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, repoPath, isMain } from '../lib/paths.mjs';
import { readJson, readText } from '../lib/fsx.mjs';
import { placeholdersIn, derivedValues, loadPrivateValues, requiredValueKeys } from '../lib/template.mjs';

const RENDERED_PATHS = [
  'tools/claude/CLAUDE.md',
  'tools/claude/skills',
  'tools/claude/commands',
  'tools/claude/settings/hooks.json',
  'tools/claude/settings/settings.json',
];

const HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'UserPromptExpansion',
  'Notification', 'Stop', 'SubagentStop', 'SubagentStart', 'SessionStart', 'SessionEnd',
  'PreCompact', 'PostCompact', 'PermissionRequest', 'PermissionDenied',
]);

export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function checkSkills(root = REPO_ROOT) {
  const problems = [];
  const dir = path.join(root, 'tools', 'claude', 'skills');
  if (!fs.existsSync(dir)) return problems;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) {
      problems.push(`skills/${entry.name}: missing SKILL.md`);
      continue;
    }
    const fm = parseFrontmatter(readText(file));
    if (!fm) {
      problems.push(`skills/${entry.name}/SKILL.md: missing YAML frontmatter`);
      continue;
    }
    if (!fm.name) problems.push(`skills/${entry.name}/SKILL.md: frontmatter has no name`);
    else if (fm.name !== entry.name) {
      problems.push(`skills/${entry.name}/SKILL.md: frontmatter name "${fm.name}" does not match its directory`);
    }
    if (!fm.description) problems.push(`skills/${entry.name}/SKILL.md: frontmatter has no description`);
  }
  return problems;
}

export function checkCommands(root = REPO_ROOT) {
  const problems = [];
  const dir = path.join(root, 'tools', 'claude', 'commands');
  if (!fs.existsSync(dir)) return problems;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const fm = parseFrontmatter(readText(path.join(dir, file)));
    if (!fm?.description) problems.push(`commands/${file}: frontmatter has no description`);
  }
  return problems;
}

export function checkHookCatalog(root = REPO_ROOT) {
  const problems = [];
  const file = path.join(root, 'tools', 'claude', 'settings', 'hooks.json');
  const catalog = readJson(file, null);
  if (!catalog) return ['tools/claude/settings/hooks.json: missing'];

  const seen = new Set();
  for (const entry of catalog.hooks ?? []) {
    const id = entry.id ?? '(unnamed)';
    if (!entry.id) problems.push('hooks.json: an entry has no id');
    if (seen.has(entry.id)) problems.push(`hooks.json: duplicate id "${entry.id}"`);
    seen.add(entry.id);
    if (typeof entry.enabled !== 'boolean') problems.push(`hooks.json[${id}]: enabled must be a boolean`);
    if (!entry.description) problems.push(`hooks.json[${id}]: missing description`);
    if (!HOOK_EVENTS.has(entry.event)) problems.push(`hooks.json[${id}]: unknown event "${entry.event}"`);
    if (entry.hook?.type !== 'command') problems.push(`hooks.json[${id}]: hook.type must be "command"`);

    const command = entry.hook?.command ?? '';
    const script = /hooks\/([A-Za-z0-9._-]+\.mjs)/.exec(command);
    if (!script) {
      problems.push(`hooks.json[${id}]: command does not reference a hook script in this repo`);
    } else if (!fs.existsSync(path.join(root, 'tools', 'claude', 'hooks', script[1]))) {
      problems.push(`hooks.json[${id}]: command references missing script ${script[1]}`);
    }
  }
  return problems;
}

export function checkPlaceholders(root = REPO_ROOT) {
  const problems = [];
  const known = new Set([
    ...Object.keys(derivedValues()),
    ...Object.keys(requiredValueKeys()),
    ...Object.keys(loadPrivateValues()),
  ]);
  const stack = RENDERED_PATHS.map((rel) => path.join(root, rel));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    if (fs.statSync(current).isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
      continue;
    }
    if (!/\.(md|json)$/.test(current)) continue;
    for (const key of placeholdersIn(readText(current))) {
      if (!known.has(key)) {
        problems.push(`${path.relative(root, current).split(path.sep).join('/')}: unknown placeholder {{${key}}} (not derived, not declared in security/required-values.json)`);
      }
    }
  }
  return problems;
}

export function checkPluginManifest(root = REPO_ROOT) {
  const problems = [];
  const marketplace = readJson(path.join(root, '.claude-plugin', 'marketplace.json'), null);
  if (!marketplace) return ['.claude-plugin/marketplace.json: missing'];
  for (const plugin of marketplace.plugins ?? []) {
    const source = plugin.source ?? '';
    if (!source.startsWith('./')) continue;
    const pluginDir = path.join(root, source);
    if (!fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'))) {
      problems.push(`marketplace.json: plugin "${plugin.name}" source ${source} has no .claude-plugin/plugin.json`);
    }
  }
  return problems;
}

export function validate(root = REPO_ROOT) {
  return [
    ...checkSkills(root),
    ...checkCommands(root),
    ...checkHookCatalog(root),
    ...checkPlaceholders(root),
    ...checkPluginManifest(root),
  ];
}

function main() {
  const problems = validate();
  console.log('assets: skills, commands, hook catalog, placeholders, plugin manifest');
  for (const p of problems) console.error(`  ! ${p}`);
  if (problems.length === 0) console.log('  ok');
  else process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main, repoPath };
