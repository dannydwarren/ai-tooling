# ADR 0002: Install by reference for hooks, copy for content

## Status

Accepted, 2026-09-09

## Context

The brief requires that hooks be "designed in this repo and installed into Claude such that Claude runs
them *from* this repo". That is achievable for hooks and not achievable for everything else, because
Claude Code resolves the two kinds of asset differently.

- **Hooks** are named by a `command` string in `~/.claude/settings.json`. The string is a shell command,
  so it can point anywhere on disk — including into this checkout.
- **Skills, commands and the global `CLAUDE.md`** are discovered by scanning fixed locations:
  `~/.claude/skills/<name>/SKILL.md`, `~/.claude/commands/*.md`, `~/.claude/CLAUDE.md`. There is no
  configuration key that redirects the scan elsewhere. If the file is not physically at that path,
  Claude does not see it.

One mechanism cannot serve both. Forcing a single answer would mean either copying hooks (reintroducing
the drift the brief explicitly wants to avoid) or trying to redirect skill discovery (not supported).

## Decision

**Hooks are installed by reference.** `tools/claude/settings/hooks.json` is a catalog whose `command`
strings are rendered at install time into absolute paths inside this checkout:

```json
"command": "node \"{{REPO_ROOT_SLASH}}/tools/claude/hooks/skill-audit.mjs\""
```

`scripts/claude-install.mjs` writes the rendered command into `~/.claude/settings.json`. Editing
`tools/claude/hooks/no-comments.mjs` changes behaviour on the next hook fire — no reinstall step, and no
possibility of the installed copy drifting from the source, because there is no copy.

**Skills, commands and `CLAUDE.md` are installed by copy.** `scripts/claude-install.mjs` walks the
`CONTENT` list (`CLAUDE.md`, `skills/`, `commands/`), renders placeholders, and writes each file to its
required location under `~/.claude/`. `scripts/claude-capture.mjs` runs the same walk in reverse,
un-rendering values back into placeholders. Both accept `--check`, which reports what *would* change and
exits 1 if anything would, so drift in either direction is a build-detectable condition rather than
something noticed months later.

**The installer merges into `settings.json`; it never overwrites it.** That file holds hand-maintained
settings this repo does not own — `enabledPlugins`, `permissions`, `env`, `extraKnownMarketplaces`, a
`SessionStart` hook that cats `work-tracking/wip.md`. The merge algorithm is:

1. Read the existing `settings.json` (`readJson`, defaulting to `{}` if absent).
2. `stripManaged()` removes every hook entry this repo owns, identified by `isManagedCommand()` — the
   command string, with backslashes normalised to forward slashes, containing `tools/claude/hooks/`.
   Groups left empty are dropped; sibling non-managed hooks inside a shared matcher group survive.
3. `addManaged()` re-adds the enabled entries from the catalog, joining a hook to an existing group when
   the event and matcher match.
4. Write a timestamped backup of the previous file, then write the merged result with every non-hook key
   untouched.

Identifying managed entries by path substring rather than by a separate marker field means the marker
cannot be lost — a hook that runs from this repo *is* a managed hook, definitionally.

`tests/install.test.mjs` covers the properties this depends on: hand-written hooks survive stripping
exactly, sibling hooks in a shared matcher group are preserved, strip-then-add applied twice equals
applied once (idempotence), `--uninstall` returns the hook block to its original state, disabled catalog
entries are not installed, and an unresolved placeholder in a hook command throws rather than writing a
half-rendered command.

## Consequences

### Good

- Hook edits are live. The "installed to Claude, run from this repo" requirement is satisfied literally.
- Hook drift is structurally impossible; content drift is detectable via `npm run claude:check` and
  `npm run claude:capture:check`.
- Re-running the installer is safe. Uninstall is exact — it removes precisely the entries whose command
  points into `tools/claude/hooks/`.
- Hand-maintained `settings.json` content is never at risk, and there is a timestamped backup regardless.

### Bad / accepted costs

- Moving or renaming the checkout breaks every installed hook, because the paths are absolute. Re-running
  `npm run claude:install` fixes it, but nothing warns you first.
- Two directions of copy means two scripts and two `--check` modes to keep in step. `CONTENT` is declared
  separately in `claude-install.mjs` and `claude-capture.mjs`, and the capture list additionally covers
  `settings.json`, so the lists are similar but not identical.
- A skill edited directly in `~/.claude/skills/` is not in the repo until `claude:capture` runs. The
  `--check` mode makes this visible but does not prevent it.
- The installer's content copy is one-way per run: it does not delete files under `~/.claude/` that were
  removed from the repo.

## Alternatives considered

**Windows directory junctions / symlinks for skills and commands** (`mklink /J ~/.claude/skills
tools/claude/skills`). Rejected on two grounds. First, a junction hijacks the *whole* directory: skills
installed by plugins or created ad hoc outside the repo would have to move into the repo or disappear,
and this repo deliberately does not own everything under `~/.claude/skills/`. Second, it hides which side
is authoritative — an edit made through the junction is an edit to the repo, with no distinction between
"I changed my config" and "I changed the repo", and no point at which the templating in ADR 0006 could
run. Copy plus a `--check` drift report keeps the authoritative side explicit and gives the placeholder
rendering a place to happen. Junctions also need elevation or Developer Mode on Windows and do not
survive a fresh clone.

**Copying hooks alongside the content.** Rejected: it reintroduces exactly the drift the brief asks to
avoid, and every hook edit would need a reinstall to take effect.

**Overwriting `settings.json` from a repo-owned file.** Rejected: it would destroy hand-maintained
plugin, permission and env settings on every install. `tools/claude/settings/settings.json` exists as a
*captured backup* of that file, not as an install source — `claude-install.mjs` never writes it back.

**A marker field on each managed hook entry** (e.g. `"managedBy": "ai-tooling"`). Rejected: Claude Code
does not preserve unknown keys as a contract, and a marker can be lost by hand-editing while the hook
keeps running. The command path is self-describing and cannot get out of sync with reality.
