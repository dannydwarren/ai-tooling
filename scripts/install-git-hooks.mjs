#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, isMain } from './lib/paths.mjs';

const MARKER = '# managed by ai-tooling';

export const PRE_PUSH = `#!/bin/sh
${MARKER}
#
# The private-value scan only works where ~/.ai-tooling/values.json exists, which is
# never true on a CI runner. This is the gate that actually stops an internal
# identifier reaching a public remote. See docs/security.md.

echo "ai-tooling: running build before push"
if ! node "$(git rev-parse --show-toplevel)/scripts/build.mjs"; then
  echo ""
  echo "ai-tooling: push refused, the build failed."
  echo "Fix it, or bypass deliberately with: git push --no-verify"
  exit 1
fi
`;

export function hooksDir(root = REPO_ROOT) {
  const configured = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return path.resolve(root, configured);
}

export function isOurs(text) {
  return typeof text === 'string' && text.includes(MARKER);
}

function main() {
  const remove = process.argv.includes('--uninstall');
  const dir = hooksDir();
  const target = path.join(dir, 'pre-push');

  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (remove) {
    if (existing === null) console.log('no pre-push hook installed');
    else if (!isOurs(existing)) console.error(`! ${target} was not written by this repo. Leaving it alone.`);
    else {
      fs.rmSync(target);
      console.log(`removed ${target}`);
    }
    return;
  }

  if (existing !== null && !isOurs(existing)) {
    console.error(`! ${target} already exists and was not written by this repo.`);
    console.error('  Refusing to overwrite it. Merge the snippet from scripts/install-git-hooks.mjs by hand.');
    process.exit(1);
  }

  fs.writeFileSync(target, PRE_PUSH, 'utf8');
  try {
    fs.chmodSync(target, 0o755);
  } catch {
    // Windows filesystems without POSIX modes; git still runs the hook.
  }

  console.log(`installed ${target}`);
  console.log('  Runs npm run build before every push, so a secret-severity finding blocks it.');
  console.log('  Bypass deliberately with: git push --no-verify');
}

if (isMain(import.meta.url)) main();
export { main };
