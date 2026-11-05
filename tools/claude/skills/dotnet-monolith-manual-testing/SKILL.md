---
name: dotnet-monolith-manual-testing
description: Use when exercising dotnet-monolith's API2 against a real environment to check a change is safe - post-deploy smoke of a branch deploy, verifying a deletion or refactor did not break surviving endpoints, or reproducing an API2 endpoint's behaviour. Phrasings include "run the API2 harness", "verify API2 in dev", "is the branch deploy safe", "smoke test dotnet-monolith after the deploy", "did deleting X break anything in API2", "check the retired routes are gone", "analyze the API2 run". Parallel lanes of targeted API2 and Activities Platform API calls plus a Datadog read of the run; writes to the target account.
---

# dotnet-monolith manual testing

A harness for exercising API2 against a real environment after a change. It is best effort, not
coverage: each lane targets the surviving code a change could have touched, and every call says
which change it covers. Point it at dev while the branch is deployed, read `summary.json`, then
let `analyze-run` check the same calls from Datadog's side.

It writes. Lane C re-saves the fixture task with the fields it just read. Nothing else writes.

## Layout

| Path | What it is |
|---|---|
| `run-all.sh` | Fires every lane in parallel, then merges |
| `run-and-analyze.sh` | `run-all.sh`, then `analyze-run` |
| `lanes/` | One file per lane — the call sequences |
| `lib/` | Client, config, manifest writer, lane runner |
| `merge.mjs` | Collapses the lanes into `merged.jsonl` + `summary.json` |
| `analysis/` | `analyze-run.py` and its `pup` wrapper — the read-only Datadog check |
| `C:\src\tmp\dotnet-api2-runs\<runId>\` | Output — manifests, request and response bodies, logs |

## Prerequisites

- Node 22+ (`fs.globSync`) and Python 3 on PATH.
- Credentials in `~/.jobnimbus/creds/`. Only `jn-login.mjs` from the api-testing plugin reads them,
  and only a bearer token reaches the harness. Headers are never persisted; bodies are.
- `pup` authenticated (`pup auth status`) for `analyze-run`.

## Running it

```bash
H={{USER_HOME_SLASH}}/.claude/skills/dotnet-monolith-manual-testing
DM_RUN_ID=<id> bash $H/run-and-analyze.sh
```

`DM_RUN_ID` is mandatory, 6–12 lowercase alphanumerics, fresh per run. It names the output
directory and every probe marker. A run is about 31 calls and finishes in seconds; `analyze-run`
then waits until the last call is three minutes old so ingestion has caught up.

One lane on its own:

```bash
DM_RUN_ID=<id> node $H/lanes/b-auth.mjs && DM_RUN_ID=<id> node $H/merge.mjs
```

## Environment and fixtures

Dev is the default. `DM_ENV=prod` switches hosts; decide that deliberately, since lane C writes.

| | Dev | Prod |
|---|---|---|
| API2 | `https://app.dev.jobnimbus.dev/api2` | `https://app.jobnimbus.com/api2` |
| Activities Platform API | `https://api.dev.jobnimbus.dev/activities` | `https://api.jobnimbus.com/activities` |

Record ids come from `~/.jobnimbus/<env>.idcache.json`, key `<identity>.<env>.env`: the company,
the first `job`, `task` and `invoice` found as a primary or related record. Resolution order is
environment variable (`DM_JOB_ID`, `DM_TASK_ID`, `DM_INVOICE_ID`, `DM_COMPANY_ID`), then the
cache, then a named error. Every override is a `DM_*` variable — see `lib/config.mjs`.

## Lanes

The lanes started from the Activities API2 sunset (dotnet-monolith #1282). Each call's `why`
names the deletion it covers.

| Lane | Covers |
|---|---|
| A `a-retired` | The 15 retired Activities routes answer 404. A 410 or 2xx gates the lane: dev is not serving the branch. The surviving `activities/ids` route answers 403 to a user token. |
| B `b-auth` | The authorization policy chain: a `GatewayPrincipal:` policy, the default policy, `[AuthorizeScope(UserFeatures.Settings)]`, and `GeneralExceptionFilterAttribute` controllers including a missing record |
| C `c-tasks-shares` | `getshare` (`ActivityInfo` list, `AttachmentAction.getAttachments`), `gettask`, and an `updatetask` echo that binds `TaskInfo` with an `ActivityInfo` collection |
| D `d-hydration` | Activities Platform API lists at `Self` and `Connected`; both make the platform call `GET /api2/activities/ids` |
| E `e-deprecation` | `DeprecatedEndpointAttribute` still adds `Deprecation` and `Link` on a Files route |

## Reading a run

`summary.json` has `clean`, `passed`/`calls`, and `failed` — each failing call with its status,
what was expected, and the response body file. A lane that stops at a gate shows `gated`; read
its `status.json` before reading anything into a short manifest.

Check a failure's response body before calling it a regression. A legacy endpoint can answer 500
for a missing or unparseable parameter (`int.Parse(null)`), which is the harness's input, not the
change.

Legacy list endpoints return `IsSuccess: false` with populated data; that flag is not a failure
signal there. `updatetask` does return a real `IsSuccess`.

## Analyzing a run (`analyze-run`)

```bash
python $H/analysis/analyze-run.py <runId>
```

Read-only. Writes `analysis.json` next to `summary.json` and exits 0 when clean.

| Section | What it checks |
|---|---|
| `harness` | Every API2 call has an api2 wide event (`@main:true`, matched on the probe in `@url.query`) with the same status and no `error` outcome |
| `hydrationHop` | The `Connected` list produced a 200 on `api2/activities/ids/{type}/{id}/{relationshipDepth}` for the fixture job |
| `api2FiveXxInWindow` | api2 5xx by route across the environment in the run window, for review |
| `startupFailuresSince` | DI resolution and worker-name failures on api2 and worker over the last `DM_SINCE_HOURS` (default 6) — set it to cover the deploy |
| `engageActivityErrorsSince` | worker errors that still mention the removed Engage activity queue, for review |

## Datadog notes

- api2 writes one wide event per request: `@main:true`, `@http.route`, `@http.response.status_code`,
  `@outcome`, `@url.path`, `@url.query`. The probe marker is in `@url.query`; search by it.
- The dev gateway replaces `jn-correlation-id`; the harness's own value never reaches the logs.
- The Activities Platform API requests `activities/ids/.../connected` in lowercase. Datadog
  attribute matching is case-sensitive.
- `pup` can return an empty result under load; an empty aggregate where rows are expected is
  retried, and a zero from a failure-count query is a pass, not proof.

## Extending it

A lane is a call sequence wrapped in `runLane`. Every call declares `expect` (a status, a list,
`{ authorized: true }` for "not 401/403 and below 500", or `{ below: 500 }`) and a `why` naming
the change it covers; the client throws at call time if either is missing. `requireHeaders`
fails a call that lacks a response header.

For a new change, add a lane per surviving surface the change touches, register it in
`run-all.sh`, and prefer read calls. Use `gate(name, ok, detail)` only for preconditions — a
fixture that did not read, a deploy that is not the branch — not for the behaviour under test.
