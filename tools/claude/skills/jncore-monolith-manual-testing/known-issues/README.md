# API1 manual testing — known issues

Defects the API1 lane harness surfaces in DEV. Every item here has been attributed, so a
future run can match against this register instead of re-investigating.

Harness: the parent folder (13 lanes, ~94 calls, `app.dev.jobnimbus.dev`);
its `endpoints/` docs cite these KI numbers. Each URL carries `?probe=<marker>`. The dev gateway
replaces `jn-correlation-id`, so search DataDog by jnid or by probe marker, never by correlation id.

Run evidence that produced this register is archived at
`C:\src\tmp\archive\2026-10-26_jncore-v9.1.441-dev-api1-validation`.

## Open defects

### KI-1 — unhandled rejection in `jn-cb.js` `_replace` on record writes

Live in production. Every affected request returns **200** to the caller while a write
rejection floats unhandled, so nothing surfaces to users or to status-code monitoring.

```
unhandledRejection: CouchbaseError: The key does not exist on the server
  safeGet         jn-cb.js:305    (stack-capture line inside safeGet)
  _replace        jn-cb.js:1112
  bluebird-retry  :71
```

| | |
|---|---|
| Trigger | estimate / invoice delete; in prod also `PUT /api1/v2/estimates/{id}?persist=false` |
| Reproduction | 6/6 deterministic in DEV, one per `estimate-delete` and `invoice-delete` |
| Prod volume | 113 hits / 7d on `nodeapi`, 5–53/day continuous |
| Suspect | PR #536 (ARCH-2280), first tag `v9.1.380` |
| Ticket | none — track under ARCH-2280 |

Not caused by the wide-events release. `jn-cb.js` is byte-identical across
`v9.1.440..v9.1.441`, and prod reproduces it while running a build with no ARCH-2525 commits.

Of the four outbox commits touching `_replace`, only #536 postdates the last clean sweep:

| commit | PR | first tag |
|---|---|---|
| `54ee69e8` | #477 | v9.1.351 |
| `f5a44f01` | #505 | v9.1.355 |
| `ab39eb4e` | #509 | v9.1.357 |
| **`8fb99fc6`** | **#536** | **v9.1.380** |

#536 added a bounded retry to the `_replace` loop — the shape that leaves a late attempt's
rejection unattached once `bluebird-retry` has moved on.

Occurrences do **not** track global CAS-conflict volume: two days with near-identical conflict
counts differ 26× in rejections, and the lowest-conflict day carries 14. They track
**single-caller write bursts against one document** — one client IP accounted for 81 hits over
two days, and one /24 produced ~15 in 41 seconds. This matches the open ARCH-2280 note that the
estimate PUT loop has only 3 attempts and no backoff, so the backoff decision already parked
there likely covers this.

```
env:prod service:nodeapi "unhandledRejection" "_replace"
```

### KI-2 — `POST /files/v2/url` 500s on a missing or empty `jnid`

`getAttachmentJnid` passes the client-supplied `jnid` straight to `jnCb.safeGet`. A missing
`jnid` or an empty string fails Couchbase key validation with `InvalidArgumentError` (the body
reads `Error fetching database: invalid argument`). `#_doesJnidExists` only swallows errors
matching `key does not exist`, so the error propagates.

- Call site: `files-api/src/files-controller/services/attachment-record-service.js:115`,
  via `files-handler.js:45` `setMetaDataAndGetS3URL`
- Lane case: `L4-files-v2-url` (omits `jnid`)
- Fails before `saveRecord`, so there is no partial write
- The route works only when the caller sends its own unique `jnid` of two or more characters;
  lane I's `file-presigned-url` does, and returns 200

A missing or empty client-supplied jnid should be treated as "not supplied" and generated
server-side, not passed to a key lookup.

### KI-3 — `POST /hover/job` returns 200 but enqueues an unprocessable message

The enqueued message carries only `customer` and no `id`. `hover-job-worker.js:21` calls
`jnCb.safeGet(jnCb.main, body.id)` and hits the same empty-key error as KI-2. Each delivery fails
three attempts; the first ends `requeued`, the second `dlq` in `hover-job-request.dlq`. The caller
sees 200 and no failure. Every attempt logs `Non-retried CB Error: invalid argument` and
`Failure outside invalid argument` on nodefarm.

Either the endpoint should reject the request, or the worker should guard the missing id.

### KI-4 — `supplier/submit` returns 500 for a business-state condition

`POST /api1/materialorders/{id}/supplier/submit` with no supplier linked returns **500** and the
plain-text body `materialorder is not linked with any supplier`. A 4xx condition returned as a
server error. Nothing crashes, so no error-detail line is logged anywhere — the wide event is the
only record of it.

Carried forward as F4 in the ARCH-2125 report.

## Expected non-2xx — do not investigate

| Lane case | Result | Why |
|---|---|---|
| `L6-htmls-proposal-badId` | 401 | Intended negative case (D4) |
| `J ar-creditmemo-delete` | 404 then 204 | Accounts-receivable read-after-write lag; the lane retries 404 on purpose |
| `L4-files-v2-url` | 500 | KI-2 |
| `F mo-supplier-submit` | 500 | KI-4 |
| `L7-htmls-estimate` | occasional 404 `ctx record could not be found` | The `<estimate>_html` state doc is not always readable straight after the estimate create. Re-run lane L; investigate only if it repeats |

## Expected error lines — do not investigate

Every full dev run writes these. `analyze-run` counts them as registered rather than problems.

| Service | Line | Per run | Why |
|---|---|---|---|
| nodefarm | `hover-job-request` delivery `@outcome:error`, `requeued` then `dlq` | 2 | KI-3, lane K `hover-job` |
| nodefarm | `Non-retried CB Error: invalid argument` | 6 | KI-3, one per attempt |
| nodefarm | `Failure outside invalid argument` | 6 | KI-3, one per attempt |
| nodeapi | `unhandledRejection … The key does not exist on the server` | ~2 | KI-1, estimate and invoice delete |
| nodeapi-files | `Non-retried CB Error: invalid argument` | 1 | KI-2, `L4-files-v2-url` |
| nodefarm | `Error in calling http://test.com` | ~2 | The dev account has an outbound webhook to `http://test.com`; `webhook-out-worker.js` logs each failed call |

## Observability gaps

- **Wide events are ~90% invisible in prod log search.** A successful wide event is `status:info`,
  and `jncore-nodeapi-service-prod` / `jncore-nodeapi-files-service-prod` carry a `sample-info`
  exclusion dropping 90% of info lines. `@main:true` needs exempting in both indexes. Ingest-time
  log metrics are unaffected, so monitors are fine; searchability is not. Those indexes are not
  managed in this repo.
- **Monitor 327643540 and `terraform/monitoring/monitor_api.tf:379` query `service:jncore-nodeapi`**,
  which returns no logs in either environment. The real tag is `nodeapi`. The monitor cannot fire.
- **`nodefarm` has its own prod `unhandledRejection` stream** (2–177/day), stacks unexamined.
  Unrelated to KI-1 until someone checks.

## Reading the stack

`jn-cb.js:305` is the stack-capture line *inside* `safeGet`:

```js
var stack = skipStackCapture ? undefined : new Error().stack;
```

It is the innermost frame of every `safeGet`-originated rejection and identifies no call site.
The discriminating frame is whatever appears below it — `_replace`, `#_doesJnidExists`,
`hover-job-worker` — so always read past the first line.
