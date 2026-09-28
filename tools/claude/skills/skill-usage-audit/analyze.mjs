#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const PROJECTS = path.join(CLAUDE, 'projects');
const PLUGINS = path.join(CLAUDE, 'plugins');

const BUILTIN = new Set([
  'artifact-design', 'artifact-diagramming', 'artifact-capabilities', 'dataviz', 'design',
  'code-review', 'simplify', 'run', 'init', 'security-review', 'update-config',
  'keybindings-help', 'fewer-permission-prompts', 'loop', 'schedule', 'claude-api',
]);

const CLI_COMMANDS = new Set([
  'plugin', 'mcp', 'clear', 'model', 'memory', 'reload-plugins', 'reload-skills',
  'compact', 'config', 'help', 'login', 'logout', 'cost', 'doctor', 'status', 'fast',
]);

function parseArgs(argv) {
  const o = { days: null, project: null, json: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') o.days = Number(argv[++i]);
    else if (a === '--project') o.project = argv[++i];
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--quiet') o.quiet = true;
  }
  return o;
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function statOr(p) { try { return fs.statSync(p); } catch { return null; } }

function walkFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function dirSize(dir) {
  let total = 0;
  for (const f of walkFiles(dir)) { const s = statOr(f); if (s) total += s.size; }
  return total;
}

function frontMatterDescription(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 4);
  if (end === -1) return '';
  const fm = text.slice(4, end);
  const m = fm.match(/^description:\s*(.*)$/mi);
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '').slice(0, 240);
}

function addEntry(catalog, entry) {
  const key = `${entry.source}|${entry.id}`;
  const prev = catalog.get(key);
  if (prev && prev.mtimeMs >= entry.mtimeMs) return;
  catalog.set(key, entry);
}

function catalogSkillDir(catalog, skillsRoot, source, idPrefix, installedAt) {
  if (!exists(skillsRoot)) return;
  let entries;
  try { entries = fs.readdirSync(skillsRoot, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const root = path.join(skillsRoot, e.name);
    const md = path.join(root, 'SKILL.md');
    const st = statOr(md);
    if (!st) continue;
    addEntry(catalog, {
      id: idPrefix ? `${idPrefix}:${e.name}` : e.name,
      kind: 'skill', source, path: root,
      sizeBytes: dirSize(root), mtimeMs: st.mtimeMs, installedAt: installedAt ?? null,
      description: frontMatterDescription(md),
    });
  }
}

function catalogCommandDir(catalog, commandsRoot, source, idPrefix, installedAt) {
  if (!exists(commandsRoot)) return;
  for (const f of walkFiles(commandsRoot)) {
    if (!f.endsWith('.md')) continue;
    const rel = path.relative(commandsRoot, f).replace(/\.md$/, '');
    const parts = rel.split(/[\\/]/);
    const st = statOr(f);
    if (!st) continue;
    addEntry(catalog, {
      id: [idPrefix, ...parts].filter(Boolean).join(':'),
      kind: 'command', source, path: f,
      sizeBytes: st.size, mtimeMs: st.mtimeMs, installedAt: installedAt ?? null,
      description: frontMatterDescription(f),
    });
  }
}

function buildBaseCatalog() {
  const catalog = new Map();
  const installedPlugins = [];

  const ipPath = path.join(PLUGINS, 'installed_plugins.json');
  if (exists(ipPath)) {
    let ip;
    try { ip = JSON.parse(fs.readFileSync(ipPath, 'utf8')); } catch { ip = null; }
    for (const [key, arr] of Object.entries(ip?.plugins ?? {})) {
      const pluginName = key.split('@')[0];
      for (const inst of arr ?? []) {
        const root = inst.installPath;
        if (!root || !exists(root)) continue;
        installedPlugins.push({ plugin: pluginName, version: inst.version, scope: inst.scope, path: root, installedAt: inst.installedAt ?? null });
        catalogSkillDir(catalog, path.join(root, 'skills'), `plugin:${pluginName}`, pluginName, inst.installedAt);
        catalogCommandDir(catalog, path.join(root, 'commands'), `plugin:${pluginName}`, pluginName, inst.installedAt);
      }
    }
  }

  catalogSkillDir(catalog, path.join(CLAUDE, 'skills'), 'user', '');
  catalogCommandDir(catalog, path.join(CLAUDE, 'commands'), 'user', '');
  return { catalog, installedPlugins };
}

function addProjectCatalog(catalog, cwds) {
  const seen = new Set();
  const homeReal = path.resolve(HOME).toLowerCase();
  for (const cwd of cwds) {
    if (path.resolve(cwd).toLowerCase() === homeReal) continue;
    const base = path.basename(cwd);
    const skills = path.join(cwd, '.claude', 'skills');
    const cmds = path.join(cwd, '.claude', 'commands');
    if (!seen.has(skills)) { seen.add(skills); catalogSkillDir(catalog, skills, `project:${base}`, ''); }
    if (!seen.has(cmds)) { seen.add(cmds); catalogCommandDir(catalog, cmds, `project:${base}`, ''); }
  }
}

function newUsage(name) {
  return {
    name, count: 0, viaSkillTool: 0, viaSlash: 0, inSubagent: 0,
    sessions: new Set(), projects: new Map(), months: new Map(),
    first: null, last: null,
  };
}

function recordUsage(usage, name, ts, session, cwd, isSub, via) {
  let u = usage.get(name);
  if (!u) { u = newUsage(name); usage.set(name, u); }
  u.count++;
  if (via === 'slash') u.viaSlash++; else u.viaSkillTool++;
  if (isSub) u.inSubagent++;
  if (session) u.sessions.add(session);
  if (cwd) u.projects.set(cwd, (u.projects.get(cwd) ?? 0) + 1);
  if (ts) {
    const mo = ts.slice(0, 7);
    u.months.set(mo, (u.months.get(mo) ?? 0) + 1);
    if (!u.first || ts < u.first) u.first = ts;
    if (!u.last || ts > u.last) u.last = ts;
  }
}

const SLASH_RE = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/g;

async function scanTranscripts(opts) {
  const usage = new Map();
  const cwds = new Set();
  const sessions = new Set();
  let files = 0, lines = 0, events = 0, earliest = null, latest = null;
  let coverFrom = null, coverTo = null;

  const sinceTs = opts.days
    ? new Date(Date.now() - opts.days * 86400000).toISOString()
    : null;

  const jsonlFiles = walkFiles(PROJECTS).filter(f => f.endsWith('.jsonl'));

  for (const file of jsonlFiles) {
    const rel = path.relative(PROJECTS, file);
    const projectDir = rel.split(/[\\/]/)[0];
    if (opts.project && !projectDir.toLowerCase().includes(opts.project.toLowerCase())) continue;
    const isSubagentFile = /[\\/]subagents[\\/]/.test(rel);
    files++;

    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    let firstLine = null, lastLine = null;

    for await (const line of rl) {
      if (!line) continue;
      lines++;
      if (!firstLine) firstLine = line;
      lastLine = line;
      const hasSkill = line.includes('"Skill"');
      const hasSlash = line.includes('<command-name>');
      if (!hasSkill && !hasSlash) continue;

      let evt;
      try { evt = JSON.parse(line); } catch { continue; }

      const ts = evt.timestamp ?? null;
      if (sinceTs && ts && ts < sinceTs) continue;
      if (ts) {
        if (!earliest || ts < earliest) earliest = ts;
        if (!latest || ts > latest) latest = ts;
      }

      const session = evt.sessionId ?? null;
      if (session) sessions.add(session);
      const cwd = evt.cwd ?? null;
      if (cwd) cwds.add(cwd);
      const isSub = isSubagentFile || evt.isSidechain === true;

      const msg = evt.message ?? {};
      const content = msg.content;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'tool_use' && block.name === 'Skill') {
            const name = block.input?.skill;
            if (name) { recordUsage(usage, String(name), ts, session, cwd, isSub, 'tool'); events++; }
          }
        }
      }

      if (msg.role === 'user') {
        let text = '';
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content)) {
          for (const b of content) if (b && b.type === 'text') text += b.text ?? '';
        }
        if (text.includes('<command-name>')) {
          SLASH_RE.lastIndex = 0;
          let m;
          while ((m = SLASH_RE.exec(text))) {
            const name = m[1];
            if (CLI_COMMANDS.has(name)) continue;
            recordUsage(usage, name, ts, session, cwd, isSub, 'slash');
            events++;
          }
        }
      }
    }

    for (const raw of [firstLine, lastLine]) {
      if (!raw) continue;
      let e;
      try { e = JSON.parse(raw); } catch { continue; }
      const t = e.timestamp;
      if (!t) continue;
      if (!coverFrom || t < coverFrom) coverFrom = t;
      if (!coverTo || t > coverTo) coverTo = t;
    }
  }

  return { usage, cwds, sessions, stats: { files, lines, events, earliest, latest, coverFrom, coverTo, totalFiles: jsonlFiles.length } };
}

function buildIndex(catalog) {
  const byId = new Map();
  for (const entry of catalog.values()) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }
  return byId;
}

function resolve(name, byId, dominantCwd) {
  const exact = byId.get(name);
  if (exact?.length) {
    if (dominantCwd) {
      const base = path.basename(dominantCwd);
      const proj = exact.find(e => e.source === `project:${base}`);
      if (proj) return proj;
    }
    const user = exact.find(e => e.source === 'user');
    if (user) return user;
    return exact[0];
  }
  const suffix = [];
  for (const [id, entries] of byId) {
    if (id.endsWith(':' + name)) suffix.push(...entries);
  }
  if (suffix.length === 1) return suffix[0];
  if (suffix.length > 1) return { ...suffix[0], ambiguous: suffix.length };
  return null;
}

function daysSince(ts, now) {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

function verdict(count, days) {
  if (count === 0) return ['NEVER-INVOKED', 'no recorded invocation in scanned history'];
  if (days === null) return ['UNKNOWN', 'no usable timestamp'];
  if (days <= 14) return ['ACTIVE', `${count}x, last ${days}d ago`];
  if (days <= 45) return ['RECENT', `${count}x, last ${days}d ago`];
  if (days <= 90) return ['DORMANT', `${count}x, last ${days}d ago`];
  return ['STALE', `${count}x, last ${days}d ago`];
}

const opts = parseArgs(process.argv.slice(2));
const now = Date.now();

if (!exists(PROJECTS)) {
  console.error(`No transcript store at ${PROJECTS}`);
  process.exit(1);
}

const { catalog, installedPlugins } = buildBaseCatalog();
const scan = await scanTranscripts(opts);
addProjectCatalog(catalog, scan.cwds);
const byId = buildIndex(catalog);

const rows = [];
const resolvedKeys = new Set();

for (const u of scan.usage.values()) {
  let dominantCwd = null, best = -1;
  for (const [cwd, n] of u.projects) if (n > best) { best = n; dominantCwd = cwd; }
  const entry = resolve(u.name, byId, dominantCwd);
  const d = daysSince(u.last, now);
  const [v, reason] = verdict(u.count, d);
  let origin;
  if (entry) origin = entry.source;
  else if (BUILTIN.has(u.name)) origin = 'built-in';
  else origin = 'unresolved';
  if (entry) resolvedKeys.add(`${entry.source}|${entry.id}`);
  rows.push({
    name: u.name,
    resolvedId: entry?.id ?? null,
    origin,
    kind: entry?.kind ?? (origin === 'built-in' ? 'built-in' : 'unknown'),
    description: entry?.description ?? '',
    count: u.count,
    viaSkillTool: u.viaSkillTool,
    viaSlash: u.viaSlash,
    inSubagent: u.inSubagent,
    sessions: u.sessions.size,
    projects: [...u.projects.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ project: p, count: n })),
    months: Object.fromEntries([...u.months.entries()].sort()),
    first_used: u.first,
    last_used: u.last,
    days_since: d,
    verdict: v,
    reason,
    ambiguous: entry?.ambiguous ?? null,
  });
}

for (const entry of catalog.values()) {
  const key = `${entry.source}|${entry.id}`;
  if (resolvedKeys.has(key)) continue;
  const [v, reason] = verdict(0, null);
  rows.push({
    name: entry.id, resolvedId: entry.id, origin: entry.source, kind: entry.kind,
    description: entry.description, count: 0, viaSkillTool: 0, viaSlash: 0, inSubagent: 0,
    sessions: 0, projects: [], months: {},
    first_used: null, last_used: null, days_since: null,
    verdict: v, reason, ambiguous: null,
    sizeBytes: entry.sizeBytes,
    installed_at: entry.installedAt ?? null,
    installed_days: entry.installedAt ? daysSince(entry.installedAt, now) : null,
  });
}

rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const summary = {
  generated_at: new Date().toISOString(),
  window_days: opts.days,
  project_filter: opts.project,
  transcript_files_scanned: scan.stats.files,
  transcript_files_total: scan.stats.totalFiles,
  lines_read: scan.stats.lines,
  invocation_events: scan.stats.events,
  sessions_with_activity: scan.sessions.size,
  transcripts_from: scan.stats.coverFrom,
  transcripts_to: scan.stats.coverTo,
  first_invocation: scan.stats.earliest,
  last_invocation: scan.stats.latest,
  catalog_size: catalog.size,
  installed_plugins: installedPlugins.map(p => ({
    plugin: p.plugin, version: p.version, scope: p.scope,
    installed_at: p.installedAt,
    installed_days: p.installedAt ? daysSince(p.installedAt, now) : null,
  })),
  distinct_invoked: rows.filter(r => r.count > 0).length,
  never_invoked: rows.filter(r => r.count === 0).length,
  by_verdict: rows.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] ?? 0) + 1; return acc; }, {}),
};

const payload = { summary, rows };

const outPath = opts.json
  ? path.resolve(opts.json)
  : path.resolve('tmp', 'skill-usage-audit', 'skill-usage.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

if (!opts.quiet) {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`
Skill usage audit`);
  console.log(`transcript coverage: ${summary.transcripts_from?.slice(0, 10) ?? '?'} to ${summary.transcripts_to?.slice(0, 10) ?? '?'}  |  invocations: ${summary.first_invocation?.slice(0, 10) ?? '?'} to ${summary.last_invocation?.slice(0, 10) ?? '?'}`);
  console.log(`${summary.transcript_files_scanned}/${summary.transcript_files_total} transcript files, ${summary.invocation_events} invocations, ${summary.sessions_with_activity} sessions`);
  console.log(`catalog: ${summary.catalog_size} installed skills+commands  |  invoked: ${summary.distinct_invoked}  |  never invoked: ${summary.never_invoked}\n`);
  console.log(`${pad('COUNT', 6)}${pad('SESS', 6)}${pad('SUB', 5)}${pad('LAST', 7)}${pad('VERDICT', 15)}${pad('ORIGIN', 30)}NAME`);
  for (const r of rows.filter(x => x.count > 0)) {
    console.log(
      `${lpad(r.count, 4)}  ${lpad(r.sessions, 4)}  ${lpad(r.inSubagent, 3)}  ${lpad(r.days_since ?? '-', 4)}d  ${pad(r.verdict, 15)}${pad(r.origin, 30)}${r.name}`
    );
  }
  console.log(`\nNever invoked (${summary.never_invoked}) -- review candidates only, NOT delete instructions:`);
  const never = rows.filter(x => x.count === 0);
  const byOrigin = new Map();
  for (const r of never) { if (!byOrigin.has(r.origin)) byOrigin.set(r.origin, []); byOrigin.get(r.origin).push(r.name); }
  for (const [o, names] of [...byOrigin].sort()) {
    const ages = never.filter(r => r.origin === o && r.installed_days !== null).map(r => r.installed_days);
    const age = ages.length ? ` [installed ${Math.min(...ages)}d ago]` : '';
    console.log(`  ${o} (${names.length})${age}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` ... +${names.length - 8}` : ''}`);
  }
  console.log(`\nwrote ${outPath}`);
}
