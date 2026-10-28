import { runLane } from '../lib/lane.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES } from '../lib/config.mjs';

const LANE = 'A';

const EVENT_ALL = [
    DESTINATIONS.ACTIVITY_TRIGGERS,
    DESTINATIONS.AUTOMATION_RULE_RECORD_SCHEDULER,
    DESTINATIONS.RECORD_UPDATE,
    DESTINATIONS.MENTIONS,
];
const EVENT_NO_AUTOMATION = [DESTINATIONS.RECORD_UPDATE, DESTINATIONS.MENTIONS];
const EVENT_NO_MENTIONS = [
    DESTINATIONS.ACTIVITY_TRIGGERS,
    DESTINATIONS.AUTOMATION_RULE_RECORD_SCHEDULER,
    DESTINATIONS.RECORD_UPDATE,
];

function activityBody(marker) {
    return {
        record_type_name: FIXTURES.ACTIVITY_TYPE_NAME,
        note: `a2125 lane ${LANE} [${marker}]`,
        primary: { id: FIXTURES.PRIMARY_CONTACT, type: 'contact' },
        related: [{ id: FIXTURES.PRIMARY_CONTACT, type: 'contact' }],
        is_private: false,
    };
}

await runLane(LANE, async ({ api1, gate, marker }) => {
    const created = await api1('activity-create', {
        method: 'POST',
        path: '/activities',
        body: activityBody(marker('activity-create')),
        entityType: 'activity',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: EVENT_ALL,
    });
    gate('activity-create-2xx', created.ok, `HTTP ${created.status}: ${created.text?.slice(0, 200)}`);

    const jnid = created.body.jnid;
    gate('activity-create-returns-jnid', Boolean(jnid), 'no jnid on the create response');

    await api1('activity-update', {
        method: 'PUT',
        path: `/activities/${jnid}`,
        body: { note: `a2125 lane ${LANE} updated [${marker('activity-update')}]` },
        entityType: 'activity',
        entityJnid: jnid,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: [DESTINATIONS.RECORD_UPDATE],
        note: 'RecordUpdate only fires on a non-empty diff; note is changed so the diff is non-empty',
    });

    await api1('activity-update-empty-diff', {
        method: 'PUT',
        path: `/activities/${jnid}`,
        body: { note: `a2125 lane ${LANE} updated [${marker('activity-update')}]` },
        entityType: 'activity',
        entityJnid: jnid,
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'same note resubmitted; an empty change list must emit nothing',
    });

    await api1('activity-create-skip-automation', {
        method: 'POST',
        path: '/activities',
        query: { skip: 'automation' },
        body: activityBody(marker('activity-create-skip-automation')),
        entityType: 'activity',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: EVENT_NO_AUTOMATION,
        note: 'no ActivityTriggers, no AutomationRuleRecordScheduler',
    });

    await api1('activity-create-skip-notification', {
        method: 'POST',
        path: '/activities',
        query: { skip: 'notification' },
        body: activityBody(marker('activity-create-skip-notification')),
        entityType: 'activity',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: EVENT_NO_MENTIONS,
        note: 'no Mentions',
    });
});
