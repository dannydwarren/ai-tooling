import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_DIR, RUN_ID } from './lib/config.mjs';

if (!existsSync(RUN_DIR)) {
    process.stderr.write(`no run directory at ${RUN_DIR}\n`);
    process.exit(1);
}

const rows = [];
const lanes = [];
for (const entry of readdirSync(RUN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'logs') {
        continue;
    }
    const dir = join(RUN_DIR, entry.name);
    const mf = join(dir, 'manifest.jsonl');
    if (existsSync(mf)) {
        for (const line of readFileSync(mf, 'utf8').split('\n')) {
            if (line.trim()) {
                rows.push(JSON.parse(line));
            }
        }
    }
    const sf = join(dir, 'status.json');
    lanes.push(
        existsSync(sf)
            ? JSON.parse(readFileSync(sf, 'utf8'))
            : { lane: entry.name, outcome: 'missing' },
    );
}

rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
writeFileSync(join(RUN_DIR, 'merged.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

const failed = rows.filter((r) => !r.pass);
const summary = {
    runId: RUN_ID,
    window: { firstWrite: rows.at(0)?.ts ?? null, lastWrite: rows.at(-1)?.ts ?? null },
    lanes: lanes.map((l) => ({ lane: l.lane, outcome: l.outcome, error: l.error?.message })),
    calls: rows.length,
    passed: rows.length - failed.length,
    failed: failed.map((r) => ({
        lane: r.lane,
        case: r.case,
        path: r.path,
        httpStatus: r.httpStatus,
        expected: r.expected,
        note: r.note,
        responseFile: r.responseFile,
    })),
    clean: failed.length === 0 && lanes.every((l) => l.outcome === 'completed'),
};
writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

process.stdout.write(`\nrun ${RUN_ID}: ${summary.passed}/${summary.calls} calls met expectations, clean=${summary.clean}\n`);
for (const l of summary.lanes.filter((x) => x.outcome !== 'completed')) {
    process.stdout.write(`  lane ${l.lane}: ${l.outcome} — ${l.error ?? ''}\n`);
}
for (const f of summary.failed) {
    process.stdout.write(`  ${f.lane}/${f.case}: ${f.httpStatus}, expected ${f.expected}${f.note ? ` (${f.note})` : ''}\n`);
}
process.stdout.write(`summary: ${join(RUN_DIR, 'summary.json')}\n`);
