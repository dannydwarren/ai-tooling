#!/usr/bin/env node
import { readPayload, runHook, block, isMain, EXIT_OK } from './lib/hook-io.mjs';

const GIT_TAKES_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const PUSH_TAKES_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const PUSHES_EVERYTHING = new Set(['--all', '--mirror', '--branches']);
const UNNAMED = new Set(['', 'HEAD', '@']);

function strip(token) {
  return token.replace(/^[("'`]+/, '').replace(/[)"'`]+$/, '');
}

export function pushArgs(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean).map(strip);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  if (tokens[i] !== 'git') return null;
  i += 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (GIT_TAKES_VALUE.has(token)) {
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    return token === 'push' ? tokens.slice(i + 1) : null;
  }
  return null;
}

function isForceFlag(token) {
  if (token === '--force' || token.startsWith('--force-with-lease')) return true;
  return /^-[A-Za-z]*f[A-Za-z]*$/.test(token);
}

function namesBranch(refspec) {
  const spec = refspec.replace(/^\+/, '');
  const destination = spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec;
  return !UNNAMED.has(destination);
}

export function unnamedForcePush(args) {
  let force = false;
  let everything = false;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (PUSH_TAKES_VALUE.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      if (isForceFlag(token)) force = true;
      if (PUSHES_EVERYTHING.has(token)) everything = true;
      continue;
    }
    positional.push(token);
  }
  const refspecs = positional.slice(1);
  if (refspecs.some((spec) => spec.startsWith('+'))) force = true;
  if (!force) return false;
  if (everything) return true;
  return refspecs.length === 0 || !refspecs.every(namesBranch);
}

export function findUnnamedForcePush(command) {
  if (typeof command !== 'string') return null;
  for (const segment of command.split(/\|\||&&|[;&|\n]/)) {
    const args = pushArgs(segment);
    if (args && unnamedForcePush(args)) return segment.trim();
  }
  return null;
}

export function report(segment) {
  return [
    `Force push blocked: \`${segment}\` does not name the branch it overwrites.`,
    'Name the remote and the branch explicitly, even for the current branch:',
    '  git push --force-with-lease origin <branch>',
  ].join('\n');
}

if (isMain(import.meta.url)) {
  runHook('force-push-needs-branch', async () => {
    const payload = await readPayload();
    const segment = findUnnamedForcePush(payload?.tool_input?.command);
    if (!segment) process.exit(EXIT_OK);
    block(report(segment));
  });
}
