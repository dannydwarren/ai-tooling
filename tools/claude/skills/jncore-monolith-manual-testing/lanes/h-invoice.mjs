import { runLane } from '../lib/lane.mjs';
import { crudChain } from '../lib/crud.mjs';
import { FIXTURES } from '../lib/config.mjs';
import { createProduct, financialBody } from '../lib/fixtures.mjs';

const LANE = 'H';

await runLane(LANE, async (ctx) => {
    const { api1, gate } = ctx;

    const productId = await createProduct(api1, LANE);
    gate('product-fixture', Boolean(productId), 'could not create the product every line item needs');

    await crudChain(ctx, {
        lane: LANE,
        type: 'invoice',
        createPath: '/v2/invoices',
        itemPath: (id) => `/v2/invoices/${id}`,
        undeletePath: (id) => `/invoices/${id}/undelete`,
        skipUndelete: true,
        createBody: (marker) => ({
            ...financialBody(productId, marker, FIXTURES.PRIMARY_CONTACT, LANE),
            status_name: 'Draft',
            date_due: Math.floor(Date.now() / 1000) + 604800,
        }),
        modifyBody: (created, marker) => ({
            ...created,
            description: `modified by ${marker}`,
            internal_note: `modified by ${marker}`,
        }),
    });
});
