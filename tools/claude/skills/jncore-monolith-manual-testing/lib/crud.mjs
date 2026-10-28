import { ACTIONS, DESTINATIONS } from './config.mjs';
import { stripReadOnly } from './fixtures.mjs';

const ACTIVITY = [DESTINATIONS.ACTIVITY];

export async function crudChain(ctx, spec) {
    const { api1, gate, marker } = ctx;
    const {
        lane,
        type,
        createPath,
        itemPath,
        undeletePath,
        createBody,
        modifyBody,
        undeleteMethod = 'POST',
        skipUndelete = false,
        prefix = type,
    } = spec;

    const created = await api1(`${prefix}-create`, {
        method: 'POST',
        path: createPath,
        body: createBody(marker(`${prefix}-create`)),
        entityType: type,
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: ACTIVITY,
    });
    gate(
        `${prefix}-create-2xx`,
        created.ok,
        `HTTP ${created.status}: ${created.text?.slice(0, 300)}`,
    );

    const jnid = created.body?.jnid ?? created.body?.id;
    gate(`${prefix}-create-returns-jnid`, Boolean(jnid), 'no jnid on the create response');

    const item = itemPath(jnid);

    await api1(`${prefix}-modify`, {
        method: 'PUT',
        path: item,
        body: stripReadOnly(modifyBody(created.body, marker(`${prefix}-modify`))),
        entityType: type,
        entityJnid: jnid,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: ACTIVITY,
    });

    await api1(`${prefix}-delete`, {
        method: 'PUT',
        path: item,
        body: stripReadOnly({ ...created.body, is_active: false }),
        entityType: type,
        entityJnid: jnid,
        expectedAction: ACTIONS.DELETED,
        expectedDestinations: ACTIVITY,
        note: 'API1 delete is a soft delete via is_active:false, not a DELETE verb',
    });

    if (skipUndelete) {
        return { jnid, created: created.body };
    }

    await api1(`${prefix}-undelete`, {
        method: undeleteMethod,
        path: undeletePath(jnid),
        body: {},
        entityType: type,
        entityJnid: jnid,
        expectedAction: ACTIONS.UNDELETED,
        expectedDestinations: ACTIVITY,
    });

    return { jnid, created: created.body };
}
