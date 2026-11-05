import { runLane } from '../lib/lane.mjs';
import { FIXTURES } from '../lib/config.mjs';

await runLane('c-tasks-shares', async ({ call, gate }) => {
    await call('getshare-job', {
        path: '/getshare',
        query: { id: FIXTURES.JOB, type: 'job' },
        expect: 200,
        entityJnid: FIXTURES.JOB,
        why: 'ShareService returns an ActivityInfo list and calls AttachmentAction.getAttachments, both trimmed by the PR',
    });

    const task = await call('gettask', {
        path: '/gettask',
        query: { id: FIXTURES.TASK },
        expect: 200,
        entityJnid: FIXTURES.TASK,
        why: 'TaskInfo still serializes TaskActivities (List<ActivityInfo>); ActivityInfo kept its properties',
    });

    const info = Array.isArray(task.body) ? task.body[0] : null;
    gate('task-fixture-read', info && typeof info === 'object', `gettask returned ${task.status}`);

    await call('updatetask-echo', {
        method: 'POST',
        path: '/updatetask',
        body: { ...info, TaskActivities: [] },
        expect: 200,
        entityJnid: FIXTURES.TASK,
        why: 'TasksController.UpdateTask binds [FromBody] TaskInfo, including an ActivityInfo collection',
        note: 'writes: re-saves the fixture task with the fields gettask returned',
    });

    await call('gettaskforjob-after-update', {
        path: '/gettaskforjob',
        query: { jobid: FIXTURES.JOB, pageIndex: 0, size: 10 },
        expect: 200,
        entityJnid: FIXTURES.JOB,
        why: 'read-back after the update, through the job task list',
    });
});
