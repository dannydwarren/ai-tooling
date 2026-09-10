# ADR 0005: Skill audit approach

## Status

Accepted, 2026-09-09

## Context

Objective 4 in `plans/2026-09-09-bootstrap.md` is to "log every skill Claude invokes on this machine ...
for later analysis of which skills earn their keep."

There are two concrete decisions waiting on that data:

1. **Which personal skills to extract into this repo.** A skill living only in `~/.claude/skills/` is
   unmanaged and unbacked-up. Only the ones actually used are worth pulling into `tools/claude/skills/`.
2. **Which work plugins to uninstall.** `~/.claude/settings.json` enables seven plugins
   (`superpowers`, `linear`, `csharp-lsp`, `engineering-standards`, `engineering`,
   `platform-api-creation`, `jnlocal`), collectively contributing dozens of skills to every session's
   context. If a plugin's skills are never invoked, it is pure context cost and should be replaced by
   one-off installs of the two or three skills that are actually used.

Neither question can be answered from memory. It needs measurement.

## Decision

A pair of hooks appends one JSON line per invocation to `tmp/logs/skill-audit.jsonl` (gitignored,
overridable via `AI_TOOLING_SKILL_LOG`). JSON Lines because it is append-only, crash-safe under concurrent
appends of small records, greppable, and trivially parsed line-by-line by
`scripts/analyze-skill-log.mjs`, which skips unparseable lines rather than failing.

### Two hooks, because one event does not see everything

This is the subtlety that shapes the whole design. A `PreToolUse` hook matched on the `Skill` tool captures
only skills the **model** decides to invoke. A slash command the **user types** — `/wip`, `/pr-review-cycle` —
is expanded before the model ever sees the turn; it never becomes a `Skill` tool call, so `PreToolUse`
never fires for it. A single `PreToolUse` hook would therefore produce a log that systematically omits every
skill invoked deliberately by hand, which is precisely the population most relevant to "which skills do I
personally reach for".

So `tools/claude/settings/hooks.json` registers the same script twice:

| id | event | matcher | captures |
|---|---|---|---|
| `skill-audit` | `PreToolUse` | `Skill` | skills the model invokes |
| `skill-audit-typed` | `UserPromptExpansion` | — | slash commands the user types |
| `skill-audit-post` | `PostToolUse` | `Skill` | completion pairing — **disabled**, doubles log volume |

`skill-audit.mjs` distinguishes the two at runtime: `isExpansion()` checks for
`hook_event_name === 'UserPromptExpansion'` or the presence of `command_name`, and every record carries
`invocation: 'user' | 'model'`. `aggregate()` in the analyzer splits each skill's count into `typed` and
`auto`, so the report answers "skills I reach for" and "skills the model reaches for" separately. Those are
different questions with different answers, and conflating them would make the extract/uninstall decisions
worse.

### The hook is deliberately passive

It always exits 0 and swallows its own errors, via `runHook()` in `tools/claude/hooks/lib/hook-io.mjs`.
It never blocks, never emits a decision, and never writes to stderr unless `AI_TOOLING_HOOK_DEBUG=1`. An
audit logger that can break a session is worse than no audit logger: the failure mode of a missing record
is a slightly incomplete report, while the failure mode of a throwing hook is a broken working session.
Debug output is opt-in for exactly this reason.

### Arguments are redacted and truncated

`argsPreview()` runs the argument text through `redact()` — which masks JWTs, GitHub / AWS / LLM / Slack
token shapes, and `password|secret|token|api_key|bearer` assignments — collapses whitespace, and caps the
result at 160 characters. Logging can be disabled entirely with `AI_TOOLING_SKILL_LOG_ARGS=0`. When a skill
name cannot be resolved from the payload, the record carries a redacted `unresolved_input` capped at 400
characters so the payload shape can be diagnosed without preserving whatever was typed.

### Classification lives in the analyzer, not the hook

The hook records raw facts: timestamp, event, invocation, tool, skill, namespace, cwd, project, session id,
args. It does **not** decide whether a skill is a plugin skill, a repo skill, an unmanaged global skill, or
built-in. That judgement is `classify()` in `scripts/analyze-skill-log.mjs`, which resolves a skill against
`tools/claude/skills/` + `tools/claude/commands/` (→ `personal-repo`), `~/.claude/skills/` +
`~/.claude/commands/` (→ `personal-global`), a namespace prefix before `:` (→ `plugin`, owner = the
namespace), or falls through to `built-in`.

Two reasons. First, the hot path stays minimal — the hook does no filesystem scanning of the skills tree on
every invocation. Second, and more important, classification rules **will** change: a skill moves from
global to repo, a plugin is uninstalled, a namespace is renamed. Because classification is applied at
analysis time over the raw log, changing the rules re-classifies all history instantly. Had it been baked
into the records, historical data would be permanently labelled under the old rules and the whole log would
need re-collection.

### The analyzer names installed plugins with zero recorded invocations

`installedPlugins()` reads `~/.claude/plugins/installed_plugins.json`, and `unusedPlugins()` subtracts the
set of plugin owners that appear in the log. The output is a direct list of "plugins you have installed and
have never invoked a skill from" — the input to the uninstall decision described in the Context above.
The rest of the report rolls up by skill, by source, and by project.

## Consequences

### Good

- Both populations are captured. A `PreToolUse`-only design would have silently missed every typed slash
  command and produced a confidently wrong conclusion.
- `invocation` makes "I use this" distinguishable from "the model picks this up", which are different
  arguments for keeping a skill.
- The audit cannot break a session, by construction.
- Classification is re-derivable, so the log stays valid as the config changes around it.
- The unused-plugin list turns "these plugins feel like bloat" into a fact.
- The log is gitignored under `tmp/`, so it is out of the scanner's scope (ADR 0004) and cannot be
  committed by accident.

### Bad / accepted costs

- A Node process starts on every skill invocation and every user prompt expansion.
- Because the hook fails open and silently, a broken hook produces an empty or partial log with no signal
  other than absence. `AI_TOOLING_HOOK_DEBUG=1` is the only way to see the failure.
- The log is local-only and lives in `tmp/`. It is not backed up and is lost on a clean of that directory.
- Records depend on payload field names (`tool_input.skill`, `command_name`, …). `extractSkill()` tries
  several key spellings, but a Claude Code payload change could start producing `unresolved_input` records
  until the extractor is updated.
- `UserPromptExpansion` fires for prompt expansions generally, not only for skills, so the record set needs
  the `invocation`/`skill` fields to be interpreted correctly rather than counted naively.
- The analyzer reads live state (`~/.claude/skills/`, `installed_plugins.json`), so a report generated today
  classifies history against today's installation.

## Alternatives considered

**`PreToolUse` on `Skill` only.** Rejected once it was established that typed slash commands expand before
the model sees them and never reach the `Skill` tool. The resulting log would omit exactly the invocations
that best indicate personal value.

**`PostToolUse` on `Skill` instead of `PreToolUse`.** Rejected as the primary source: it misses skills that
error or are interrupted, and it fires after the fact. It is retained as `skill-audit-post`, disabled by
default, for anyone who later wants start/finish pairing — at double the log volume. `aggregate()` already
skips `PostToolUse` records so enabling it does not double-count.

**Classifying inside the hook.** Rejected: it puts a directory scan on the hot path, and it freezes the
classification of every historical record under the rules in force when it was written.

**A blocking or nudging hook** (e.g. warning when a rarely-used skill is invoked). Rejected: the goal is
measurement, and an audit that changes behaviour measures the audit rather than the behaviour. Passive is
the point.

**Logging full arguments verbatim.** Rejected: skill arguments routinely carry ticket contents, file paths
and occasionally credentials. Redaction plus a 160-character cap keeps the log useful for spotting usage
patterns without turning it into a secondary secret store.

**Parsing Claude Code session transcripts after the fact instead of hooking.** Rejected: the transcript
format is machine-generated state this repo explicitly does not manage, it is undocumented and subject to
change, and it would not cleanly distinguish a typed slash command from a model-invoked skill.

**Writing the log outside `tmp/`.** Rejected: it would land in scanner scope and be committable, and the log
records project names and argument previews from real work.
