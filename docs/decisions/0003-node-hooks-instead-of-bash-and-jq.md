# ADR 0003: Node hooks instead of bash + jq

## Status

Accepted, 2026-09-09

## Context

The `no-comments` hook arrived as a bash script from a coworker's Mac, with their absolute paths baked
in and `jq` used to pull fields out of the hook's stdin payload. Two problems on this machine:

- **`jq` is not installed.** Every Bash example in the official Claude Code hook documentation uses it;
  none of them run here as written (see `docs/claude/hooks.md` §8.4).
- **The paths were someone else's.** The brief requires the script to live in this repo and be re-pathed
  for this machine.

Claude Code invokes a `type: "command"` hook through the shell and hands it a JSON payload on stdin, so
the hook's only hard requirements are: read stdin, parse JSON, exit with the right code.

## Decision

Hooks are Node ES modules (`.mjs`), executed as `node "<abs path>/tools/claude/hooks/<name>.mjs"`.

Node 24 is already on this machine (`package.json` sets an `engines.node` floor of `>=20`), so this adds
no dependency at all — no `jq`, no bash-isms, and the same script runs unchanged on macOS or Linux if
this config is ever installed there. JSON parsing is `JSON.parse`, which is what `jq` was being used for.
Shared plumbing lives in `tools/claude/hooks/lib/hook-io.mjs`: `readPayload()`, `block()`, `runHook()`,
`redact()`, and the `EXIT_OK` / `EXIT_BLOCK` constants.

The decisive advantage over a shell script is testability. Because a hook is a module, the test suite
imports its functions directly and asserts on them — `tests/no-comments.test.mjs` calls `commentLines()`,
`introducedComments()` and `isCodeFile()` without spawning a process or feeding a subprocess synthetic
stdin.

**Hook modules guard their side effects behind `isMain(import.meta.url)`.** Both `no-comments.mjs` and
`skill-audit.mjs` end with:

```js
if (isMain(import.meta.url)) {
  runHook('no-comments', async () => { ... });
}
```

This is not stylistic. Without the guard, importing the module in a test *executes the hook*, which calls
`readPayload()` → `readStdin()` and blocks reading the test runner's stdin — the test run hangs with no
error. This happened during development. `isMain()` compares `import.meta.url` against
`pathToFileURL(process.argv[1]).href`, so it is true only when the file was invoked directly.

**The port preserves the original bash script's semantics exactly**, so behaviour is unchanged and any
future divergence is a deliberate edit rather than an artefact of the rewrite:

- The same file extension list: `.cs .ts .tsx .js .jsx .mjs .cjs .go .java .kt .swift .rs .c .h .cpp .hpp`.
  Anything else is passed through untouched.
- The same leading-comment pattern, `/^[^\S\n]*(\/\/|\/\*|\*\/|\* )/` — line-initial `//`, `/*`, `*/`, or
  `* ` after optional horizontal whitespace.
- The same trailing-comment pattern, `/[^\s][^\S\n]+\/\/([^\S\n]|$)/` — code, then whitespace, then `//`
  followed by whitespace or end of line. The required whitespace *after* `//` is what stops `https://`
  from matching, since a URL always has a hostname character there; the required whitespace *before* `//`
  independently rules it out too. Both guards are carried over verbatim rather than "simplified".
- The same exclusion of pre-existing comments: `introducedComments()` builds a `Set` of the comment lines
  found in `old_string` and reports only lines in `new_string` that are not already in it, so moving or
  re-indenting existing commented code does not trip the hook. Multi-edit calls are handled by pairing
  each `edits[]` entry's `old_string` / `new_string`.
- The same cap of 8 reported lines (`introduced.slice(0, 8)`).
- The same exit code 2 for a violation (`EXIT_BLOCK`).

**Exit 2 on `PostToolUse` cannot undo the write.** The hook is a `PostToolUse` hook matched on
`Edit|Write`, so by the time it runs the file is already on disk with the comments in it. Exit code 2 does
not roll anything back; what it does is feed the stderr message back to the model, which then removes the
comments itself in a follow-up edit. The hook is a correction loop, not a veto. This is why `report()`
writes an instruction ("Remove them now") rather than a diagnostic.

`no-comments` ships with `"enabled": false` in `tools/claude/settings/hooks.json` — it is installed only
once its false-positive rate is trusted, since a false positive costs an extra model turn on every edit.

## Consequences

### Good

- Runs on this machine as-is, with no `jq` and no extra install step.
- Cross-platform: the same `.mjs` file works wherever Node does.
- Directly unit-testable by import, which is why `no-comments` has real per-pattern coverage rather than
  a smoke test.
- `runHook()` gives every hook uniform fail-open behaviour: an internal exception is swallowed and the
  process exits 0, so a bug in a hook cannot break editing. Only the deliberate `block()` path exits 2.
  Debugging is opt-in via `AI_TOOLING_HOOK_DEBUG=1`.

### Bad / accepted costs

- Node process startup on every matched tool call. Small, but not free, and it is paid on every `Edit`
  and `Write` once `no-comments` is enabled.
- Node becomes a hard prerequisite for the config to function. A machine with Claude Code but no Node
  gets silently hookless.
- Hooks copied from the official docs or from coworkers have to be ported rather than pasted.
- The `isMain` guard is easy to omit when adding a new hook, and omitting it produces a hang rather than
  a failure — an obscure symptom for a one-line cause. It is documented in `docs/claude/hooks.md` for
  this reason.

## Alternatives considered

**Install `jq` and keep the bash script.** Rejected: it adds a machine prerequisite outside the repo to
solve a problem Node already solves, keeps the hook untestable except by subprocess, and leaves the hook
dependent on Git Bash being the shell Claude invokes.

**PowerShell hooks** (`ConvertFrom-Json` is built in). Rejected: Windows-only, slower to start than Node,
and awkward to unit test.

**Reimplement JSON parsing in POSIX sh.** Rejected outright — hand-rolled JSON parsing in a hook that
runs on every edit is a bad trade at any price.

**A compiled binary hook.** Rejected: a build artefact in the repo, a platform matrix to maintain, and
edits would stop being live, breaking the by-reference install model of ADR 0002.

**Skipping the `isMain` guard and testing by spawning the hook as a subprocess.** Rejected: it makes
every assertion an integration test over stdout/stderr and exit codes, it is slower, and it gives worse
failure messages than asserting on `commentLines()` directly.

## Appendix: the original script

Kept as provenance, and so the bash version can be restored on a machine that has `jq` and prefers
it. It is **not** wired into anything; `tools/claude/hooks/no-comments.mjs` is the live
implementation. The script body is verbatim; only the coworker's username in the `command` path has
been replaced, since this repo is public and that is someone else's personal information.

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "/Users/<coworker>/.claude/hooks/no-comments.sh",
        "timeout": 10,
        "statusMessage": "Checking for code comments"
      }
    ]
  }
]
```

```bash
#!/usr/bin/env bash
set -u
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
case "$path" in
  *.cs|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.go|*.java|*.kt|*.swift|*.rs|*.c|*.h|*.cpp|*.hpp) ;;
  *) exit 0 ;;
esac
new=$(printf '%s' "$input" | jq -r '.tool_input.new_string // .tool_input.content // empty')
old=$(printf '%s' "$input" | jq -r '.tool_input.old_string // empty')
pattern='^[[:space:]]*(//|/\*|\*/|\* )|[^[:space:]][[:space:]]+//([[:space:]]|$)'
new_hits=$(printf '%s\n' "$new" | grep -E "$pattern" || true)
[ -z "$new_hits" ] && exit 0
old_hits=$(printf '%s\n' "$old" | grep -E "$pattern" || true)
if [ -n "$old_hits" ]; then
  added=$(printf '%s\n' "$new_hits" | grep -vxF -f <(printf '%s\n' "$old_hits") || true)
else
  added="$new_hits"
fi
[ -z "$added" ] && exit 0
{
  echo "Comment lines introduced in $path. CLAUDE.md forbids code comments. Remove them now (rename or extract instead of explaining):"
  printf '%s\n' "$added" | head -8
} >&2
exit 2
```

The Node port differs from this in three ways, all deliberate:

- It also handles a `edits` array, so a multi-edit payload is covered rather than silently skipped.
- It trims each reported line before printing, which only affects the message, not the verdict.
- Its side effect is guarded by `isMain(import.meta.url)`, so the module can be imported by tests.
