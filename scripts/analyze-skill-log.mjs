#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, repoPath, isMain } from './lib/paths.mjs';

export const DEFAULT_LOG = repoPath('tmp', 'logs', 'skill-audit.jsonl');

export function readLog(file = DEFAULT_LOG) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function namesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''));
}

export function repoSkills() {
  return new Set([
    ...namesIn(repoPath('tools', 'claude', 'skills')),
    ...namesIn(repoPath('tools', 'claude', 'commands')),
  ]);
}

export function globalSkills() {
  return new Set([
    ...namesIn(path.join(CLAUDE_HOME, 'skills')),
    ...namesIn(path.join(CLAUDE_HOME, 'commands')),
  ]);
}

export function pluginNameOf(key) {
  const at = String(key).lastIndexOf('@');
  return at > 0 ? key.slice(0, at) : String(key);
}

export function parseInstalledPlugins(data) {
  const plugins = data?.plugins;
  if (!plugins || typeof plugins !== 'object') return [];
  return [...new Set(Object.keys(plugins).map(pluginNameOf))].sort();
}

export function installedPlugins() {
  const file = path.join(CLAUDE_HOME, 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(file)) return [];
  try {
    return parseInstalledPlugins(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

export function classify(skill, { inRepo, inGlobal }) {
  if (!skill) return { source: 'unknown', owner: null };
  if (skill.includes(':')) return { source: 'plugin', owner: skill.slice(0, skill.indexOf(':')) };
  if (inRepo.has(skill)) return { source: 'personal-repo', owner: 'ai-tooling' };
  if (inGlobal.has(skill)) return { source: 'personal-global', owner: 'unmanaged' };
  return { source: 'built-in', owner: 'claude' };
}

export function classifyRecord(record, context) {
  if (record?.kind === 'agent') return { source: 'agent', owner: agentOwner(record) };
  if (record?.expansion_type === 'mcp_prompt') return { source: 'mcp-prompt', owner: 'mcp' };
  return classify(record?.name ?? record?.skill ?? null, context);
}

function agentOwner(record) {
  const name = record?.name ?? record?.skill ?? '';
  return name.includes(':') ? name.slice(0, name.indexOf(':')) : 'claude';
}

export function aggregate(records, context) {
  const bySkill = new Map();
  for (const record of records) {
    if (record.event === 'PostToolUse' || record.event === 'SubagentStop') continue;
    const skill = record.name ?? record.skill ?? '(unresolved)';
    let stat = bySkill.get(skill);
    if (!stat) {
      stat = {
        skill, count: 0, typed: 0, auto: 0,
        first: record.ts, last: record.ts, projects: new Set(),
        ...classifyRecord(record, context),
      };
      bySkill.set(skill, stat);
    }
    stat.count += 1;
    if (record.invocation === 'user') stat.typed += 1;
    else stat.auto += 1;
    if (record.ts < stat.first) stat.first = record.ts;
    if (record.ts > stat.last) stat.last = record.ts;
    if (record.project) stat.projects.add(record.project);
  }
  return [...bySkill.values()].sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
}

export function rollup(stats, key) {
  const map = new Map();
  for (const stat of stats) {
    const bucket = stat[key] ?? 'unknown';
    const current = map.get(bucket) ?? { bucket, invocations: 0, skills: 0 };
    current.invocations += stat.count;
    current.skills += 1;
    map.set(bucket, current);
  }
  return [...map.values()].sort((a, b) => b.invocations - a.invocations);
}

export function unusedPlugins(stats, installed) {
  const used = new Set(stats.filter((s) => s.source === 'plugin').map((s) => s.owner));
  return installed.filter((name) => !used.has(name)).sort();
}

export function auditHooksInstalled() {
  const file = path.join(CLAUDE_HOME, 'settings.json');
  if (!fs.existsSync(file)) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    return JSON.stringify(settings.hooks ?? {}).includes('skill-audit.mjs');
  } catch {
    return false;
  }
}

function day(ts) {
  return typeof ts === 'string' ? ts.slice(0, 10) : '?';
}

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    if (at < 0) return null;
    const next = args[at + 1];
    if (next === undefined || next.startsWith('--')) {
      console.error(`  ! ${flag} needs a value. Ignoring it.`);
      return null;
    }
    return next;
  };

  const rawTop = valueOf('--top');
  let top = Infinity;
  if (rawTop !== null) {
    const parsed = Number(rawTop);
    if (!Number.isFinite(parsed) || parsed < 1) console.error(`  ! --top ${rawTop} is not a positive number. Ignoring it.`);
    else top = Math.floor(parsed);
  }

  const since = valueOf('--since');
  const logFile = valueOf('--log') ?? DEFAULT_LOG;

  let records = readLog(logFile);
  if (since) records = records.filter((r) => typeof r.ts === 'string' && r.ts >= since);

  const context = { inRepo: repoSkills(), inGlobal: globalSkills() };
  const stats = aggregate(records, context);
  const installed = installedPlugins();

  if (asJson) {
    console.log(JSON.stringify({
      log: logFile,
      records: records.length,
      skills: stats.map((s) => ({ ...s, projects: [...s.projects] })),
      bySource: rollup(stats, 'source'),
      byOwner: rollup(stats, 'owner'),
      unusedPlugins: unusedPlugins(stats, installed),
    }, null, 2));
    return;
  }

  console.log('Skill usage report');
  console.log(`  log:     ${logFile}`);
  if (records.length === 0) {
    console.log('  no invocations recorded yet.');
    if (auditHooksInstalled()) {
      console.log('  The audit hooks are installed. Use Claude normally and re-run this.');
      console.log('  If nothing appears, restart Claude Code so it re-reads settings.json.');
    } else {
      console.log('  The audit hooks are NOT installed. Run: npm run claude:install');
    }
    return;
  }
  console.log(`  records: ${records.length} invocation(s) of ${stats.length} distinct skill(s)`);
  console.log(`  window:  ${day(records[0].ts)} to ${day(records[records.length - 1].ts)}`);

  console.log('\nBy skill  (typed = you invoked it, auto = the model chose it)');
  console.log(table(
    stats.slice(0, top).map((s) => [s.count, s.typed, s.auto, s.skill, s.source, [...s.projects].join(',') || '-', day(s.first), day(s.last)]),
    ['n', 'typed', 'auto', 'skill', 'source', 'projects', 'first', 'last'],
  ));

  console.log('\nBy source');
  console.log(table(rollup(stats, 'source').map((r) => [r.invocations, r.skills, r.bucket]), ['n', 'skills', 'source']));

  console.log('\nBy plugin / owner');
  console.log(table(rollup(stats, 'owner').map((r) => [r.invocations, r.skills, r.bucket]), ['n', 'skills', 'owner']));

  const candidates = stats.filter((s) => s.source === 'personal-global');
  if (candidates.length > 0) {
    console.log('\nExtraction candidates (personal skills used but not yet tracked in this repo)');
    for (const c of candidates) console.log(`  ${c.skill} (${c.count} use(s)) -> run: npm run claude:capture`);
  }

  const unused = unusedPlugins(stats, installed);
  if (unused.length > 0) {
    console.log('\nInstalled plugins with no recorded skill invocations in this window');
    for (const name of unused) console.log(`  ${name}`);
    console.log('  Candidates for uninstalling and pulling in as one-offs when actually needed.');
  }
}

if (isMain(import.meta.url)) main();
export { main };
