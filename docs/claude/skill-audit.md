# Skill audit

Every skill invocation on this machine is logged, so the question "which skills am I actually
getting value from" has an answer made of data instead of impressions.

The point is to act on it: extract the personal skills that earn their keep into this repo, and stop
carrying bloated work plugins that are installed permanently for the sake of one skill used twice a
quarter.

## How it works

Two hooks, one script, one log file.

```
you type /wip                 ->  UserPromptExpansion  ->  skill-audit.mjs  ->  tmp/logs/skill-audit.jsonl
model invokes a skill         ->  PreToolUse (Skill)   ->  skill-audit.mjs  ->  tmp/logs/skill-audit.jsonl
```

**Two hooks are required, and this is the easiest thing to get wrong.** A `PreToolUse` hook matched
on the `Skill` tool captures only skills the model chooses to invoke. A slash command you type is
expanded into a prompt before the model ever sees it, so it never becomes a `Skill` tool call and
`PreToolUse` never fires. An audit built on `PreToolUse` alone silently misses everything you
invoke by hand.

Each record carries `invocation: "user"` or `invocation: "model"`, so the report can separate the
two. That distinction turns out to be the interesting part of the data: a skill the model keeps
auto-triggering is a different kind of asset from one you deliberately reach for.

## The log

`tmp/logs/skill-audit.jsonl`, gitignored, one JSON object per line:

```json
{
  "ts": "2026-09-10T04:36:18.025Z",
  "event": "PreToolUse",
  "invocation": "model",
  "tool": "Skill",
  "skill": "superpowers:brainstorming",
  "namespace": "superpowers",
  "cwd": "/c/src/ai-tooling",
  "project": "ai-tooling",
  "session_id": "abc123",
  "args": "test run"
}
```

`namespace` is the plugin prefix when there is one, derived syntactically from the name. `project`
is the basename of the working directory. `args` is redacted and truncated to 160 characters; set
`AI_TOOLING_SKILL_LOG_ARGS=0` to drop it entirely. If the skill name cannot be found in the payload
the raw input is preserved as `unresolved_input` (redacted) so the hook can be fixed rather than
silently losing data.

The log lives in this repo's `tmp/` regardless of which project you were working in, because the
hook resolves the path relative to its own location. Override with `AI_TOOLING_SKILL_LOG`.

JSONL is append-only and never rewritten, so the log is safe to `tail`, safe to concurrent writes
from parallel sessions, and trivially greppable:

```bash
grep '"skill":"engineering' tmp/logs/skill-audit.jsonl | wc -l
```

## Reading the report

```bash
npm run skills:report
node scripts/analyze-skill-log.mjs --since 2026-09-01 --top 20
node scripts/analyze-skill-log.mjs --json
```

```
By skill  (typed = you invoked it, auto = the model chose it)
n  typed  auto  skill                      source         projects    first       last
-  -----  ----  -------------------------  -------------  ----------  ----------  ----------
1  0      1     superpowers:brainstorming  plugin         ai-tooling  2026-09-10  2026-09-10
1  1      0     wip                        personal-repo  ai-tooling  2026-09-10  2026-09-10
```

Classification lives in the analyzer, not the hook, so the rules can change without touching the
hot path and without invalidating history:

| Source | Meaning | What to do about it |
|---|---|---|
| `plugin` | Name is namespaced, e.g. `engineering:utilities:ship` | Roll up by owner to judge the plugin as a whole |
| `personal-repo` | Tracked in `tools/claude/` | Already managed, nothing to do |
| `personal-global` | In `~/.claude` but not in this repo | **Extraction candidate** — run `npm run claude:capture` |
| `built-in` | Neither, so it ships with Claude | Nothing to manage |
| `mcp-prompt` | `expansion_type` was `mcp_prompt`, so it is an MCP server prompt, not a skill | Excluded from skill judgements |

The report ends with two action lists.

**Extraction candidates** are personal skills you use that exist only on this machine. They are one
`npm run claude:capture` away from being version controlled.

**Installed plugins with no recorded invocations** reads `~/.claude/plugins/installed_plugins.json`
and subtracts the namespaces that actually appear in the log. Those are the candidates for
uninstalling and pulling in as one-offs when genuinely needed. Judge them over a meaningful window —
a plugin used once a quarter looks identical to a dead one after a week of data.

## The other half: what you are paying for

The usage report tells you what you *used*. It says nothing until data accumulates, and on its own
it cannot tell you the size of the bill. The inventory does:

```bash
npm run skills:inventory
```

```
entries  used   desc   owner            on?  source
-------  ----   -----  ---------------  ---  ------------------------------
48       1/48   6.9kb  big-work-plugin  yes  work-marketplace v3.4.1
14       1/14   1.8kb  superpowers      yes  claude-plugins-official v6.3.0
3        2/3    0.7kb  ai-tooling       yes  this repo
19       0/19   3.9kb  cached-plugin    no   work-marketplace v1.2.0

  82 skills and commands, ~18kb of descriptions, loaded every session.
  cached-plugin is cached but disabled, so it costs nothing today.

  used:  4 of 82 distinct enabled skills (5%)
  first: 2026-09-08 03:12
  last:  2026-09-10 09:26
  plus 1 used but not in the inventory (built-in, or since removed).
```

(Owner names above are illustrative. Run it to see your own.)

It walks the plugin cache and counts every skill **and command** each owner contributes, along with
the description bytes, because descriptions are what actually occupy the context window in every
session. `on?` reflects `enabledPlugins` in settings, so plugins that are merely cached are shown
but excluded from the totals — they cost nothing today.

Put the two together and the decision makes itself. An owner with a large `entries` count stuck at
`0/N` over a meaningful window is context you pay for on every single turn and never spend.
Uninstall it, and pull the one or two skills you actually want in as one-offs.

**Two counts, and they measure different things.** `entries` is what *loads* — a plugin that ships
a skill and a same-named command contributes both, and both occupy context. The coverage line
counts *distinct names*, since those are what you can actually invoke. When they differ, the report
says so rather than leaving you to reconcile two numbers.

Skills used but absent from the inventory are reported separately rather than folded in. Those are
Claude's built-ins, which live nowhere on disk, or something since uninstalled — counting them in a
denominator of installed skills would be wrong either way.

### Just the skills you used

```bash
npm run skills:used
```

```
n  typed  auto  skill                       owner                first used        last used
-  -----  ----  --------------------------  -------------------  ----------------  ----------------
3  3      0     wip                         ai-tooling           2026-09-08 03:12  2026-09-10 01:58
2  2      0     engineering:utilities:ship  big-work-plugin      2026-09-08 03:40  2026-09-09 10:44
2  0      2     superpowers:brainstorming   superpowers          2026-09-08 08:02  2026-09-10 09:26
1  0      1     dataviz                     built-in or removed  2026-09-10 04:22  2026-09-10 04:22
```

This lists **only skills that were actually invoked** — never the full catalogue. It is the view for
"what do I actually reach for", where the summary above is "what am I carrying". Times are local;
the log itself stores UTC.

Both accept `--log <path>` to read a different log and `--json` for machine-readable output.

## Design notes

**The hook never blocks.** It always exits 0 and swallows its own exceptions. An audit logger that
can break a session is worse than no audit logger, so correctness of the log is subordinate to not
interfering. Set `AI_TOOLING_HOOK_DEBUG=1` to surface swallowed errors while developing.

**The hook is dumb, the analyzer is smart.** The hook records syntactic facts only — name,
namespace, cwd, timestamp. Every judgement (is this personal? is this plugin worth keeping?) happens
at analysis time. That means improving the classification never requires re-collecting data.

**Counting ignores `PostToolUse`.** If the optional `skill-audit-post` hook is enabled, its records
are skipped when counting, so completions cannot double-count invocations.

## Cost

Each hook invocation spawns a Node process, measured at roughly **165 ms** on this machine. That is
paid once per skill invocation and once per typed slash command — not per tool call — so it is
small against the seconds a skill itself takes, but it is not free and it is latency you feel on
`/wip`.

If it becomes annoying, the hook config accepts `"async": true`, which runs the handler in the
background without blocking. That is a good fit for a fire-and-forget logger and would remove the
latency entirely. It is deliberately **not** enabled here: it has not been verified on this Claude
Code version, and a mis-specified key that silently disables the hook would cost more than the
165 ms it saves. Try it, then confirm the log still grows before trusting it.

## Caveats

- **It only sees this machine.** That is the intent.
- **Skills invoked inside a subagent** are recorded like any other, but attributed to the subagent's
  working directory.
- **The log is not rotated.** One line per invocation is small, but it will grow forever. Truncate or
  archive it when it stops being useful; nothing depends on its history.
- **`args` is a redacted preview**, not a faithful record. It is context for reading the log, not an
  audit trail.
- Enabling **both** install routes — the script installer and the plugin — would register the hooks
  twice and double every count. Pick one. See [plugins.md](plugins.md).
