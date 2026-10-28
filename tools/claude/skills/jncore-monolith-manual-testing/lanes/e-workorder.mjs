import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { FIXTURES } from '../lib/config.mjs';
import { createProduct, financialBody } from '../lib/fixtures.mjs';

const LANE = 'E';

await runLane(LANE, async (ctx) => {
    const { api1, gate } = ctx;

    const productId = await createProduct(api1, LANE);
    gate('product-fixture', Boolean(productId), 'could not create the product every line item needs');

    const body = (marker) => financialBody(productId, marker, FIXTURES.PRIMARY_CONTACT, LANE);

    await crudChain(ctx, {
        lane: LANE,
        type: 'workorder',
        prefix: 'wo-legacy',
        createPath: '/v2/workorders',
        itemPath: (id) => `/workorders/${id}`,
        undeletePath: (id) => `/workorders/${id}/undelete`,
        createBody: body,
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
            internal_note: `modified by ${marker}`,
        }),
        note: 'created on v2 because the legacy tree has no create route; modify/delete/undelete exercise the LEGACY handlers',
    });

    await crudChain(ctx, {
        lane: LANE,
        type: 'workorder',
        prefix: 'wo-v2',
        createPath: '/v2/workorders',
        itemPath: (id) => `/v2/workorders/${id}`,
        undeletePath: (id) => `/workorders/${id}/undelete`,
        createBody: body,
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
            internal_note: `modified by ${marker}`,
        }),
        skipUndelete: true,
    });
});
