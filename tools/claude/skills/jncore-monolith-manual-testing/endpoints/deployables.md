# Deployables

The lanes drive API1. A jncore-monolith PR can change deployables API1 never reaches, so map
the PR's changed packages to this table before choosing what to run.

| Package | Datadog `service` | Reached by | How to test |
|---|---|---|---|
| `api` | `nodeapi` | lanes A–H, J–L | full run |
| `files-api` | `nodeapi-files` | lanes I, L | `lanes/i-files.mjs` |
| `file-upload-postprocessor` | `file-upload-postprocessor` | presigned upload only | `lanes/i-files.mjs` — `file-presigned-*` cases ([files](files.md)) |
| `timebased-automation` | `nodefarm-worker` | its own scheduler, every 30s | nothing to drive; read the scheduler's logs |
| `adhoc-scripts` (manual) | `custom_nodescript_adhoc` | Adhoc workflow | run a script (below) |
| `adhoc-scripts` (scheduled) | the cron's name, e.g. `tax-collection` | `nodescript-cron.tf` schedule | not testable from a dev run (below) |

Search Datadog by `service` and the deploy time. The dev deploy's `task_version` tag changes when
the new task lands. That change is the before/after boundary for every check below.

## file-upload-postprocessor

Run lane I. It passes when all of these hold:

- `file-presigned-processed` returns 200.
- Datadog has exactly one `@main:true @message_type:file-upload-postprocessing @jnid:<jnid>` event
  for the lane's jnid, with `outcome:success`, `disposition:deleted` and the run's company id.
- No `status:error` line appears for `service:file-upload-postprocessor` in the run window.

## timebased-automation

The scheduler runs in dev without help. Some cycles find real jobs, so both the cycle and the
per-job paths show up within a few minutes. To force the per-job path, create a time-based
automation in the dev account.

It passes when all of these hold, after the `task_version` boundary:

- A cycle event arrives every ~30s, each with `outcome:success`.
- At least one per-job event arrives, from a real job or a forced one.
- Log lines the PR replaces stop at the boundary.
- No new error or warn pattern appears. Use the deploy-regression-watch skill for the before/after
  set difference on `service:nodefarm-worker`.

## adhoc-scripts

Dispatch the Adhoc workflow with `gh`. A dev run needs no approval:

```bash
gh workflow run adhoc.yml -R JobNimbus/jncore-monolith \
  -f environment=dev -f version=<ref> -f startup_file=src/adhoc-scripts.js \
  -f "node_args=--script <name> ..." -f skip_terraform=false
gh run list -R JobNimbus/jncore-monolith --workflow adhoc.yml --limit 1
gh run watch <runId> -R JobNimbus/jncore-monolith
```

- **`version`** is the git ref the image is built from: the PR branch while it is open, or the
  first release tag containing the merge commit (`git merge-base --is-ancestor <sha> <tag>`) once
  merged, because the branch is deleted on merge.
- **`skip_terraform=false`** applies the `adhoc_scripts` stack first. That costs about two minutes,
  but a stale stack is worse: a task definition that still references a since-deleted secret fails
  with `TaskFailedToStart … marked for deletion`, and the script never runs.
- **Dev company id:** `companyId` under `danny.dev.env` in `~/.jobnimbus/dev.idcache.json`.
- **Logs:** `service:custom_nodescript_adhoc`. A run takes about four minutes end to end; the
  script's own lines start about two minutes after dispatch. The workflow's monitor step fails
  whenever the task exits non-zero, including on purpose.

### Choosing scripts

Read the script's `case` in `adhoc-scripts/src/adhoc-scripts.js` before running it. Several
hardcode prod ids, or write unless told otherwise.

- **The PR changes the runner** (`adhoc-scripts.js`, `helper/runScript.js`): every script goes
  through it. Run one success path and one error path.
- **The PR changes one script**: run that script, in its dry-run mode if it has one, scoped to the
  dev company id from `~/.jobnimbus/dev.idcache.json`.

| Path | `node_args` | Writes |
|---|---|---|
| success | `--script FULFMNT-2037-fix-workorder-allday-dates --customerJnid <dev companyId> --limit 1` | none: dry run is the default and returns before its only write |
| thrown error | `--script user-removal-for-bcr-cleanup-preview` | none. It hardcodes the prod BCR company id, so in dev it always throws `DocumentNotFoundError` |
| init failure | `--script <a name with no case>` | none. Exits 0 with an error |

### Pass criteria

- Exactly one `@main:true @message_type:<script>` event per run, written before the task stops.
- Its `outcome` matches the path: `success` for the dry run, `error` for the other two.
- The exit code matches the path. The thrown-error path exits 1, so the workflow's monitor step
  fails. That failure is expected; check the event, not the workflow conclusion.
- `script_arguments` carries argument names and never their values.

## Scheduled crons do not run the branch image

Crons in `terraform/adhoc_scripts/nodescript-cron.tf` take a hardcoded image tag, not the deployed
release. `jncore-custom-nodescript:master` is never published, because the pipeline tags only
`<version>` and `security-latest`, so it resolves to a 2025 image (ARCH-2550). A passing manual
adhoc run says nothing about what the scheduled run executes. Check the cron's `image` before
assuming a merged change reaches it.
