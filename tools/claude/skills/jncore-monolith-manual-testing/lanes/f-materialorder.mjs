import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES } from '../lib/config.mjs';
import { createProduct, financialBody } from '../lib/fixtures.mjs';

const LANE = 'F';

await runLane(LANE, async (ctx) => {
    const { api1, gate, marker } = ctx;

    const productId = await createProduct(api1, LANE);
    gate('product-fixture', Boolean(productId), 'could not create the product every line item needs');

    const body = (marker) => financialBody(productId, marker, FIXTURES.PRIMARY_CONTACT, LANE);

    const legacy = await crudChain(ctx, {
        lane: LANE,
        type: 'materialorder',
        prefix: 'mo-legacy',
        createPath: '/v2/materialorders',
        itemPath: (id) => `/materialorders/${id}`,
        undeletePath: (id) => `/materialorders/${id}/undelete`,
        createBody: body,
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
            internal_note: `modified by ${marker}`,
        }),
    });

    await crudChain(ctx, {
        lane: LANE,
        type: 'materialorder',
        prefix: 'mo-v2',
        createPath: '/v2/materialorders',
        itemPath: (id) => `/v2/materialorders/${id}`,
        undeletePath: (id) => `/materialorders/${id}/undelete`,
        createBody: body,
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
            internal_note: `modified by ${marker}`,
        }),
        skipUndelete: true,
    });

    await api1('mo-supplier-submit', {
        method: 'POST',
        path: `/materialorders/${legacy.jnid}/supplier/submit`,
        body: {},
        entityType: 'materialorder',
        entityJnid: legacy.jnid,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: `supplier submit on the legacy-tree order [${marker('mo-supplier-submit')}]`,
    });
});
