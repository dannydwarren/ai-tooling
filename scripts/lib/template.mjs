import fs from 'node:fs';
import { REPO_ROOT, USER_HOME, CLAUDE_HOME, VALUES_FILE, toPosix, toSlash } from './paths.mjs';

export const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

export function jsonEscaped(p) {
  return p.replace(/\\/g, '\\\\');
}

export function derivedValues() {
  return {
    REPO_ROOT,
    REPO_ROOT_JSON: jsonEscaped(REPO_ROOT),
    REPO_ROOT_SLASH: toSlash(REPO_ROOT),
    REPO_ROOT_POSIX: toPosix(REPO_ROOT),
    USER_HOME,
    USER_HOME_JSON: jsonEscaped(USER_HOME),
    USER_HOME_SLASH: toSlash(USER_HOME),
    USER_HOME_POSIX: toPosix(USER_HOME),
    CLAUDE_HOME,
    CLAUDE_HOME_JSON: jsonEscaped(CLAUDE_HOME),
    CLAUDE_HOME_SLASH: toSlash(CLAUDE_HOME),
    CLAUDE_HOME_POSIX: toPosix(CLAUDE_HOME),
  };
}

export function requiredValueKeys(file) {
  const target = file ?? new URL('../../security/required-values.json', import.meta.url);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return parsed?.values ?? {};
  } catch {
    return {};
  }
}

export function loadPrivateValues(file = VALUES_FILE) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw new Error(`Could not parse values file ${file}: ${err.message}`);
  }
}

export function loadValues(file = VALUES_FILE) {
  return { ...derivedValues(), ...loadPrivateValues(file) };
}

export function placeholdersIn(text) {
  return [...new Set([...String(text).matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

export function renderDeep(value, values) {
  const missing = new Set();
  const walk = (node) => {
    if (typeof node === 'string') {
      const result = render(node, values);
      result.missing.forEach((m) => missing.add(m));
      return result.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return { value: walk(value), missing: [...missing] };
}

export function render(text, values) {
  const missing = new Set();
  const out = String(text).replace(PLACEHOLDER, (whole, key) => {
    if (!(key in values)) {
      missing.add(key);
      return whole;
    }
    return values[key];
  });
  return { text: out, missing: [...missing] };
}

export const MIN_UNRENDER_LENGTH = 6;

export function unrender(text, values, keys) {
  const source = String(text);
  const names = (keys ?? Object.keys(values))
    .filter((k) => typeof values[k] === 'string' && values[k].length >= MIN_UNRENDER_LENGTH);

  const candidates = [];
  const lower = source.toLowerCase();
  for (const key of names) {
    const needle = values[key].toLowerCase();
    let at = lower.indexOf(needle);
    while (at !== -1) {
      candidates.push({ start: at, end: at + needle.length, key });
      at = lower.indexOf(needle, at + 1);
    }
  }

  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  let out = '';
  let cursor = 0;
  for (const match of candidates) {
    if (match.start < cursor) continue;
    out += source.slice(cursor, match.start) + `{{${match.key}}}`;
    cursor = match.end;
  }
  return out + source.slice(cursor);
}
