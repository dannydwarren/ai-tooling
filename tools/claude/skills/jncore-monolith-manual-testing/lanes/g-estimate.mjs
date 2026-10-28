import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES } from '../lib/config.mjs';
import { createProduct, financialBody } from '../lib/fixtures.mjs';

const LANE = 'G';

await runLane(LANE, async (ctx) => {
    const { api1, gate, marker } = ctx;

    const productId = await createProduct(api1, LANE);
    gate('product-fixture', Boolean(productId), 'could not create the product every line item needs');

    const { jnid } = await crudChain(ctx, {
        lane: LANE,
        type: 'estimate',
        createPath: '/v2/estimates',
        itemPath: (id) => `/v2/estimates/${id}`,
        undeletePath: (id) => `/estimates/${id}/undelete`,
        createBody: (marker) => ({
            ...financialBody(productId, marker, FIXTURES.PRIMARY_CONTACT, LANE),
            status_name: 'Draft',
        }),
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
            internal_note: `modified by ${marker}`,
        }),
    });

    await api1('estimate-html-sign', {
        method: 'PUT',
        path: `/htmls/${jnid}_html`,
        body: { html_data: `<p>a2125 lane-${LANE} [${marker('estimate-html-sign')}]</p>` },
        entityType: 'estimate',
        entityJnid: jnid,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'docid is the HTML state-doc key {recordId}_html — html-route.js:99 strips the suffix to reach the estimate. A bare estimate id 404s (html-route.js:86)',
    });
});
