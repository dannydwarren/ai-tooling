import fs from 'node:fs';
import path from 'node:path';

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function relFiles(dir) {
  return listFiles(dir).map((f) => path.relative(dir, f).split(path.sep).join('/'));
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(readText(file));
}

export function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export const BACKUP_SUFFIX = '.ai-tooling-backup.';
export const BACKUPS_KEPT = 5;

export function backup(file, keep = BACKUPS_KEPT) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}${BACKUP_SUFFIX}${stamp}`;
  fs.copyFileSync(file, target);
  pruneBackups(file, keep);
  return target;
}

export function backupsOf(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}${BACKUP_SUFFIX}`;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .map((name) => path.join(dir, name));
}

export function pruneBackups(file, keep = BACKUPS_KEPT) {
  const existing = backupsOf(file);
  const excess = existing.slice(0, Math.max(0, existing.length - keep));
  for (const old of excess) {
    try {
      fs.rmSync(old);
    } catch {
      // a backup we cannot remove is not worth failing an install over
    }
  }
  return excess;
}

export function sameText(a, b) {
  return normalize(a) === normalize(b);
}

function normalize(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\s+$/, '');
}
