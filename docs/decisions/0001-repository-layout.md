# ADR 0001: Repository layout

## Status

Accepted, 2026-09-09

## Context

This repo holds AI tooling configuration for more than one tool over time. Claude Code is the first,
but the brief in `plans/2026-09-09-bootstrap.md` is explicit that the repo should "provide tooling and
configuration for a variety of tools" and "must include instructions for installing tooling to any tool
I configure here."

Three properties constrain the layout:

1. **Multi-tool.** A layout organised around Claude Code would have to be rebuilt the first time a
   second tool arrives.
2. **Mixed personal and work content.** `tools/claude/skills/` contains personal skills
   (`wip`, `pr-review-cycle`) alongside work-shaped ones (`checking-kafka-offset-lag`). There is no
   clean split, so the layout must not try to impose one.
3. **Public OSS despite being personal.** MIT licensed and public on GitHub, but nothing here is
   written for an outside audience. That means every directory has to survive being read by a stranger,
   which is what forces `security/` and `tmp/` (gitignored) to be first-class parts of the layout rather
   than afterthoughts.

## Decision

Top-level directories, each with a single responsibility:

```
docs/            explanations and decision records (docs/claude/, docs/decisions/)
plans/           written plans, e.g. plans/2026-09-09-bootstrap.md
tools/<tool>/    everything specific to one AI tool
scripts/         repo-owned automation: install, capture, scan, analyse
security/        detection patterns and the scanner allowlist
tests/           node:test suites plus tests/fixtures/
tmp/             gitignored scratch, logs and analysis output
```

`tools/<tool>/` is the extension point. Adding a tool is one new directory plus one new section in
`docs/install.md` — no change to the scanner, the test layout, or any existing tool directory.

**Repo-owned automation never lives inside a tool directory.** `scripts/claude-install.mjs` and
`scripts/claude-capture.mjs` are named for the tool they act on but live in `scripts/`, because they are
this repo's machinery, not content Claude consumes. The inverse also holds: `tools/claude/hooks/` holds
scripts Claude executes, and those are content, not machinery. The two never mix. `scripts/lib/` and
`tools/claude/hooks/lib/` are deliberately separate helper trees for the same reason — the hooks must
not depend on repo tooling that a future refactor could move.

## Consequences

`tools/claude/` doubles as a Claude Code plugin root. Claude discovers a plugin by finding
`.claude-plugin/plugin.json` at the plugin's root, so `tools/claude/.claude-plugin/plugin.json` exists,
and the repo-root `.claude-plugin/marketplace.json` points its single plugin entry at `./tools/claude`.
The per-tool directory boundary and the plugin boundary happen to coincide, which is why the plugin
manifest sits inside `tools/claude/` rather than at the repo root, while the *marketplace* manifest
— which describes the repo as a whole — stays at the root.

### Good

- Adding a tool touches exactly one new directory and one docs section.
- A reader can tell from the path alone whether a file is consumed by a tool (`tools/`) or run by the
  repo (`scripts/`).
- `tools/claude/` being a valid plugin root came free; the plugin install path in
  `docs/claude/plugins.md` needed no restructuring.
- `security/` and `tests/fixtures/` at the top level make the "this repo must not leak" requirement
  visible rather than buried in a script.

### Bad / accepted costs

- Two `lib/` trees (`scripts/lib/`, `tools/claude/hooks/lib/`) with some conceptual overlap — both
  define an `isMain()` helper. That duplication is deliberate and is the price of keeping hooks
  independent of repo tooling.
- Personal and work content are interleaved inside `tools/claude/skills/`. Separating them would need a
  second axis of nesting that the install path (see ADR 0002) cannot express, since Claude scans
  `~/.claude/skills/<name>/SKILL.md` flat.
- Tool-specific docs are split across `tools/<tool>/README.md` and `docs/<tool>/`, so a reader has two
  places to look.

## Alternatives considered

**Flat repo mirroring `~/.claude` at the root** (`skills/`, `commands/`, `hooks/`, `CLAUDE.md`).
Rejected: it hard-codes Claude Code as the only tool. The second tool would force a full restructure,
and there would be no unambiguous home for `scripts/` or `security/` that did not look like Claude
content.

**Grouping by personal vs work** (`personal/claude/`, `work/claude/`). Rejected: the split is not clean
— `checking-kafka-offset-lag` is a work skill that is personally maintained — and it doubles the number
of directories the installer has to walk while giving no mechanical benefit. The real work/personal
boundary is enforced by ADR 0006's private-value templating, not by directory placement.

**One repo per tool.** Rejected: shared machinery (the scanner, the templating layer, the test harness)
would have to be duplicated or extracted into a package, and the whole point is a single place to look
for "how is my AI tooling configured".

**Putting install scripts inside `tools/claude/scripts/`.** Rejected: it blurs the line between what
Claude executes and what the repo executes, and it would put repo tooling inside the plugin root, where
it would ship to anyone installing the plugin.
