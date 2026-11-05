import { runLane } from '../lib/lane.mjs';
import { FIXTURES, RUN_ID } from '../lib/config.mjs';
import { first, savedOk } from '../lib/checks.mjs';

const SIDE_EFFECT = 'create path: the save writes its side-effect activity through IActivityAction.AddActivity and ActivityRepository.Save, both changed by the PR';

function newId(body) {
    return body?.ObjectId ?? body?.jnid ?? null;
}

await runLane('g-creates', async ({ call, gate }) => {
    const startedAt = new Date();
    const created = {};

    const fixtureContact = first((await call('fixture-contact', {
        path: '/getcontact', query: { id: FIXTURES.CONTACT }, expect: 200, why: 'contact type and status to copy',
    })).body);
    const fixtureJob = first((await call('fixture-job', {
        path: '/getjob', query: { id: FIXTURES.JOB }, expect: 200, why: 'job type and status to copy',
    })).body);
    const fixtureTask = first((await call('fixture-task', {
        path: '/gettask', query: { id: FIXTURES.TASK }, expect: 200, why: 'task type to copy',
    })).body);
    gate('fixtures-read', fixtureContact && fixtureJob && fixtureTask, 'a fixture read returned no record');

    try {
        const contactTemplate = first((await call('contact-template', {
            path: '/getcontact', expect: 200, why: 'blank contact, as webappui loads it',
        })).body);
        const name = `dm ${RUN_ID}`;
        const contact = await call('contact-create', {
            method: 'POST',
            path: '/updatecontact',
            body: {
                ...contactTemplate,
                FirstName: 'dm',
                LastName: RUN_ID,
                display_name: name,
                ContactType: fixtureContact.ContactType,
                Status: fixtureContact.Status,
                custom_fields: fixtureContact.custom_fields,
            },
            expect: 200,
            check: savedOk,
            why: SIDE_EFFECT,
        });
        created.contact = newId(contact.body);
        gate('contact-created', created.contact, `updatecontact returned ${contact.body?.Message ?? contact.status}`);

        const jobTemplate = first((await call('job-template', {
            path: '/getjob',
            query: { loadPrimaryContactForNewJobId: created.contact },
            expect: 200,
            why: 'blank job with the new contact as primary, as webappui loads it',
        })).body);
        const job = await call('job-create', {
            method: 'POST',
            path: '/updatejob',
            body: { ...jobTemplate, Name: name, JobType: fixtureJob.JobType, Status: fixtureJob.Status, custom_fields: fixtureJob.custom_fields },
            expect: 200,
            check: savedOk,
            why: SIDE_EFFECT,
        });
        created.job = newId(job.body);
        gate('job-created', created.job, `updatejob returned ${job.body?.Message ?? job.status}`);

        const taskTemplate = first((await call('task-template', {
            path: '/gettask',
            query: { loadJobIdForNewTaskID: created.job },
            expect: 200,
            why: 'blank task on the new job, as webappui loads it',
        })).body);
        const task = await call('task-create', {
            method: 'POST',
            path: '/updatetask',
            body: {
                ...taskTemplate,
                Title: name,
                TaskType: fixtureTask.TaskType,
                DateStart: Math.floor(Date.now() / 1000) + 86400,
                DateDue: 0,
            },
            expect: 200,
            check: savedOk,
            why: SIDE_EFFECT,
        });
        created.task = newId(task.body);

        const fixtureEstimate = first((await call('fixture-estimate', {
            path: '/getestimate', query: { id: FIXTURES.ESTIMATE }, expect: 200, why: 'line items to copy; an estimate needs at least one',
        })).body);
        await new Promise((r) => setTimeout(r, 5000));
        const estimateTemplate = first((await call('estimate-template', {
            path: '/getestimate',
            query: { jobid: created.job },
            expect: 200,
            why: 'blank estimate on the new job; read 5 s after the job save, since GetEstimate dereferences the parent job and a just-saved job can read back null',
        })).body);
        const estimate = await call('estimate-create', {
            method: 'POST',
            path: '/updateestimate',
            body: { ...estimateTemplate, note: name, items: fixtureEstimate?.items ?? [] },
            expect: 200,
            check: savedOk,
            why: SIDE_EFFECT,
        });
        created.estimate = estimate.pass ? newId(estimate.body) : null;

        const editedContact = first((await call('contact-read', {
            path: '/getcontact', query: { id: created.contact }, expect: 200, entityJnid: created.contact, why: 'read back the new contact',
        })).body);
        await call('contact-edit', {
            method: 'POST',
            path: '/updatecontact',
            body: { ...editedContact, Description: `edited ${RUN_ID}` },
            expect: 200,
            check: savedOk,
            entityJnid: created.contact,
            why: `edit path: ${SIDE_EFFECT}`,
        });

        const editedJob = first((await call('job-read', {
            path: '/getjob', query: { id: created.job }, expect: 200, entityJnid: created.job, why: 'read back the new job',
        })).body);
        await call('job-edit', {
            method: 'POST',
            path: '/updatejob',
            body: { ...editedJob, Description: `edited ${RUN_ID}` },
            expect: 200,
            check: savedOk,
            entityJnid: created.job,
            why: `edit path: ${SIDE_EFFECT}`,
        });

        if (created.estimate) {
            const editedEstimate = first((await call('estimate-read', {
                path: '/getestimate', query: { id: created.estimate }, expect: 200, entityJnid: created.estimate, why: 'read back the new estimate',
            })).body);
            await call('estimate-edit', {
                method: 'POST',
                path: '/updateestimate',
                body: { ...editedEstimate, note: `edited ${RUN_ID}` },
                expect: 200,
                check: savedOk,
                entityJnid: created.estimate,
                why: `edit path: ${SIDE_EFFECT}`,
            });
        }

        if (created.task) {
            await call('task-complete', {
                path: '/taskmethods',
                query: { id: created.task, action: 'complete' },
                expect: 200,
                check: savedOk,
                entityJnid: created.task,
                why: `task completion writes a side-effect activity — ${SIDE_EFFECT}`,
            });
        }

        let found = 0;
        for (let attempt = 1; attempt <= 4 && found === 0; attempt += 1) {
            await new Promise((r) => setTimeout(r, 15000));
            const list = await call(`new-job-activities-${attempt}`, {
                base: 'activities',
                path: '/v1/activities',
                query: { pageSize: 50, primaryRecordId: created.job, primaryRecordType: 'job', relationshipDepth: 'Connected' },
                expect: 200,
                entityJnid: created.job,
                why: 'side-effect activities written by the creates and edits reach the Activities Platform API',
            });
            found = (list.body?.data ?? []).filter((a) => new Date(a.createdAt) >= startedAt).length;
        }
        await call('new-job-activities-verdict', {
            base: 'activities',
            path: '/v1/activities',
            query: { pageSize: 50, primaryRecordId: created.job, primaryRecordType: 'job', relationshipDepth: 'Connected' },
            expect: 200,
            check: (body) => {
                const n = (body?.data ?? []).filter((a) => new Date(a.createdAt) >= startedAt).length;
                return n > 0 || 'no activity created during the lane is visible on the new job';
            },
            entityJnid: created.job,
            why: 'side-effect activities written by the creates and edits reach the Activities Platform API',
        });
    } finally {
        const cleanup = [
            ['task', created.task, '/taskmethods'],
            ['estimate', created.estimate, '/estimatemethods'],
            ['job', created.job, '/jobmethods'],
            ['contact', created.contact, '/contactmethods'],
        ];
        for (const [type, id, path] of cleanup) {
            if (id) {
                await call(`delete-${type}`, {
                    path,
                    query: { id, action: 'delete' },
                    expect: 200,
                    check: savedOk,
                    entityJnid: id,
                    why: `cleanup; the soft-delete writes a side-effect activity too — ${SIDE_EFFECT}`,
                });
            }
        }
    }
});
