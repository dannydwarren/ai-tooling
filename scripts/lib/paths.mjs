import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const USER_HOME = os.homedir();

export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR
  ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
  : path.join(USER_HOME, '.claude');

export const VALUES_FILE = process.env.AI_TOOLING_VALUES
  ? path.resolve(process.env.AI_TOOLING_VALUES)
  : path.join(USER_HOME, '.ai-tooling', 'values.json');

export function toPosix(p) {
  const win = /^([A-Za-z]):[\\/]/.exec(p);
  if (win) return `/${win[1].toLowerCase()}/${p.slice(3).replace(/\\/g, '/')}`;
  return p.replace(/\\/g, '/');
}

export function toSlash(p) {
  return p.replace(/\\/g, '/');
}

export function repoPath(...parts) {
  return path.join(REPO_ROOT, ...parts);
}

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return importMetaUrl === pathToFileURL(process.argv[1]).href;
}
