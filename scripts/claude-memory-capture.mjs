#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, REPO_ROOT, repoPath, isMain } from './lib/paths.mjs';
import { readText, writeText, sameText } from './lib/fsx.mjs';

export const TARGET = repoPath('tools', 'claude', 'memory');

export function projectsRoot() {
  return path.join(CLAUDE_HOME, 'projects');
}

export function memorySources(root = projectsRoot()) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = path.join(root, project.name, 'memory');
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort();
    if (files.length > 0) found.push({ project: project.name, dir, files });
  }
  return found.sort((a, b) => a.project.localeCompare(b.project));
}

export function plan(sources = memorySources()) {
  const items = [];
  for (const source of sources) {
    for (const file of source.files) {
      items.push({
        project: source.project,
        srcFile: path.join(source.dir, file),
        destFile: path.join(TARGET, source.project, file),
      });
    }
  }
  return items;
}

function main({ check = process.argv.includes('--check') } = {}) {
  const items = plan();
  const changes = [];

  for (const item of items) {
    const text = readText(item.srcFile);
    const exists = fs.existsSync(item.destFile);
    if (!exists || !sameText(readText(item.destFile), text)) {
      changes.push(`${exists ? 'update' : 'create'} ${path.relative(REPO_ROOT, item.destFile)}`);
      if (!check) writeText(item.destFile, text);
    }
  }

  const projects = new Set(items.map((i) => i.project));
  console.log(`ai-tooling claude memory capture${check ? ' (check)' : ''}`);
  console.log(`  source: ${projectsRoot()}`);
  console.log(`  found:  ${items.length} memory file(s) across ${projects.size} project(s)`);
  if (changes.length === 0) console.log('  repo already matches the machine');
  else console.log(`  ${check ? 'would change' : 'changed'}: ${changes.length} file(s)`);

  if (check && changes.length > 0) process.exit(1);
}

if (isMain(import.meta.url)) main();
export { main };
