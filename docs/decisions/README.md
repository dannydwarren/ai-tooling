# Architecture decision records

An ADR here records a decision that shaped this repo, the situation that forced it, and what it costs.
It exists so that a decision does not have to be re-argued from scratch every time someone (including its
author, months later) wonders why the repo is built this way. An ADR is a historical record, not
documentation: it is written once, at the time of the decision, and is not edited to match later reality.
If a decision is reversed, a new ADR supersedes it and the old one stays in place with its status updated.

For how things actually work today, read `docs/install.md`, `docs/claude/hooks.md`,
`docs/claude/plugins.md` and `docs/security.md`. For the plan these decisions came out of, read
`plans/2026-09-09-bootstrap.md`.

## Numbering

Files are `NNNN-kebab-case-title.md`, numbered sequentially from `0001` in the order the decisions were
made. Numbers are never reused and never renumbered. Each record uses the same headings: `Status`,
`Context`, `Decision`, `Consequences` (split into `Good` and `Bad / accepted costs`), and
`Alternatives considered`.

## Records

| # | Title | Summary |
|---|---|---|
| [0001](0001-repository-layout.md) | Repository layout | One directory per tool under `tools/`, with repo-owned automation kept in `scripts/`, so adding a tool costs one directory and one docs section. |
| [0002](0002-install-by-reference-vs-copy.md) | Install by reference for hooks, copy for content | Hooks are referenced by absolute path from `settings.json` so edits are live; skills, commands and `CLAUDE.md` are copied because Claude only discovers them at fixed locations, with `--check` reporting drift and the installer merging rather than overwriting `settings.json`. |
| [0003](0003-node-hooks-instead-of-bash-and-jq.md) | Node hooks instead of bash + jq | Hooks are Node ESM scripts because `jq` is absent on this machine and a module can be unit tested by import — with an `isMain()` guard so importing a hook does not execute it. |
| [0004](0004-secret-and-pii-policy.md) | Secret and PII policy — two severities | `secret` findings fail the build, `pii` findings are reported unless `--strict`; patterns are data, allowlist entries need a written reason, and fixtures guard both false negatives and false positives. |
| [0005](0005-skill-audit-approach.md) | Skill audit approach | Log skill invocations as JSON lines to gitignored `tmp/`, using two hooks because typed slash commands never reach the `Skill` tool, with classification deferred to the analyzer. |
| [0006](0006-templating-private-values.md) | Templating private values outside the tree | Files under `tools/` hold `{{PLACEHOLDER}}` tokens; paths are derived, private values live in `~/.ai-tooling/values.json` outside the tree, and the scanner turns each private value into a build-failing rule. |
