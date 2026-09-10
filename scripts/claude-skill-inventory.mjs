#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, repoPath, isMain } from './lib/paths.mjs';
import { readLog, DEFAULT_LOG } from './analyze-skill-log.mjs';

const CACHE = path.join(CLAUDE_HOME, 'plugins', 'cache');

export const BUILT_IN = 'built-in';
export const UNCOUNTABLE = '∞';

export function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].trim().replace(/^["']|["']$/g, '');
    } else if (key && /^\s+\S/.test(line)) {
      out[key] += ` ${line.trim()}`;
    }
  }
  return out;
}

export function skillsUnder(root, namespace) {
  const dir = path.join(root, 'skills');
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const stack = [{ dir, parts: [] }];
  while (stack.length > 0) {
    const { dir: current, parts } = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const next = path.join(current, entry.name);
      const skillFile = path.join(next, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const fm = frontmatter(fs.readFileSync(skillFile, 'utf8'));
        const name = [namespace, ...parts, entry.name].filter(Boolean).join(':');
        found.push({ name, kind: 'skill', description: fm.description ?? '', bytes: (fm.description ?? '').length });
      }
      stack.push({ dir: next, parts: [...parts, entry.name] });
    }
  }
  return found;
}

export function agentsUnder(root, namespace) {
  const dir = path.join(root, 'agents');
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fm = frontmatter(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
    const bare = fm.name || entry.name.replace(/\.md$/, '');
    const name = [namespace, bare].filter(Boolean).join(':');
    found.push({ name, kind: 'agent', description: fm.description ?? '', bytes: (fm.description ?? '').length });
  }
  return found;
}

export function commandsUnder(root, namespace) {
  const dir = path.join(root, 'commands');
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const stack = [{ dir, parts: [] }];
  while (stack.length > 0) {
    const { dir: current, parts } = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push({ dir: next, parts: [...parts, entry.name] });
      } else if (entry.name.endsWith('.md')) {
        const fm = frontmatter(fs.readFileSync(next, 'utf8'));
        const name = [namespace, ...parts, entry.name.replace(/\.md$/, '')].filter(Boolean).join(':');
        found.push({ name, kind: 'command', description: fm.description ?? '', bytes: (fm.description ?? '').length });
      }
    }
  }
  return found;
}

export function enabledPlugins(file = path.join(CLAUDE_HOME, 'settings.json')) {
  if (!fs.existsSync(file)) return null;
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    const enabled = settings.enabledPlugins;
    if (!enabled) return null;
    return new Set(
      Object.entries(enabled)
        .filter(([, on]) => on)
        .map(([key]) => key.split('@')[0]),
    );
  } catch {
    return null;
  }
}

export function pluginVersions(cache = CACHE) {
  if (!fs.existsSync(cache)) return [];
  const out = [];
  for (const marketplace of dirs(cache)) {
    for (const plugin of dirs(path.join(cache, marketplace))) {
      const versions = dirs(path.join(cache, marketplace, plugin)).sort(compareVersions);
      const version = versions[versions.length - 1];
      if (!version) continue;
      out.push({ marketplace, plugin, version, root: path.join(cache, marketplace, plugin, version) });
    }
  }
  return out;
}

function dirs(parent) {
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

export function compareVersions(a, b) {
  const numeric = /^\d+(\.\d+)*$/;
  if (numeric.test(a) && numeric.test(b)) {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const diff = (left[i] ?? 0) - (right[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
  if (numeric.test(a)) return 1;
  if (numeric.test(b)) return -1;
  return a.localeCompare(b);
}

export function inventory() {
  const rows = [];
  const enabled = enabledPlugins();

  for (const source of pluginVersions()) {
    rows.push({
      owner: source.plugin,
      kind: 'plugin',
      detail: `${source.marketplace} v${source.version}`,
      enabled: enabled ? enabled.has(source.plugin) : null,
      skills: [
        ...skillsUnder(source.root, source.plugin),
        ...commandsUnder(source.root, source.plugin),
        ...agentsUnder(source.root, source.plugin),
      ],
    });
  }

  const repoRoot = repoPath('tools', 'claude');
  const mine = [...skillsUnder(repoRoot, null), ...commandsUnder(repoRoot, null), ...agentsUnder(repoRoot, null)];
  rows.push({ owner: 'ai-tooling', kind: 'personal-repo', detail: 'this repo', enabled: true, skills: mine });

  const tracked = new Set(mine.map((s) => s.name));
  const global = [...skillsUnder(CLAUDE_HOME, null), ...commandsUnder(CLAUDE_HOME, null), ...agentsUnder(CLAUDE_HOME, null)];
  rows.push({
    owner: 'unmanaged',
    kind: 'personal-global',
    detail: 'in ~/.claude only',
    enabled: true,
    skills: global.filter((s) => !tracked.has(s.name)),
  });

  return rows.filter((r) => r.skills.length > 0);
}

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function stamp(ts) {
  if (typeof ts !== 'string') return '-';
  const when = new Date(ts);
  if (Number.isNaN(when.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

export function nameOf(record) {
  return record?.name ?? record?.skill ?? null;
}

export function usageBySkill(records) {
  const map = new Map();
  for (const record of records) {
    if (record?.event === 'PostToolUse' || record?.event === 'SubagentStop') continue;
    const skill = nameOf(record);
    if (!skill) continue;
    let stat = map.get(skill);
    if (!stat) {
      stat = { skill, kind: record.kind ?? null, count: 0, typed: 0, auto: 0, first: record.ts, last: record.ts };
      map.set(skill, stat);
    }
    if (!stat.kind && record.kind) stat.kind = record.kind;
    stat.count += 1;
    if (record.invocation === 'user') stat.typed += 1;
    else stat.auto += 1;
    if (typeof record.ts === 'string') {
      if (typeof stat.first !== 'string' || record.ts < stat.first) stat.first = record.ts;
      if (typeof stat.last !== 'string' || record.ts > stat.last) stat.last = record.ts;
    }
  }
  return map;
}

export const KINDS = ['skill', 'command', 'agent'];

export function byKind(rows) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const row of rows) {
    for (const entry of row.skills) {
      if (counts[entry.kind] !== undefined) counts[entry.kind] += 1;
    }
  }
  return counts;
}

export function coverage(rows, usage) {
  const available = new Map();
  const kindOf = new Map();
  for (const row of rows) {
    if (row.enabled === false) continue;
    for (const entry of row.skills) {
      available.set(entry.name, row.owner);
      kindOf.set(entry.name, entry.kind);
    }
  }

  const used = [];
  const builtins = [];
  const removed = [];
  for (const [name, stat] of usage) {
    if (available.has(name)) {
      used.push({ ...stat, owner: available.get(name), kind: kindOf.get(name) });
    } else if (name.includes(':')) {
      removed.push({ ...stat, owner: `${name.slice(0, name.indexOf(':'))} (not installed)`, kind: stat.kind ?? 'unknown' });
    } else {
      builtins.push({ ...stat, owner: BUILT_IN, kind: stat.kind ?? 'skill' });
    }
  }

  const perKind = Object.fromEntries(KINDS.map((k) => [k, { total: 0, used: 0 }]));
  for (const kind of kindOf.values()) {
    if (perKind[kind]) perKind[kind].total += 1;
  }
  for (const entry of used) {
    if (perKind[entry.kind]) perKind[entry.kind].used += 1;
  }

  const all = [...used, ...builtins, ...removed]
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
  const stamps = all.map((s) => s.first).filter((t) => typeof t === 'string').sort();
  const lasts = all.map((s) => s.last).filter((t) => typeof t === 'string').sort();

  return {
    total: available.size,
    usedCount: used.length,
    perKind,
    builtins,
    removed,
    skills: all,
    first: stamps[0] ?? null,
    last: lasts[lasts.length - 1] ?? null,
  };
}

export function usedIn(row, usage) {
  return row.skills.filter((s) => usage.has(s.name)).length;
}

function main() {
  const args = process.argv.slice(2);
  const detail = args.includes('--used');
  const asJson = args.includes('--json');
  const logAt = args.indexOf('--log');
  const logFile = logAt >= 0 && args[logAt + 1] && !args[logAt + 1].startsWith('--')
    ? args[logAt + 1]
    : DEFAULT_LOG;

  const rows = inventory();
  const usage = usageBySkill(readLog(logFile));
  const stats = coverage(rows, usage);

  if (asJson) {
    console.log(JSON.stringify({
      log: logFile,
      total: stats.total,
      used: stats.usedCount,
      builtinsUsed: stats.builtins.length,
      removedUsed: stats.removed.length,
      first: stats.first,
      last: stats.last,
      skills: stats.skills,
      owners: rows.filter((r) => r.enabled !== false).map((r) => ({
        owner: r.owner,
        kind: r.kind,
        entries: r.skills.length,
        used: usedIn(r, usage),
        bytes: r.skills.reduce((n, s) => n + s.bytes, 0),
      })),
      cached: rows.filter((r) => r.enabled === false).map((r) => ({
        owner: r.owner,
        entries: r.skills.length,
        detail: r.detail,
      })),
    }, null, 2));
    return;
  }

  if (detail) {
    console.log('Invocations recorded — skills, commands and agents');
    console.log(`  log: ${logFile}`);
    if (stats.skills.length === 0) {
      console.log('  nothing recorded yet.');
      return;
    }
    console.log('');
    const only = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;
    const shown = only ? stats.skills.filter((s) => s.kind === only) : stats.skills;

    if (shown.length === 0) {
      console.log(`  nothing recorded${only ? ` for kind "${only}"` : ''}.`);
      return;
    }

    console.log(table(
      shown.map((s) => [s.count, s.typed, s.auto, s.kind ?? '?', s.skill, s.owner, stamp(s.first), stamp(s.last)]),
      ['n', 'typed', 'auto', 'kind', 'name', 'owner', 'first used', 'last used'],
    ));
    console.log('');
    console.log(`  ${shown.length} distinct invocation target(s). Times are local.`);
    return;
  }

  const invocable = rows.filter((r) => r.enabled !== false);
  const cached = rows.filter((r) => r.enabled === false);

  console.log('Invocation inventory — what can be invoked, and what it costs');
  console.log(`  cache: ${CACHE}`);
  console.log('');

  const count = (row, kind) => row.skills.filter((s) => s.kind === kind).length;

  const totals = invocable
    .map((r) => [
      r.skills.length,
      `${usedIn(r, usage)}/${r.skills.length}`,
      count(r, 'skill'),
      count(r, 'command'),
      count(r, 'agent'),
      `${Math.round(r.skills.reduce((n, s) => n + s.bytes, 0) / 1024 * 10) / 10}kb`,
      r.owner,
      r.detail,
    ])
    .sort((a, b) => b[0] - a[0]);

  totals.push([
    UNCOUNTABLE,
    `${stats.builtins.length}/${UNCOUNTABLE}`,
    UNCOUNTABLE,
    UNCOUNTABLE,
    UNCOUNTABLE,
    '-',
    BUILT_IN,
    'ships with Claude, not enumerable on disk',
  ]);

  console.log(table(totals, ['entries', 'used', 'skills', 'cmds', 'agents', 'desc', 'owner', 'source']));

  const liveCount = invocable.reduce((n, r) => n + r.skills.length, 0);
  const liveBytes = invocable.reduce((n, r) => n + r.skills.reduce((m, s) => m + s.bytes, 0), 0);
  const percent = stats.total === 0 ? 0 : Math.round((stats.usedCount / stats.total) * 100);

  console.log('');
  console.log(`  ${liveCount} installed entries, ~${Math.round(liveBytes / 1024)}kb of descriptions, loaded every session.`);
  if (liveCount !== stats.total) {
    console.log(`  ${stats.total} distinct names: some plugins ship a skill and a same-named command, and both load.`);
  }

  console.log('');
  for (const kind of KINDS) {
    const k = stats.perKind[kind];
    const pct = k.total === 0 ? 0 : Math.round((k.used / k.total) * 100);
    console.log(`  ${`${kind}s`.padEnd(9)} ${k.used} of ${k.total} used (${pct}%)`);
  }
  console.log(`  ${'built-in'.padEnd(9)} ${stats.builtins.length} used, out of a total this tool cannot know`);
  console.log('');
  console.log(`  overall:  ${stats.usedCount} of ${stats.total} installed (${percent}%)`);
  console.log(`  first:    ${stamp(stats.first)}`);
  console.log(`  last:     ${stamp(stats.last)}`);

  if (stats.removed.length > 0) {
    console.log(`  ${stats.removed.length} used skill(s) belong to a plugin that is no longer installed.`);
  }

  if (cached.length > 0) {
    const entries = cached.reduce((n, r) => n + r.skills.length, 0);
    console.log('');
    console.log(`  Not listed above, because they cannot be invoked: ${cached.map((r) => r.owner).join(', ')}`);
    console.log(`  (${entries} entries sitting in the plugin cache, disabled. Remove with /plugin uninstall.)`);
  }

  if (stats.skills.length === 0) {
    console.log('');
    console.log('  No usage recorded yet. Use Claude for a while, then re-run.');
    console.log('  An owner stuck at 0/N over a meaningful window is context you pay for and never spend:');
    console.log('  uninstall it and pull the one or two skills you want in as one-offs.');
  } else {
    const unused = invocable.filter((r) => usedIn(r, usage) === 0).map((r) => r.owner);
    if (unused.length > 0) {
      console.log('');
      console.log(`  Installed but never invoked in this window: ${unused.join(', ')}`);
    }
    console.log('');
    console.log('  Run with --used to list each skill that was actually invoked.');
  }
}

if (isMain(import.meta.url)) main();
export { main };
