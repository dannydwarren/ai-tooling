import { runLane } from '../lib/lane.mjs';
import { FIXTURES } from '../lib/config.mjs';

await runLane('d-hydration', async ({ call }) => {
    await call('activity-types', {
        base: 'activities',
        path: '/v1/activity-types',
        expect: 200,
        why: 'Activities Platform API sanity check before the hydration calls',
    });

    await call('list-self', {
        base: 'activities',
        path: '/v1/activities',
        query: { pageSize: 10, primaryRecordId: FIXTURES.JOB, primaryRecordType: 'job', relationshipDepth: 'Self' },
        expect: 200,
        entityJnid: FIXTURES.JOB,
        why: 'baseline list on the platform, no monolith hop',
    });

    await call('list-connected', {
        base: 'activities',
        path: '/v1/activities',
        query: { pageSize: 10, primaryRecordId: FIXTURES.JOB, primaryRecordType: 'job', relationshipDepth: 'Connected' },
        expect: 200,
        entityJnid: FIXTURES.JOB,
        why: 'Connected makes ActivityIdResolver call GET /api2/activities/ids — ListActivityIdsQuery, ConnectedRecordResolver and ActivityRepository all changed in the PR',
    });
});
