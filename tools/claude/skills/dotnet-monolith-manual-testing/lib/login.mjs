import { execFileSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ENV, IDENTITY, LOGIN_URL } from './config.mjs';

let cached = null;

export function token() {
    if (cached) {
        return cached;
    }
    const out = execFileSync(
        process.execPath,
        [resolveLoginScript(), IDENTITY, ENV, '--login-url', LOGIN_URL],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!out) {
        throw new Error('jn-login.mjs produced no token');
    }
    cached = out;
    return cached;
}

function resolveLoginScript() {
    if (process.env.DM_LOGIN_SCRIPT && existsSync(process.env.DM_LOGIN_SCRIPT)) {
        return process.env.DM_LOGIN_SCRIPT;
    }
    const pattern = join(homedir(), '.claude', 'plugins', 'cache', '**', 'api-testing', 'scripts', 'jn-login.mjs')
        .replaceAll('\\', '/');
    const hits = globSync(pattern).sort();
    if (hits.length === 0) {
        throw new Error('jn-login.mjs not found under ~/.claude/plugins/cache. Set DM_LOGIN_SCRIPT.');
    }
    return hits.at(-1);
}
