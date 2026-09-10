import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractSkill, namespaceOf, projectOf, buildRecord, isExpansion } from '../tools/claude/hooks/skill-audit.mjs';
import { aggregate, classify, classifyRecord, rollup, unusedPlugins, readLog } from '../scripts/analyze-skill-log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'tools', 'claude', 'hooks', 'skill-audit.mjs');

function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-audit-'));
  return path.join(dir, 'log.jsonl');
}

function runHook(payload, logFile, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, AI_TOOLING_SKILL_LOG: logFile, ...env },
  });
}

test('extracts the skill name from either field spelling', () => {
  assert.equal(extractSkill({ skill: 'a:b' }), 'a:b');
  assert.equal(extractSkill({ command: 'design' }), 'design');
  assert.equal(extractSkill({ skill_name: 'x' }), 'x');
  assert.equal(extractSkill({}), null);
  assert.equal(extractSkill({ skill: '   ' }), null);
});

test('derives the namespace from a plugin-qualified name', () => {
  assert.equal(namespaceOf('engineering:utilities:ship'), 'engineering');
  assert.equal(namespaceOf('superpowers:brainstorming'), 'superpowers');
  assert.equal(namespaceOf('wip'), null);
  assert.equal(namespaceOf(null), null);
});

test('derives the project from the cwd regardless of separator or host platform', () => {
  assert.equal(projectOf('C:\\src\\ai-tooling'), 'ai-tooling');
  assert.equal(projectOf('C:/src/ai-tooling'), 'ai-tooling');
  assert.equal(projectOf('/home/x/repo/'), 'repo');
  assert.equal(projectOf('/c/src/ai-tooling'), 'ai-tooling');
  assert.equal(projectOf('C:\\src\\ai-tooling\\'), 'ai-tooling');
  assert.equal(projectOf(null), null);
  assert.equal(projectOf(''), null);
});

test('builds a record with the fields the analyzer needs', () => {
  const record = buildRecord({
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    session_id: 's1',
    cwd: 'C:\\src\\ai-tooling',
    tool_input: { skill: 'engineering:utilities:ship', args: 'now' },
  }, '2026-09-09T00:00:00.000Z');

  assert.equal(record.skill, 'engineering:utilities:ship');
  assert.equal(record.namespace, 'engineering');
  assert.equal(record.project, 'ai-tooling');
  assert.equal(record.session_id, 's1');
  assert.equal(record.args, 'now');
  assert.equal(record.ts, '2026-09-09T00:00:00.000Z');
});

test('recognises a typed slash command expansion', () => {
  assert.ok(isExpansion({ hook_event_name: 'UserPromptExpansion', command_name: 'wip' }));
  assert.ok(isExpansion({ command_name: 'wip' }));
  assert.ok(!isExpansion({ hook_event_name: 'PreToolUse', tool_name: 'Skill' }));
  assert.ok(!isExpansion(null));
});

test('a typed slash command is recorded as a user invocation', () => {
  const record = buildRecord({
    hook_event_name: 'UserPromptExpansion',
    command_name: 'wip',
    command_input: 'today',
    cwd: 'C:\\src\\ai-tooling',
  }, 'now');

  assert.equal(record.skill, 'wip');
  assert.equal(record.invocation, 'user');
  assert.equal(record.args, 'today');
  assert.equal(record.project, 'ai-tooling');
});

test('a leading slash is stripped so typed and model names agree', () => {
  assert.equal(buildRecord({ hook_event_name: 'UserPromptExpansion', command_name: '/wip' }, 'now').skill, 'wip');
});

test('a model invoked skill is recorded as a model invocation', () => {
  const record = buildRecord({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'a:b' } }, 'now');
  assert.equal(record.invocation, 'model');
});

test('a namespaced typed command keeps its namespace', () => {
  const record = buildRecord({ hook_event_name: 'UserPromptExpansion', command_name: 'engineering:utilities:ship' }, 'now');
  assert.equal(record.namespace, 'engineering');
});

test('end to end: a typed slash command is logged', () => {
  const log = tempLog();
  runHook({ hook_event_name: 'UserPromptExpansion', command_name: 'wip', cwd: 'C:\\src\\repo' }, log);
  const records = readLog(log);
  assert.equal(records.length, 1);
  assert.equal(records[0].skill, 'wip');
  assert.equal(records[0].invocation, 'user');
});

test('redacts secrets out of the args preview', () => {
  const record = buildRecord({
    tool_name: 'Skill',
    tool_input: { skill: 'x', args: 'token=abcdefghijklmnop' },
  }, 'now');
  assert.ok(!record.args.includes('abcdefghijklmnop'));
  assert.match(record.args, /REDACTED/);
});

test('args logging can be turned off', () => {
  process.env.AI_TOOLING_SKILL_LOG_ARGS = '0';
  const record = buildRecord({ tool_name: 'Skill', tool_input: { skill: 'x', args: 'sensitive' } }, 'now');
  delete process.env.AI_TOOLING_SKILL_LOG_ARGS;
  assert.equal(record.args, null);
});

test('an unrecognised input shape is preserved for diagnosis', () => {
  const record = buildRecord({ tool_name: 'Skill', tool_input: { mystery: 'value' } }, 'now');
  assert.equal(record.skill, null);
  assert.match(record.unresolved_input, /mystery/);
});

test('end to end: appends one line per invocation and creates the directory', () => {
  const log = tempLog();
  runHook({ hook_event_name: 'PreToolUse', tool_name: 'Skill', cwd: 'C:\\src\\repo', tool_input: { skill: 'a:b' } }, log);
  runHook({ hook_event_name: 'PreToolUse', tool_name: 'Skill', cwd: 'C:\\src\\repo', tool_input: { skill: 'c' } }, log);

  const records = readLog(log);
  assert.equal(records.length, 2);
  assert.equal(records[0].skill, 'a:b');
  assert.equal(records[1].skill, 'c');
});

test('end to end: always exits 0, even on garbage input', () => {
  const log = tempLog();
  assert.equal(runHook({ tool_name: 'Skill', tool_input: { skill: 'x' } }, log).status, 0);
  const bad = spawnSync(process.execPath, [HOOK], {
    input: '}{ not json',
    encoding: 'utf8',
    env: { ...process.env, AI_TOOLING_SKILL_LOG: log },
  });
  assert.equal(bad.status, 0);
});

test('end to end: ignores tools that are not Skill', () => {
  const log = tempLog();
  runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, log);
  assert.equal(readLog(log).length, 0);
});

test('classifies skills by source', () => {
  const context = { inRepo: new Set(['pr-review-cycle']), inGlobal: new Set(['pr-review-cycle', 'orphan']) };
  assert.deepEqual(classify('engineering:ship', context), { source: 'plugin', owner: 'engineering' });
  assert.deepEqual(classify('pr-review-cycle', context), { source: 'personal-repo', owner: 'ai-tooling' });
  assert.deepEqual(classify('orphan', context), { source: 'personal-global', owner: 'unmanaged' });
  assert.deepEqual(classify('dataviz', context), { source: 'built-in', owner: 'claude' });
});

test('an MCP prompt expansion is not counted as a skill', () => {
  const context = { inRepo: new Set(), inGlobal: new Set() };
  assert.deepEqual(
    classifyRecord({ skill: 'some-prompt', expansion_type: 'mcp_prompt' }, context),
    { source: 'mcp-prompt', owner: 'mcp' },
  );
  assert.deepEqual(
    classifyRecord({ skill: 'wip', expansion_type: 'slash_command' }, context),
    { source: 'built-in', owner: 'claude' },
  );
});

test('expansion metadata is captured when present', () => {
  const record = buildRecord({
    hook_event_name: 'UserPromptExpansion',
    command_name: 'wip',
    expansion_type: 'slash_command',
    command_source: 'user',
  }, 'now');
  assert.equal(record.expansion_type, 'slash_command');
  assert.equal(record.command_source, 'user');
});

test('expansion metadata is absent on model invocations', () => {
  const record = buildRecord({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'a' } }, 'now');
  assert.ok(!('expansion_type' in record));
});

test('aggregates counts, window and projects per skill', () => {
  const context = { inRepo: new Set(), inGlobal: new Set() };
  const stats = aggregate([
    { ts: '2026-09-01T10:00:00Z', event: 'PreToolUse', skill: 'a:b', project: 'p1' },
    { ts: '2026-09-03T10:00:00Z', event: 'PreToolUse', skill: 'a:b', project: 'p2' },
    { ts: '2026-09-02T10:00:00Z', event: 'PreToolUse', skill: 'c', project: 'p1' },
  ], context);

  assert.equal(stats[0].skill, 'a:b');
  assert.equal(stats[0].count, 2);
  assert.equal(stats[0].first, '2026-09-01T10:00:00Z');
  assert.equal(stats[0].last, '2026-09-03T10:00:00Z');
  assert.deepEqual([...stats[0].projects].sort(), ['p1', 'p2']);
});

test('aggregation ignores PostToolUse so enabling the post hook does not double count', () => {
  const context = { inRepo: new Set(), inGlobal: new Set() };
  const stats = aggregate([
    { ts: '2026-09-01T10:00:00Z', event: 'PreToolUse', skill: 'a' },
    { ts: '2026-09-01T10:00:01Z', event: 'PostToolUse', skill: 'a' },
  ], context);
  assert.equal(stats[0].count, 1);
});

test('aggregation counts typed and model invocations separately but totals both', () => {
  const context = { inRepo: new Set(), inGlobal: new Set() };
  const stats = aggregate([
    { ts: '2026-09-01T10:00:00Z', event: 'UserPromptExpansion', invocation: 'user', skill: 'wip' },
    { ts: '2026-09-01T10:00:01Z', event: 'UserPromptExpansion', invocation: 'user', skill: 'wip' },
    { ts: '2026-09-01T10:00:02Z', event: 'PreToolUse', invocation: 'model', skill: 'wip' },
  ], context);

  assert.equal(stats[0].count, 3);
  assert.equal(stats[0].typed, 2);
  assert.equal(stats[0].auto, 1);
});

test('rolls up by source and finds plugins with no recorded use', () => {
  const context = { inRepo: new Set(), inGlobal: new Set() };
  const stats = aggregate([
    { ts: '2026-09-01T00:00:00Z', event: 'PreToolUse', skill: 'engineering:ship' },
    { ts: '2026-09-01T00:00:00Z', event: 'PreToolUse', skill: 'engineering:debug' },
  ], context);

  assert.deepEqual(rollup(stats, 'owner'), [{ bucket: 'engineering', invocations: 2, skills: 2 }]);
  assert.deepEqual(unusedPlugins(stats, ['engineering', 'product', 'qa']), ['product', 'qa']);
});

test('a missing log file reads as empty rather than throwing', () => {
  assert.deepEqual(readLog(path.join(os.tmpdir(), 'definitely-not-here-12345.jsonl')), []);
});
