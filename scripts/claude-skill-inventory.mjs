#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, repoPath, isMain } from './lib/paths.mjs';
import { readLog, DEFAULT_LOG } from './analyze-skill-log.mjs';

const CACHE = path.join(CLAUDE_HOME, 'plugins', 'cache');

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
        found.push({ name, description: fm.description ?? '', bytes: (fm.description ?? '').length });
      }
      stack.push({ dir: next, parts: [...parts, entry.name] });
    }
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
        found.push({ name, description: fm.description ?? '', bytes: (fm.description ?? '').length });
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
      skills: [...skillsUnder(source.root, source.plugin), ...commandsUnder(source.root, source.plugin)],
    });
  }

  const repoRoot = repoPath('tools', 'claude');
  const mine = [...skillsUnder(repoRoot, null), ...commandsUnder(repoRoot, null)];
  rows.push({ owner: 'ai-tooling', kind: 'personal-repo', detail: 'this repo', enabled: true, skills: mine });

  const tracked = new Set(mine.map((s) => s.name));
  const global = [...skillsUnder(CLAUDE_HOME, null), ...commandsUnder(CLAUDE_HOME, null)];
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

export function usageBySkill(records) {
  const map = new Map();
  for (const record of records) {
    if (record?.event === 'PostToolUse') continue;
    const skill = record?.skill;
    if (!skill) continue;
    let stat = map.get(skill);
    if (!stat) {
      stat = { skill, count: 0, typed: 0, auto: 0, first: record.ts, last: record.ts };
      map.set(skill, stat);
    }
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

export function coverage(rows, usage) {
  const available = new Map();
  for (const row of rows) {
    if (row.enabled === false) continue;
    for (const skill of row.skills) available.set(skill.name, row.owner);
  }

  const used = [];
  const untracked = [];
  for (const [name, stat] of usage) {
    if (available.has(name)) used.push({ ...stat, owner: available.get(name) });
    else untracked.push({ ...stat, owner: 'built-in or removed' });
  }

  const all = [...used, ...untracked].sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
  const stamps = all.map((s) => s.first).filter((t) => typeof t === 'string').sort();
  const lasts = all.map((s) => s.last).filter((t) => typeof t === 'string').sort();

  return {
    total: available.size,
    usedCount: used.length,
    untracked,
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
      first: stats.first,
      last: stats.last,
      skills: stats.skills,
      owners: rows.map((r) => ({
        owner: r.owner,
        kind: r.kind,
        enabled: r.enabled,
        entries: r.skills.length,
        used: usedIn(r, usage),
        bytes: r.skills.reduce((n, s) => n + s.bytes, 0),
      })),
    }, null, 2));
    return;
  }

  if (detail) {
    console.log('Skills actually used');
    console.log(`  log: ${logFile}`);
    if (stats.skills.length === 0) {
      console.log('  nothing recorded yet.');
      return;
    }
    console.log('');
    console.log(table(
      stats.skills.map((s) => [s.count, s.typed, s.auto, s.skill, s.owner, stamp(s.first), stamp(s.last)]),
      ['n', 'typed', 'auto', 'skill', 'owner', 'first used', 'last used'],
    ));
    console.log('');
    console.log(`  ${stats.skills.length} distinct skill(s) used. Times are local.`);
    return;
  }

  console.log('Skill inventory — what is loaded into every session');
  console.log(`  cache: ${CACHE}`);
  console.log('');

  const totals = rows
    .map((r) => [
      r.skills.length,
      `${usedIn(r, usage)}/${r.skills.length}`,
      `${Math.round(r.skills.reduce((n, s) => n + s.bytes, 0) / 1024 * 10) / 10}kb`,
      r.owner,
      r.enabled === false ? 'no' : 'yes',
      r.detail,
    ])
    .sort((a, b) => b[0] - a[0]);

  console.log(table(totals, ['entries', 'used', 'desc', 'owner', 'on?', 'source']));

  const live = rows.filter((r) => r.enabled !== false);
  const liveCount = live.reduce((n, r) => n + r.skills.length, 0);
  const liveBytes = live.reduce((n, r) => n + r.skills.reduce((m, s) => m + s.bytes, 0), 0);
  const cachedOnly = rows.filter((r) => r.enabled === false);

  const percent = stats.total === 0 ? 0 : Math.round((stats.usedCount / stats.total) * 100);

  console.log('');
  console.log(`  ${liveCount} skills and commands, ~${Math.round(liveBytes / 1024)}kb of descriptions, loaded every session.`);
  if (cachedOnly.length > 0) {
    console.log(`  ${cachedOnly.map((r) => r.owner).join(', ')} are cached but disabled, so they cost nothing today.`);
  }

  console.log('');
  console.log(`  used:  ${stats.usedCount} of ${stats.total} distinct enabled skills (${percent}%)`);
  console.log(`  first: ${stamp(stats.first)}`);
  console.log(`  last:  ${stamp(stats.last)}`);
  if (stats.untracked.length > 0) {
    console.log(`  plus ${stats.untracked.length} used but not in the inventory (built-in, or since removed).`);
  }
  if (liveCount !== stats.total) {
    console.log(`  (${liveCount} entries but ${stats.total} distinct names: some plugins ship a skill and a same-named command, and both load.)`);
  }

  if (stats.skills.length === 0) {
    console.log('');
    console.log('  No usage recorded yet. Use Claude for a while, then re-run.');
    console.log('  An owner stuck at 0/N over a meaningful window is context you pay for and never spend:');
    console.log('  uninstall it and pull the one or two skills you want in as one-offs.');
  } else {
    const unused = rows.filter((r) => r.enabled !== false && usedIn(r, usage) === 0).map((r) => r.owner);
    if (unused.length > 0) {
      console.log('');
      console.log(`  Enabled but never invoked in this window: ${unused.join(', ')}`);
    }
    console.log('');
    console.log('  Run with --used to list each skill that was actually invoked.');
  }
}

if (isMain(import.meta.url)) main();
export { main };
