#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, isMain, toSlash } from './lib/paths.mjs';
import { readJson } from './lib/fsx.mjs';

const CACHE = path.join(CLAUDE_HOME, 'plugins', 'cache');

export function discover(cache = CACHE) {
  if (!fs.existsSync(cache)) return [];
  const found = [];
  for (const marketplace of dirs(cache)) {
    for (const plugin of dirs(path.join(cache, marketplace))) {
      for (const version of dirs(path.join(cache, marketplace, plugin))) {
        const root = path.join(cache, marketplace, plugin, version);
        const manifest = path.join(root, 'hooks', 'hooks.json');
        if (!fs.existsSync(manifest)) continue;
        found.push({ marketplace, plugin, version, root, manifest });
      }
    }
  }
  return found;
}

function dirs(parent) {
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

export function flatten(hooks) {
  const out = [];
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const hook of group.hooks ?? []) {
        out.push({ event, matcher: group.matcher ?? null, hook });
      }
    }
  }
  return out;
}

export function rewriteRoot(command, root) {
  if (typeof command !== 'string') return command;
  return command
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', toSlash(root))
    .replaceAll('$CLAUDE_PLUGIN_ROOT', toSlash(root));
}

export function toCatalogEntry(source, entry, index) {
  const id = `${source.plugin}-${entry.event}-${index}`.toLowerCase();
  return {
    id,
    enabled: false,
    event: entry.event,
    ...(entry.matcher ? { matcher: entry.matcher } : {}),
    description: `Imported from the ${source.plugin} plugin (${source.marketplace}, v${source.version}). Review before enabling: it runs code from a plugin, pinned to the version installed today.`,
    hook: { ...entry.hook, command: rewriteRoot(entry.hook.command, source.root) },
  };
}

function main() {
  const args = process.argv.slice(2);
  const wanted = args.includes('--plugin') ? args[args.indexOf('--plugin') + 1] : null;
  const asCatalog = args.includes('--as-catalog');

  const sources = discover().filter((s) => !wanted || s.plugin === wanted);

  if (sources.length === 0) {
    console.log(wanted
      ? `No installed plugin named "${wanted}" declares hooks.`
      : 'No installed plugin declares hooks.');
    console.log(`Looked under ${CACHE}`);
    return;
  }

  if (asCatalog) {
    const entries = [];
    for (const source of sources) {
      const manifest = readJson(source.manifest, {});
      flatten(manifest.hooks).forEach((entry, i) => entries.push(toCatalogEntry(source, entry, i)));
    }
    console.log(JSON.stringify(entries, null, 2));
    console.log('');
    console.log('// Paste the entries above into tools/claude/settings/hooks.json, review each one,');
    console.log('// set enabled:true on the ones you want, then run: npm run claude:install');
    return;
  }

  console.log('Hooks declared by installed plugins');
  console.log(`  cache: ${CACHE}`);
  console.log('');

  for (const source of sources) {
    const manifest = readJson(source.manifest, {});
    const entries = flatten(manifest.hooks);
    console.log(`${source.plugin}  (${source.marketplace}, v${source.version})`);
    if (entries.length === 0) {
      console.log('  declares a hooks.json but no hooks');
      continue;
    }
    for (const entry of entries) {
      console.log(`  ${entry.event}${entry.matcher ? ` [${entry.matcher}]` : ''}`);
      console.log(`      ${rewriteRoot(entry.hook.command, source.root)}`);
    }
    console.log('');
  }

  console.log('These already run whenever their plugin is enabled. Nothing here needs installing.');
  console.log('Re-run with --as-catalog to emit entries you can adopt into this repo, which lets you');
  console.log('run one plugin hook without enabling the whole plugin. See docs/claude/plugins.md.');
}

if (isMain(import.meta.url)) main();
export { main };
