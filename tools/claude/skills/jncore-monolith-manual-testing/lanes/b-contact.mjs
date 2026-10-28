import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { NONCE } from '../lib/config.mjs';

const LANE = 'B';

await runLane(LANE, async (ctx) => {
    await crudChain(ctx, {
        lane: LANE,
        type: 'contact',
        createPath: '/contacts',
        itemPath: (id) => `/contacts/${id}`,
        undeletePath: (id) => `/contacts/${id}/undelete`,
        createBody: (marker) => ({
            first_name: 'a2125',
            last_name: `lane-${LANE}`,
            display_name: `a2125 lane-${LANE} ${NONCE} [${marker}]`,
            description: `created by ${marker}`,
        }),
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
        }),
    });
});
