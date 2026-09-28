---
name: jncore-monolith-docker-test
description: Use when installing dependencies, running tests or lint, or running a real-Couchbase harness in jncore-monolith (any worktree under C:\src\jncore-monolith*) on this Windows arm64 machine. Phrasings include "install deps", "run the tests", "run the api spec", "run lint", "does this fail without the fix", "run the harness against Couchbase", "yarn install:all fails", "couchbase SDK won't load", "ELECTRON_RUN_AS_NODE". Native node cannot load the couchbase SDK here; everything runs in a node:24 Linux container driven by scripts/jnm.sh.
---

# jncore-monolith in Docker

## Overview

Native `node`, `yarn` and `mocha` do not work for jncore-monolith on this machine. It is a Snapdragon
(arm64) and the couchbase SDK has no win32-arm64 build; VS Code also sets `ELECTRON_RUN_AS_NODE`.
Inside a Linux container the SDK's linux-arm64 build loads fine, so everything runs there, through
one script. Do not run `yarn`, `npx mocha` or `node` for this repo on the host.

    J={{CLAUDE_HOME_SLASH}}/skills/jncore-monolith-docker-test/scripts/jnm.sh

## Commands

| Command | What it does |
|---|---|
| `bash $J up <wt> [--couchbase]` | Installs any package set this worktree needs that does not exist yet, then starts container `jnm-<worktree folder>`. `--couchbase` also brings up `jnm-couchbase` and joins its network. Safe to re-run; it says "already up" when nothing changed. |
| `bash $J test <wt>` | Every package's tests, one after another, then a pass/fail summary. Does not stop at the first failing package. |
| `bash $J test <wt> <pkg>` | One package's tests. |
| `bash $J test <wt> <pkg> <spec>...` | Named specs (paths relative to the package), keeping that package's own mocha flags. |
| `bash $J lint <wt> [pkg]` | Lint every package with a summary, or one package. |
| `bash $J harness <wt> <pkg> <script> [args]` | Runs a harness script from `/repo/<pkg>` with `CB_HOST=localhost`. Needs `up --couchbase`. |
| `bash $J shell <wt>` | Interactive bash in the container. |
| `bash $J down <wt> [--couchbase]` | Removes the worktree container, and optionally Couchbase. Package sets are kept. |
| `bash $J couchbase` | Starts and initialises `jnm-couchbase` on its own (buckets `main`, `state`, `tmp`). |
| `bash $J status` | Containers, plus package sets in use and unused. |
| `bash $J timings [n]` | The last `n` commands (default 15) and runs / fails / avg / last / max per command and per step, across every session. |
| `bash $J prune` | Deletes package sets no container uses. Run it now and then to reclaim disk. |

`<wt>` is the worktree path, for example `C:/src/jncore-monolith-arch-2280`. `/c/src/...` works too.

Typical session:

    bash $J up C:/src/jncore-monolith-arch-2280 --couchbase
    bash $J test C:/src/jncore-monolith-arch-2280 jncore src/connectors/jn-cb.spec.js
    bash $J test C:/src/jncore-monolith-arch-2280 api src/controllers/account-handler.spec.js
    bash $J harness C:/src/jncore-monolith-arch-2280 workers improv-tests/outbox-txn-write-conflict/run-all.sh
    bash $J test C:/src/jncore-monolith-arch-2280
    bash $J down C:/src/jncore-monolith-arch-2280

Full-suite runs are fine in this repo.

## Reporting timings to Danny (required)

Danny uses these timings to judge whether the skill is working well or needs changing. Every command
prints `[jnm] <step>: <time>` lines on stderr as it goes and ends with
`[jnm] total: <command> took <time> (exit N)`. Every line is also appended to the timings log
(`{{REPO_ROOT_SLASH}}/tmp/logs/jnm-timings.tsv`, override with `JNM_TIMINGS_LOG`).

- **After every jnm command,** tell Danny the total and any step that took a noticeable share of it,
  in one short line. For example: "`test api (specs)`: 8s (check 1s, run 5s)." Don't drop these
  lines when you summarise the test output.
- **Compare against the Timings table below.** If a command or step takes more than about twice its
  expected time, say so plainly, name the step, and suggest a likely cause. A first run after the
  machine or Docker has been idle is often slow once (a cold file cache): a 17s spec took 1m28s the
  first time after a weekend. Run it again before calling it a regression.
- **When Danny asks how the skill is doing** (or at the end of a session that used it heavily), run
  `bash $J timings` and summarise the trend: what got slower, what failed, which step dominates.
- Never let a timing line hide a failure. The exit code and pass/fail summary come first.

## How installs are shared

Installing is the slow part: every package's `node_modules` is about 1.2 GB across ~65,000 files. So
each package is installed **once per distinct set of dependencies**, not once per worktree:

- A package set is a Docker volume named `jnm-nm-<pkg>-<hash>`. The hash covers the package's
  `package.json` and `yarn.lock` (plus jncore's, for services that depend on jncore) and the image.
- `up` works out the hashes for the worktree. Sets that already exist are reused as-is. Missing sets
  are installed in a throwaway container that sees the worktree **read-only**, so an install can
  never modify your checkout.
- Worktrees off the same `main` share every set, so a new worktree comes up in seconds. A branch that
  changes one package's dependencies gets a new set for that package only.
- If a worktree's dependencies change while its container is up, `test`/`lint` refuse to run and say
  to re-run `up`.
- The host sees empty `node_modules` folders. Editors lose package type info; tests are unaffected.
  Inspect installed packages through `shell`.

## jncore is linked, not copied

Every service depends on `"@jobnimbus/jncore": "file:../jncore"`, which yarn installs as a **copy**.
Left alone, service tests would silently run the jncore from install time. The container instead
mounts the worktree's own `jncore/src` over each service's copy, so a jncore edit is live in every
service immediately. No sync step, no reinstall.

For a "does this fail without the fix" check: revert the jncore change, run `test`, restore it, run
`test` again.

## Things that will bite you without the script

- **`yarn test` at the root stops at the first failing package.** The other packages never run, and
  it is easy to read the output as "only jncore has failures". `test` runs every package.
- **Mocha timeouts are raised to 60s.** Some specs (for example
  `jncore/src/jnlib/side-effect-activity-sites.spec.js`) read every package's source; through the
  Windows bind mount that takes ~15s against a 5s budget. Override with `JNM_TEST_TIMEOUT`.
- **Service mocha runs need `--require ./src/global-config-test.js`,** jncore's do not, and
  `file-upload-postprocessor` uses jest. The spec form of `test` reads the flags from each package's
  own `test` script; do not hand-write mocha lines.
- **Lint is broken as configured, and dirty on main.** The root `.eslintrc.json` loads
  `eslint-plugin-jest`, which only `file-upload-postprocessor` installs, and ESLint 8 resolves plugins
  from the working directory. `lint` passes `--resolve-plugins-relative-to` so it actually runs. On
  `main` (2026-09-25) 7 of 9 packages already fail lint (352 errors), and CI does not run lint, so
  judge lint by the files you changed, not by the exit code.
- **`yarn install:all` stops at the first failure** and the public registry times out now and then.
  `up` installs per package with a 10 minute network timeout and 3 attempts. Install logs are at
  `/tmp/jnm-install-<pkg>.log` in the throwaway container, and the last 30 lines are printed on
  failure.
- **Couchbase must share a network namespace with the test container.** The client bootstraps from
  the node's advertised address, which is `localhost` inside `jnm-couchbase`. `jnm-couchbase`
  publishes no host ports, so it never clashes with another Couchbase container holding 8091/11210.
  If `jnm-couchbase` is recreated, worktree containers lose their network; the script warns, and
  `up <wt> --couchbase` fixes it.
- **Harness scripts that start their own Couchbase** (like the ARCH-2280 `run-all.sh`) first check
  `localhost:8091`. Through `harness` that is `jnm-couchbase`, already up, so they skip their own
  startup.

## Secrets

- `~/.npmrc` holds the private registry token. It is mounted read-only and never read, printed or
  copied into the worktree. Do not `cat` it.
- `jnm-couchbase` uses `Administrator` / `password` by default. It is a throwaway local container with
  no published ports. Override with `CB_USERNAME` / `CB_PASSWORD`. Never point this script at a
  shared Couchbase cluster.

## Overrides

| Variable | Default |
|---|---|
| `JNM_IMAGE` | `node:24` (matches `.nvmrc`) |
| `JNM_TEST_TIMEOUT` | `60000` (floor for mocha `-t`) |
| `JNM_COUCHBASE` | `jnm-couchbase` |
| `JNM_COUCHBASE_IMAGE` | `couchbase/server:enterprise-7.6.6` |
| `JNM_YARN_CACHE` | `jnm-yarn-cache` |
| `JNM_TIMINGS_LOG` | `{{REPO_ROOT_SLASH}}/tmp/logs/jnm-timings.tsv` |
| `CB_USERNAME` / `CB_PASSWORD` | `Administrator` / `password` |

## Timings

Measured on this machine (Snapdragon X, Docker Desktop), 2026-09-25 to 2026-09-28. These are the
expected values to compare `[jnm]` lines against.

| Command / step | Expected | How often |
|---|---|---|
| First `up` on the machine (all 10 package sets) | ~6 min (one run hit 27 min on a single package) | Once per machine |
| `up` for a new worktree with the same dependencies | ~20–30s | Once per worktree |
| `up` for a worktree already up | ~10s | Any time |
| `up > check package sets` | ~1s | Every `up` |
| `up > install <pkg>` | 20–70s per package | Per dependency change |
| `up > couchbase`, already running / first create | ~6s / ~1 min | Every `up --couchbase` |
| `check container` (start of test/lint/harness) | ~1s | Every command |
| One spec file (`test <pkg> <spec>`) | ~8–20s | Every run |
| Full test suite (9 packages, 3,407 tests) | ~3.5 min | Every run |
| Full lint | ~45s | Every run |
| Outbox harness against Couchbase | ~70s | Every run |

For comparison, installing into a per-worktree `node_modules` took 13–15 min per worktree on Docker
volumes, and ~16 min for jncore alone through the Windows bind mount.

`prune` deletes every package set no container references, including after you `down` the last
worktree on a set. The next `up` then pays the first-install cost again. Prune only when disk matters.
