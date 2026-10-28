import { runLane } from '../lib/lane.mjs';
import { ACTIONS, DESTINATIONS, FIXTURES } from '../lib/config.mjs';

const LANE = 'I';

function upload(marker, related) {
    const form = new FormData();
    form.append('files', new Blob([`a2125 ${marker}\n`], { type: 'text/plain' }), `${marker}.txt`);
    form.append('description', `a2125 lane-${LANE} [${marker}]`);
    if (related) {
        form.append('related', related);
    }
    return form;
}

await runLane(LANE, async ({ api1, gate, marker }) => {
    const mk = marker('file-multipart');
    const created = await api1('file-multipart', {
        method: 'POST',
        path: '/files/multipart',
        form: upload(mk, FIXTURES.PRIMARY_CONTACT),
        entityType: 'attachment',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'corrected 2026-09-17 — no file-attached activity producer exists in any repo; this asserts absence',
    });
    gate('file-multipart-2xx', created.ok, `HTTP ${created.status}: ${created.text?.slice(0, 300)}`);

    const docid = created.body?.id ?? created.body?.jnid;
    gate('file-multipart-returns-id', Boolean(docid), 'no id on the multipart response');

    await api1('file-modify', {
        method: 'PUT',
        path: `/files/${docid}`,
        body: { description: `modified by ${marker('file-modify')}`, persist: true },
        entityType: 'attachment',
        entityJnid: docid,
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'no file-modified activity producer exists; asserts absence',
    });

    await api1('file-delete', {
        method: 'DELETE',
        path: `/files/${docid}`,
        entityType: 'attachment',
        entityJnid: docid,
        expectedAction: ACTIONS.DELETED,
        expectedDestinations: [DESTINATIONS.ACTIVITY_BULK],
        note: 'createDeleteAttachmentActivity with skipAutomation:true — the only API1-reachable ActivityBulk producer, never exercised end to end before this run',
    });
});
