import { ACTIONS, NONCE } from './config.mjs';

export async function createProduct(api1, lane) {
    const res = await api1('fixture-product', {
        method: 'POST',
        path: '/products',
        body: {
            name: `a2125 lane-${lane} product ${NONCE}`,
            description: 'ARCH-2125 harness fixture',
            price: 1,
            cost: 1,
            item_type: 'material',
        },
        entityType: 'product',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'line items must reference a real product — jn-financial-api-helper.js:274 rejects any line without a resolvable product jnid. product is absent from buildSideEffectActivities, so no activity is expected',
    });
    return res.body?.jnid ?? null;
}

export function lineItem(productId, label) {
    return {
        jnid: productId,
        name: `a2125 ${label}`,
        quantity: 1,
        price: 1,
        cost: 1,
        item_type: 'material',
    };
}

export function financialBody(productId, label, contactId, lane) {
    return {
        date_created: Math.floor(Date.now() / 1000),
        description: `a2125 lane-${lane} ${label}`,
        primary: { id: contactId, type: 'contact' },
        related: [{ id: contactId, type: 'contact' }],
        items: [lineItem(productId, label)],
    };
}

const READ_ONLY_FIELDS = [
    'recid',
    'guid',
    'parent_approved_estimate_total',
    'parent_approved_invoice_total',
    'parent_approved_invoice_due',
    'parent_last_estimate',
    'parent_last_invoice',
    'payments',
    'total_paid',
    'due',
];

export function stripReadOnly(record) {
    const out = { ...record };
    for (const field of READ_ONLY_FIELDS) {
        delete out[field];
    }
    return out;
}
