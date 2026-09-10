# Installing

Every tool this repo configures gets a section here. Adding a tool means adding a directory under
`tools/` and a section below.

## Prerequisites

- **Node 20 or newer.** Everything is plain Node ESM with no dependencies; there is no `npm install`
  step. Check with `node --version`.
- **Git**, because the scanner enumerates files with `git ls-files`.
- The repo cloned somewhere stable. Hook commands are written as absolute paths, so moving the
  checkout means re-running the installer.

## The private values file

Files under `tools/` contain `{{PLACEHOLDER}}` tokens instead of machine-specific or
employer-internal strings. Most placeholders are derived automatically from your environment, but a
few hold values that must not be committed to a public repo. Those live outside the working tree:

```
~/.ai-tooling/values.json
```

```json
{
  "MSK_CLUSTER_NAME": "the-kafka-cluster-name",
  "WORK_MARKETPLACE_REPO": "the-internal-marketplace-repo-name"
}
```

Keeping it outside the repo means a `.gitignore` mistake cannot leak it. Override the location with
`AI_TOOLING_VALUES=/some/other/path.json` if you need to.

Which keys you need is declared, without their values, in
[../security/required-values.json](../security/required-values.json). That file is what lets the
build validate placeholders on a machine — or a CI runner — that has no values file at all.

If a placeholder cannot be resolved, the installer refuses to write anything and lists the missing
keys. It never emits a half-rendered file.

The derived placeholders, which you never need to define, are `REPO_ROOT`, `USER_HOME` and
`CLAUDE_HOME`, each also available as `_SLASH` (forward slashes, keeps the drive letter), `_POSIX`
(`/c/...` form) and `_JSON` (backslashes doubled, for embedding in a JSON string).

## Claude Code

### Install

```bash
npm run claude:check     # dry run: prints exactly what would change
npm run claude:install   # do it
```

The installer does two different things, because hooks and content have different constraints.

**Hooks are referenced, not copied.** It merges entries into `~/.claude/settings.json` whose
`command` points at the script inside this checkout, for example:

```json
{
  "type": "command",
  "command": "node \"C:/src/ai-tooling/tools/claude/hooks/skill-audit.mjs\"",
  "timeout": 10
}
```

Editing a hook in this repo therefore takes effect on the next invocation. There is nothing to
reinstall and nothing to drift.

**Skills, commands and `CLAUDE.md` are copied**, because Claude finds them by scanning
`~/.claude/skills/`, `~/.claude/commands/` and `~/.claude/CLAUDE.md` and offers no way to redirect
those paths.

Which hooks get installed is controlled by the `enabled` flag in
[../tools/claude/settings/hooks.json](../tools/claude/settings/hooks.json). See
[claude/hooks-catalog.md](claude/hooks-catalog.md).

### What the installer will not do

It **merges** rather than overwrites. It only ever touches hook entries whose command references
`tools/claude/hooks/`; anything else in `settings.json` — your plugins, permissions, env, your own
hooks — is left exactly as it was. It writes a timestamped backup next to the file before changing
it, keeping the five most recent, and running it twice produces the same result as running it once.

It compares hooks structurally rather than textually, so a settings file that something else has
reordered is recognised as unchanged instead of being rewritten on every run.

It does **not** restore `tools/claude/settings/settings.json` over your live settings. That file is
a backup for rebuilding a machine, not an input to the installer. To use it, render the
placeholders and merge it by hand.

### Removing things you deleted from the repo

Deleting a skill here does not delete it from `~/.claude`. The installer reports files it finds on
the machine that this repo does not track, and removes them only when you ask:

```bash
npm run claude:install -- --prune
```

Without `--prune` it lists them and suggests `npm run claude:capture` if you meant to keep them.
Empty directories left behind are cleaned up.

### Making the scan run before every push

The private-value check only works where `~/.ai-tooling/values.json` exists, which is never true on
a CI runner. Install the git hook so the local build gates the push:

```bash
npm run install-git-hooks     # adds a pre-push hook running npm run build
npm run uninstall-git-hooks   # removes it
```

It refuses to overwrite a `pre-push` hook it did not write. Bypass a single push deliberately with
`git push --no-verify`. See [security.md](security.md).

### Uninstall

```bash
npm run claude:uninstall
```

Removes this repo's hook entries from `~/.claude/settings.json` and leaves everything else,
including the copied skills, commands and `CLAUDE.md`, in place. Delete those by hand if you want
them gone.

### Capturing changes made outside the repo

If you edit `~/.claude/CLAUDE.md` or add a skill directly on the machine, pull it back in:

```bash
npm run claude:capture:check   # what differs
npm run claude:capture         # copy machine to repo, re-inserting placeholders
```

Then review the diff and commit. Re-inserting placeholders is automatic but worth eyeballing: it is
a literal search-and-replace over your values, longest first, case-insensitively.

### Installing as a plugin instead

The repo also ships a plugin manifest, so the same hooks, skills and commands can be served live
from the checkout with no copying at all:

```
/plugin marketplace add C:\src\ai-tooling
/plugin install ai-tooling@ai-tooling
```

The tradeoff is namespacing: plugin-provided skills and commands are addressed as
`ai-tooling:<name>`, so `/wip` becomes `/ai-tooling:wip`. The script-based installer is the default
precisely because it preserves the names already in muscle memory. Details, caveats and the
`AI_TOOLING_SKILL_LOG` workaround for plugin-cache installs are in
[claude/plugins.md](claude/plugins.md).

Do not use both routes at once — the hooks would run twice per event.

**This route has not been exercised on this machine.** The manifests are written and validated by
the build, but installing the plugin would have disturbed a working setup, so it was left alone. Two
specifics to confirm the first time you try it: whether `/plugin marketplace add` accepts a Windows
absolute drive path, and whether the plugin is served live from the checkout or copied into
`~/.claude/plugins/cache`. If it is copied, the audit hook resolves its log path relative to the
copy, so set `AI_TOOLING_SKILL_LOG` to the checkout's `tmp/logs/skill-audit.jsonl`. Both points are
discussed in [claude/plugins.md](claude/plugins.md).

### Seeing and adopting hooks from other plugins

```bash
npm run claude:plugin-hooks
```

Lists every hook that installed plugins declare and will run whenever those plugins are enabled.
Adding `--as-catalog` emits entries you can adopt into this repo's catalog, which is how you run one
plugin's hook without enabling the whole plugin. See
[claude/hooks-catalog.md](claude/hooks-catalog.md).

## What is backed up but not installed

These files are captured for rebuilding a machine and are deliberately never written back
automatically.

**[settings.json](../tools/claude/settings/settings.json)** — a copy of the live settings with this
repo's own managed hooks stripped out, so it records the hand-maintained configuration (env,
permissions, enabled plugins, marketplaces, your own hooks) rather than anything the installer
generates. Restoring it means merging the parts you want by hand.

**[workspace-CLAUDE.md](../tools/claude/workspace-CLAUDE.md)** — the `CLAUDE.md` sitting in the
parent directory of this checkout, which applies to every repo beneath it. It is AI configuration
and worth backing up, but it lives outside `~/.claude`, so restoring it is a deliberate copy.
Override the location with `AI_TOOLING_WORKSPACE_CLAUDE_MD`.

**[mcp-servers.json](../tools/claude/settings/mcp-servers.json)** — the `mcpServers` block from
`~/.claude.json`. That file is large and stateful, holding session history and account state, so it
is never written to programmatically. Any server whose config carries an inline credential in `env`
is **omitted entirely** rather than redacted, so the backup can never become a place a secret hides.

## Setting up a new machine

1. Install Node 20+ and Git.
2. Clone the repo.
3. Create `~/.ai-tooling/values.json` with the private values (see above). Without it the installer
   tells you which keys are missing, with a description of each.
4. `npm run build` to confirm the repo is healthy.
5. `npm run claude:install`.
6. Restore plugins and marketplaces from
   [settings.json](../tools/claude/settings/settings.json). Do this through the CLI rather than by
   copying the file, because plugin installs are stateful:

   ```
   /plugin marketplace add anthropics/claude-plugins-official
   /plugin marketplace add <path to the internal marketplace>
   /plugin install <name>@<marketplace>
   ```

   The `enabledPlugins` and `extraKnownMarketplaces` keys in the backup list exactly what was
   installed and where each came from.
7. Restore MCP servers from
   [mcp-servers.json](../tools/claude/settings/mcp-servers.json) with `claude mcp add`, and supply
   any credentials from outside the repo.
8. Restart Claude Code so it re-reads `settings.json`.
9. `npm run skills:report` to confirm the audit log starts filling up.

## Verifying an install

```bash
npm run claude:check     # exits non-zero if the machine has drifted from the repo
npm run build            # validation, scan and tests
```

To confirm a hook is actually wired up, invoke any skill and check the log grows:

```bash
node scripts/analyze-skill-log.mjs
```

If it does not, see the debugging section in [claude/hooks.md](claude/hooks.md).
