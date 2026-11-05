import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_DIR } from './config.mjs';

const FIELDS = [
    'lane',
    'case',
    'seq',
    'ts',
    'method',
    'base',
    'path',
    'marker',
    'httpStatus',
    'expected',
    'pass',
    'headers',
    'latencyMs',
    'requestFile',
    'responseFile',
    'entityJnid',
    'why',
    'note',
];

export function laneDir(lane) {
    const dir = join(RUN_DIR, lane);
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function manifestPath(lane) {
    return join(laneDir(lane), 'manifest.jsonl');
}

export function append(lane, row) {
    const unknown = Object.keys(row).filter((k) => !FIELDS.includes(k));
    if (unknown.length > 0) {
        throw new Error(`manifest row for lane ${lane} has unknown fields: ${unknown.join(', ')}`);
    }
    const ordered = {};
    for (const f of FIELDS) {
        if (row[f] !== undefined) {
            ordered[f] = row[f];
        }
    }
    appendFileSync(manifestPath(lane), JSON.stringify(ordered) + '\n', 'utf8');
}

export function writeBody(lane, name, value) {
    const dir = join(laneDir(lane), 'bodies');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
    return file;
}

export function laneStatus(lane, status) {
    writeFileSync(join(laneDir(lane), 'status.json'), JSON.stringify({ lane, ...status }, null, 2), 'utf8');
}
