import { randomUUID } from 'node:crypto';
import { API2_BASE, ACTIVITIES_BASE, RUN_ID } from './config.mjs';
import { token } from './login.mjs';
import { append, writeBody } from './manifest.mjs';

const BASES = { api2: API2_BASE, activities: ACTIVITIES_BASE };
const CAPTURED_HEADERS = ['deprecation', 'link', 'content-type'];

export function marker(lane, caseName) {
    return `dm-${RUN_ID}-${lane}-${caseName}`;
}

export function describeExpectation(expect) {
    if (typeof expect === 'number') {
        return String(expect);
    }
    if (Array.isArray(expect)) {
        return expect.join('|');
    }
    if (expect?.authorized) {
        return 'authorized (not 401/403, below 500)';
    }
    if (expect?.below) {
        return `below ${expect.below}`;
    }
    throw new Error(`unknown expectation ${JSON.stringify(expect)}`);
}

export function meets(expect, status) {
    if (typeof expect === 'number') {
        return status === expect;
    }
    if (Array.isArray(expect)) {
        return expect.includes(status);
    }
    if (expect?.authorized) {
        return status !== 401 && status !== 403 && status > 0 && status < 500;
    }
    if (expect?.below) {
        return status > 0 && status < expect.below;
    }
    throw new Error(`unknown expectation ${JSON.stringify(expect)}`);
}

export function createClient(lane) {
    let seq = 0;

    async function call(caseName, opts) {
        const {
            method = 'GET',
            path,
            base = 'api2',
            query = {},
            body,
            expect,
            requireHeaders = [],
            why,
            note,
            entityJnid,
            probe = base === 'api2',
        } = opts;
        if (expect === undefined) {
            throw new Error(`${lane}/${caseName}: every call declares expect`);
        }
        if (!why) {
            throw new Error(`${lane}/${caseName}: every call declares why — which deletion it covers`);
        }
        describeExpectation(expect);
        if (!BASES[base]) {
            throw new Error(`${lane}/${caseName}: unknown base ${base}`);
        }

        seq += 1;
        const mk = marker(lane, caseName);
        const url = new URL(BASES[base].replace(/\/+$/, '') + path);
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null) {
                url.searchParams.set(k, String(v));
            }
        }
        if (probe) {
            url.searchParams.set('probe', mk);
        }

        const headers = { Authorization: `Bearer ${token()}`, 'jn-correlation-id': randomUUID() };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        const tag = `${String(seq).padStart(3, '0')}-${caseName}`;
        const requestFile = body !== undefined ? writeBody(lane, `${tag}.req.json`, body) : null;

        const startedAt = Date.now();
        let res;
        let text;
        try {
            res = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            text = await res.text();
        } catch (err) {
            append(lane, {
                lane,
                case: caseName,
                seq,
                ts: new Date().toISOString(),
                method,
                base,
                path,
                marker: mk,
                httpStatus: 0,
                expected: describeExpectation(expect),
                pass: false,
                latencyMs: Date.now() - startedAt,
                requestFile,
                responseFile: writeBody(lane, `${tag}.err.txt`, String(err)),
                why,
                note: `transport failure: ${err.message}`,
            });
            return { status: 0, ok: false, body: null, text: '', headers: {}, pass: false };
        }

        const parsed = tryParse(text);
        const responseFile = writeBody(
            lane,
            `${tag}.res.${parsed === null ? 'txt' : 'json'}`,
            parsed === null ? text : parsed,
        );
        const captured = {};
        for (const h of CAPTURED_HEADERS) {
            const v = res.headers.get(h);
            if (v !== null) {
                captured[h] = v;
            }
        }
        const missingHeaders = requireHeaders.filter((h) => !(h.toLowerCase() in captured));
        const pass = meets(expect, res.status) && missingHeaders.length === 0;

        append(lane, {
            lane,
            case: caseName,
            seq,
            ts: new Date().toISOString(),
            method,
            base,
            path,
            marker: mk,
            httpStatus: res.status,
            expected:
                describeExpectation(expect) +
                (requireHeaders.length ? ` + headers ${requireHeaders.join(',')}` : ''),
            pass,
            headers: captured,
            latencyMs: Date.now() - startedAt,
            requestFile,
            responseFile,
            entityJnid,
            why,
            note: missingHeaders.length ? `missing headers: ${missingHeaders.join(', ')}${note ? `; ${note}` : ''}` : note,
        });

        return { status: res.status, ok: res.ok, body: parsed, text, headers: captured, pass };
    }

    return { call, marker: (c) => marker(lane, c) };
}

function tryParse(text) {
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
