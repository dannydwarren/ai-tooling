# Claude Code Hooks

How the hook mechanism actually works, what it can and cannot do, and the Windows-specific details that decide whether a hook runs at all.

Companion documents: [plugins.md](./plugins.md) (distribution and the plugin route), [hooks-catalog.md](./hooks-catalog.md) (the hooks this repo ships), [../install.md](../install.md) (installing this repo into `~/.claude`).

Primary sources, all verified while writing this: <https://code.claude.com/docs/en/hooks.md>, <https://code.claude.com/docs/en/hooks-guide.md>, <https://code.claude.com/docs/en/settings.md>, <https://code.claude.com/docs/en/settings-reference.md>.

---

## 1. Mental model

A hook is a handler the Claude Code **harness** invokes at a lifecycle point. The harness runs it; the model does not decide whether to. That is the whole reason hooks exist.

| | CLAUDE.md / memory | Hook |
| :--- | :--- | :--- |
| Who acts on it | The model | The harness |
| Guarantee | Advisory. The model may not comply | Deterministic. It runs on every matching event |
| Failure mode | Silently forgotten mid-context | Visible: exit code, stderr, debug log |
| Can stop an action | No | Yes, on [events that can block](#42-exit-code-2-per-event) |

If the requirement is phrased "always do X" / "never let me do Y" / "every time Z happens", it is a hook. If it is "prefer X", it is CLAUDE.md. The official docs make the same split explicitly: "For instructions that never change, prefer CLAUDE.md. It loads without running a script and is the standard place for static project conventions" (<https://code.claude.com/docs/en/hooks#add-context-for-claude>).

Handlers are not limited to shell commands. There are five `type` values: `command`, `http`, `mcp_tool`, `prompt`, `agent`. This document concentrates on `command`, which is what this repo uses; the other four are summarized in [§3.4](#34-handler-types-other-than-command).

Configuration has three levels of nesting:

```
hooks
└── <EventName>                 // lifecycle point
    └── [ matcher group ]       // filter: which tool / source / type
        └── hooks: [ handler ]  // what runs
```

---

## 2. Hook events

Claude Code groups events into three cadences: once per session (`SessionStart`, `SessionEnd`), once per turn (`UserPromptSubmit`, `Stop`, `StopFailure`), and per tool call inside the agentic loop (`PreToolUse`, `PostToolUse`) — except `EndConversation` calls, which skip both tool events.

### 2.1 The events you will actually use

| Event | Fires | Can block? | Matcher matches |
| :--- | :--- | :--- | :--- |
| `SessionStart` | Session begins or resumes | No (stderr shown to user only) | How the session started: `startup`, `resume`, `clear`, `compact`, `fork` |
| `UserPromptSubmit` | You submit a prompt, before the model sees it | **Yes** — blocks and erases the prompt | No matcher support |
| `UserPromptExpansion` | A typed command (`/name`) expands into a prompt | **Yes** — blocks the expansion | `command_name` |
| `PreToolUse` | After tool parameters are built, before the call runs | **Yes** — blocks the call | `tool_name` |
| `PostToolUse` | After a tool call **succeeds** | No — see [§4.3](#43-posttooluse-cannot-undo-anything) | `tool_name` |
| `PostToolUseFailure` | After a tool call fails | No | `tool_name` |
| `Stop` | Main agent finishes responding | **Yes** — keeps it going | No matcher support |
| `SubagentStop` | A subagent finishes | **Yes** | Agent type |
| `PreCompact` | Before context compaction | **Yes** | `manual`, `auto` |
| `Notification` | Claude Code emits a notification | No (exit code and stderr ignored) | Notification type — `permission_prompt`, `idle_prompt`, `auth_success`, `agent_needs_input`, `agent_completed`, the `elicitation_*` set, the `quota_auto_resume_*` set |
| `SessionEnd` | Session terminates | No | Why it ended: `clear`, `resume`, `logout`, `prompt_input_exit`, `other` |

### 2.2 The rest of the roster

The docs list considerably more than the ten above. Complete set, for reference:

| Event | Fires | Can block? | Matcher matches |
| :--- | :--- | :--- | :--- |
| `Setup` | `--init-only`, or `--init` / `--maintenance` in `-p` mode | No | `init`, `maintenance` |
| `InstructionsLoaded` | A CLAUDE.md or `.claude/rules/*.md` is loaded | No (exit code ignored) | `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` |
| `PermissionRequest` | A tool call needs a permission decision | No via exit 2 — deny via the `decision` object | `tool_name` |
| `PermissionDenied` | Auto mode denies a tool call | No — but `retry: true` lets the model retry | `tool_name` |
| `PostToolBatch` | After a batch of parallel tool calls resolves | **Yes** — stops the loop before the next model call | No matcher support |
| `MessageDisplay` | While assistant text streams to screen | No (display-only) | No matcher support |
| `SubagentStart` | A subagent is spawned | No | Agent type |
| `TaskCreated` / `TaskCompleted` | Task create / mark-complete | **Yes** (rolls back / prevents) | No matcher support |
| `StopFailure` | Turn ends on an API error | No — output ignored except `terminalSequence` | `rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `server_error`, `max_output_tokens`, and others |
| `TeammateIdle` | An agent-team teammate is about to idle | **Yes** | No matcher support |
| `ConfigChange` | A config file changes mid-session | **Yes** (except `policy_settings`) | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| `CwdChanged` | Working directory changes (e.g. Claude runs `cd`) | No | No matcher support |
| `DirectoryAdded` | Directory added mid-session | No | `slash_command`, `register_repo_root` |
| `FileChanged` | A watched file changes on disk | No | **Literal filenames**, exact-match only — see [§5.4](#54-filechanged-is-special) |
| `WorktreeCreate` | A worktree is being created | **Yes** — *any* non-zero exit fails creation | No matcher support |
| `WorktreeRemove` | A worktree is being removed | No | No matcher support |
| `PostCompact` | After compaction completes | No | `manual`, `auto` |
| `PreModelSwitch` / `PostModelSwitch` | Before / after the session model changes | Pre: **yes**. Post: no | Canonical model name (`claude-opus-5`, `.*opus.*`) |
| `Elicitation` / `ElicitationResult` | MCP server requests user input / user responded | **Yes** (deny / decline) | MCP server name |

Note the asymmetry worth internalizing: **`FileChanged` catches writes that `PostToolUse: Edit|Write` misses.** If a `Bash` command or an outside process rewrites a file, no `Edit|Write` hook fires. `FileChanged` does, but only after the fact and with no decision control.

---

## 3. The stdin payload

Command hooks receive JSON on **stdin**. HTTP hooks receive the same JSON as the POST body.

### 3.1 Common fields (every event)

| Field | Meaning |
| :--- | :--- |
| `session_id` | Current session identifier |
| `prompt_id` | UUID of the prompt being processed. Absent until first user input. Matches the OTel `prompt.id` attribute |
| `transcript_path` | Path to the conversation JSONL. Written asynchronously — **it may lag the in-memory conversation** |
| `cwd` | Working directory when the hook is invoked. Follows Claude into worktrees and after `cd` |
| `scratchpad_dir` | Session scratchpad path. Absent when there is none |
| `permission_mode` | `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`. **Manual mode arrives as `default`, never `manual`.** Not present on every event |
| `effort` | `{ "level": "low" \| "medium" \| "high" \| "xhigh" \| "max" }`. Present on tool-context events when the model supports the effort parameter. Also exported as `$CLAUDE_EFFORT` |
| `hook_event_name` | Name of the event that fired |
| `agent_id` | Present only inside a subagent call |
| `agent_type` | Agent name, e.g. `Explore`, `security-reviewer`. Present under `--agent` or inside a subagent |

There is **no** `$CLAUDE_MODEL` environment variable and no `model` field on most events. Only `SessionStart` may carry `model` (and it can be omitted); `PreModelSwitch` / `PostModelSwitch` carry `from_model` and `to_model`.

### 3.2 Event-specific fields

| Event | Adds |
| :--- | :--- |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` (optional; excludes permission-prompt and PreToolUse time) |
| `UserPromptSubmit` | `prompt` |
| `UserPromptExpansion` | `expansion_type` (`slash_command` \| `mcp_prompt`), `command_name`, `command_args`, `command_source`, `prompt` |
| `SessionStart` | `source`, optional `model`, `agent_type`, `session_title`. On `resume`/`fork` with prior responses, also `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` |
| `SessionEnd` | `reason` |
| `Stop` | `stop_hook_active`, `last_assistant_message`, `background_tasks[]`, `session_crons[]` |
| `SubagentStop` | the `Stop` fields plus `agent_id`, `agent_type`, `agent_transcript_path` |
| `PreCompact` | `trigger`, `custom_instructions` (`null` for `auto`) |
| `PostCompact` | `trigger`, `compact_summary` |
| `Notification` | `message`, optional `title`, `notification_type` |

Use `last_assistant_message` on `Stop` / `SubagentStop` rather than parsing `transcript_path` — the transcript is not guaranteed to contain the final message when the hook fires.

A representative `PreToolUse` payload:

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "scratchpad_dir": "/tmp/claude-1000/-home-user-my-project/abc123/scratchpad",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

### 3.3 File paths in `tool_input` on Windows

This is the single most likely reason a hook you wrote silently does nothing here.

For `Write`, `Edit`, and `Read`, `tool_input.file_path` is **always absolute**: `~` and relative spellings are expanded before hooks run. On Windows the path arrives with **backslash separators**, even when your hook is running under Git Bash where `$PWD` looks like `/c/project`:

```json
{
  "tool_name": "Write",
  "tool_input": { "file_path": "C:\\project\\src\\index.ts", "content": "..." }
}
```

A forward-slash comparison such as a `/src/` check never matches. Normalize first, then match a path *segment* rather than anchoring with `^`:

```js
const p = String(payload.tool_input.file_path).replace(/\\/g, '/');
if (p.includes('/src/')) { /* ... */ }
```

### 3.4 Handler types other than `command`

| `type` | Transport | Notes |
| :--- | :--- | :--- |
| `command` | stdin / stdout / stderr / exit code | The default. Everything below in this doc |
| `http` | POST body / response body | Cannot block through status codes alone — return 2xx with decision JSON. Extra fields: `url`, `headers`, `allowedEnvVars` (env interpolation only works for names listed there) |
| `mcp_tool` | Tool call on an already-connected MCP server | Fields `server`, `tool`, `input`. `input` string values support `${tool_input.file_path}`-style substitution. Never triggers an OAuth/connect flow; expect "not connected" on `SessionStart` |
| `prompt` | Single-turn LLM evaluation | Fields `prompt` (use `$ARGUMENTS` for the hook input JSON), `model`. Default timeout 30s |
| `agent` | Spawns a subagent with Read/Grep/Glob | **Experimental, may change.** Default timeout 60s |

---

## 4. The output contract

Two channels: the exit code, and JSON printed to stdout. The docs are emphatic that they are not alternatives in the way you might assume — **Claude Code reads JSON output from stdout on every exit code, not just 0**, and exit 2's block is the one outcome JSON cannot override.

Pick one style per hook. Mixing works but is hard to reason about.

### 4.1 Exit codes

| Exit | Effect |
| :--- | :--- |
| `0` | Success. stdout parsed as JSON when it starts with `{` and ends with `}`, otherwise treated as plain text. **stderr goes to the debug log only — Claude never sees it** |
| `2` | Blocking error on events that can block. Blocks even if your JSON says `permissionDecision: "allow"` |
| anything else | **Not a block.** Non-blocking error: the action proceeds and the transcript shows `<hook name> hook error` with the first line of stderr, prefixed `Failed with non-blocking status code:` |

The trap: `exit 1` — the conventional Unix failure code — does **not** block. If your hook is a policy gate, it must `exit 2`. The one exception is `WorktreeCreate`, where any non-zero exit aborts creation.

A hook that cannot start (bad path, not executable) lands in the same non-blocking bucket with a shell error like `127`. Watch for that notice on a policy hook's first run: a mistyped path in `settings.json` leaves the gate silently disabled.

How stdout is classified, ignoring surrounding whitespace:

- Starts with `{` **and** ends with `}` → parsed as JSON.
- Starts with `{` but does not end with `}` → plain text.
- Starts with anything else → plain text. A JSON array or a quoted JSON string counts as plain text.

For events using the standard decision model, stdout that *looks* like JSON but fails to parse, or parses but fails schema validation, is a non-blocking error on every exit code except 2.

### 4.2 Exit code 2 per event

| Event | Blocks? | What exit 2 does |
| :--- | :--- | :--- |
| `PreToolUse` | Yes | Blocks the tool call |
| `UserPromptSubmit` | Yes | Blocks processing and erases the prompt |
| `UserPromptExpansion` | Yes | Blocks the expansion |
| `Stop` / `SubagentStop` | Yes | Prevents stopping; conversation continues |
| `PostToolBatch` | Yes | Stops the agentic loop before the next model call |
| `TaskCreated` / `TaskCompleted` | Yes | Rolls back creation / prevents completion |
| `PreCompact` | Yes | Blocks compaction |
| `ConfigChange` | Yes | Blocks the change (except `policy_settings`) |
| `PreModelSwitch` | Yes | Blocks the switch, stderr shown to user |
| `Elicitation` / `ElicitationResult` | Yes | Denies / declines |
| `WorktreeCreate` | Yes | *Any* non-zero exit fails creation |
| `PostToolUse` | **No** | **Shows stderr to Claude; the tool already ran** |
| `PostToolUseFailure` | No | Shows stderr to Claude; the tool already failed |
| `PermissionRequest` | No | Exit 2 not honored — deny via the `decision` object |
| `PermissionDenied` | No | Exit code and stderr ignored; use `retry: true` |
| `Notification`, `Setup` | No | Exit code and stderr ignored |
| `SessionStart`, `SubagentStart`, `SessionEnd`, `PostCompact`, `PostModelSwitch`, `CwdChanged`, `FileChanged` | No | Stderr shown to the user only, as a `hook error` notice |
| `StopFailure` | No | Output and exit code ignored, except `terminalSequence` |
| `InstructionsLoaded`, `MessageDisplay`, `WorktreeRemove`, `DirectoryAdded` | No | Ignored / logged only |

### 4.3 PostToolUse cannot undo anything

Worth stating flatly because it is the most common misconception: **a `PostToolUse` hook cannot prevent the tool from having run.** The file is already written, the command already executed, the network request already sent. Exit 2 on `PostToolUse` does exactly one thing — it feeds your **stderr** back to the model as a blocking message so the model can go and correct itself on the next turn.

The same applies to the JSON path. `updatedToolOutput` changes only what Claude sees; the docs are explicit that telemetry (OTel tool spans, analytics) has already captured the original. To prevent or modify a call, you need `PreToolUse`.

Corollary: `PostToolUse` is a *correction* mechanism, not a *prevention* mechanism. It is excellent for "you just wrote a comment; the house rule forbids comments; remove it" and useless for "don't let that write happen".

### 4.4 JSON on stdout

Three kinds of field: universal, top-level `decision`/`reason`, and the nested `hookSpecificOutput`.

**Universal fields** (accepted by every event, though some events discard them — each event's docs section says which):

| Field | Default | Meaning |
| :--- | :--- | :--- |
| `continue` | `true` | `false` stops Claude entirely after the hook runs. **Takes precedence over any event-specific decision field** |
| `stopReason` | none | Message shown to the **user** when `continue` is `false`. Not shown to Claude |
| `suppressOutput` | `false` | **Has no effect.** Accepted but not acted on. A successful hook's stdout is never shown in the transcript anyway |
| `systemMessage` | none | Warning shown to the user |
| `terminalSequence` | none | Terminal escape sequence for Claude Code to emit on your behalf. Restricted to OSC `0`/`1`/`2`/`9`/`99`/`777` and BEL; anything else and the field is ignored. Use this instead of `/dev/tty`, which hooks cannot open |

Note `suppressOutput` explicitly: the docs list it as a no-op. Do not build behaviour on it.

**`hookSpecificOutput`** requires `hookEventName` set to the event name. Decision fields by event:

| Events | Pattern | Fields |
| :--- | :--- | :--- |
| `UserPromptSubmit`, `UserPromptExpansion`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Stop`, `SubagentStop`, `ConfigChange`, `PreCompact` | Top-level `decision` | `decision: "block"` (the only value) + `reason` |
| `PreToolUse` | `hookSpecificOutput` | `permissionDecision`: `allow` \| `deny` \| `ask` \| `defer`; `permissionDecisionReason`; `updatedInput`; `additionalContext` |
| `PermissionRequest` | `hookSpecificOutput` | `decision.behavior`: `allow` \| `deny`, with optional `decision.updatedInput` |
| `PermissionDenied` | `hookSpecificOutput` | `retry: true` |
| `SessionStart`, `SubagentStart`, `PostModelSwitch` | Context only | `additionalContext`; `SessionStart` also `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills` |
| `Setup`, `WorktreeRemove`, `Notification`, `SessionEnd`, `PostCompact`, `InstructionsLoaded`, `StopFailure`, `CwdChanged`, `DirectoryAdded`, `FileChanged` | None | No decision control. Side effects only |

`PreToolUse` deny:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Database writes are not allowed"
  }
}
```

`permissionDecisionReason` routing is asymmetric: for `allow` and `ask` it is shown to the **user** and not to Claude; for `deny` it is shown to **Claude**. `updatedInput` replaces the *entire* input object, so echo back unchanged fields too.

Precedence when several `PreToolUse` hooks disagree: `deny` > `defer` > `ask` > `allow`. And `ask` is not merely advisory — it forces a permission prompt even in auto mode.

**`additionalContext`** is the injection channel. The string is wrapped in a system reminder and inserted where the hook fired; Claude reads it on the next model request but it is not a visible chat message. Placement by event: `SessionStart`/`SubagentStart` before the first prompt; `UserPromptSubmit`/`UserPromptExpansion` alongside the prompt; the tool events next to the tool result; `Stop`/`SubagentStop` at end of turn. Multiple hooks returning `additionalContext` all get through.

Write it as **factual statements**, not imperatives. "The deployment target is production" reads as context; text framed as out-of-band system instructions can trip Claude's prompt-injection defences and get surfaced to you instead of used.

Two hard limits worth remembering: hook output strings (`additionalContext`, `systemMessage`, plain stdout) are capped at **10,000 characters**; beyond that the text is written to a file and replaced with a preview plus path. And `additionalContext` injected mid-session is **saved in the transcript and replayed on `--continue`/`--resume`** rather than re-run, so timestamps and commit SHAs go stale. `SessionStart` hooks do re-run on resume (with `source: "resume"` or `"fork"`), so put refreshable context there.

### 4.5 The `Stop` loop cap

A `Stop` hook that blocks is a loop. Claude Code overrides the hook and ends the turn after **8 consecutive blocks**. Your handler must check `stop_hook_active` in the input and exit 0 when it is `true`, or you will burn eight turns every time. `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises the cap if a hook genuinely needs more iterations.

`hookSpecificOutput.additionalContext` on `Stop` is the softer form: it keeps the conversation going under the same loop protections, but the transcript labels it `Stop hook feedback` rather than showing a hook error.

---

## 5. Matcher semantics

The `matcher` field on a matcher group filters when the group's handlers run. **How it is evaluated depends on which characters it contains** — there is no explicit "this is a regex" flag.

| Matcher value | Evaluated as | Example |
| :--- | :--- | :--- |
| `"*"`, `""`, or omitted | Match all | Fires on every occurrence |
| Only letters, digits, `_`, `-`, spaces, `,`, `\|` | Exact string, or `\|`/`,`-separated list of exact strings | `Bash`; `Edit\|Write`; `Edit, Write`; `code-reviewer` |
| Contains any other character | **JavaScript regex, unanchored** | `^Notebook`; `mcp__memory__.*` |

Unanchored means `RegExp.prototype.test` — a match anywhere in the value succeeds. `Edit.*` matches both `Edit` and `NotebookEdit`. Write `^Edit$` when you mean exactly `Edit`.

Matchers are **case-sensitive**. A `matcher` on an event with no matcher support is silently ignored.

Version floors worth knowing: comma separators and surrounding-whitespace tolerance require v2.1.191+; hyphens in the exact-match set require v2.1.195+ (before that, `code-reviewer` was treated as an unanchored regex and also fired for `senior-code-reviewer`).

### 5.1 MCP tools

MCP tools appear as ordinary tools named `mcp__<server>__<tool>` and are matched the same way.

```
mcp__memory__create_entities        # one specific tool
mcp__memory__.*                     # every tool from the memory server
mcp__brave-search__.*               # server name containing a hyphen
mcp__.*__write.*                    # any write* tool from any server
```

**The `.*` is required.** A bare `mcp__memory` contains only exact-match characters, so it is compared as an exact string and matches nothing.

Plugin-bundled MCP servers use a scoped segment that includes the plugin name: `mcp__plugin_<plugin-name>_<server-name>__<tool>`. A matcher written against the bare server key never fires for those. For plugin `my-plugin` bundling server `db`: `mcp__plugin_my-plugin_db__.*`.

### 5.2 The `Skill` tool

`Skill` is a tool name, so `PreToolUse` with `matcher: "Skill"` fires when **Claude calls the Skill tool** — which is the model-invoked / auto-triggered path.

The docs state directly that this is only half the story:

> This event covers the path `PreToolUse` doesn't: a `PreToolUse` hook matching the `Skill` tool fires only when Claude calls the tool, but typing `/skillname` directly bypasses `PreToolUse`. `UserPromptExpansion` fires on that direct path.
> — <https://code.claude.com/docs/en/hooks#userpromptexpansion>

So, to answer the question directly:

| Invocation path | Event that fires | Matcher |
| :--- | :--- | :--- |
| Model decides to use a skill (auto-triggered) | `PreToolUse` | `Skill` |
| You type `/skillname` | `UserPromptExpansion` | the command name |

They are **not** the same hook. A skill-usage audit that only hooks `PreToolUse: Skill` records model-invoked skills and misses everything you typed yourself. Covering both means registering two hooks, which is why this repo ships `skill-audit` and `skill-audit-typed` as a pair — see [hooks-catalog.md](./hooks-catalog.md) and [skill-audit.md](./skill-audit.md).

`UserPromptExpansion` also distinguishes `expansion_type` (`slash_command` for skill and custom commands, `mcp_prompt` for MCP server prompts) and carries `command_source`, so a handler can tell a plugin command from a personal one.

*Unverified:* the hooks reference documents `tool_input` schemas for `Bash`, `Grep`, `WebFetch`, `WebSearch`, `Agent` and the file tools, but **not for the `Skill` tool**. The field name carrying the skill's name in `tool_input` is not stated in the docs. This repo's hook probes `skill`, `skill_name`, `skillName`, `name`, `command` in order and logs the raw input when none match, which is the right defensive shape given the gap.

### 5.3 Narrowing further with `if`

On tool events only (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`), a handler can carry an `if` field using **permission-rule syntax**, matched against tool name and arguments together. It runs before the process spawns, so it also saves spawn overhead.

```json
{ "type": "command", "if": "Bash(git *)", "command": "node \"C:/hooks/audit.mjs\"" }
```

On any non-tool event, **a handler with `if` set never runs.** That is a silent-disable trap.

`if` holds exactly one rule — there is no `&&`, `||`, or list syntax. Multiple conditions means multiple handlers.

Bash `if` matching is best-effort and deliberately fails *open*:

| `if` pattern | Bash command | Runs? | Why |
| :--- | :--- | :--- | :--- |
| `Bash(git *)` | `FOO=bar git push` | yes | Leading assignments stripped |
| `Bash(git *)` | `npm test && git push` | yes | Each subcommand checked |
| `Bash(rm *)` | `echo $(rm -rf /)` | yes | `$()` and backticks checked |
| `Bash(rm *)` | `echo $(date)` | no | Nothing matches |
| `Bash(git *)` | `$TOOL git push` | yes | Expansion unknowable, so it runs |

Because it is best-effort, the docs say plainly: use the permission system, not `if`, to enforce a hard allow/deny.

Also note that for a file tool, `"Edit(src/**)"` matches only `src` in the working directory (v2.1.214+). To match `src` at any depth, write `"Edit(**/src/**)"`.

### 5.4 `FileChanged` is special

`FileChanged` does not follow the rules above when building its watch list — its matcher is **literal filenames, exact-match only**. `FileChanged` and `StopFailure` also use a narrower exact-match character set (letters, digits, `_`, `|` only); a hyphen, space, or comma in a matcher for those two pushes it onto the regex path, and only `|` separates alternatives.

Paths to watch can also be supplied dynamically by a `SessionStart` hook returning `hookSpecificOutput.watchPaths` (array of absolute paths).

---

## 6. Where hooks live, and how they combine

### 6.1 Locations

| Location | Scope | Shareable |
| :--- | :--- | :--- |
| `~/.claude/settings.json` | All your projects on this machine | No |
| `.claude/settings.json` | One project | Yes — commit it |
| `.claude/settings.local.json` | One project, you only | No — gitignored when Claude Code creates it |
| Managed policy settings | Organization-wide | Admin-controlled |
| Plugin `hooks/hooks.json` | Whenever the plugin is enabled | Yes — bundled with the plugin |
| Skill frontmatter | Rest of the session, from first invocation | Yes — in the skill file |
| Subagent frontmatter | While that subagent runs | Yes — in the agent file |

On Windows `~/.claude` means `%USERPROFILE%\.claude`, unless `CLAUDE_CONFIG_DIR` redirects it.

### 6.2 They merge — they do not override

This is the point that matters and it is the opposite of ordinary settings precedence:

> Hook entries merge across settings levels rather than replacing each other: user, project, and local settings add their own hooks without removing managed ones.
> — <https://code.claude.com/docs/en/hooks#hook-locations>

So a `PostToolUse: Edit|Write` hook in your user settings and another in the project's settings both run. There is no shadowing. Practically: adding a project hook never disables a user hook, and you cannot "override" a plugin's hook by writing a same-named one — you get both.

Related merge rules:

- **All matching hooks run in parallel.** One hook returning `deny` does not stop its siblings from executing, so do not rely on a deny to suppress another hook's side effects. Results are merged after all of them finish.
- **The same handler defined in more than one settings file runs once.** But a plugin's or a skill's copy of the same handler stays separate and runs again.
- When multiple `PreToolUse` hooks return `updatedInput`, **the last one to finish wins**, and because they run in parallel the order is non-deterministic. Never have two hooks rewrite the same tool's input.

Hooks from settings, managed policy, and plugins also run **inside subagents**. When a subagent calls a tool, `PreToolUse`/`PostToolUse` fire the same configured hooks, with `agent_id` and `agent_type` in the payload so you can tell them apart from main-thread calls.

### 6.3 Turning hooks off

`"disableAllHooks": true` in a settings file disables all hooks. Notes:

- It is read **after settings precedence applies**, so a `false` in a project's `.claude/settings.json` overrides a `true` in your user settings.
- `--settings '{"disableAllHooks": true}'` turns them off for one run regardless of project settings.
- Set outside managed settings it disables user, project, local, and plugin hooks; managed hooks and hooks from managed-force-enabled plugins keep running.
- **There is no way to disable an individual hook while keeping it in the configuration.** To remove one, delete its entry.

Settings-file hook edits are normally picked up by the file watcher without a restart.

`allowManagedHooksOnly` (enterprise) blocks user, project, local, and plugin hooks entirely, with an exemption for plugins force-enabled in managed `enabledPlugins`.

### 6.4 Workspace trust

Hooks in a project `.claude/settings.json` require workspace trust — and the trust check fires **before** the trust dialog, so an untrusted folder's hooks do not run. Frontmatter hooks in a project *skill* register on invocation and follow the settings-file rule; frontmatter hooks in a project *subagent* run only after you accept the trust dialog for that folder (v2.1.218+), and a `-p` session does not count as accepting it.

---

## 7. Variable expansion in `command`

Three path placeholders, substituted by Claude Code before the command runs:

| Placeholder | Resolves to |
| :--- | :--- |
| `${CLAUDE_PROJECT_DIR}` | The project root **where the session started**. Also set in the environment of stdio MCP servers and plugin LSP servers |
| `${CLAUDE_PLUGIN_ROOT}` | The plugin's installation directory. **Changes on every plugin update** |
| `${CLAUDE_PLUGIN_DATA}` | The plugin's persistent data directory — for dependencies and state that must survive updates |

All three are also **exported as environment variables** (`CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`) on the spawned process, in both exec and shell form, so a Node script can read `process.env.CLAUDE_PLUGIN_ROOT` regardless of how it was launched.

**Worktrees split these two apart.** `${CLAUDE_PROJECT_DIR}` stays at the session's starting project root even after Claude enters a worktree; the `cwd` field in the stdin payload follows Claude. If a hook needs to know which tree Claude is actually working in, read `cwd`, not the placeholder.

Other environment available to a hook process:

| Variable | Where |
| :--- | :--- |
| `$CLAUDE_EFFORT` | Current effort level, also in the `effort` payload field |
| `$CLAUDE_CODE_REMOTE` | `"true"` in remote web environments; unset in the local CLI |
| `$CLAUDE_ENV_FILE` | A file path to append `export` statements to, persisting env vars for later Bash commands. **Only on `SessionStart`, `Setup`, `CwdChanged`, `FileChanged`** |
| `$CLAUDE_PLUGIN_OPTION_<KEY>` | A plugin user-config option value, for shell-form plugin hooks |
| `$CLAUDE_CODE_BRIDGE_SESSION_ID` | Remote Control session ID while a Remote Control connection is active (v2.1.199+) |

A hook process otherwise inherits the parent environment, minus the `OTEL_*` exporter variables Claude Code strips from every subprocess.

Plugin hooks additionally substitute `${user_config.*}` values, **exec form only**. A shell-form plugin hook whose `command` references `${user_config.*}` fails with an error instead of running; read `$CLAUDE_PLUGIN_OPTION_<KEY>` or switch to exec form.

Handlers run in the current directory. If that directory no longer exists (a worktree another shell deleted), Claude Code falls back to the session's starting directory, then the project root, then home, then system temp, and records the fallback in the debug log.

---

## 8. Windows specifics

This machine is Windows 11, with Git Bash and Node 24 available and **no `jq`**. Every Bash example in the official docs uses `jq`; none of them will run here as written.

### 8.1 Which shell runs `command`

A command hook has two forms, selected by whether `args` is present:

- **Shell form** (`args` absent): the `command` string is handed to a shell — `sh -c` on macOS/Linux, **Git Bash on Windows**, or **PowerShell when Git Bash is not installed**. The shell tokenizes, expands variables, and interprets pipes, `&&`, redirects, and globs.
- **Exec form** (`args` present): `command` is resolved as an executable on `PATH` and spawned **directly, with no shell**. Each `args` element is one argument exactly as written. Placeholders are substituted into `command` and each `args` element as plain strings. Apostrophes, `$`, backticks pass through verbatim.

`"shell": "bash" | "powershell"` picks the shell explicitly for shell form; it is ignored when `args` is set. Setting `"powershell"` auto-detects `pwsh.exe` and falls back to `powershell.exe`.

The docs' explicit guidance: **set `args` whenever the hook references a path placeholder**, because exec form passes each element as one argument with no quoting concerns. Omit `args` only when you need pipes or `&&`.

### 8.2 Why `node "C:/path/to/hook.mjs"` is the safe shell-form spelling

Four properties combine:

1. **`node` is a real `.exe`.** On Windows, exec form requires `command` to resolve to an actual executable. The `.cmd` / `.bat` shims that npm, npx, and eslint install in `node_modules/.bin` are **not executables and cannot be spawned without a shell** — the docs call this out specifically, and recommend invoking the underlying script with `node` directly (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]`) because "the `node` plus script-path pattern works on every platform".
2. **Forward slashes survive both shells.** Git Bash treats `\` as an escape character; `C:\src\ai-tooling\hooks\x.mjs` inside a JSON string is already `C:\\src\\...` in the file, and what the shell then sees depends on quoting. Node accepts `C:/src/...` on Windows without complaint, so forward slashes sidestep the whole question.
3. **The drive letter keeps it absolute in both worlds.** A Git Bash-style `/c/src/...` path is meaningless to a `node.exe` spawned outside Git Bash, and meaningless to PowerShell if Git Bash is absent. `C:/src/...` is understood by Node in every case.
4. **Double quotes handle spaces.** `%USERPROFILE%` frequently contains a space. In shell form the docs instruct: wrap each placeholder in double quotes.

So, in shell form:

```json
{
  "type": "command",
  "command": "node \"C:/src/ai-tooling/tools/claude/hooks/skill-audit.mjs\"",
  "timeout": 10
}
```

And the exec-form equivalent, which avoids shell quoting entirely and is what the docs prefer for placeholder paths:

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/skill-audit.mjs"],
  "timeout": 10
}
```

Exec form has one gotcha: `command` is the executable **only**. A bare name containing whitespace alongside `args` — `"command": "node script.js"` — logs a warning because no such executable exists. An absolute path containing spaces, such as `C:\Program Files\nodejs\node.exe`, is a single valid executable and is fine.

### 8.3 PowerShell hooks

If you write a PowerShell hook, the placeholder rules change. As of v2.1.198, Claude Code rewrites `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` in a PowerShell shell-form command into PowerShell's `${env:NAME}` form — which means the placeholder works inside **double-quoted** strings and not inside single-quoted ones, where PowerShell never expands variables.

**Never write the bare `$CLAUDE_PROJECT_DIR` spelling in a PowerShell hook.** PowerShell parses it as an undefined local variable and resolves it to `$null`, leaving the script path without its prefix. Claude Code does not rewrite that form; it logs a warning to the debug log and the hook silently misbehaves.

The version-proof spelling:

```json
{
  "type": "command",
  "shell": "powershell",
  "command": "& \"$env:CLAUDE_PROJECT_DIR\\.claude\\hooks\\check.ps1\""
}
```

Reading stdin in PowerShell: `$callInput = [Console]::In.ReadToEnd() | ConvertFrom-Json`.

### 8.4 No `jq` — read stdin in Node

The idiomatic replacement for `jq -r '.tool_input.command'`:

```js
#!/usr/bin/env node
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let payload = {};
try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { }

const command = payload?.tool_input?.command ?? '';
if (/\brm\s+-rf\b/.test(command)) {
  process.stderr.write('Blocked: rm -rf is not allowed.\n');
  process.exit(2);
}
process.exit(0);
```

Two habits this repo already follows and that are worth keeping: guard `JSON.parse` (empty or malformed stdin should not crash the hook), and build any JSON output with `JSON.stringify` rather than string concatenation, so quotes and backslashes inside values are escaped correctly. The docs specifically attribute JSON parse failures to hand-built payloads.

### 8.5 The Git Bash profile trap

This is a Windows-flavoured failure that produces *no error at all*.

Shell-form hooks run in a non-interactive shell, but Git Bash — and any config with `BASH_ENV` pointing at `~/.bashrc` — still sources your profile. If the profile prints anything unconditionally, that text is prepended to your hook's stdout:

```text
Shell ready on arm64
{"decision": "block", "reason": "Not allowed"}
```

The combined output no longer starts with `{`, so all of stdout is treated as plain text and the JSON is ignored. On exit 0 **nothing appears in the transcript**; the parse attempt is recorded only in the debug log. Fix the profile:

```bash
# in ~/.bashrc
if [[ $- == *i* ]]; then
  echo "Shell ready"
fi
```

Or avoid the class entirely by using exec form, which spawns no shell.

---

## 9. Timeouts, status messages, parallelism

**Parallelism.** All matching hooks for an event run in parallel and every one runs to completion before results are merged. Deny does not short-circuit siblings.

**Timeouts.** Set per handler with `timeout`, in **seconds**.

| Handler type | Default |
| :--- | :--- |
| `command`, `http`, `mcp_tool` | 600 s |
| `prompt` | 30 s |
| `agent` | 60 s |

Lowered defaults for `command`/`http`/`mcp_tool` on specific events: **30 s** on `UserPromptSubmit`, `PreModelSwitch`, `PostModelSwitch`; **10 s** on `MessageDisplay`.

`SessionEnd` hooks are the odd one out: they share a **1.5-second budget** across all of them. A longer per-hook `timeout` in a settings file raises the budget to match, up to 60 s — but **timeouts on plugin-provided hooks do not raise the budget**. Override explicitly with `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`.

What a timeout does: the hook is canceled and **its output is discarded**, so on most events a timed-out hook renders no decision. On `PreToolUse` a timed-out command/http/mcp_tool hook does **not** block — the call continues through the normal permission flow. Do not rely on a stalled hook to act as a gate. (`PreModelSwitch` is the exception: a hook canceled at its timeout blocks the switch.)

`timeout` is not enforced on a command hook running with `async: true`.

**`statusMessage`.** A custom spinner message shown while the hook runs. Purely cosmetic, but the cheapest way to make a hook's existence visible while you are still trusting it.

**Async hooks.** `"async": true` runs a command hook in the background without blocking. `"asyncRewake": true` additionally wakes Claude on exit code 2, showing the hook's stderr (or stdout if stderr is empty) as a system reminder — the mechanism for reacting to a long-running background failure.

**`once: true`** removes a hook after its first successful run, but it is honored **only in skill frontmatter** and ignored in settings files and agent frontmatter.

---

## 10. What is possible

Concrete patterns. All shell-form/Node, no `jq`.

### 10.1 Block a dangerous command (hard gate)

`PreToolUse` on `Bash`, narrowed by `if` so the process only spawns when it might matter.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.mjs"],
            "statusMessage": "Checking command safety"
          }
        ]
      }
    ]
  }
}
```

The handler either prints a deny decision or exits 0. Exiting 0 silently is *not* an approval — it just declines to decide, and the call continues through the normal permission flow.

`PreToolUse` hooks fire before any permission-mode check, in **every** mode including `bypassPermissions` and `--dangerously-skip-permissions`. This is the only mechanism that enforces policy a user cannot escape by changing permission mode. The reverse does not hold: a hook `"allow"` cannot loosen a deny rule from settings.

### 10.2 Auto-format after an edit

`PostToolUse` on `Edit|Write`. The hook reads `tool_input.file_path`, normalizes separators, and runs the formatter. Because `PostToolUse` cannot block, the worst case is a formatter that fails and reports via stderr + exit 2 so the model sees it.

Prefer `FileChanged` instead when you care about the file changing *at all* rather than about the tool that changed it — a `Bash` command writing the same file fires no `Edit|Write` hook.

### 10.3 Inject context at session start

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/src/ai-tooling/tools/claude/hooks/session-context.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`SessionStart` is one of only four events (`UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`) where **plain-text stdout is added to Claude's context**, so a context-loading hook can just print and exit — no JSON needed. Use the JSON form only when combining context with `sessionTitle`, `watchPaths`, or `reloadSkills`.

This repo's user settings already do exactly this: it `cat`s `work-tracking/wip.md` into every session. That is the correct event for it — and note that `SessionStart` re-runs on resume with `source: "resume"`, so the WIP snapshot refreshes rather than replaying a stale copy.

Keep these fast. They run on every session, including every `/clear`.

### 10.4 Audit every tool or skill call

`PreToolUse` with the matcher omitted (or `"*"`) fires on every tool call; write one JSONL line per call and analyse later. For skills specifically, remember [§5.2](#52-the-skill-tool): `PreToolUse: Skill` covers the model-invoked path, `UserPromptExpansion` covers the typed `/name` path, and you need both for a complete picture.

An audit hook must be **passive**: always exit 0, never block, wrap everything in try/catch. See [§11.3](#113-fail-open).

### 10.5 Enforce a house rule the model keeps forgetting

The canonical case: CLAUDE.md says "never add code comments", and the model adds comments anyway because CLAUDE.md is advisory.

A `PostToolUse` hook on `Edit|Write` inspects `tool_input.new_string` / `content`, and on a violation writes the complaint to **stderr** and exits 2. The tool already ran — the file has the comment in it — but the model receives the stderr and corrects itself on the next turn. That is the honest shape of this control: detection plus forced correction, not prevention.

If you want actual prevention, the same check has to move to `PreToolUse` and return `permissionDecision: "deny"`. The tradeoff is false positives: a `PreToolUse` deny costs the model a whole turn and can deadlock it if the heuristic is wrong. Starting on `PostToolUse` while you calibrate the false-positive rate, then promoting to `PreToolUse`, is the low-risk path — which is why this repo ships `no-comments` as a `PostToolUse` hook, disabled by default.

### 10.6 Other shapes worth knowing

- **Desktop notification** — `Notification` hook returning `terminalSequence` (OSC 777/9). Hooks have no controlling terminal and cannot write to `/dev/tty`; `terminalSequence` is the supported route and works on Windows, in tmux, and in screen. Only emitted in interactive sessions, never under `-p` or the SDK.
- **Guard the finish line** — `Stop` hook that runs tests and returns `additionalContext: "Please run the test suite before finishing"`, guarded on `stop_hook_active`.
- **Persist env vars for later Bash calls** — `SessionStart` hook appending `export` lines to `$CLAUDE_ENV_FILE`.
- **Auto-install skills mid-session** — `SessionStart` hook that syncs a skills repo then returns `{"hookSpecificOutput": {"hookEventName": "SessionStart", "reloadSkills": true}}`, since skill discovery otherwise runs before `SessionStart` hooks finish.
- **Redaction** — intercept at `PreToolUse` (`updatedInput`) for outbound tool arguments and `PostToolUse` (`updatedToolOutput`) for inbound results. Remember `updatedToolOutput` must match the tool's output shape (`Bash` returns `{stdout, stderr, interrupted, isImage}`); a mismatched value is ignored and the original is used.

---

## 11. Debugging hooks

### 11.1 The debug log is the only complete record

Which hooks matched, their exit codes, and full stdout/stderr go to the debug log — not the terminal.

```bash
claude --debug-file C:/src/ai-tooling/tmp/claude-debug.log
# or
claude --debug     # writes to ~/.claude/debug/<session-id>.txt; does NOT print to the terminal
```

Mid-session, `/debug` enables logging and reports the path. `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` adds matcher counts and query matching.

Typical entries:

```text
2026-07-19T02:03:24.382Z [DEBUG] Hook output does not start with {, treating as plain text
2026-07-19T02:03:24.382Z [DEBUG] Hook PostToolUse:Write (PostToolUse) success:
hook-ran
```

`/hooks` opens a read-only browser of every configured hook, labelled by source (`User Settings`, `Project Settings`, `Local Settings`, `Plugin Hooks`, `Session Hooks`) — the fastest way to confirm a hook is registered at all, and to see which file it came from.

### 11.2 Test a hook by piping JSON into it

The hook is just a program reading stdin. Run it directly:

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' \
  | node "C:/src/ai-tooling/tools/claude/hooks/block-rm.mjs"
echo $?
```

For payloads with Windows paths, a heredoc avoids quoting pain:

```bash
node "C:/src/ai-tooling/tools/claude/hooks/no-comments.mjs" <<'JSON'
{"hook_event_name":"PostToolUse","tool_name":"Write",
 "tool_input":{"file_path":"C:\\src\\proj\\src\\a.ts","content":"// nope\nconst x = 1;"}}
JSON
echo $?
```

Check three things: the exit code, that stdout is *only* the JSON object (nothing prepended — see [§8.5](#85-the-git-bash-profile-trap)), and that stderr carries the message you want the model to read on exit 2.

### 11.3 Fail open

A hook that crashes should not take the session with it. Wrap the body in try/catch and exit 0 on internal error, optionally logging to stderr behind a debug flag. That is the shape `runHook()` in `tools/claude/hooks/lib/hook-io.mjs` implements, and it is the right default for anything passive.

The deliberate exception is a policy gate. There, failing open means the gate is silently off — so a gate should be loud when it breaks, and you should watch for `Failed with non-blocking status code:` in the transcript on its first run after any path change.

### 11.4 Symptom → cause

| Symptom | Likely cause |
| :--- | :--- |
| Hook never runs | Matcher case or exact-vs-regex mismatch ([§5](#5-matcher-semantics)); an `if` field on a non-tool event; wrong event; untrusted workspace |
| `hook error: ... command not found` | Relative path. Use an absolute path or a placeholder; or switch to exec form with `args` |
| `jq: command not found` | No `jq` on this machine. Parse in Node ([§8.4](#84-no-jq--read-stdin-in-node)) |
| Valid JSON printed, no effect, no error | Something printed before it — shell profile output ([§8.5](#85-the-git-bash-profile-trap)). Check the debug log |
| JSON validation / parse notice in transcript | stdout looked like JSON but was invalid, or parsed but failed schema. Happens even on exit 0. Build output with `JSON.stringify` |
| Hook should have blocked but didn't | It exited `1`, not `2` ([§4.1](#41-exit-codes)); or it timed out, and a timed-out `PreToolUse` hook does not block |
| Claude keeps working, "Stop hook blocked too many times" | `Stop` hook not checking `stop_hook_active` ([§4.5](#45-the-stop-loop-cap)) |
| `/hooks` shows nothing | Invalid JSON in the settings file (no trailing commas, no comments), wrong file location, or the watcher missed the edit — restart the session |
| Path check never matches on Windows | Backslash separators in `tool_input.file_path` ([§3.3](#33-file-paths-in-tool_input-on-windows)) |

Broader diagnosis: `/status` shows which settings files loaded, and `/doctor` plus <https://code.claude.com/docs/en/debug-your-config> covers precedence problems.

---

## 12. Security notes

Hooks execute arbitrary shell commands automatically, with your credentials, at events you may not be watching. A few consequences:

- A hook in a project's `.claude/settings.json` is code that ships with the repository. Workspace trust is the gate; do not trust folders casually.
- A plugin's hooks activate as a set the moment the plugin is enabled. Read `hooks/hooks.json` before enabling a third-party plugin — see [plugins.md §5](./plugins.md#5-can-you-install-just-the-hooks-from-someone-elses-plugin).
- `additionalContext` and hook stdout land in the model's context. Redact secrets on the way out; this repo's `redact()` in `hook-io.mjs` exists for that.
- HTTP hook allowlists (`allowedHttpHookUrls`, `httpHookAllowedEnvVars`) apply to hooks from every source including managed settings, and only variables named in `allowedEnvVars` are interpolated into headers.

---

## 13. Things this document could not verify

- **`Skill` tool `tool_input` schema.** The hooks reference documents `tool_input` for `Bash`, `Grep`, `WebFetch`, `WebSearch`, `Agent`, and the file tools, but not for `Skill`. The field carrying the skill name is not stated.
- **Whether `PostToolUse` fires for the `Skill` tool at skill *completion*** in a way that reliably pairs with the `PreToolUse` record. `PostToolUse` fires "after a tool call succeeds" and `Skill` is a tool, so it should — but the docs never discuss the `Skill` tool's lifecycle specifically.
- **Exact behaviour of a `SessionStart` hook under `/clear` cancellation.** The docs say `/clear` runs the hooks in the background and cancels them if you `/clear` again or `/resume` while they run, discarding output; they do not say whether a partially-written side effect is rolled back (it plainly is not, but that is inference).
