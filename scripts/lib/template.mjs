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

export function unrender(text, values, keys) {
  let out = String(text);
  const names = keys ?? Object.keys(values);
  const ordered = names
    .filter((k) => typeof values[k] === 'string' && values[k].length >= 3)
    .sort((a, b) => values[b].length - values[a].length);
  for (const key of ordered) {
    out = replaceAllCaseInsensitive(out, values[key], `{{${key}}}`);
  }
  return out;
}

function replaceAllCaseInsensitive(haystack, needle, replacement) {
  if (!needle) return haystack;
  let out = '';
  let index = 0;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  for (;;) {
    const at = lowerHay.indexOf(lowerNeedle, index);
    if (at === -1) break;
    out += haystack.slice(index, at) + replacement;
    index = at + needle.length;
  }
  return out + haystack.slice(index);
}
