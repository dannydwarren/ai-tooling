import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_DIR, RUN_ID, ACTIONS, DESTINATIONS } from './lib/config.mjs';

const ARMS = ['on', 'off'];

if (!existsSync(RUN_DIR)) {
    process.stderr.write(`no run directory at ${RUN_DIR}\n`);
    process.exit(1);
}

const rows = [];
const statuses = [];

for (const arm of ARMS) {
    const armDir = join(RUN_DIR, arm);
    if (!existsSync(armDir)) {
        continue;
    }
    const lanes = readdirSync(armDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

    for (const lane of lanes) {
        const mf = join(armDir, lane, 'manifest.jsonl');
        if (existsSync(mf)) {
            for (const line of readFileSync(mf, 'utf8').split('\n')) {
                if (line.trim()) {
                    rows.push(JSON.parse(line));
                }
            }
        }
        const sf = join(armDir, lane, 'status.json');
        statuses.push(
            existsSync(sf)
                ? { arm, ...JSON.parse(readFileSync(sf, 'utf8')) }
                : { arm, lane, outcome: 'missing', note: 'lane never wrote status.json' },
        );
    }
}

rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

const window = {
    runId: RUN_ID,
    firstWrite: rows.at(0)?.ts ?? null,
    lastWrite: rows.at(-1)?.ts ?? null,
};

const byArm = tally(rows, (r) => r.arm ?? 'unset');
const byStatus = tally(rows, (r) => String(r.httpStatus));
const byAction = tally(rows, (r) => r.expectedAction ?? 'unset');
const destinationsSeen = new Set(rows.flatMap((r) => r.expectedDestinations ?? []));
const destinationsMissing = Object.values(DESTINATIONS).filter((d) => !destinationsSeen.has(d));

const nonSuccess = rows.filter((r) => r.httpStatus < 200 || r.httpStatus >= 300);
const negatives = rows.filter((r) => r.expectedAction === ACTIONS.NONE);
const missingJnid = rows.filter(
    (r) => r.expectedAction !== ACTIONS.NONE && !r.entityJnid && r.httpStatus >= 200 && r.httpStatus < 300,
);

const summary = {
    window,
    lanes: statuses.map((s) => ({ arm: s.arm, lane: s.lane, outcome: s.outcome })),
    calls: rows.length,
    byArm,
    armPairing: pairArms(rows),
    byStatus,
    byExpectedAction: byAction,
    destinationsExpectedSomewhere: [...destinationsSeen].sort(),
    destinationsNeverExpected: destinationsMissing,
    nonSuccessCalls: nonSuccess.map(pick),
    negativeCases: negatives.map(pick),
    successfulCallsWithoutEntityJnid: missingJnid.map(pick),
};

writeFileSync(join(RUN_DIR, 'merged.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(`\nmerged  ${join(RUN_DIR, 'merged.jsonl')}\n`);
process.stdout.write(`summary ${join(RUN_DIR, 'summary.json')}\n`);

if (summary.armPairing.onlyInOnArm?.length || summary.armPairing.onlyInOffArm?.length) {
    process.stdout.write(
        '\nWARNING cases present in only one arm — the on/off comparison cannot be made for them:\n' +
            `  only on:  ${summary.armPairing.onlyInOnArm.join(', ') || '(none)'}\n` +
            `  only off: ${summary.armPairing.onlyInOffArm.join(', ') || '(none)'}\n`,
    );
}

if (destinationsMissing.length > 0) {
    process.stdout.write(
        `\nWARNING destinations never expected by any lane: ${destinationsMissing.join(', ')}\n` +
            'A destination type no lane exercised is an untested claim, not a pass.\n',
    );
}

function pairArms(all) {
    const on = new Set();
    const off = new Set();
    for (const r of all) {
        (r.arm === 'off' ? off : on).add(`${r.lane}/${r.case}`);
    }
    if (on.size === 0 || off.size === 0) {
        return { paired: 0, note: 'only one arm present; run Phase 4b before pairing' };
    }
    const onlyOn = [...on].filter((k) => !off.has(k)).sort();
    const onlyOff = [...off].filter((k) => !on.has(k)).sort();
    return {
        paired: [...on].filter((k) => off.has(k)).length,
        onlyInOnArm: onlyOn,
        onlyInOffArm: onlyOff,
    };
}

function tally(list, keyOf) {
    const out = {};
    for (const item of list) {
        const k = keyOf(item);
        out[k] = (out[k] ?? 0) + 1;
    }
    return out;
}

function pick(r) {
    return {
        arm: r.arm,
        lane: r.lane,
        case: r.case,
        method: r.method,
        path: r.path,
        httpStatus: r.httpStatus,
        marker: r.marker,
        correlationId: r.correlationId,
        entityJnid: r.entityJnid,
        expectedAction: r.expectedAction,
    };
}
