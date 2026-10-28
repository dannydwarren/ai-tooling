import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { globSync } from 'node:fs';
import { ENV, IDENTITY, LOGIN_URL } from './config.mjs';

let cached = null;

export function token() {
    if (cached) {
        return cached;
    }
    const script = resolveLoginScript();
    const out = execFileSync(
        process.execPath,
        [script, IDENTITY, ENV, '--login-url', LOGIN_URL],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!out) {
        throw new Error('jn-login.mjs produced no token');
    }
    cached = out;
    return cached;
}

function resolveLoginScript() {
    if (process.env.A2125_LOGIN_SCRIPT && existsSync(process.env.A2125_LOGIN_SCRIPT)) {
        return process.env.A2125_LOGIN_SCRIPT;
    }
    const pattern = join(
        homedir(),
        '.claude',
        'plugins',
        'cache',
        '**',
        'api-testing',
        'scripts',
        'jn-login.mjs',
    ).replaceAll('\\', '/');
    const hits = globSync(pattern).sort();
    if (hits.length === 0) {
        throw new Error(
            'jn-login.mjs not found under ~/.claude/plugins/cache. Set A2125_LOGIN_SCRIPT.',
        );
    }
    return hits.at(-1);
}
