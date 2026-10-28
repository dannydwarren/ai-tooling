import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENV = process.env.A2125_ENV || 'dev';
export const IDENTITY = process.env.A2125_IDENTITY || 'danny';

export const LOGIN_URL = process.env.A2125_LOGIN_URL || 'https://app.dev.jobnimbus.dev';
export const API1_BASE = process.env.A2125_API1_BASE || 'https://app.dev.jobnimbus.dev/api1';
export const AR_BASE =
    process.env.A2125_AR_BASE || 'https://api.dev.jobnimbus.dev/accounts-receivable';

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
        `${label} is not set. Add it to ${ID_CACHE_FILE} under "${ID_CACHE_KEY}", ` +
            `or export ${envVar}.`,
    );
}

export const COMPANY_ID = process.env.A2125_COMPANY_ID || ID_CACHE?.companyId || null;

export const RUN_ID = requireRunId();
export const ARM = requireArm();

export const ROOT = join(import.meta.dirname, '..');
export const OUTPUT_ROOT = process.env.A2125_OUTPUT_ROOT || 'C:/src/tmp/jncore-api1-runs';
export const RUN_DIR = join(OUTPUT_ROOT, RUN_ID);
export const ARM_DIR = join(RUN_DIR, ARM);

export const NONCE = Date.now().toString(36).slice(-6);

export const FIXTURES = Object.freeze({
    get PRIMARY_CONTACT() {
        return requireId(
            'primary contact',
            'A2125_PRIMARY_CONTACT',
            process.env.A2125_PRIMARY_CONTACT || cachedRecordId('contact'),
        );
    },
    JOB_RECORD_TYPE: process.env.A2125_JOB_RECORD_TYPE || 'Residential',
    JOB_STATUS: process.env.A2125_JOB_STATUS || 'Lead',
    ACTIVITY_TYPE_NAME: process.env.A2125_ACTIVITY_TYPE_NAME || 'Note',
});

export const DEFECTS = Object.freeze({
    D1: 'D1',
    D2: 'D2',
    D3: 'D3',
    D4: 'D4',
    D5: 'D5',
});

export const ACTIONS = Object.freeze({
    CREATED: 'Created',
    MODIFIED: 'Modified',
    DELETED: 'Deleted',
    UNDELETED: 'Undeleted',
    NONE: 'none',
});

export const DESTINATIONS = Object.freeze({
    ACTIVITY: 'Activity',
    ACTIVITY_BULK: 'ActivityBulk',
    ACTIVITY_TRIGGERS: 'ActivityTriggers',
    AUTOMATION_RULE_RECORD_SCHEDULER: 'AutomationRuleRecordScheduler',
    RECORD_UPDATE: 'RecordUpdate',
    MENTIONS: 'Mentions',
});

function requireRunId() {
    const id = process.env.A2125_RUN_ID;
    if (!id) {
        throw new Error(
            'A2125_RUN_ID is not set. Every lane must share one run id — the orchestrator sets it.',
        );
    }
    if (!/^[a-z0-9]{6,12}$/.test(id)) {
        throw new Error(`A2125_RUN_ID must be 6-12 lowercase alphanumerics, got "${id}"`);
    }
    return id;
}

function requireArm() {
    const arm = (process.env.A2125_ARM || 'on').toLowerCase();
    if (arm !== 'on' && arm !== 'off') {
        throw new Error(`A2125_ARM must be "on" or "off", got "${arm}"`);
    }
    return arm;
}
