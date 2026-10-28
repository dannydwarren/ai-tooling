import { runLane } from '../lib/lane.mjs';
import { ACTIONS, DESTINATIONS, DEFECTS, FIXTURES, NONCE } from '../lib/config.mjs';
import { createProduct, financialBody, stripReadOnly } from '../lib/fixtures.mjs';

const LANE = 'L';

const bumpPrice = (items) =>
    (items ?? []).map((item) => ({ ...item, price: 99, cost: 99, amount: 99 }));

function upload(marker, formRelated) {
    const form = new FormData();
    form.append('files', new Blob([`a2125 ${marker}\n`], { type: 'text/plain' }), `${marker}.txt`);
    form.append('description', `a2125 lane-${LANE} [${marker}]`);
    if (formRelated) {
        form.append('related', formRelated);
    }
    return form;
}

await runLane(LANE, async ({ api1, gate, marker }) => {
    const contact = await api1('l-fixture-contact', {
        method: 'POST',
        path: '/contacts',
        body: {
            first_name: 'a2125',
            last_name: `lane-${LANE}`,
            display_name: `a2125 lane-${LANE} ${NONCE} [${marker('l-fixture-contact')}]`,
        },
        entityType: 'contact',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'Lane L builds its own fixtures so the two arms can run at different times',
    });
    gate('l-fixture-contact-2xx', contact.ok, `HTTP ${contact.status}`);
    const contactId = contact.body.jnid;

    await api1('L1-multipart-related', {
        method: 'POST',
        path: '/files/multipart',
        form: upload(marker('L1-multipart-related'), contactId),
        entityType: 'attachment',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        defectRef: DEFECTS.D5,
        note: 'related as a multipart FORM FIELD — files-handler.js:125 reads fields.related. Expect primary and related[] to name the contact',
    });

    await api1('L2-multipart-noRelated', {
        method: 'POST',
        path: '/files/multipart',
        form: upload(marker('L2-multipart-noRelated'), null),
        entityType: 'attachment',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        defectRef: DEFECTS.D5,
        note: 'negative control for L1 — related omitted, so related[] must be absent',
    });

    await api1('L3-multipart-relatedQuery', {
        method: 'POST',
        path: '/files/multipart',
        query: { related: contactId },
        form: upload(marker('L3-multipart-relatedQuery'), null),
        entityType: 'attachment',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        defectRef: DEFECTS.D5,
        note: 'related as a QUERY PARAM — invisible to fields.related. If this returns an id and does not attach while L1 does, D5 is a harness error and the rollout blocker is withdrawn',
    });

    await api1('L4-files-v2-url', {
        method: 'POST',
        path: '/files/v2/url',
        body: {
            filename: `${marker('L4-files-v2-url')}.txt`,
            contentType: 'text/plain',
            related: [contactId],
        },
        entityType: 'attachment',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        defectRef: DEFECTS.D3,
        note: 'v2/files-handler.js:43 reads custAuth.customer with no guard that the auth context resolved one. A 500 in BOTH arms is pre-existing',
    });

    const productId = await createProduct(api1, LANE);
    gate('l-fixture-product', Boolean(productId), 'could not create the product every line item needs');

    const estimate = await api1('l-fixture-estimate', {
        method: 'POST',
        path: '/v2/estimates',
        body: { ...financialBody(productId, marker('l-fixture-estimate'), contactId, LANE), status_name: 'Draft' },
        entityType: 'estimate',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
    });

    if (estimate.ok && estimate.body?.jnid) {
        await api1('L7-htmls-estimate', {
            method: 'PUT',
            path: `/htmls/${estimate.body.jnid}_html`,
            body: { html_data: `<p>a2125 [${marker('L7-htmls-estimate')}]</p>` },
            entityType: 'estimate',
            entityJnid: estimate.body.jnid,
            expectedAction: ACTIONS.MODIFIED,
            expectedDestinations: [DESTINATIONS.ACTIVITY],
            defectRef: DEFECTS.D4,
            note: 'uses the real {recordId}_html state-doc key. A 200 here proves QA 404 was the id convention, not a defect',
        });
    }

    let proposalId = process.env.A2125_PROPOSAL_ID;
    if (!proposalId) {
        const found = await api1('l-fixture-proposal-lookup', {
            method: 'GET',
            path: '/proposals',
            query: { size: 5 },
            entityType: 'proposal',
            expectedAction: ACTIONS.NONE,
            expectedDestinations: [],
            note: 'read-only discovery — API1 registers no proposal create route, so L5 borrows an existing one',
        });
        const list = found.body?.results ?? found.body?.proposals ?? found.body?.data ?? [];
        proposalId = Array.isArray(list) ? (list[0]?.jnid ?? list[0]?.id) : undefined;
    }

    if (proposalId) {
        await api1('L5-htmls-proposal', {
            method: 'PUT',
            path: `/htmls/${proposalId}/proposal`,
            body: { html_data: `<p>a2125 [${marker('L5-htmls-proposal')}]</p>` },
            entityType: 'proposal',
            entityJnid: proposalId,
            expectedAction: ACTIONS.NONE,
            expectedDestinations: [],
            defectRef: DEFECTS.D4,
            note: 'proposal is excluded from the Modified list in buildSideEffectActivities, so no activity is the correct outcome',
        });
    } else {
        process.stdout.write(
            'lane L — L5-htmls-proposal SKIPPED: GET /proposals returned none and A2125_PROPOSAL_ID is unset. ' +
                'D4 then rests on L6 alone, which only covers the bad-id path.\n',
        );
    }

    await api1('L6-htmls-proposal-badId', {
        method: 'PUT',
        path: `/htmls/${marker('L6-htmls-proposal-badId')}/proposal`,
        body: { html_data: '<p>nonexistent proposal id</p>' },
        entityType: 'proposal',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        defectRef: DEFECTS.D4,
        note: 'html-route.js:155 uses :docid directly as the proposal id with no !jnRec guard before jnRec.customer. Should 404; a 500 is the missing-guard defect, expected in both arms',
    });

    const woBody = (label) => financialBody(productId, marker(label), contactId, LANE);

    const wo = await api1('l-fixture-workorder', {
        method: 'POST',
        path: '/v2/workorders',
        body: woBody('l-fixture-workorder'),
        entityType: 'workorder',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
        note: 'created through the v2 tree — the legacy tree registers no create route (workorders-route.js has GET, PUT /:docid and POST /:docid/undelete only). L8 still exercises the LEGACY PUT below',
    });

    if (wo.ok && wo.body?.jnid) {
        await api1('L8-wo-skip', {
            method: 'PUT',
            path: `/workorders/${wo.body.jnid}`,
            query: { skip: 'system_update_activity' },
            body: stripReadOnly({ ...wo.body, description: `L8 ${marker('L8-wo-skip')}`, items: bumpPrice(wo.body.items) }),
            entityType: 'workorder',
            entityJnid: wo.body.jnid,
            expectedAction: ACTIONS.MODIFIED,
            expectedDestinations: [DESTINATIONS.ACTIVITY],
            defectRef: DEFECTS.D1,
            note: 'the legacy route never parses skipFlags — git log -S getFlagsFromQueryString returns no commits on workorders-handler.js. An activity IS expected; its presence confirms the skip is ignored',
        });
    }

    const woV2 = await api1('l-fixture-workorder-v2', {
        method: 'POST',
        path: '/v2/workorders',
        body: woBody('l-fixture-workorder-v2'),
        entityType: 'workorder',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: [DESTINATIONS.ACTIVITY],
    });

    if (woV2.ok && woV2.body?.jnid) {
        await api1('L9-wo-v2-skip', {
            method: 'PUT',
            path: `/v2/workorders/${woV2.body.jnid}`,
            query: { skip: 'system_update_activity' },
            body: stripReadOnly({ ...woV2.body, description: `L9 ${marker('L9-wo-v2-skip')}`, items: bumpPrice(woV2.body.items) }),
            entityType: 'workorder',
            entityJnid: woV2.body.jnid,
            expectedAction: ACTIONS.NONE,
            expectedDestinations: [],
            defectRef: DEFECTS.D1,
            note: 'the v2 twin DOES honour it — v2/workorder/handler.js:176 passes skipFlags into save. Paired with L8, this is the whole of D1',
        });
    }
});
