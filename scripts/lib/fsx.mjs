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

export function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.ai-tooling-backup.${stamp}`;
  fs.copyFileSync(file, target);
  return target;
}

export function sameText(a, b) {
  return normalize(a) === normalize(b);
}

function normalize(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\s+$/, '');
}
