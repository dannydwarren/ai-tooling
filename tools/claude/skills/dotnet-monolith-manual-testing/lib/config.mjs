import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENV = process.env.DM_ENV || 'dev';
export const IDENTITY = process.env.DM_IDENTITY || 'danny';

const HOSTS = {
    dev: { app: 'https://app.dev.jobnimbus.dev', api: 'https://api.dev.jobnimbus.dev' },
    prod: { app: 'https://app.jobnimbus.com', api: 'https://api.jobnimbus.com' },
};

if (!HOSTS[ENV]) {
    throw new Error(`DM_ENV must be one of ${Object.keys(HOSTS).join(', ')}, got "${ENV}"`);
}

export const LOGIN_URL = process.env.DM_LOGIN_URL || HOSTS[ENV].app;
export const API2_BASE = process.env.DM_API2_BASE || `${HOSTS[ENV].app}/api2`;
export const ACTIVITIES_BASE = process.env.DM_ACTIVITIES_BASE || `${HOSTS[ENV].api}/activities`;

const ID_CACHE_FILE = join(homedir(), '.jobnimbus', `${ENV}.idcache.json`);
const ID_CACHE_KEY = `${IDENTITY}.${ENV}.env`;

const ID_CACHE = (() => {
    try {
        return JSON.parse(readFileSync(ID_CACHE_FILE, 'utf8'))[ID_CACHE_KEY] ?? null;
    } catch {
        return null;
    }
})();

function cachedRecordId(type) {
    for (const record of ID_CACHE?.records ?? []) {
        if (record.primary?.type === type) {
            return record.primary.id;
        }
        const related = (record.related ?? []).find((r) => r.type === type);
        if (related) {
            return related.id;
        }
    }
    return null;
}

function requireId(label, envVar, value) {
    if (value) {
        return value;
    }
    throw new Error(
        `${label} is not set. Add it to ${ID_CACHE_FILE} under "${ID_CACHE_KEY}", or export ${envVar}.`,
    );
}

export const FIXTURES = Object.freeze({
    get COMPANY() {
        return requireId('company id', 'DM_COMPANY_ID', process.env.DM_COMPANY_ID || ID_CACHE?.companyId);
    },
    get JOB() {
        return requireId('job id', 'DM_JOB_ID', process.env.DM_JOB_ID || cachedRecordId('job'));
    },
    get TASK() {
        return requireId('task id', 'DM_TASK_ID', process.env.DM_TASK_ID || cachedRecordId('task'));
    },
    get INVOICE() {
        return requireId('invoice id', 'DM_INVOICE_ID', process.env.DM_INVOICE_ID || cachedRecordId('invoice'));
    },
    get CONTACT() {
        return requireId('contact id', 'DM_CONTACT_ID', process.env.DM_CONTACT_ID || cachedRecordId('contact'));
    },
    get ESTIMATE() {
        return requireId('estimate id', 'DM_ESTIMATE_ID', process.env.DM_ESTIMATE_ID || cachedRecordId('estimate'));
    },
    get CREDIT_MEMO() {
        return requireId('credit memo id', 'DM_CREDIT_MEMO_ID', process.env.DM_CREDIT_MEMO_ID || cachedRecordId('creditmemo'));
    },
    get MATERIAL_ORDER() {
        return requireId(
            'material order id',
            'DM_MATERIAL_ORDER_ID',
            process.env.DM_MATERIAL_ORDER_ID || cachedRecordId('materialorder'),
        );
    },
    ACTIVITY_TYPE_ID: process.env.DM_ACTIVITY_TYPE_ID || '1',
    FILE_TYPE_ID: process.env.DM_FILE_TYPE_ID || '1',
});

export const RUN_ID = requireRunId();

export const OUTPUT_ROOT = process.env.DM_OUTPUT_ROOT || 'C:/src/tmp/dotnet-api2-runs';
export const RUN_DIR = join(OUTPUT_ROOT, RUN_ID);

function requireRunId() {
    const id = process.env.DM_RUN_ID;
    if (!id) {
        throw new Error('DM_RUN_ID is not set. Every lane must share one run id — run-all.sh passes it on.');
    }
    if (!/^[a-z0-9]{6,12}$/.test(id)) {
        throw new Error(`DM_RUN_ID must be 6-12 lowercase alphanumerics, got "${id}"`);
    }
    return id;
}
