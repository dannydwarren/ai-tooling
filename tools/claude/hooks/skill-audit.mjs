#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readPayload, runHook, repoRoot, redact, isMain } from './lib/hook-io.mjs';

const ARG_PREVIEW_CHARS = 160;
const FIELD_CHARS = 512;

function capped(value) {
  if (typeof value !== 'string') return value ?? null;
  return value.length > FIELD_CHARS ? value.slice(0, FIELD_CHARS) : value;
}

export function logPath() {
  if (process.env.AI_TOOLING_SKILL_LOG) return process.env.AI_TOOLING_SKILL_LOG;
  return path.join(repoRoot(), 'tmp', 'logs', 'skill-audit.jsonl');
}

export function extractSkill(toolInput) {
  const input = toolInput || {};
  for (const key of ['skill', 'skill_name', 'skillName', 'name', 'command']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function isExpansion(payload) {
  return payload?.hook_event_name === 'UserPromptExpansion' || typeof payload?.command_name === 'string';
}

export function isAgent(payload) {
  return payload?.hook_event_name === 'SubagentStart' || payload?.hook_event_name === 'SubagentStop';
}

export function namespaceOf(skill) {
  if (!skill || !skill.includes(':')) return null;
  return skill.slice(0, skill.indexOf(':'));
}

export function projectOf(cwd) {
  if (!cwd) return null;
  const segments = String(cwd).split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

export function argsPreview(raw) {
  if (process.env.AI_TOOLING_SKILL_LOG_ARGS === '0') return null;
  if (raw === undefined || raw === null || raw === '') return null;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const clean = redact(text).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > ARG_PREVIEW_CHARS ? `${clean.slice(0, ARG_PREVIEW_CHARS)}...` : clean;
}

export function buildRecord(payload, now) {
  const expansion = isExpansion(payload);
  const agent = isAgent(payload);
  const toolInput = payload?.tool_input || {};

  let name = null;
  if (agent) name = typeof payload.agent_type === 'string' ? payload.agent_type.trim() : null;
  else if (expansion) name = typeof payload.command_name === 'string' ? payload.command_name.trim().replace(/^\//, '') : null;
  else name = extractSkill(toolInput);

  const record = {
    ts: now,
    event: payload?.hook_event_name ?? null,
    kind: agent ? 'agent' : null,
    invocation: expansion ? 'user' : 'model',
    tool: payload?.tool_name ?? null,
    name: capped(name || null),
    namespace: namespaceOf(name),
    cwd: capped(payload?.cwd ?? null),
    project: capped(projectOf(payload?.cwd)),
    session_id: capped(payload?.session_id ?? null),
    args: agent ? null : argsPreview(expansion ? payload.command_input : (toolInput.args ?? toolInput.arguments)),
  };

  if (agent) record.agent_id = capped(payload.agent_id ?? null);

  if (expansion) {
    record.expansion_type = payload.expansion_type ?? null;
    record.command_source = payload.command_source ?? null;
  }

  if (!record.name) {
    const source = expansion || agent ? payload : toolInput;
    record.unresolved_input = redact(JSON.stringify(source)).slice(0, 400);
  }
  return record;
}

export function append(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

if (isMain(import.meta.url)) {
  runHook('skill-audit', async () => {
    const payload = await readPayload();
    if (payload?.tool_name && payload.tool_name !== 'Skill') return;
    if (!isExpansion(payload) && !isAgent(payload) && !payload?.tool_name) return;
    append(logPath(), buildRecord(payload, new Date().toISOString()));
  });
}
