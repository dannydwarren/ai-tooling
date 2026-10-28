import { runLane } from '../lib/lane.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES, NONCE, ENV } from '../lib/config.mjs';

const LANE = 'K';

await runLane(LANE, async ({ api1, gate, marker }) => {
    const contact = await api1('skip-fixture-contact', {
        method: 'POST',
        path: '/contacts',
        body: {
            first_name: 'a2125',
            last_name: `lane-${LANE}`,
            display_name: `a2125 lane-${LANE} ${NONCE} [${marker('skip-fixture-contact')}]`,
        },
        entityType: 'contact',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
    });
    gate('skip-fixture-contact-2xx', contact.ok, `HTTP ${contact.status}`);
    const jnid = contact.body.jnid;

    await api1('contact-modify-skip-system-update', {
        method: 'PUT',
        path: `/contacts/${jnid}`,
        query: { skip: 'system_update_activity' },
        body: { ...contact.body, description: `suppressed by ${marker('contact-modify-skip-system-update')}` },
        entityType: 'contact',
        entityJnid: jnid,
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'createUpdateActivity:false must suppress the Modified side effect entirely. A pass here is as load-bearing as a create',
    });

    if (ENV === 'prod') {
        process.stdout.write(
            'lane K — hover-job and qbchild SKIPPED in prod: both reach third-party integrations ' +
                '(Hover, QuickBooks Desktop) with payloads never verified against a real account.\n',
        );
        return;
    }

    await api1('hover-job', {
        method: 'POST',
        path: '/hover/job',
        body: {
            jnid: FIXTURES.PRIMARY_CONTACT,
            marker: marker('hover-job'),
        },
        entityType: 'job',
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'jn-hover-helper.js:163. Payload shape unverified for danny.dev — a 4xx here is a reachability finding, not a cutover finding',
    });

    await api1('qbchild', {
        method: 'POST',
        path: `/utility/qbchild/${jnid}`,
        body: {},
        entityType: 'contact',
        entityJnid: jnid,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'open question 1 in the plan — reachability with danny.dev unverified. A 4xx drops this case rather than failing the lane',
    });
});
