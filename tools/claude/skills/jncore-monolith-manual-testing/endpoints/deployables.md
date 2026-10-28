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
the new task lands.

## timebased-automation

The scheduler runs in dev without help. Some cycles find real jobs, so both the cycle and the
per-job paths show up within a few minutes. To check a logging change, compare lines before and
after the deploy. To force the per-job path, create a time-based automation in the dev account.

## adhoc-scripts

Run `.github/workflows/adhoc.yml` with `environment: dev`, `version: <branch or tag>` and
`node_args: --script <name>`.

- **Uncheck Skip Terraform** if the `adhoc_scripts` stack might be stale. A task definition that
  still references a secret since deleted fails to start with `TaskFailedToStart … marked for
  deletion`, and the script never runs.
- `user-removal-for-bcr-cleanup-preview` is a dry run and safe. It hardcodes the prod BCR company
  id, so in dev it always throws `DocumentNotFoundError`. That tests the thrown-error path only:
  exit 1, with an error logged.
- A script nobody recognises exits 0 with an error. It tests the init-failure path.

## Scheduled crons do not run the branch image

Crons in `terraform/adhoc_scripts/nodescript-cron.tf` take a hardcoded image tag, not the deployed
release. `jncore-custom-nodescript:master` is never published, because the pipeline tags only
`<version>` and `security-latest`, so it resolves to a 2025 image (ARCH-2550). A passing manual
adhoc run says nothing about what the scheduled run executes. Check the cron's `image` before
assuming a merged change reaches it.
