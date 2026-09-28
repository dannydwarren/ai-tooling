---
name: skill-usage-audit
description: Audit which Claude Code skills and plugin commands actually get used, from the full local transcript history rather than the live session. Use when asked "which skills do I actually use", "audit my skills", "which skills are dead weight", "skill usage stats", or when deciding what to prune from installed plugins.
---

# Skill usage audit

Reconstructs historical skill usage by replaying every transcript under `~/.claude/projects/`. Read-only against the transcript store; writes one JSON file to a path you choose. No network, no deletion, no archiving.

## Run it

```bash
node ~/.claude/skills/skill-usage-audit/analyze.mjs --json ./tmp/skill-usage-audit/skill-usage.json
```

Flags:

- `--days N` — only count invocations in the last N days
- `--project <substr>` — restrict to transcript project dirs matching a substring
- `--json <path>` — where to write the data (relative paths resolve against cwd)
- `--quiet` — suppress the terminal table, write JSON only

After running, publish the JSON as an Artifact report if the user wants something to review later.

## What counts as an invocation

- `Skill` tool calls — the dominant signal, captured with the full namespaced id (`engineering:linear:start-work`)
- `<command-name>` slash tags in user messages, excluding built-in CLI commands (`/mcp`, `/clear`, `/model`, …)

Both main-session and subagent transcripts are scanned; subagent hits are counted separately so fan-out work is visible rather than invisible.

## What it catalogs

- Installed plugins only, resolved via `~/.claude/plugins/installed_plugins.json` — both `skills/` and `commands/`. Scoping to installed paths is deliberate: `~/.claude/plugins/marketplaces/` holds plugins that are merely *available*, and `cache/` holds superseded versions. Cataloging those inflates the never-used list with things that were never installed.
- `~/.claude/skills/` and `~/.claude/commands/`
- Per-project `.claude/skills` and `.claude/commands`, discovered from the `cwd` recorded on transcript events rather than by decoding project directory names. `$HOME` is skipped so the global skill dir is not double-counted as a project.

Names are resolved exactly, then by namespace suffix so a bare `ship` credits `engineering:utilities:ship`. Anything invoked but absent from disk is reported as `built-in` or `unresolved` rather than dropped.

## Reading the verdicts

`ACTIVE` ≤14d · `RECENT` ≤45d · `DORMANT` ≤90d · `STALE` >90d · `NEVER-INVOKED` no recorded call.

**`NEVER-INVOKED` is a review candidate, never a delete instruction.** Three things routinely produce a zero count on a skill that is doing real work:

1. **Hook injection.** `superpowers:using-superpowers` is injected by a SessionStart hook into every single session and never appears as a `Skill` call. Its count is zero; its influence is total.
2. **Install age.** A skill installed 14 days ago has had 14 days to be used. Always read `installed_days` next to the count before concluding anything.
3. **Transcript horizon.** Coverage starts at `transcripts_from`. Claude Code prunes old transcripts, so absence before that date is unmeasured, not absent.

Compare `count` against `installed_days` and `transcripts_from` before acting. Never wire this into automatic archiving.

## Credit

The idea came from [cskwork/skill-usage-stats](https://github.com/cskwork/skill-usage-stats) (MIT, commit `d403ba1`) — auditing skills from local transcript history rather than the live session, and bucketing results into usage verdicts.

This is an independent Node implementation; no code was taken from it. It was rewritten because the original's detection could not resolve plugin-namespaced skill ids, skipped subagent transcripts, and treated `plugins/marketplaces/` as installed — which on a plugin-heavy Windows setup credited 4 of 101 real invocations. The original also ships a companion archiving tool that acts on those verdicts; this skill deliberately has no such counterpart.
