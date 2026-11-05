import { runLane } from '../lib/lane.mjs';
import { FIXTURES } from '../lib/config.mjs';
import { first, savedOk } from '../lib/checks.mjs';

const RECORDS = [
    ['contact', () => FIXTURES.CONTACT, '/getcontact', '/updatecontact'],
    ['job', () => FIXTURES.JOB, '/getjob', '/updatejob'],
    ['invoice', () => FIXTURES.INVOICE, '/getinvoice', '/updateinvoice'],
    ['creditmemo', () => FIXTURES.CREDIT_MEMO, '/getcreditmemo', '/updatecreditmemo'],
    ['materialorder', () => FIXTURES.MATERIAL_ORDER, '/getmaterialorder', '/updatematerialorder'],
];

await runLane('f-edits', async ({ call }) => {
    for (const [type, idOf, getPath, updatePath] of RECORDS) {
        const id = idOf();
        const read = await call(`get-${type}`, {
            path: getPath,
            query: { id },
            expect: 200,
            entityJnid: id,
            why: `fixture ${type} to re-save`,
        });
        const record = first(read.body);
        if (!record || typeof record !== 'object') {
            continue;
        }
        await call(`update-${type}-echo`, {
            method: 'POST',
            path: updatePath,
            body: record,
            expect: 200,
            check: savedOk,
            entityJnid: id,
            why: `edit path: the ${type} save writes its side-effect activity through IActivityAction.AddActivity and ActivityRepository.Save, both changed by the PR`,
            note: `writes: re-saves the fixture ${type} with the fields ${getPath} returned`,
        });
    }
});
