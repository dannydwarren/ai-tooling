import { runLane } from '../lib/lane.mjs';
import { FIXTURES } from '../lib/config.mjs';

const RETIRED = [
    ['POST', '/updateactivity', 'updateactivity'],
    ['POST', '/v1/activities', 'v1-activities'],
    ['GET', '/getactivity', 'getactivity'],
    ['GET', '/getactivityforjob', 'getactivityforjob'],
    ['GET', '/v2/jobs/dm-probe/related-activities', 'related-activities'],
    ['GET', '/getactivityforcontact', 'getactivityforcontact'],
    ['GET', '/getactivityforassociated', 'getactivityforassociated'],
    ['GET', '/getactivityfortask', 'getactivityfortask'],
    ['GET', '/getactivityforuser', 'getactivityforuser'],
    ['GET', '/getactivitiesformaster', 'getactivitiesformaster'],
    ['GET', '/activitymethods', 'activitymethods'],
    ['POST', '/system/v1/activities', 'system-v1-create'],
    ['POST', '/system/v2/activities/dm-probe', 'system-v2-create'],
    ['GET', '/system/v1/activities/dm-probe/dm-probe', 'system-v1-get'],
    ['GET', '/guestgetactivity', 'guestgetactivity'],
];

await runLane('a-retired', async ({ call, gate }) => {
    const results = [];
    for (const [method, path, name] of RETIRED) {
        const res = await call(name, {
            method,
            path,
            body: method === 'POST' ? {} : undefined,
            expect: 404,
            why: 'retired route is no longer registered; 410 or 2xx means the branch is not what dev is serving',
        });
        results.push(res.status);
    }

    await call('activity-ids-still-registered', {
        path: `/activities/ids/job/${FIXTURES.JOB}/Self`,
        expect: [401, 403],
        why: 'the one Activities route that stays is Service-only; a user token is refused by the GatewayPrincipal policy, not 404',
    });

    gate(
        'branch-deployed',
        !results.some((s) => s === 410 || (s >= 200 && s < 300)),
        `retired routes answered ${[...new Set(results)].join(', ')}`,
    );
});
