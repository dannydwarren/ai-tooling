import { randomUUID } from 'node:crypto';
import { API1_BASE, AR_BASE, RUN_ID, ARM, ACTIONS, DESTINATIONS, DEFECTS } from './config.mjs';
import { token } from './login.mjs';
import { append, writeBody } from './manifest.mjs';

const VALID_ACTIONS = new Set(Object.values(ACTIONS));
const VALID_DESTINATIONS = new Set(Object.values(DESTINATIONS));
const VALID_DEFECTS = new Set(Object.values(DEFECTS));

export function marker(lane, caseName) {
    return `a2125-${RUN_ID}-${ARM}-${lane}-${caseName}`;
}

export function createClient(lane) {
    let seq = 0;

    function call(caseName, opts) {
        validateExpectations(
            lane,
            caseName,
            opts.expectedAction,
            opts.expectedDestinations,
            opts.defectRef,
        );
        return dispatch(caseName, opts);
    }

    async function dispatch(caseName, opts) {
        const {
            method,
            path,
            body,
            base = API1_BASE,
            query = {},
            expectedAction,
            expectedDestinations,
            entityType,
            entityJnid,
            defectRef,
            form,
            note,
            extraHeaders = {},
            probe = true,
        } = opts;

        seq += 1;
        const mk = marker(lane, caseName);
        const correlationId = randomUUID();
        const url = buildUrl(base, path, query, probe ? mk : null);

        const headers = {
            Authorization: `Bearer ${token()}`,
            'jn-correlation-id': correlationId,
            ...extraHeaders,
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const requestFile =
            body !== undefined
                ? writeBody(lane, `${pad(seq)}-${caseName}.req.json`, body)
                : form !== undefined
                  ? writeBody(lane, `${pad(seq)}-${caseName}.req.txt`, describeForm(form))
                  : null;

        const startedAt = Date.now();
        let res;
        let text;
        try {
            res = await fetch(url, {
                method,
                headers,
                body: form !== undefined ? form : body === undefined ? undefined : JSON.stringify(body),
            });
            text = await res.text();
        } catch (err) {
            const latencyMs = Date.now() - startedAt;
            append(lane, {
                lane,
                arm: ARM,
                case: caseName,
                seq,
                ts: new Date().toISOString(),
                method,
                path,
                marker: mk,
                correlationId,
                httpStatus: 0,
                latencyMs,
                requestFile,
                responseFile: writeBody(lane, `${pad(seq)}-${caseName}.err.txt`, String(err)),
                entityType,
                entityJnid,
                expectedAction,
                expectedDestinations,
                defectRef,
                note: `transport failure: ${err.message}`,
            });
            throw err;
        }
        const latencyMs = Date.now() - startedAt;

        const parsed = tryParse(text);
        const responseFile = writeBody(
            lane,
            `${pad(seq)}-${caseName}.res.${parsed === null ? 'txt' : 'json'}`,
            parsed === null ? text : parsed,
        );

        const resolvedJnid = entityJnid ?? parsed?.jnid ?? parsed?.id ?? null;

        append(lane, {
            arm: ARM,
            lane,
            case: caseName,
            seq,
            ts: new Date().toISOString(),
            method,
            path,
            marker: mk,
            correlationId,
            httpStatus: res.status,
            latencyMs,
            requestFile,
            responseFile,
            entityType,
            entityJnid: resolvedJnid,
            expectedAction,
            expectedDestinations,
            defectRef,
            note,
        });

        return { status: res.status, ok: res.ok, body: parsed, text, marker: mk, correlationId };
    }

    const api1 = (caseName, opts) => call(caseName, { ...opts, base: API1_BASE });
    const ar = (caseName, opts) => call(caseName, { ...opts, base: AR_BASE });

    return { call, api1, ar, marker: (c) => marker(lane, c) };
}

function validateExpectations(lane, caseName, action, destinations, defectRef) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(
            `${lane}/${caseName}: expectedAction must be one of ${[...VALID_ACTIONS].join(', ')} — got ${action}`,
        );
    }
    if (!Array.isArray(destinations)) {
        throw new Error(`${lane}/${caseName}: expectedDestinations must be an array`);
    }
    const bad = destinations.filter((d) => !VALID_DESTINATIONS.has(d));
    if (bad.length > 0) {
        throw new Error(`${lane}/${caseName}: unknown destinations ${bad.join(', ')}`);
    }
    if (defectRef !== undefined && defectRef !== null && !VALID_DEFECTS.has(defectRef)) {
        throw new Error(
            `${lane}/${caseName}: defectRef must be one of ${[...VALID_DEFECTS].join(', ')} — got ${defectRef}`,
        );
    }
    if (action === ACTIONS.NONE && destinations.includes(DESTINATIONS.ACTIVITY)) {
        throw new Error(
            `${lane}/${caseName}: expectedAction "none" cannot also expect an Activity destination`,
        );
    }
}

function buildUrl(base, path, query, probeMarker) {
    const url = new URL(base.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
            url.searchParams.set(k, String(v));
        }
    }
    if (probeMarker) {
        url.searchParams.set('probe', probeMarker);
    }
    return url.toString();
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

function pad(n) {
    return String(n).padStart(3, '0');
}

function describeForm(form) {
    return [...form.keys()]
        .map((k) => {
            const v = form.get(k);
            return typeof v === 'string' ? `${k}=${v}` : `${k}=<blob ${v.size ?? '?'}b>`;
        })
        .join('\n');
}

export { ACTIONS, DESTINATIONS, DEFECTS };
