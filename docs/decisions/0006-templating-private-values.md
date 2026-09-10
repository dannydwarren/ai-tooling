# ADR 0006: Templating private values outside the working tree

## Status

Accepted, 2026-09-09

## Context

This repo is public on GitHub, but the config it captures is real working config, and real working config
contains things that must not be published:

- **Employer-internal identifiers.** `tools/claude/skills/checking-kafka-offset-lag/SKILL.md` needs an MSK
  cluster name to make its example DataDog queries usable. `~/.claude/settings.json` references the
  employer's internal plugin marketplace by repository name under `extraKnownMarketplaces`.
- **Absolute home paths.** `~/.claude/CLAUDE.md` is built around them, and every one discloses the account
  name. The hook `command` strings in `settings.json` embed the absolute path of this checkout.

None of this is a credential — the scanner's `secret` rules from ADR 0004 would not catch any of it — but
publishing an internal cluster name or a private repository name is still a leak. "Did I remember to strip
the internal name from this file before committing?" is a judgement call made under time pressure, dozens
of times, forever. That is a bad control.

## Decision

**Files under `tools/` store `{{PLACEHOLDER}}` tokens, never real private values.** Rendering happens at
install time; the reverse substitution happens at capture time. The regex is `/\{\{([A-Z0-9_]+)\}\}/g`
(`scripts/lib/template.mjs`).

### Path placeholders are derived automatically

`derivedValues()` computes them from the environment — nothing to configure and nothing to keep in sync:

| base | source | variants |
|---|---|---|
| `REPO_ROOT` | resolved from `scripts/lib/paths.mjs`'s own location | `_JSON`, `_SLASH`, `_POSIX` |
| `USER_HOME` | `os.homedir()` | `_JSON`, `_SLASH`, `_POSIX` |
| `CLAUDE_HOME` | `CLAUDE_CONFIG_DIR` or `~/.claude` | `_JSON`, `_SLASH`, `_POSIX` |

The three variants exist because the same path is written three different ways in three different
consumers:

- **plain** — prose in `CLAUDE.md`: `{{USER_HOME}}\work-tracking\`.
- **`_SLASH`** — forward slashes for a shell command string:
  `node "{{REPO_ROOT_SLASH}}/tools/claude/hooks/skill-audit.mjs"`.
- **`_POSIX`** — Git Bash form, `C:\src\x` → `/c/src/x`, for a bash-executed hook command:
  `cat {{USER_HOME_POSIX}}/work-tracking/wip.md`.
- **`_JSON`** — backslash-escaped for a path *inside a JSON string*. This variant is load-bearing rather
  than cosmetic. A Windows path stored in `settings.json` appears as `C:\\Users\\Name\\.jobnimbus`, with
  doubled backslashes, so the raw `USER_HOME` value (`C:\Users\Name`) does not appear in the file text and
  the reverse substitution would silently fail to match it — leaving the real path in a tracked file.
  `jsonEscaped()` produces the doubled form, and `tests/install.test.mjs` covers both the escaping and the
  settings.json round trip.

### Genuinely private values live outside the working tree

`~/.ai-tooling/values.json` (overridable via `AI_TOOLING_VALUES`) holds `MSK_CLUSTER_NAME` and
`WORK_MARKETPLACE_REPO`. It is deliberately **not** in the repo — not even in a gitignored directory.
A `.gitignore` mistake, a `git add -f`, a `git clean` from the wrong directory, or an editor that indexes
the workspace cannot leak a file that was never inside it. `loadValues()` merges
`{...derivedValues(), ...loadPrivateValues()}`, so private values can override a derived key if ever
needed.

`security/required-values.json` declares the *keys* and a description of each, without the values. It is
committed, so a fresh clone knows what to create, and the build can recognise a placeholder as legitimate
on a machine or CI runner that has no values file at all.

### The scanner turns every private value into a `secret`-severity rule

This is the part that makes the whole scheme mechanical rather than a matter of care.
`privateValueRules()` in `scripts/checks/scan.mjs` reads `loadPrivateValues()` and synthesises, for each
value of at least 6 characters, a rule:

```js
{
  id: `private-value:${key}`,
  severity: 'secret',
  title: `Private value ${key} appears verbatim (use the {{${key}}} placeholder instead)`,
  regex: new RegExp(escapeRegExp(value), 'gi'),
}
```

`secret` severity fails the build (ADR 0004). So if an internal cluster name or the private marketplace
repo name ever lands verbatim in a tracked or untracked-unignored file, the build goes red and names the
file, the line, and the placeholder that should have been used. "Did I leak an internal name?" stops being
a judgement call and becomes a check that runs every build. The rules never appear in `patterns.json` —
that file is public, and a pattern file listing the internal names would be the leak.

### Rendering and un-rendering

- `render()` (install) replaces `{{KEY}}` with the value and returns the list of keys it could not resolve.
- `unrender()` (capture) replaces values with `{{KEY}}`, longest value first so a nested path becomes
  `{{CLAUDE_HOME}}` rather than `{{USER_HOME}}\.claude`, and case-insensitively because Windows paths vary
  in case between the sources that produce them.

### The installer fails loudly rather than writing half-rendered files

`scripts/claude-install.mjs` collects unresolved placeholders across every planned file *before* writing
anything, and if any are missing it writes nothing at all, prints `Nothing was written`, lists each missing
key with its description from `security/required-values.json` formatted as the JSON to paste, and exits 1.
`addManaged()` throws outright on an unresolved placeholder in a hook command, since a hook command with a
literal `{{REPO_ROOT_SLASH}}` in it would be installed into `settings.json` and fail on every tool call.

## Consequences

### Good

- The public repo contains placeholders where internal identifiers would be, and no history to scrub.
- Private values cannot be leaked by a `.gitignore` error, because they are not in the tree.
- "Did I leak an internal name" is answered by `npm run build`, not by remembering.
- Path templating makes the repo portable: a different account name, a different checkout location, or a
  non-default `CLAUDE_CONFIG_DIR` all work with no edits, because the path values are derived rather than
  stored.
- `security/required-values.json` documents what a new machine needs without disclosing any of it.

### Bad / accepted costs

- **A fresh clone on a new machine does not work until `~/.ai-tooling/values.json` is recreated.** There is
  no way around this — that is the point — so the installer makes it a loud, self-describing failure that
  names the missing keys rather than a silent partial install.
- The values file is not backed up by this repo, by design. Losing it means reconstructing the values from
  the descriptions in `security/required-values.json`.
- On a machine without the values file, the private-value rules do not exist, so the scanner cannot detect
  a verbatim internal name there. The protection is strongest exactly where the risk is — the machine that
  knows the values is the machine that could leak them.
- `unrender()` is a case-insensitive literal substitution, so a short or common private value would produce
  false replacements. The 6-character floor in `privateValueRules()` and the 3-character floor in
  `unrender()` are crude guards; a genuinely short internal identifier would need different handling.
- Reading `tools/claude/skills/checking-kafka-offset-lag/SKILL.md` in the repo is slightly harder than
  reading the rendered file, because the reader sees `{{MSK_CLUSTER_NAME}}`.
- Every new private value is three edits: the token in the file, the key in `required-values.json`, the
  value in the out-of-tree values file.

## Alternatives considered

**Keep the real values in the repo and rely on `.gitignore`.** Rejected: a gitignored file is still in the
working tree, so one `git add -f`, one tooling change, one editor indexing the workspace, and it is out.
Anything that must not be published should not be in the directory that gets published.

**Redact by hand before each commit.** Rejected: a repeated judgement call under time pressure is exactly
the control that eventually fails, and it fails silently and irreversibly in a public repo.

**Encrypt the values into the repo (git-crypt, SOPS, an encrypted blob).** Rejected: it adds a toolchain
prerequisite and a key to manage in order to protect values that are not secrets — they are internal
identifiers. Keeping them out of the tree entirely is simpler and has no key-loss failure mode.

**Environment variables instead of a values file.** Rejected: they would have to be set for every install,
capture and scan invocation, they are easy to leak into a shell history or a captured process listing, and
the scanner needs the full set present to synthesise its private-value rules. A single JSON file at a known
path outside the tree is easier to reason about. `AI_TOOLING_VALUES` still allows relocating it.

**One path placeholder form instead of four variants.** Rejected: it does not survive contact with JSON.
Without `_JSON`, the backslash-escaped path inside `settings.json` never matches on capture, and the real
home path stays in a tracked file — a silent failure of exactly the protection the scheme exists to
provide.

**Listing private values in `security/patterns.json` so the scanner catches them.** Rejected: that file is
public. A pattern file enumerating the internal names would *be* the leak. Hence the split — keys and
descriptions are public in `required-values.json`, values are out of tree, and the rules are synthesised at
scan time.
