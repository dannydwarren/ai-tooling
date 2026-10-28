import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARM_DIR } from './config.mjs';

const FIELDS = [
    'arm',
    'lane',
    'case',
    'seq',
    'ts',
    'method',
    'path',
    'marker',
    'correlationId',
    'httpStatus',
    'latencyMs',
    'requestFile',
    'responseFile',
    'entityType',
    'entityJnid',
    'expectedAction',
    'expectedDestinations',
    'defectRef',
    'note',
];

export function laneDir(lane) {
    const dir = join(ARM_DIR, lane);
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
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    writeFileSync(file, text, 'utf8');
    return file;
}

export function laneStatus(lane, status) {
    writeFileSync(
        join(laneDir(lane), 'status.json'),
        JSON.stringify({ lane, ...status }, null, 2),
        'utf8',
    );
}

export { FIELDS };
