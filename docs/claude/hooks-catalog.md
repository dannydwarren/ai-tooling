# Hook catalog

The hooks this repo ships, what each one does, and whether it is installed by default.

The catalog is [../../tools/claude/settings/hooks.json](../../tools/claude/settings/hooks.json).
The installer reads it, renders the placeholders, and merges the enabled entries into
`~/.claude/settings.json`. For the mechanics of hooks in general see [hooks.md](hooks.md); for
installing see [../install.md](../install.md).

## The catalog format

This is *this repo's* format, not Claude's. Claude's `settings.json` nests hooks by event and
matcher, which makes an individual hook awkward to describe, toggle or document. The catalog is a
flat list instead, and the installer does the nesting.

```json
{
  "id": "skill-audit",
  "enabled": true,
  "event": "PreToolUse",
  "matcher": "Skill",
  "description": "why this hook exists",
  "hook": {
    "type": "command",
    "command": "node \"{{REPO_ROOT_SLASH}}/tools/claude/hooks/skill-audit.mjs\"",
    "timeout": 10,
    "statusMessage": "Recording skill usage"
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Unique, used in installer output. Not written to `settings.json`. |
| `enabled` | Whether the installer writes it. Flip and re-run `npm run claude:install`. |
| `event` | Claude hook event. Validated against a known list by the build. |
| `matcher` | Optional. Omit to match everything the event fires for. |
| `description` | Required by the build. |
| `hook` | Passed through to `settings.json` verbatim after rendering. |

`{{REPO_ROOT_SLASH}}` renders to the checkout path with forward slashes and the drive letter intact
(`C:/src/ai-tooling`). That form is used deliberately: it works whether the command string is
handled by Git Bash or PowerShell, and Node accepts it directly, so there is no backslash-escaping
to get wrong. See [hooks.md](hooks.md) for why.

The build validates the catalog: unique ids, a boolean `enabled`, a known event, a description, and
that the command actually references a script that exists in `tools/claude/hooks/`.

## Installed by default

### `skill-audit` — `PreToolUse` on `Skill`

Appends one JSON line per skill invocation to `tmp/logs/skill-audit.jsonl`.

Captures skills the **model** decides to invoke. Records `invocation: "model"`.

### `skill-audit-typed` — `UserPromptExpansion`, no matcher

The same script on a different event, and it is not redundant. A slash command you type is expanded
into a prompt *before* the model sees it, so it never becomes a `Skill` tool call and `PreToolUse`
never fires for it. Without this hook the audit would silently miss everything you invoke by hand —
which is most of what you actually care about. Records `invocation: "user"`.

Both hooks are strictly passive: they always exit 0 and swallow their own errors. An audit logger
that can break a session is worse than no audit logger. Full design in
[skill-audit.md](skill-audit.md).

### `no-comments` — `PostToolUse` on `Edit|Write`

Enforces the no-code-comments rule from `CLAUDE.md`. When an `Edit` or `Write` introduces a comment
line into a recognised code file, the hook exits 2 and writes the offending lines to stderr, which
feeds them back to the model so it removes them.

It cannot prevent the write. `PostToolUse` runs after the tool has already succeeded; exit 2 is a
correction signal, not a veto.

Detection rules, ported from the original bash version:

- **Only these extensions:** `.cs .ts .tsx .js .jsx .mjs .cjs .go .java .kt .swift .rs .c .h .cpp .hpp`.
  Markdown, JSON and everything else are ignored outright.
- **A line is a comment** if it starts with `//`, `/*`, `*/` or `* ` after optional leading
  whitespace, or if it has code followed by whitespace then `//` then whitespace-or-end-of-line.
- **`https://` is not a comment.** Requiring whitespace or end-of-line after `//` is what excludes
  URLs. `const u = "https://x"` does not match.
- **Only introduced comments count.** Lines present verbatim in `old_string` are subtracted, so
  editing near an existing comment does not trip it.
- At most 8 offending lines are listed.

**Known false positives**, all inherited from the original spec rather than introduced by the port:

| Input | Why it trips |
|---|---|
| A wrapped expression whose continuation line starts with `*`, e.g. `const x = a\n  * b;` | Indistinguishable from a jsdoc `* ` line without parsing |
| A markdown bullet inside a template literal | Same rule, no awareness of string context |
| A string literal containing ` // `, e.g. `const sep = ' // ';` | The trailing-comment rule does not know it is inside a string |
| `Write` to an **existing** file | `Write` supplies `content` with no `old_string`, so every pre-existing comment counts as introduced |

Only single-line `a * b` and `a / b` are covered by the tests; the wrapped form is not caught by
them and will trip the hook.

**Enabled 2026-09-10.** It is the only hook here that can interrupt work, so if the false positives
above become tiresome, set `"enabled": false` for `no-comments` in
[../../tools/claude/settings/hooks.json](../../tools/claude/settings/hooks.json) and re-run
`npm run claude:install`.

Two things to keep in mind now that it is live:

- **It is global.** It fires in every repo, including work repos where comments are normal and
  expected. The `Write`-over-an-existing-file case above is the one that will surface there.
- **It does not know when you asked for comments.** `CLAUDE.md` permits them when you explicitly
  request them; the hook has no way to see that request and will push for their removal anyway.

Its behaviour is pinned by fifteen tests in
[../../tests/no-comments.test.mjs](../../tests/no-comments.test.mjs), including the URL and division
false-positive cases, so changing the patterns will tell you if you broke something.

## Available but disabled

### `skill-audit-post` — `PostToolUse` on `Skill`

Records skill completion, letting the analyzer pair start with finish for duration and failure
analysis. Doubles the log volume for information nobody needs yet, so it is off. The analyzer
already ignores `PostToolUse` records when counting, so enabling it cannot double-count.

Whether `PostToolUse` reliably fires for `Skill` in a way that pairs cleanly with the `PreToolUse`
record is not documented; verify before relying on it.

## Adopting a hook from someone else's plugin

A plugin's hooks are part of the plugin: enable it and they all run, disable it and none do. There
is no supported way to take just one. What you *can* do is see what they are and, if you want one
without the rest of the plugin, copy it into this catalog.

```bash
npm run claude:plugin-hooks                                    # what every installed plugin declares
node scripts/claude-plugin-hooks.mjs --plugin engineering      # narrow to one
node scripts/claude-plugin-hooks.mjs --plugin engineering --as-catalog
```

The first form is worth running occasionally on its own merits: it shows which hooks are executing
on every session because a plugin declares them, which is otherwise invisible.

`--as-catalog` emits catalog entries with `${CLAUDE_PLUGIN_ROOT}` resolved to the plugin's real
install path. Paste them into `tools/claude/settings/hooks.json` and review before flipping
`enabled`. They arrive **disabled**, always — adopting one means running someone else's code on
every matching event, and that should be a decision, not a side effect.

The catch to understand: the resolved path pins the hook to the plugin version installed today.
Update the plugin and the path goes stale, and the hook silently stops running. If you want a
plugin's hook permanently, copy the script into `tools/claude/hooks/` and own it. The generated
`description` records which plugin and version it came from so this is traceable later.

Background on why plugins work this way is in [plugins.md](plugins.md).

## Adding a hook

1. Write the script in `tools/claude/hooks/`. Import from `lib/hook-io.mjs` for stdin parsing,
   redaction and the fail-open wrapper. Guard the side effect with `isMain(import.meta.url)` or
   importing it in a test will execute it.
2. Add a catalog entry in `tools/claude/settings/hooks.json`.
3. Write tests in `tests/`. Test the exported pure functions directly, and spawn the script for the
   exit-code contract.
4. `npm run build`, then `npm run claude:install`.
5. Restart Claude Code so it re-reads `settings.json`.

Keep the fail-open discipline: a hook that throws should exit 0. Only a deliberate policy verdict
should ever exit 2. Set `AI_TOOLING_HOOK_DEBUG=1` to see swallowed errors on stderr while
developing.
