# Plan: Bootstrap the `ai-tooling` repo

- **Date:** 2026-09-09
- **Status:** executing
- **Author:** Claude (autonomous overnight run), from Danny's written brief

## Brief (as given)

> The purpose of this repo is to have all of my personal skills, all ai configuration and
> settings, tooling specific folders for specific tools (ie. Claude). There will be things which
> are personal based and things which are work based. Nothing here is meant to be generic to share
> with the world, though the repo is MIT licensed and is OSS. This repo should never contain secret
> information or reveal PII. This repo should have a build process by which these types of
> information are detected and reported. There will be no AI code reviewer only static scripts
> written and contained in this repo. I intend for this repo to provide tooling and configuration
> for a variety of tools. This repo must include instructions for installing tooling to any tool I
> configure here.

Plus explicit objectives:

1. **Back up Claude.** Global `CLAUDE.md`, global skills, and configuration copied into this repo.
2. **The `no-comments` hook.** A `PostToolUse` hook on `Edit|Write` that rejects introduced code
   comments. Supplied as a coworker's bash script with their pathing; must be re-pathed for this
   machine and the script must live in this repo. Need not be operational immediately.
3. **Hook authoring + plugin hooks.** Hooks designed in this repo and installed into Claude such
   that Claude runs them *from* this repo. Hooks from other plugins must also be installable.
   Document how this works and what is possible.
4. **Skill audit.** Log every skill Claude invokes on this machine, to the repo's gitignored
   `tmp/`, for later analysis of which skills earn their keep.

Operating constraints: run autonomously, no questions, commit to `main`, record plans and
decisions.

## Objectives to deliverables

| # | Objective | Deliverable |
|---|---|---|
| O1 | Back up Claude config | `tools/claude/` mirrors the user-authored surface of `~/.claude` |
| O2 | Sync is repeatable | `scripts/claude-capture.mjs` (machine to repo), `scripts/claude-install.mjs` (repo to machine) |
| O3 | `no-comments` hook | `tools/claude/hooks/no-comments.mjs`, wired via `tools/claude/settings/hooks.json` |
| O4 | Skill audit | `tools/claude/hooks/skill-audit.mjs` writing `tmp/logs/skill-audit.jsonl`; `scripts/analyze-skill-log.mjs` |
| O5 | Secret / PII detection | `scripts/checks/scan-secrets.mjs`, `scan-pii.mjs`, data-driven from `security/patterns.json` |
| O6 | Build process | `scripts/build.mjs` plus `npm run build`; CI in `.github/workflows/build.yml` |
| O7 | Install instructions | `docs/install.md` (per tool), `tools/<tool>/README.md` |
| O8 | Hooks explained | `docs/claude/hooks.md`, `docs/claude/plugins.md`, `docs/claude/hooks-catalog.md` |
| O9 | Decisions recorded | `docs/decisions/` ADRs, this plan |

## Non-goals

- No AI-based review anywhere in the build. Static scripts only, all contained in this repo.
- Not generic. This is Danny's config; OSS licensing is incidental, not an audience.
- Not a secret store. Credentials never enter the working tree, even under `tmp/`.
- No attempt to back up machine-generated Claude state (sessions, history, caches, credentials).

## Architecture

### Repository layout

```
docs/            explanations and decision records
plans/           plans (this file)
tools/<tool>/    everything specific to one AI tool
scripts/         install/capture/build/analysis, the repo's own tooling
security/        detection patterns and the allowlist for the scanner
tests/           node:test suites for the scripts
tmp/             gitignored scratch and logs
```

`tools/<tool>/` is the extension point. Adding a new tool means adding one directory and one
section in `docs/install.md`. Claude is the first; the layout assumes there will be more.

### Install model: reference for hooks, copy for content

Two different problems, two different answers.

- **Hooks are referenced in place.** `~/.claude/settings.json` points its `command` at the
  absolute path of the script inside this repo. Editing a hook here changes behaviour immediately,
  with no reinstall step and no drift. This is exactly the "installed to Claude to use it from this
  repo" requirement.
- **Skills, commands and `CLAUDE.md` are copied.** Claude discovers these by scanning fixed
  locations (`~/.claude/skills/<name>/SKILL.md`, `~/.claude/commands/*.md`) and offers no
  redirection, so they must physically live there. `claude-install.mjs` copies repo to machine and
  `claude-capture.mjs` copies machine to repo; both support `--check` to report drift without
  writing.

See `docs/decisions/0002-install-by-reference-vs-copy.md`.

### Settings merging

`~/.claude/settings.json` holds hand-maintained settings this repo does not own (plugins,
permissions, env). The installer therefore **merges** a managed fragment rather than overwriting
the file: it reads the existing JSON, replaces only hook entries tagged as managed by this repo,
writes a timestamped backup, and leaves everything else untouched. Managed entries are identified
by a marker so re-running the installer is idempotent and uninstall is exact.

### Secret and PII policy

Two severities, because they are genuinely different risks:

- **`secret` fails the build.** Private keys, JWTs, cloud keys, tokens, passwords, connection
  strings. Non-negotiable; no allowlisting without an explicit, justified entry.
- **`pii` is reported.** Email addresses, phone numbers, absolute home-directory paths, IPs.
  These are *unavoidable* in a personal config repo. `~/.claude/CLAUDE.md` is full of absolute
  home-directory paths and referencing them is the whole point of the file. Failing the
  build on them would make the repo unusable, so they are surfaced in a report with an allowlist
  carrying a written justification per accepted finding. `--strict` promotes them to failures.

See `docs/decisions/0004-secret-and-pii-policy.md`.

### Skill audit

A `PreToolUse` hook matched on the `Skill` tool appends one JSON line per invocation to
`tmp/logs/skill-audit.jsonl`. The hook is strictly passive: it always exits 0, never blocks, and
swallows its own errors, because an audit logger that can break the session is worse than no audit
logger. `scripts/analyze-skill-log.mjs` aggregates the log into counts by skill, by source
(personal / plugin / built-in) and by project, which is the input to the "which skills do I extract
into this repo, and which work plugins are bloat" decision.

See `docs/decisions/0005-skill-audit-approach.md`.

## Execution order

1. Skeleton, `.gitignore`, `README`, plan (this file).
2. Research: Claude hook semantics; inventory of the local Claude config surface. *(parallel agents)*
3. Capture `~/.claude` user-authored content into `tools/claude/`.
4. Write the hooks (`no-comments`, `skill-audit`) and the shared hook I/O helper.
5. Write the scanner, build script, and tests.
6. Write install/capture scripts; run the installer for real.
7. Write docs (hooks, plugins, install, security) and decision records.
8. Review pass (independent agents), fix findings, verify, commit to `main`.

## Deviations from this plan, and what caused them

Recorded rather than edited into the plan above, so the reasoning stays visible.

1. **One scanner, not two.** O5 named `scan-secrets.mjs` and `scan-pii.mjs`. They became a single
   `scripts/checks/scan.mjs` with a `severity` field on each rule, because the two would have shared
   their entire file-walking, allowlist and reporting machinery and differed only in a constant.

2. **Two audit hooks, not one.** O4 assumed a single `PreToolUse` hook on the `Skill` tool. Research
   during step 2 established that a slash command typed by the user expands before the model sees
   it, so it never becomes a `Skill` tool call and `PreToolUse` never fires. A companion hook on
   `UserPromptExpansion` was added, and records now carry `invocation: user|model`. Without this the
   audit would have silently missed most of what Danny actually invokes — the exact question the
   audit exists to answer.

3. **A templating layer was added** (`{{PLACEHOLDER}}` tokens, private values in
   `~/.ai-tooling/values.json`, `security/required-values.json` declaring the key names). Not in the
   original plan. It became necessary once the repo turned out to have a public GitHub remote while
   the captured config legitimately contained employer-internal identifiers. See ADR 0006.

4. **A link checker was added** to the build. Not planned; the volume of cross-referenced
   documentation made broken relative links a certainty otherwise.

5. **The repo also ships a plugin manifest.** The plan described only the settings.json install
   route. Research showed a plugin can serve hooks, skills and commands live from a checkout, which
   is a direct answer to the "hooks from other plugins" objective, so both routes are implemented and
   documented. The script installer remains the default because the plugin route namespaces `/wip`
   as `/ai-tooling:wip`.

## Risks

| Risk | Mitigation |
|---|---|
| Installer corrupts hand-maintained `settings.json` | Merge not overwrite, timestamped backup, `--check` dry run, idempotent marker, `--uninstall` |
| Hook crashes break every edit | Hooks fail open (exit 0) on internal error; only the deliberate `no-comments` verdict exits 2 |
| `no-comments` false positives block work | Installed disabled by default; enable explicitly once trusted |
| Scanner false negatives leak a secret | Patterns are data-driven and unit-tested against a fixture corpus of known-bad strings |
| Scanner false positives make the build useless | Two severities plus a justified allowlist |
| Repo config drifts from the machine | `--check` mode in both directions, run by the build |
