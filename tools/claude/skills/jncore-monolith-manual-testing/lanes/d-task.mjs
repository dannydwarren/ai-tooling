import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES } from '../lib/config.mjs';

const LANE = 'D';

await runLane(LANE, async (ctx) => {
    const { api1, marker } = ctx;

    const { jnid, created } = await crudChain(ctx, {
        lane: LANE,
        type: 'task',
        createPath: '/tasks',
        itemPath: (id) => `/tasks/${id}`,
        undeletePath: (id) => `/tasks/${id}/undelete`,
        createBody: (marker) => ({
            title: `a2125 lane-${LANE} [${marker}]`,
            date_start: Math.floor(Date.now() / 1000),
            date_end: Math.floor(Date.now() / 1000) + 3600,
            primary: { id: FIXTURES.PRIMARY_CONTACT, type: 'contact' },
            related: [{ id: FIXTURES.PRIMARY_CONTACT, type: 'contact' }],
        }),
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
        }),
    });

    await api1('task-complete', {
        method: 'PUT',
        path: `/tasks/${jnid}`,
        body: { ...created, is_completed: true },
        entityType: 'task',
        entityJnid: jnid,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'completion emits an extra Task Completed activity via helpers/activity-helper.js, on top of Task Modified',
    });
});
