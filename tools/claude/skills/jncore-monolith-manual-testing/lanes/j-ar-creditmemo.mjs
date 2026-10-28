import { runLane } from '../lib/lane.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES } from '../lib/config.mjs';
import { createProduct } from '../lib/fixtures.mjs';

const LANE = 'J';

await runLane(LANE, async ({ api1, ar, gate, marker }) => {
    const productId = await createProduct(api1, LANE);
    gate('product-fixture', Boolean(productId), 'could not create the product the credit memo line needs');

    const cm = await ar('ar-creditmemo-create', {
        method: 'POST',
        path: '/v1/credit-memos',
        extraHeaders: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
            primaryRecord: { id: FIXTURES.PRIMARY_CONTACT, type: 'contact' },
            description: `a2125 lane-${LANE} [${marker('ar-creditmemo-create')}]`,
            lineItems: [
                {
                    productId,
                    name: 'a2125 line',
                    quantity: 1,
                    price: { amount: 100, currency: 'USD' },
                    uom: 'Items',
                },
            ],
        },
        entityType: 'creditmemo',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'AR is a fixture factory, not a test target — its writes do not run JnRecord.save and never reach the cutover flag. Do not report as flag coverage',
    });
    gate(
        'ar-creditmemo-create-2xx',
        cm.ok,
        `AR credit-memo create failed: HTTP ${cm.status}: ${cm.text?.slice(0, 300)}`,
    );

    const id = cm.body?.id ?? cm.body?.data?.id;
    gate('ar-creditmemo-returns-id', Boolean(id), 'no id on the AR credit-memo response');

    let deleted;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        deleted = await ar('ar-creditmemo-delete', {
            method: 'DELETE',
            path: `/v1/credit-memos/${id}`,
            entityType: 'creditmemo',
            entityJnid: id,
            expectedAction: ACTIONS.NONE,
            expectedDestinations: [],
            note: `sets up the undelete; attempt ${attempt} (AR reads can lag its own writes)`,
        });
        if (deleted.ok || deleted.status !== 404) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    gate('ar-creditmemo-delete-2xx', deleted.ok, `HTTP ${deleted.status}`);

    const undeleted = await api1('creditmemo-undelete', {
        method: 'POST',
        path: `/creditmemos/${id}/undelete`,
        body: {},
        entityType: 'creditmemo',
        entityJnid: id,
        expectedAction: ACTIONS.UNDELETED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'the reachability question: can API1 see and reverse an AR-created, AR-deleted record',
    });
    gate(
        'ar-to-api1-reachable',
        undeleted.ok,
        `API1 could not undelete the AR-created credit memo: HTTP ${undeleted.status}. ` +
            'Lane J stops here rather than burning its remaining cases on an unproven premise.',
    );
});
