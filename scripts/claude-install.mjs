#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, REPO_ROOT, VALUES_FILE, repoPath, isMain, toSlash } from './lib/paths.mjs';
import { loadValues, render, renderDeep, placeholdersIn, requiredValueKeys } from './lib/template.mjs';
import { relFiles, readText, writeText, readJson, writeJson, backup, sameText } from './lib/fsx.mjs';

const SOURCE = repoPath('tools', 'claude');
const HOOKS_DIR = toSlash(path.join(SOURCE, 'hooks')).toLowerCase();

const CONTENT = [
  { from: 'CLAUDE.md', to: 'CLAUDE.md', kind: 'file' },
  { from: 'skills', to: 'skills', kind: 'dir' },
  { from: 'commands', to: 'commands', kind: 'dir' },
];

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
    uninstall: argv.includes('--uninstall'),
    verbose: argv.includes('--verbose'),
  };
}

export function plannedContent(values) {
  const planned = [];
  for (const item of CONTENT) {
    const src = path.join(SOURCE, item.from);
    if (!fs.existsSync(src)) continue;
    const rels = item.kind === 'dir' ? relFiles(src) : [''];
    for (const rel of rels) {
      const srcFile = rel ? path.join(src, rel) : src;
      const destFile = rel ? path.join(CLAUDE_HOME, item.to, rel) : path.join(CLAUDE_HOME, item.to);
      const raw = readText(srcFile);
      const { text, missing } = render(raw, values);
      planned.push({ srcFile, destFile, text, missing });
    }
  }
  return planned;
}

export function catalogEntries() {
  const catalog = readJson(path.join(SOURCE, 'settings', 'hooks.json'), { hooks: [] });
  return catalog.hooks ?? [];
}

export function isManagedCommand(command, hooksDir = HOOKS_DIR) {
  if (typeof command !== 'string') return false;
  return toSlash(command).toLowerCase().includes(`${hooksDir}/`);
}

export function stripManaged(hooks, hooksDir = HOOKS_DIR) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }

    const kept = [];
    for (const group of groups) {
      const inner = group?.hooks;
      if (!Array.isArray(inner)) {
        kept.push(group);
        continue;
      }
      if (!inner.some((h) => isManagedCommand(h?.command, hooksDir))) {
        kept.push(group);
        continue;
      }
      const remaining = inner.filter((h) => !isManagedCommand(h?.command, hooksDir));
      if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    }

    if (kept.length > 0 || groups.length === 0) out[event] = kept;
  }
  return out;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function addManaged(hooks, entries, values) {
  const out = JSON.parse(JSON.stringify(hooks ?? {}));
  const applied = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const rendered = renderDeep(entry.hook, values);
    if (rendered.missing.length > 0) {
      throw new Error(`Hook "${entry.id}" has unresolved placeholders: ${rendered.missing.join(', ')}`);
    }
    const hook = rendered.value;
    out[entry.event] ??= [];
    const matcher = entry.matcher;
    let group = out[entry.event].find((g) => (g.matcher ?? null) === (matcher ?? null));
    if (!group) {
      group = matcher ? { matcher, hooks: [] } : { hooks: [] };
      out[entry.event].push(group);
    }
    group.hooks ??= [];
    group.hooks.push(hook);
    applied.push(entry.id);
  }
  return { hooks: out, applied };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const values = loadValues();
  const settingsFile = path.join(CLAUDE_HOME, 'settings.json');

  const problems = [];
  const changes = [];

  let settings;
  try {
    settings = readJson(settingsFile, {});
  } catch (err) {
    console.error(`ai-tooling claude ${args.check ? 'check' : 'install'}`);
    console.error(`  ! ${err.message}`);
    console.error('  Nothing was written. Fix or move that file and run again.');
    console.error('  A UTF-8 BOM is handled automatically; a trailing comma or truncated write is not.');
    process.exit(1);
  }

  const missingValues = new Set();
  const planned = plannedContent(values);
  for (const item of planned) item.missing.forEach((m) => missingValues.add(m));

  if (missingValues.size > 0) {
    const described = requiredValueKeys();
    const lines = [...missingValues].map((key) => `      "${key}": ""   ${described[key] ? `// ${described[key]}` : ''}`);
    problems.push(
      `Unresolved placeholders: ${[...missingValues].join(', ')}\n` +
      `  Nothing was written. Define them in ${VALUES_FILE}:\n${lines.join('\n')}\n` +
      '  See docs/install.md.',
    );
  }

  for (const item of planned) {
    if (args.uninstall) break;
    const exists = fs.existsSync(item.destFile);
    const current = exists ? readText(item.destFile) : null;
    if (!exists || !sameText(current, item.text)) {
      changes.push(`${exists ? 'update' : 'create'} ${item.destFile}`);
      if (!args.check && missingValues.size === 0) writeText(item.destFile, item.text);
    }
  }

  const before = canonical(settings.hooks ?? {});
  const stripped = stripManaged(settings.hooks);
  let nextHooks = stripped;
  let applied = [];
  if (!args.uninstall) {
    const result = addManaged(stripped, catalogEntries(), values);
    nextHooks = result.hooks;
    applied = result.applied;
  }
  const after = canonical(nextHooks);

  if (before !== after) {
    changes.push(
      args.uninstall
        ? `remove managed hooks from ${settingsFile}`
        : `set managed hooks [${applied.join(', ')}] in ${settingsFile}`,
    );
    if (!args.check && missingValues.size === 0) {
      const saved = backup(settingsFile);
      const next = { ...settings };
      if (Object.keys(nextHooks).length > 0) next.hooks = nextHooks;
      else delete next.hooks;
      writeJson(settingsFile, next);
      if (saved) changes.push(`backed up previous settings to ${saved}`);
    }
  }

  const label = args.uninstall ? 'uninstall' : args.check ? 'check' : 'install';
  console.log(`ai-tooling claude ${label}`);
  console.log(`  repo:   ${REPO_ROOT}`);
  console.log(`  claude: ${CLAUDE_HOME}`);
  console.log(`  values: ${fs.existsSync(VALUES_FILE) ? VALUES_FILE : `${VALUES_FILE} (absent)`}`);

  for (const problem of problems) console.error(`  ! ${problem}`);

  if (problems.length > 0) {
    console.error(`  ${changes.length} pending change(s) withheld until the values above are defined.`);
  } else if (changes.length === 0) {
    console.log('  up to date, nothing to do');
  } else {
    for (const change of changes) console.log(`  ${args.check ? 'would ' : ''}${change}`);
  }

  if (problems.length > 0) process.exit(1);
  if (args.check && changes.length > 0) process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main, placeholdersIn };
