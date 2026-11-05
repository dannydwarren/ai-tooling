import { runLane } from '../lib/lane.mjs';
import { FIXTURES } from '../lib/config.mjs';

await runLane('b-auth', async ({ call }) => {
    await call('gettask-gateway-policy', {
        path: '/gettask',
        query: { id: FIXTURES.TASK },
        expect: 200,
        entityJnid: FIXTURES.TASK,
        why: 'GatewayPrincipal:User,Service policy — GatewayPrincipalTypePolicyProvider resolves it before its fallback',
    });

    await call('gettaskforjob-default-policy', {
        path: '/gettaskforjob',
        query: { jobid: FIXTURES.JOB, pageIndex: 0, size: 10 },
        expect: 200,
        entityJnid: FIXTURES.JOB,
        why: 'no named policy — the default policy, built by GatewayPrincipalTypePolicyProvider',
    });

    await call('getactivitytype', {
        path: '/getactivitytype',
        query: { id: FIXTURES.ACTIVITY_TYPE_ID },
        expect: 200,
        why: 'ActivityTypeController stays; CustomerRepository lost the activity-type auto-create method',
    });

    await call('delete-missing-email-settings-scope', {
        method: 'DELETE',
        path: '/emails/v1/emails/dmmissing0000000',
        expect: 404,
        why: '[AuthorizeScope(UserFeatures.Settings)] — UserFeatures moved out of RecordAuthorizationModel.cs; a missing id passes the scope filter and deletes nothing',
    });

    await call('invoicelist-exception-filter', {
        path: '/invoicelist',
        query: { jobid: FIXTURES.JOB },
        expect: 200,
        entityJnid: FIXTURES.JOB,
        why: 'InvoicesController carries GeneralExceptionFilterAttribute, which lost its ValidationException arm',
    });

    await call('getinvoice', {
        path: '/getinvoice',
        query: { id: FIXTURES.INVOICE },
        expect: 200,
        entityJnid: FIXTURES.INVOICE,
        why: 'GatewayPrincipal:User,Service policy on a GeneralExceptionFilterAttribute controller',
    });

    await call('getinvoice-missing', {
        path: '/getinvoice',
        query: { id: 'dmmissing0000000' },
        expect: { below: 500 },
        why: 'a missing record goes through GeneralExceptionFilterAttribute; NotFound/Forbidden mapping must not turn into a 500',
    });
});
