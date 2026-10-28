---
name: jncore-monolith-manual-testing
description: Use when exercising jncore-monolith's API1 end to end against a real environment - release validation, post-deploy smoke, or reproducing a specific endpoint's behaviour. Phrasings include "run the API1 harness", "exercise API1 in dev", "did this release break API1", "test contact/job/estimate/invoice creation", "run the lanes", "smoke test jncore after the deploy", "reproduce the estimate delete rejection", "test the deployables in this PR", "verify the file-upload postprocessor / timebased automation / adhoc scripts after the deploy". Twelve parallel lanes over the full API1 write surface; writes real records to the target account.
---

# jncore-monolith manual testing

A standing harness for exercising API1 end to end against a real environment. Point it at dev
after a release, read the status profile against the last known-good run, and hand the entity ids
to whoever is reading logs.

It writes real records. Every run creates contacts, jobs, estimates, invoices and files in the
target account, soft-deletes most of them, and leaves them there.

When the request is "test the deployables in this PR", start from
[deployables](endpoints/deployables.md). It maps each jncore-monolith package to what reaches it.
The postprocessor is reached only through lane I's presigned upload. Timebased automation and
adhoc scripts are reached by no lane.

## Layout

| Path | What it is |
|---|---|
| `run-all.sh` | Fires every lane in parallel |
| `lanes/` | One file per lane — the call sequences |
| `lib/` | Shared client, config, fixtures, manifest writer |
| `endpoints/` | Per-endpoint instructions: what to call, what to expect, what lies |
| `merge-manifests.mjs` | Collapses a run's lanes into `merged.jsonl` + `summary.json` |
| `selftest.mjs` | Validates the harness without touching the network |
| `known-issues/` | Registered defects the harness surfaces, with their KI numbers |
| `baselines/` | Expected `byStatus` per environment, from the last good run |
| `C:\src\tmp\jncore-api1-runs\<runId>\` | Output — manifest, status, request and response bodies, lane logs |

Known defects the harness surfaces are registered in [known-issues](known-issues/README.md).
Check a non-2xx against that register before investigating it.

## Prerequisites

- Node 20+ on PATH. Nothing here needs the Couchbase SDK, so it runs natively on Windows.
- Credentials in `~/.jobnimbus/creds/` (`danny.dev.creds`, `danny.prod.creds`). The harness never
  reads them directly — `jn-login.mjs` from the api-testing plugin does, and only a bearer token
  crosses into the harness. No credential is ever written to `runs/`.
- Headers are never persisted. Request and response bodies are.

## Running it

```bash
H={{USER_HOME_SLASH}}/.claude/skills/jncore-monolith-manual-testing
A2125_RUN_ID=<id> bash $H/run-all.sh
```

`A2125_RUN_ID` is mandatory and must be 6–12 lowercase alphanumerics. It scopes the output
directory and every probe marker, so pick a fresh one per run and keep it — it is how you find the
run in logs afterwards.

A full 12-lane run is about 75 calls. Lane I waits up to a minute for the postprocessor; every
other lane finishes in under ten seconds.

One lane on its own, which is what you want when chasing a specific endpoint:

```bash
A2125_RUN_ID=<id> node $H/lanes/g-estimate.mjs
```

Against production — real customer account, so decide deliberately:

```bash
. $H/prod-env.sh
A2125_RUN_ID=<id> bash $H/run-all.sh
```

`prod-env.sh` carries URLs, the company id and a fixture contact. It holds no credentials. Lane K
skips `hover` and `qbchild` when the environment is prod.

Then collapse the output:

```bash
A2125_RUN_ID=<id> node $H/merge-manifests.mjs
```

Before trusting a run after editing the harness:

```bash
A2125_RUN_ID=selftest node $H/selftest.mjs
```

## Where output goes

Everything a run produces is written under `C:\src\tmp\jncore-api1-runs\<runId>\` — manifests,
status files, request and response bodies, and the per-lane logs. Nothing is written inside the
skill directory.

Override with `A2125_OUTPUT_ROOT` if you want it somewhere else.

Run output contains real request and response bodies from a live account. Keep it out of any
tracked tree.

## Environment

Dev is the default; no exports needed.

| | Dev | Prod |
|---|---|---|
| API1 | `https://app.dev.jobnimbus.dev/api1` | `https://app.jobnimbus.com/api1` |
| Accounts-receivable | `https://api.dev.jobnimbus.dev/accounts-receivable` | `https://api.jobnimbus.com/accounts-receivable` |
| Company | from the id cache | from the id cache |
| Primary contact | from the id cache | from the id cache |
| Job record type | `Residential` | `Retail` |

Every override is an `A2125_*` environment variable — see `lib/config.mjs`.

### Record ids come from the id cache

Account and fixture ids are not baked into the harness. They are read from
`~/.jobnimbus/<env>.idcache.json`, keyed by `<identity>.<env>.env` — the same cache the rest of the
API testing tooling fills in. `companyId` is taken directly; the primary contact is the first
record of type `contact`, whether it appears as a `primary` or in a `related` array.

Resolution order is **environment variable, then id cache, then a named error** — nothing falls
back to a built-in id, so a run never writes to an account you did not choose.

Both environments resolve from the cache with no setup. `prod-env.sh` carries only URLs and the job
record type — no account or record ids live in this skill.

## Lanes

| Lane | Covers | Endpoint doc |
|---|---|---|
| A | Direct activity writes, `skip` suppression | [activities](endpoints/activities.md) |
| B | Contact CRUD | [contacts](endpoints/contacts.md) |
| C | Job CRUD | [jobs](endpoints/jobs.md) |
| D | Task CRUD and completion | [tasks](endpoints/tasks.md) |
| E | Work order CRUD, both trees | [workorders](endpoints/workorders.md) |
| F | Material order CRUD, both trees, supplier submit | [materialorders](endpoints/materialorders.md) |
| G | Estimate CRUD and signing | [estimates](endpoints/estimates.md) |
| H | Invoice CRUD | [invoices](endpoints/invoices.md) |
| I | File upload, modify, delete; presigned upload through the postprocessor | [files](endpoints/files.md) |
| J | Credit memo undelete via an AR fixture | [creditmemos](endpoints/creditmemos.md) |
| K | Hover, QBD child sync, skip-system-update | [misc](endpoints/misc.md) |
| L | Negative and edge cases | [proposals](endpoints/proposals.md), [files](endpoints/files.md) |

## Reading a run

In `summary.json`, start with `byStatus`, `nonSuccessCalls` (the non-2xx rows) and
`successfulCallsWithoutEntityJnid`.

The question a run answers is **did the status profile change**. Compare `byStatus` with
`baselines/<env>.json`. An identical profile, including the same expected failures, is a pass. A
new non-2xx, or an old one that disappeared, is the finding. When a lane change alters the call
count, replace the baseline with a clean run made after the change.

A lane stops at its first failed gate and records `gated` rather than `failed`, so one broken
fixture does not cost you the other eleven lanes. Check `status.json` per lane before reading
anything into a short manifest.

## Handing off to log analysis

Every URL carries `?probe=a2125-<runId>-<arm>-<lane>-<case>`, and every row in `merged.jsonl`
records the entity jnid.

Search by **jnid or probe marker, never by correlation id** — the dev gateway replaces inbound
`jn-correlation-id`, so the one the harness generates does not survive to the logs.

A useful handoff is the run window in UTC, the company id, and the lane/case/status/jnid table out
of `merged.jsonl`.

## Methodology constraints

These are carried forward from the original plan because each one has already produced a wrong
conclusion at least once.

- **Absence of an info log proves nothing.** Datadog samples `status:info`, and in prod a
  `sample-info` exclusion filter drops 90% of them. Only error and warn are reliably retained.
  For outbox work the authoritative signal is the outbox document's own `status`/`processedAt` in
  Couchbase, not the dispatch log. Use a log only to corroborate a positive.
- **Never send `origin-jn-*` headers.** A user-principal request carrying one gets 401 —
  `GuardOriginHeaders` rejects unless the principal is a service. Origin headers belong to the S2S
  path only. Client calls send `jn-correlation-id` and nothing else.
- **API1's numeric `record_type` is not a test signal.** It is unreliable.
- **`{type} {action}` activity types are artifacts**, not findings. Type 0 with a derived label is
  the intended end state.

Signals that look decisive and are not: the returned id shape, an API1 read-back on its own,
absence from the API1 list immediately after a write, and any absent info log.

## Extending it

A lane is a call sequence wrapped in `runLane`, which handles the manifest, the gates and the
status file. `crudChain` in `lib/crud.mjs` covers the create → modify → soft-delete → undelete
shape that most record types share, so a new record type is usually a few lines.

Every call declares `expectedAction` and `expectedDestinations`, and the client rejects unknown
values at call time rather than letting a typo pass silently into the manifest. Add new values to
the frozen maps in `lib/config.mjs`.

`gate(name, ok, detail)` is for preconditions whose failure makes everything after it meaningless —
a fixture that did not create, a premise that did not hold. Use it for those, not for assertions
about the behaviour under test; a gated lane is a harness problem, and the run should say so
rather than reporting a false negative.
