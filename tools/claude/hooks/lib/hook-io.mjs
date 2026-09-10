import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

export const EXIT_OK = 0;
export const EXIT_BLOCK = 2;

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return importMetaUrl === pathToFileURL(process.argv[1]).href;
}

export function isRepoRoot(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return manifest?.name === 'ai-tooling';
  } catch {
    return false;
  }
}

export function repoRoot(from) {
  const start = from ?? path.dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..', '..', '..');
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
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

const KEYED_SECRET = /((?:password|passwd|secret|token|api[_-]?key|apikey|bearer|authorization)["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi;

export function redact(text) {
  let out = String(text ?? '');
  for (const re of SECRETISH) out = out.replace(re, '[REDACTED]');
  return out.replace(KEYED_SECRET, (whole, prefix) => `${prefix}[REDACTED]`);
}
