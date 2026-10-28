import { randomUUID } from 'node:crypto';
import { runLane } from '../lib/lane.mjs';
import { token } from '../lib/login.mjs';
import { ACTIONS, API1_BASE, DESTINATIONS, FIXTURES } from '../lib/config.mjs';

const LANE = 'I';
const POSTPROCESSOR_POLLS = 12;
const POSTPROCESSOR_POLL_MS = 5000;

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

    const presignedJnid = `a2125${randomUUID().replaceAll('-', '').slice(0, 18)}`;
    const signed = await api1('file-presigned-url', {
        method: 'POST',
        path: '/files/v2/url',
        body: {
            filename: `${marker('file-presigned-url')}.txt`,
            contentType: 'text/plain',
            description: `a2125 lane-${LANE} [${marker('file-presigned-url')}]`,
            related: [FIXTURES.PRIMARY_CONTACT],
            jnid: presignedJnid,
        },
        entityType: 'attachment',
        entityJnid: presignedJnid,
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'writes the tmp record and signs an S3 PUT; the client must supply jnid (KI-2)',
    });
    gate(
        'file-presigned-url-2xx',
        signed.ok && Boolean(signed.body?.url),
        `HTTP ${signed.status}: ${signed.text?.slice(0, 300)}`,
    );

    const put = await fetch(signed.body.url, {
        method: 'PUT',
        body: `a2125 ${marker('file-presigned-url')}\n`,
    });
    gate('file-presigned-s3-put', put.ok, `S3 PUT HTTP ${put.status}`);

    const meta = `/files/${presignedJnid}/meta`;
    for (let attempt = 0; attempt < POSTPROCESSOR_POLLS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POSTPROCESSOR_POLL_MS));
        const poll = await fetch(`${API1_BASE}${meta}`, {
            headers: { Authorization: `Bearer ${token()}` },
        });
        if (poll.ok) {
            break;
        }
    }

    await api1('file-presigned-processed', {
        method: 'GET',
        path: meta,
        entityType: 'attachment',
        entityJnid: presignedJnid,
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
        note: 'file-upload-postprocessor moves the tmp record into main; 404 means the SQS message was not processed within the poll window',
    });
});
