import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES, NONCE } from '../lib/config.mjs';

const LANE = 'C';

await runLane(LANE, async (ctx) => {
    const { api1, gate, marker } = ctx;

    const contact = await api1('job-primary-contact', {
        method: 'POST',
        path: '/contacts',
        body: {
            first_name: 'a2125',
            last_name: `lane-${LANE}-primary`,
            display_name: `a2125 lane-${LANE} primary ${NONCE} [${marker('job-primary-contact')}]`,
        },
        entityType: 'contact',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'lane fixture; also a Contact Created case in its own right',
    });
    gate('job-primary-contact-2xx', contact.ok, `HTTP ${contact.status}`);

    const primaryId = contact.body?.jnid ?? FIXTURES.PRIMARY_CONTACT;

    await crudChain(ctx, {
        lane: LANE,
        type: 'job',
        createPath: '/jobs',
        itemPath: (id) => `/jobs/${id}`,
        undeletePath: (id) => `/jobs/${id}/undelete`,
        createBody: (marker) => ({
            name: `a2125 lane-${LANE} [${marker}]`,
            record_type_name: FIXTURES.JOB_RECORD_TYPE,
            status_name: FIXTURES.JOB_STATUS,
            primary: { id: primaryId },
        }),
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
        }),
    });
});
