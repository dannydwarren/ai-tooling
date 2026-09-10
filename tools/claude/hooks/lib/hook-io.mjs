import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const EXIT_OK = 0;
export const EXIT_BLOCK = 2;

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return importMetaUrl === pathToFileURL(process.argv[1]).href;
}

export function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..');
}

export async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function readPayload() {
  const raw = await readStdin();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function block(message) {
  process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
  process.exit(EXIT_BLOCK);
}

export function pass() {
  process.exit(EXIT_OK);
}

export async function runHook(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (process.env.AI_TOOLING_HOOK_DEBUG === '1') {
      process.stderr.write(`[${name}] internal error: ${err?.stack || err}\n`);
    }
  }
  process.exit(EXIT_OK);
}

const SECRETISH = [
  /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g,
  /\b((?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,})/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(sk-[A-Za-z0-9_-]{16,})/g,
  /\b(xox[abprs]-[A-Za-z0-9-]{8,})/g,
  /((?:password|passwd|secret|token|api[_-]?key|bearer)\s*[:=]\s*)(\S{6,})/gi,
];

export function redact(text) {
  let out = String(text ?? '');
  for (const re of SECRETISH) {
    out = out.replace(re, (m, a, b) => (b === undefined ? '[REDACTED]' : `${a}[REDACTED]`));
  }
  return out;
}
