#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readPayload, runHook, block, isMain, EXIT_OK } from '../../tools/claude/hooks/lib/hook-io.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TAKES_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

export function isPush(command) {
  if (typeof command !== 'string') return false;
  return command.split(/\|\||&&|[;&|\n]/).some(isPushSegment);
}

function isPushSegment(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;

  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  if (tokens[i]?.replace(/^[("'`]+/, '') !== 'git') return false;
  i += 1;

  while (i < tokens.length) {
    const token = tokens[i];
    if (TAKES_VALUE.has(token)) {
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    return token.replace(/[)"'`]+$/, '') === 'push';
  }
  return false;
}

export function runBuild(root = PROJECT_ROOT) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

export function report(output) {
  const lines = output.split(/\r?\n/);
  const interesting = lines.filter((line) => /^\s*(!|SECRET|PII|STALE|NOT SCANNED|failed:|✖)/.test(line));
  const detail = (interesting.length > 0 ? interesting : lines.filter(Boolean).slice(-15)).slice(0, 25);
  return [
    'Push blocked: the build does not pass, so this must not reach the remote.',
    'The secret and private-value scan only runs here, never on the runner.',
    '',
    ...detail,
    '',
    'Fix it and try again. Do not work around this by disabling the check.',
  ].join('\n');
}

if (isMain(import.meta.url)) {
  runHook('guard-push', async () => {
    const payload = await readPayload();
    if (!isPush(payload?.tool_input?.command)) process.exit(EXIT_OK);

    const { ok, output } = runBuild();
    if (ok) process.exit(EXIT_OK);

    block(report(output));
  });
}
