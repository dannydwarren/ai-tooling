import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ARM, ARM_DIR, ACTIONS, DESTINATIONS, DEFECTS } from './lib/config.mjs';
import { createClient } from './lib/call.mjs';
import { manifestPath } from './lib/manifest.mjs';

const LANE = 'selftest';
let failures = 0;

function check(name, fn) {
    try {
        fn();
        process.stdout.write(`  ok    ${name}\n`);
    } catch (err) {
        failures += 1;
        process.stdout.write(`  FAIL  ${name}\n        ${err.message}\n`);
    }
}

function throws(fn, match) {
    let threw = null;
    try {
        fn();
    } catch (err) {
        threw = err;
    }
    if (!threw) {
        throw new Error('expected a throw, got none');
    }
    if (match && !threw.message.includes(match)) {
        throw new Error(`expected message to include "${match}", got "${threw.message}"`);
    }
}

if (existsSync(join(ARM_DIR, LANE))) {
    rmSync(join(ARM_DIR, LANE), { recursive: true, force: true });
}

const client = createClient(LANE);

process.stdout.write('expectation validation\n');

check('rejects an unknown action', () =>
    throws(
        () =>
            client.api1('bad-action', {
                method: 'POST',
                path: '/nowhere',
                expectedAction: 'Frobnicated',
                expectedDestinations: [],
            }),
        'expectedAction must be one of',
    ),
);

check('rejects a non-array destinations', () =>
    throws(
        () =>
            client.api1('bad-dest-type', {
                method: 'POST',
                path: '/nowhere',
                expectedAction: ACTIONS.CREATED,
                expectedDestinations: DESTINATIONS.ACTIVITY,
            }),
        'must be an array',
    ),
);

check('rejects an unknown destination', () =>
    throws(
        () =>
            client.api1('bad-dest', {
                method: 'POST',
                path: '/nowhere',
                expectedAction: ACTIONS.CREATED,
                expectedDestinations: ['RabbitMQ'],
            }),
        'unknown destinations',
    ),
);

check('rejects an unknown defectRef', () =>
    throws(
        () =>
            client.api1('bad-defect', {
                method: 'POST',
                path: '/nowhere',
                expectedAction: ACTIONS.CREATED,
                expectedDestinations: [],
                defectRef: 'D9',
            }),
        'defectRef must be one of',
    ),
);

check('rejects action none with an Activity destination', () =>
    throws(
        () =>
            client.api1('contradiction', {
                method: 'POST',
                path: '/nowhere',
                expectedAction: ACTIONS.NONE,
                expectedDestinations: [DESTINATIONS.ACTIVITY],
            }),
        'cannot also expect an Activity',
    ),
);

process.stdout.write('manifest shape\n');

const { append, writeBody } = await import('./lib/manifest.mjs');

check('rejects an unknown manifest field', () =>
    throws(() => append(LANE, { lane: LANE, bogus: 1 }), 'unknown fields'),
);

check('writes a well-formed row', () => {
    append(LANE, {
        lane: LANE,
        case: 'synthetic',
        seq: 1,
        ts: new Date().toISOString(),
        method: 'POST',
        path: '/contacts',
        marker: 'a2125-selftest-selftest-synthetic',
        correlationId: '00000000-0000-0000-0000-000000000000',
        httpStatus: 200,
        latencyMs: 12,
        requestFile: null,
        responseFile: null,
        entityType: 'contact',
        entityJnid: 'abc123',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        defectRef: DEFECTS.D5,
        arm: ARM,
    });
    const lines = readFileSync(manifestPath(LANE), 'utf8').trim().split('\n');
    const row = JSON.parse(lines.at(-1));
    if (row.case !== 'synthetic' || row.expectedAction !== 'Created') {
        throw new Error('row did not round-trip');
    }
    if (Object.keys(row)[0] !== 'arm') {
        throw new Error('field order not preserved: arm must lead the row');
    }
    if (row.arm !== ARM || row.defectRef !== 'D5') {
        throw new Error('arm/defectRef did not round-trip');
    }
});

check('writeBody returns a real path', () => {
    const p = writeBody(LANE, 'synthetic.json', { a: 1 });
    if (!existsSync(p)) {
        throw new Error(`body file missing: ${p}`);
    }
});

process.stdout.write('marker scheme\n');

check('marker is run-, arm- and lane-scoped', () => {
    const m = client.marker('some-case');
    if (!/^a2125-[a-z0-9]{6,12}-(on|off)-selftest-some-case$/.test(m)) {
        throw new Error(`unexpected marker "${m}"`);
    }
    if (!m.includes(`-${ARM}-`)) {
        throw new Error(`marker does not carry the active arm "${ARM}": ${m}`);
    }
});

process.stdout.write(
    failures === 0 ? '\nselftest passed\n' : `\nselftest FAILED (${failures})\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
