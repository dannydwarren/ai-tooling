#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, REPO_ROOT, USER_HOME, VALUES_FILE, repoPath, isMain } from './lib/paths.mjs';
import { loadValues, loadPrivateValues, derivedValues, unrender } from './lib/template.mjs';
import { relFiles, readText, writeText, sameText } from './lib/fsx.mjs';
import { stripManaged } from './claude-install.mjs';

const TARGET = repoPath('tools', 'claude');

const CONTENT = [
  { from: 'CLAUDE.md', to: 'CLAUDE.md', kind: 'file' },
  { from: 'skills', to: 'skills', kind: 'dir' },
  { from: 'commands', to: 'commands', kind: 'dir' },
  { from: 'settings.json', to: path.join('settings', 'settings.json'), kind: 'file', transform: withoutManagedHooks },
];

export function withoutManagedHooks(text) {
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    return text;
  }
  if (!settings || typeof settings !== 'object' || !settings.hooks) return text;

  const kept = stripManaged(settings.hooks);
  const next = { ...settings };
  if (Object.keys(kept).length > 0) next.hooks = kept;
  else delete next.hooks;
  return `${JSON.stringify(next, null, 2)}\n`;
}

export function templateKeys() {
  return [...Object.keys(loadPrivateValues()), ...Object.keys(derivedValues())];
}

export const WORKSPACE_CLAUDE_MD = process.env.AI_TOOLING_WORKSPACE_CLAUDE_MD
  ?? path.join(path.dirname(REPO_ROOT), 'CLAUDE.md');

export function mcpServers(file = path.join(USER_HOME, '.claude.json')) {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const servers = parsed?.mcpServers;
    if (!servers || Object.keys(servers).length === 0) return null;
    return servers;
  } catch {
    return null;
  }
}

export function mcpBackup(servers) {
  return {
    note: 'Backup of the mcpServers block from ~/.claude.json, captured by scripts/claude-capture.mjs. This is NOT installed automatically: ~/.claude.json is large and stateful, so restore it by hand or with `claude mcp add`. Placeholders are rendered from ~/.ai-tooling/values.json. Servers whose config contained an inline credential are omitted, not redacted.',
    mcpServers: servers,
  };
}

export function hasInlineSecret(server) {
  const env = server?.env ?? {};
  return Object.values(env).some((v) => typeof v === 'string' && v.trim().length > 0);
}

export function plan() {
  const values = loadValues();
  const keys = templateKeys();
  const items = [];

  const servers = mcpServers();
  if (servers) {
    const safe = {};
    const skipped = [];
    for (const [name, config] of Object.entries(servers)) {
      if (hasInlineSecret(config)) skipped.push(name);
      else safe[name] = config;
    }
    const backup = mcpBackup(safe);
    if (skipped.length > 0) backup.omitted = skipped;
    items.push({
      srcFile: path.join(USER_HOME, '.claude.json'),
      destFile: path.join(TARGET, 'settings', 'mcp-servers.json'),
      text: unrender(`${JSON.stringify(backup, null, 2)}\n`, values, keys),
    });
  }

  if (fs.existsSync(WORKSPACE_CLAUDE_MD)) {
    const header = [
      '<!--',
      'Backup of the workspace-level CLAUDE.md that sits alongside this checkout and applies to',
      'every repo under it. Captured by scripts/claude-capture.mjs. NOT installed automatically:',
      'it lives outside ~/.claude and outside this repo, so restoring it is a deliberate copy.',
      '-->',
      '',
    ].join('\n');
    items.push({
      srcFile: WORKSPACE_CLAUDE_MD,
      destFile: path.join(TARGET, 'workspace-CLAUDE.md'),
      text: unrender(header + readText(WORKSPACE_CLAUDE_MD), values, keys),
    });
  }

  for (const item of CONTENT) {
    const src = path.join(CLAUDE_HOME, item.from);
    if (!fs.existsSync(src)) continue;
    const rels = item.kind === 'dir' ? relFiles(src) : [''];
    for (const rel of rels) {
      const srcFile = rel ? path.join(src, rel) : src;
      const destFile = rel ? path.join(TARGET, item.to, rel) : path.join(TARGET, item.to);
      const raw = item.transform ? item.transform(readText(srcFile)) : readText(srcFile);
      items.push({ srcFile, destFile, text: unrender(raw, values, keys) });
    }
  }
  return items;
}

function main() {
  const check = process.argv.includes('--check');
  const items = plan();
  const changes = [];

  for (const item of items) {
    const exists = fs.existsSync(item.destFile);
    const current = exists ? readText(item.destFile) : null;
    if (!exists || !sameText(current, item.text)) {
      changes.push(`${exists ? 'update' : 'create'} ${path.relative(REPO_ROOT, item.destFile)}`);
      if (!check) writeText(item.destFile, item.text);
    }
  }

  console.log(`ai-tooling claude capture${check ? ' (check)' : ''}`);
  console.log(`  claude: ${CLAUDE_HOME}`);
  console.log(`  values: ${fs.existsSync(VALUES_FILE) ? VALUES_FILE : `${VALUES_FILE} (absent)`}`);
  if (changes.length === 0) console.log('  repo already matches the machine');
  else for (const change of changes) console.log(`  ${check ? 'would ' : ''}${change}`);

  if (check && changes.length > 0) process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main };
