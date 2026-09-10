#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, isMain } from '../lib/paths.mjs';
import { candidateFiles } from './scan.mjs';

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_FENCE = /```[\s\S]*?```|`[^`\n]*`/g;

export function linksIn(text) {
  const withoutCode = text.replace(CODE_FENCE, (block) => block.replace(/[^\n]/g, ' '));
  return [...withoutCode.matchAll(LINK)].map((m) => m[1]);
}

export function isLocal(href) {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  if (href.startsWith('#')) return false;
  return true;
}

export function resolveTarget(fromFile, href, root = REPO_ROOT) {
  const clean = href.split('#')[0];
  if (!clean) return null;
  const base = clean.startsWith('/')
    ? path.join(root, clean.slice(1))
    : path.resolve(path.dirname(path.join(root, fromFile)), clean);
  return base;
}

export function validate(root = REPO_ROOT) {
  const problems = [];
  const markdown = candidateFiles(root).filter((rel) => rel.toLowerCase().endsWith('.md'));

  for (const rel of markdown) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    for (const href of linksIn(fs.readFileSync(abs, 'utf8'))) {
      if (!isLocal(href)) continue;
      const target = resolveTarget(rel, href, root);
      if (target === null) continue;
      if (!fs.existsSync(target)) {
        problems.push(`${rel}: broken link -> ${href}`);
        continue;
      }
      if (!path.resolve(target).startsWith(path.resolve(root))) {
        problems.push(`${rel}: link escapes the repo -> ${href}`);
      }
    }
  }
  return { problems, count: markdown.length };
}

function main() {
  const { problems, count } = validate();
  console.log(`links: ${count} markdown file(s) checked`);
  for (const p of problems) console.error(`  ! ${p}`);
  if (problems.length === 0) console.log('  ok');
  else process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main };
