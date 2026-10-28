import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLane } from '../lib/lane.mjs';
import { token } from '../lib/login.mjs';
import { ACTIONS, API1_BASE, ARM_DIR, DESTINATIONS, FIXTURES, NONCE } from '../lib/config.mjs';
import { stripReadOnly } from '../lib/fixtures.mjs';

const LANE = 'M';
const ACTIVITY = [DESTINATIONS.ACTIVITY];
const INDEX_WAIT_MS = 15000;
const POLL_MS = 5000;
const POLL_LIMIT_MS = 180000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await runLane(LANE, async ({ api1, gate, marker }) => {
    const ids = {};

    const settings = await api1('account-settings', {
        method: 'GET',
        path: '/account/settings',
        expectedAction: ACTIONS.NONE,
        expectedDestinations: [],
    });
    gate('account-settings-2xx', settings.ok, `HTTP ${settings.status}`);
    const locations = (settings.body?.locations ?? []).filter((l) => l.is_active !== false);
    gate('two-active-locations', locations.length >= 2, `found ${locations.length}`);
    const [locA, locB] = locations.map((l) => l.id);

    const contact = await api1('contact-create', {
        method: 'POST',
        path: '/contacts',
        body: {
            first_name: 'a2125',
            last_name: `lane-${LANE}`,
            display_name: `a2125 lane-${LANE} ${NONCE} [${marker('contact-create')}]`,
            location: { id: locA },
        },
        entityType: 'contact',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: ACTIVITY,
    });
    gate('contact-create-2xx', contact.ok, `HTTP ${contact.status}: ${contact.text?.slice(0, 300)}`);
    ids.contact = contact.body.jnid;

    const job = await api1('job-create', {
        method: 'POST',
        path: '/jobs',
        body: {
            name: `a2125 lane-${LANE} ${NONCE} [${marker('job-create')}]`,
            record_type_name: FIXTURES.JOB_RECORD_TYPE,
            status_name: FIXTURES.JOB_STATUS,
            primary: { id: ids.contact },
            location: { id: locA },
        },
        entityType: 'job',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: ACTIVITY,
    });
    gate('job-create-2xx', job.ok, `HTTP ${job.status}: ${job.text?.slice(0, 300)}`);
    ids.job = job.body.jnid;

    const task = await api1('task-create', {
        method: 'POST',
        path: '/tasks',
        body: {
            title: `a2125 lane-${LANE} ${NONCE} [${marker('task-create')}]`,
            date_start: Math.floor(Date.now() / 1000),
            date_end: Math.floor(Date.now() / 1000) + 3600,
            primary: { id: ids.job, type: 'job' },
            related: [{ id: ids.job, type: 'job' }],
            location: { id: locA },
        },
        entityType: 'task',
        expectedAction: ACTIONS.CREATED,
        expectedDestinations: ACTIVITY,
    });
    gate('task-create-2xx', task.ok, `HTTP ${task.status}: ${task.text?.slice(0, 300)}`);
    ids.task = task.body.jnid;

    await sleep(INDEX_WAIT_MS);

    const read = (caseName, type, id) =>
        api1(caseName, {
            method: 'GET',
            path: `/${type}s/${id}`,
            entityType: type,
            entityJnid: id,
            expectedAction: ACTIONS.NONE,
            expectedDestinations: [],
        });

    const renamed = `a2125 lane-${LANE} ${NONCE} renamed [${marker('job-rename')}]`;
    const jobBeforeRename = (await read('job-read-before-rename', 'job', ids.job)).body;
    const rename = await api1('job-rename', {
        method: 'PUT',
        path: `/jobs/${ids.job}`,
        body: stripReadOnly({ ...jobBeforeRename, name: renamed }),
        entityType: 'job',
        entityJnid: ids.job,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: ACTIVITY,
        note: 'job save queues related_objects_update; the worker rewrites related[].name on the job children',
    });
    gate('job-rename-2xx', rename.ok, `HTTP ${rename.status}: ${rename.text?.slice(0, 300)}`);

    const jobBeforeRelocate = (await read('job-read-before-relocate', 'job', ids.job)).body;
    const relocate = await api1('job-relocate', {
        method: 'PUT',
        path: `/jobs/${ids.job}`,
        body: stripReadOnly({ ...jobBeforeRelocate, location: { id: locB } }),
        entityType: 'job',
        entityJnid: ids.job,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: ACTIVITY,
        note: 'location change queues related_objects_update_for_location; the worker moves the job children to the new location',
    });
    gate('job-relocate-2xx', relocate.ok, `HTTP ${relocate.status}: ${relocate.text?.slice(0, 300)}`);

    const contactBeforeModify = (await read('contact-read', 'contact', ids.contact)).body;
    await api1('contact-modify', {
        method: 'PUT',
        path: `/contacts/${ids.contact}`,
        body: stripReadOnly({ ...contactBeforeModify, description: `modified by ${marker('contact-modify')}` }),
        entityType: 'contact',
        entityJnid: ids.contact,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: ACTIVITY,
        note: 'contact save queues related_objects_update',
    });
    const contactBeforeRelocate = (await read('contact-read-before-relocate', 'contact', ids.contact)).body;
    await api1('contact-relocate', {
        method: 'PUT',
        path: `/contacts/${ids.contact}`,
        body: stripReadOnly({ ...contactBeforeRelocate, location: { id: locB } }),
        entityType: 'contact',
        entityJnid: ids.contact,
        expectedAction: ACTIONS.MODIFIED,
        expectedDestinations: ACTIVITY,
        note: 'contact location change queues related_objects_update_for_location',
    });

    const applied = (body) => ({
        name: (body?.related ?? []).find((r) => r.id === ids.job)?.name === renamed,
        location: body?.location?.id === locB,
    });

    const started = Date.now();
    while (Date.now() - started < POLL_LIMIT_MS) {
        const poll = await fetch(`${API1_BASE}/tasks/${ids.task}`, {
            headers: { Authorization: `Bearer ${token()}` },
        });
        const state = poll.ok ? applied(await poll.json()) : {};
        if (state.name && state.location) {
            break;
        }
        await sleep(POLL_MS);
    }
    const waitedMs = Date.now() - started;

    const taskBody = (await read('task-read-after-workers', 'task', ids.task)).body;
    const state = applied(taskBody);
    const checks = [
        {
            check: 'related_objects_update renamed the job on its task',
            ok: state.name,
            waitedMs,
            observed: (taskBody?.related ?? []).map((r) => ({ id: r.id, name: r.name })),
            expected: renamed,
        },
        {
            check: 'related_objects_update_for_location moved the task to the job location',
            ok: state.location,
            waitedMs,
            observed: taskBody?.location,
            expected: { id: locB },
        },
    ];

    for (const [type, id] of [
        ['task', ids.task],
        ['job', ids.job],
        ['contact', ids.contact],
    ]) {
        const current = (await read(`${type}-read-before-delete`, type, id)).body;
        await api1(`${type}-delete`, {
            method: 'PUT',
            path: `/${type}s/${id}`,
            body: stripReadOnly({ ...current, is_active: false }),
            entityType: type,
            entityJnid: id,
            expectedAction: ACTIONS.DELETED,
            expectedDestinations: ACTIVITY,
        });
    }

    writeFileSync(
        join(ARM_DIR, LANE, 'checks.json'),
        JSON.stringify({ ids, locations: { from: locA, to: locB }, checks }, null, 2),
    );
    for (const c of checks) {
        process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.check} (${c.waitedMs} ms)\n`);
    }
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
        throw new Error(`worker effects missing: ${failed.map((c) => c.check).join('; ')}`);
    }
});
