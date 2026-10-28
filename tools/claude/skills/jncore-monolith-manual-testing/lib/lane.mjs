import { RUN_ID } from './config.mjs';
import { createClient } from './call.mjs';
import { laneStatus, manifestPath } from './manifest.mjs';

export async function runLane(lane, fn) {
    const client = createClient(lane);
    const startedAt = new Date().toISOString();
    process.stdout.write(`lane ${lane} — run ${RUN_ID} — start ${startedAt}\n`);

    const gates = [];
    const gate = (name, ok, detail) => {
        gates.push({ name, ok, detail });
        if (!ok) {
            const err = new Error(`gate failed: ${name} — ${detail}`);
            err.gate = name;
            throw err;
        }
    };

    try {
        await fn({ ...client, gate, lane });
        laneStatus(lane, {
            runId: RUN_ID,
            outcome: 'completed',
            startedAt,
            endedAt: new Date().toISOString(),
            gates,
        });
        process.stdout.write(`lane ${lane} — completed — ${manifestPath(lane)}\n`);
    } catch (err) {
        laneStatus(lane, {
            runId: RUN_ID,
            outcome: err.gate ? 'gated' : 'failed',
            startedAt,
            endedAt: new Date().toISOString(),
            gates,
            error: { message: err.message, stack: err.stack },
        });
        process.stdout.write(
            `lane ${lane} — ${err.gate ? 'GATED' : 'FAILED'} — ${err.message}\n`,
        );
        process.exitCode = err.gate ? 0 : 1;
    }
}
