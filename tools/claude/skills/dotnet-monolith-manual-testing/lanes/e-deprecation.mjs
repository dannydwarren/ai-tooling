import { runLane } from '../lib/lane.mjs';
import { FIXTURES } from '../lib/config.mjs';

await runLane('e-deprecation', async ({ call }) => {
    await call('getfiletype-headers', {
        path: '/getfiletype',
        query: { id: FIXTURES.FILE_TYPE_ID },
        expect: 200,
        requireHeaders: ['Deprecation', 'Link'],
        why: 'DeprecatedEndpointAttribute must still add Deprecation/Link on endpoints without a RetirementFlagKey',
    });
});
