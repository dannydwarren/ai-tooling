# Claude Code Plugins and Marketplaces

What a plugin is, how it carries hooks, how a marketplace distributes it, and — the question this repo exists to answer — whether you can take just the hooks out of somebody else's plugin.

Companion documents: [hooks.md](./hooks.md) (the hook mechanism itself), [hooks-catalog.md](./hooks-catalog.md) (the hooks this repo ships), [../install.md](../install.md) (installing this repo into `~/.claude`).

Primary sources, all verified while writing this: <https://code.claude.com/docs/en/plugins.md>, <https://code.claude.com/docs/en/plugin-marketplaces.md>, <https://code.claude.com/docs/en/hooks.md>, <https://code.claude.com/docs/en/settings-reference.md>.

---

## 1. What a plugin is

A plugin is a directory containing skills, agents, hooks, MCP servers, LSP servers, and monitors, optionally alongside a `.claude-plugin/plugin.json` manifest. It is the **unit of distribution** — you install, enable, disable, and version a plugin as a whole.

Claude Code supports two ways to add custom skills, agents, and hooks, and the docs frame the choice this way:

| Approach | Skill / command names | Best for |
| :--- | :--- | :--- |
| **Standalone** (`.claude/` directory) | `/hello` | Personal workflows, project customizations, quick experiments |
| **Plugin** (self-contained directory) | `/plugin-name:hello` | Sharing, distributing, versioned releases, reuse across projects |

The namespacing difference is not cosmetic and it is not optional. **Plugin skills are always namespaced** to prevent collisions; the prefix is the `name` field in `plugin.json`. This is the central tradeoff in [§6](#6-how-this-repo-uses-both-mechanisms).

### 1.1 Directory anatomy

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # manifest — ONLY this file goes in .claude-plugin/
├── skills/
│   └── code-review/
│       └── SKILL.md         # → /my-plugin:code-review
├── commands/                # flat .md skill files (legacy shape; prefer skills/)
├── agents/                  # subagent definitions
├── hooks/
│   └── hooks.json           # event handlers
├── .mcp.json                # MCP server configs
├── .lsp.json                # LSP server configs
├── monitors/monitors.json   # background monitors
├── bin/                     # executables added to the Bash tool's PATH while enabled
└── settings.json            # default settings applied when enabled (only `agent` and
                             #   `subagentStatusLine` keys are supported)
```

All of those directories are **auto-discovered** at the plugin root. There is no manifest key you must add to register them.

The single most common structural mistake, called out as a warning in the docs: **do not put `commands/`, `agents/`, `skills/`, or `hooks/` inside `.claude-plugin/`.** Only `plugin.json` goes there. And the plugin root is the individual plugin's own directory — never `~/.claude/`.

A plugin shipping exactly one skill may place `SKILL.md` at the plugin root instead of creating `skills/`.

### 1.2 The manifest

```json
{
  "name": "my-plugin",
  "description": "What it does",
  "version": "1.0.0",
  "author": { "name": "Your Name" }
}
```

| Field | Purpose |
| :--- | :--- |
| `name` | Unique identifier **and skill namespace**. Skills become `/my-plugin:hello` |
| `description` | Shown in the plugin manager |
| `version` | Optional. **If set, users only receive updates when you bump it.** If omitted, the version falls through to the next source in the docs' version-management chain |
| `author`, `homepage`, `repository`, `license`, `keywords` | Optional metadata |

`.claude-plugin/plugin.json` is itself optional if the components use default locations — but you want it, because `name` is what namespaces everything.

---

## 2. How a plugin declares hooks

`hooks/hooks.json` at the plugin root, with an optional top-level `description`. The `hooks` object is **the same shape as the `hooks` key in `settings.json`** — that is what makes copying between them viable ([§5](#5-can-you-install-just-the-hooks-from-someone-elses-plugin)).

```json
{
  "description": "Automatic code formatting",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
            "args": [],
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

When the plugin is enabled, these hooks **merge** with your user and project hooks. They do not override and are not overridden — see [hooks.md §6.2](./hooks.md#62-they-merge--they-do-not-override).

### 2.1 `${CLAUDE_PLUGIN_ROOT}`

A plugin's scripts cannot use absolute paths, because the plugin lands wherever Claude Code caches it. `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's **installation directory**, and it **changes on every plugin update**.

Three related placeholders, all substituted into `command` and into each `args` element, and all also exported as environment variables on the spawned process:

| Placeholder | Resolves to |
| :--- | :--- |
| `${CLAUDE_PROJECT_DIR}` | The project root where the session started |
| `${CLAUDE_PLUGIN_ROOT}` | The plugin's install directory. Changes on update |
| `${CLAUDE_PLUGIN_DATA}` | The plugin's persistent data directory — for dependencies and state that must survive updates |

Two rules from the docs worth following:

- **Prefer exec form** (`args` present) for any hook referencing a placeholder. Each `args` element is passed as one argument, with no shell and no quoting.
- **In shell form, wrap each placeholder in double quotes** — `node "${CLAUDE_PLUGIN_ROOT}"/scripts/format.js`.

Plugin hooks additionally substitute `${user_config.*}` values, **exec form only**. A shell-form plugin hook whose `command` references `${user_config.*}` fails with an error instead of running; read `$CLAUDE_PLUGIN_OPTION_<KEY>` instead, or set `args` to switch to exec form.

Caveat for plugins that write into the repo they came from: because installation copies the plugin into `~/.claude/plugins/cache`, a script that walks upward from its own location to find "the repo root" will resolve to a path inside the cache, not to your checkout. If a plugin hook needs the checkout, it must read `cwd` from the stdin payload or an environment variable — not derive it from `import.meta.url`.

---

## 3. Marketplaces

A marketplace is a **catalog**: a `.claude-plugin/marketplace.json` at a repository root listing plugins and where to fetch each one.

```json
{
  "name": "company-tools",
  "owner": { "name": "DevTools Team", "email": "devtools@example.com" },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "Automatic code formatting on save",
      "version": "2.1.0"
    },
    {
      "name": "deployment-tools",
      "source": { "source": "github", "repo": "company/deploy-plugin" },
      "description": "Deployment automation tools"
    }
  ]
}
```

### 3.1 Schema

Required at the top level: `name` (kebab-case, public-facing — users type `plugin@marketplace`), `owner` (object with required `name`, optional `email` and `url`), `plugins` (array).

Optional: `$schema`, `description`, `version`, `metadata.pluginRoot`, `allowCrossMarketplaceDependenciesOn`, `renames`.

Each entry in `plugins` requires `name` and `source`. Entries may also carry any field from the plugin manifest schema plus the marketplace-specific `category`, `tags`, `strict`, `relevance`, `headers`, `headersHelper`, `defaultEnabled`, and the component-path fields `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`.

Each user can register **only one marketplace per name** — adding a second with the same name replaces the first. Several names are reserved for Anthropic (`claude-plugins-official`, `claude-community`, `anthropic-marketplace`, and others), plus names that impersonate them.

### 3.2 Plugin source kinds

`source` is either a string (relative path) or an object with a `source` discriminator.

| Source | Type | Fields | Notes |
| :--- | :--- | :--- | :--- |
| Relative path | string, e.g. `"./my-plugin"` | — | Local directory inside the marketplace repo. **Must start with `./`**, unless it is a bare name under `metadata.pluginRoot` |
| `github` | object | `repo`, `ref?`, `sha?` | |
| `url` | object | `url`, `ref?`, `sha?` | Any git URL |
| `git-subdir` | object | `url`, `path`, `ref?`, `sha?` | Sparse clone of a monorepo subdirectory |
| `npm` | object | `package`, `version?`, `registry?` | Installed via `npm install` |
| `archive` | object | `url`, `sha256?` | Zip over HTTPS; needs no git or npm. v2.1.224+ |
| `command` | object | `command`, `timeout?`, `mode?` | Plugin directory produced by a local command, re-run once per session. v2.1.229+ |

Relative paths resolve against the **marketplace root** — the directory containing `.claude-plugin/` — not against `.claude-plugin/` itself. `./plugins/my-plugin` means `<repo>/plugins/my-plugin`. `../` outside the marketplace root is not allowed.

Where both `ref` and `sha` are set on a git-based source, the `sha` is the effective pin.

**Marketplace source ≠ plugin source.** The marketplace source is where the `marketplace.json` catalog itself comes from (set when you run `/plugin marketplace add`, or via `extraKnownMarketplaces`); git-based marketplace sources support `ref` but not `sha`. The plugin source is where each individual plugin comes from, inside the catalog; those support both.

One trap: if users add your marketplace via a **direct URL to the `marketplace.json` file**, relative paths will not resolve, because only that one file is downloaded. Relative paths work only when Claude Code has a local copy of the marketplace — i.e. a git source or a local directory.

### 3.3 Installation copies

When a plugin is installed, Claude Code **copies the plugin directory into `~/.claude/plugins/cache`** (the `command` source in link mode is the one exception, and is used in place). Consequences:

- A copied plugin cannot reference files outside its own directory (`../shared-utils` will not be there). Use symlinks if you must share.
- Editing your checkout does not change an installed copy until the marketplace and plugin update.

The exception that makes local development pleasant is `--plugin-dir`, which loads a plugin directly from disk with no install step ([§4.3](#43-development-loop)).

---

## 4. Installing from a local directory

### 4.1 The flow

From a session, using the slash commands:

```text
/plugin marketplace add ./my-marketplace
/plugin install quality-review-plugin@my-plugins
```

`add` takes a GitHub `owner/repo` shorthand, a git URL, a remote URL to a `marketplace.json`, or a **local directory path**. `install` takes `<plugin-name>@<marketplace-name>`, where the marketplace name is the `name` field from `marketplace.json` — not the path you passed to `add`.

The install opens a details view where you select an installation scope. **Check the install summary: if it reports `Run /reload-plugins to activate.`, run that command.**

The same commands exist on the CLI:

```bash
claude plugin marketplace add ./my-marketplace [--scope user|project|local] [--sparse <paths...>]
claude plugin marketplace list [--json]
claude plugin marketplace update [name]
claude plugin marketplace remove <name> [--scope ...]
```

`--scope` defaults to `user`. Removing a marketplace from its **last** remaining scope also uninstalls the plugins you installed from it; use `update` to refresh without losing installs.

*Unverified:* the docs show local paths as `./my-marketplace` and describe the argument as "local directory path". They do **not** show a Windows absolute drive path such as `C:\src\ai-tooling`. Note also that as of v2.1.196 a host typed without a scheme is rejected as an invalid `owner/repo` shorthand, which suggests the argument is parsed before it is stat'ed. If a backslash path is rejected, try forward slashes (`C:/src/ai-tooling`) or run the command from the parent directory with `./ai-tooling`.

### 4.2 What persists it in settings.json

Two keys, both writable at any scope. Claude Code writes them for you when you use `/plugin` or `claude plugin enable`, but you can also commit them.

**`extraKnownMarketplaces`** — registers a marketplace by name so anyone opening the repo gets it without adding it themselves. Type: object mapping a marketplace name to an object with a `source` object and an optional `autoUpdate` boolean.

```json
{
  "extraKnownMarketplaces": {
    "ai-tooling": {
      "source": { "source": "directory", "path": "C:\\src\\ai-tooling" }
    }
  }
}
```

The `source` object takes one of six forms:

| `source` | Fields | Notes |
| :--- | :--- | :--- |
| `github` | `repo` | |
| `git` | `url` | Any git host, incl. self-hosted GitLab / Bitbucket. Uses the machine's normal git credentials |
| `url` | `url`, optional `headers`, `headersHelper` | Direct URL to a `marketplace.json` |
| `file` | `path` | Local path to a `marketplace.json` file |
| `directory` | `path` | Local filesystem path. **"for development only"** per the docs |
| `settings` | `name`, `plugins` | An inline marketplace declared in the settings file itself. Its plugins must reference external sources |

Two gates: entries in a repository's `.claude/settings.json` or `.claude/settings.local.json` are honored **only after you accept the workspace trust dialog** for that folder — in an untrusted folder they are ignored with no message. And when more than one settings file defines the same marketplace name, the highest-precedence file's entry is used **whole**; it inherits no fields from the lower one.

`autoUpdate` defaults to `true` for official Anthropic marketplaces and `false` for third-party ones.

**`enabledPlugins`** — turns individual plugins on or off, keyed by `plugin-name@marketplace-name`, valued boolean.

```json
{
  "enabledPlugins": {
    "ai-tooling@ai-tooling": true,
    "superpowers@claude-plugins-official": true,
    "experimental-features@personal": false
  }
}
```

A plugin with no entry at any scope falls back to its `defaultEnabled` value (default `true`; a marketplace entry can set it `false` to install disabled).

Precedence note that catches people out: **project settings take precedence over user settings**, so setting a plugin `false` in `~/.claude/settings.json` does *not* disable a plugin the project's `.claude/settings.json` enables. To opt out on your machine, set it `false` in `.claude/settings.local.json`.

And: enabling an externally-sourced plugin in a project's `.claude/settings.json` does **not** install it for other people. Claude Code reports it as not installed until each user installs it.

### 4.3 Development loop

```bash
claude --plugin-dir ./my-plugin              # load a plugin directly, no install
claude --plugin-dir ./my-plugin.zip          # a zip works too
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
claude --plugin-dir ./plugins                # a folder of plugins (v2.1.265+)
claude --plugin-url https://example.com/p.zip
```

When a `--plugin-dir` plugin shares a name with an installed marketplace plugin, the **local copy wins for that session** — so you can test changes to something you already have installed without uninstalling it. Managed force-enabled/force-disabled plugins are the exception; `--plugin-dir` cannot override those.

`/reload-plugins` picks up changes mid-session — plugins, skills, agents, hooks, plugin MCP servers, and plugin LSP servers.

Validate before publishing: `claude plugin validate ./your-plugin` (add `--strict` to treat warnings as errors). `claude plugin init <name>` scaffolds a plugin under `~/.claude/skills/` that auto-loads as `<name>@skills-dir` with no marketplace step at all.

---

## 5. Can you install just the hooks from someone else's plugin?

**Short answer: not as a supported per-component toggle. The plugin is the unit of distribution, and its hooks activate as a set the moment the plugin is enabled.**

The evidence: `enabledPlugins` is documented as an object mapping `plugin-name@marketplace-name` to a boolean — a whole-plugin switch. The hooks reference describes plugin hooks activating "when plugin is enabled", full stop. `disableAllHooks` is all-or-nothing and the docs state outright that "there is no way to disable an individual hook while keeping it in the configuration." Nothing in the plugin, marketplace, or settings references exposes a "components: hooks only" flag on the consuming side.

*Unverified:* this is a conclusion from the absence of any such mechanism across the plugin, marketplace, hooks, and settings-reference pages — the docs never state "you cannot install a subset of a plugin's components" in those words.

There are three practical workarounds, in increasing order of how much you own afterwards.

### 5.1 Copy the hook entries into your own settings.json

The plugin's `hooks/hooks.json` and the `hooks` key in `settings.json` are **the same schema**. The docs make this explicit in the reverse direction, when migrating standalone config into a plugin: "Copy the `hooks` object from your `.claude/settings.json` or `settings.local.json`, since the format is the same."

So: read their `hooks/hooks.json`, lift the `hooks` object into your `~/.claude/settings.json`, and **rewrite `${CLAUDE_PLUGIN_ROOT}` to a real path** — because you are no longer a plugin and that placeholder will not resolve for you.

Their plugin:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit",
        "hooks": [{ "type": "command",
                    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh" }] }
    ]
  }
}
```

Your `~/.claude/settings.json`, after vendoring their `scripts/` directory somewhere you control:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit",
        "hooks": [{ "type": "command",
                    "command": "node \"C:/src/ai-tooling/vendor/their-plugin/scripts/format.mjs\"" }] }
    ]
  }
}
```

What you gain: only the hooks, no skills or commands, no namespace pollution, and full control over the command string. What you lose: updates. Nothing tells you when upstream changes the script, and you own the copy forever. Also verify the script's own assumptions — a script written for `${CLAUDE_PLUGIN_ROOT}` may read `process.env.CLAUDE_PLUGIN_ROOT` or `${CLAUDE_PLUGIN_DATA}` internally, and neither is set when the hook runs from settings.

### 5.2 Re-publish their plugin through your own marketplace with `strict: false`

This is the documented mechanism closest to "curate someone else's components", and it is worth knowing about.

A marketplace entry's `strict` field controls whether `plugin.json` is the authority for component definitions:

| `strict` | Behavior |
| :--- | :--- |
| `true` (default) | `plugin.json` is the authority. The marketplace entry can **supplement** it; both are merged |
| `false` | **The marketplace entry is the entire definition.** If the plugin also has a `plugin.json` that declares components, that is a conflict and the plugin fails to load |

The docs describe `strict: false` as being for exactly this: "the marketplace operator wants full control. The plugin repo provides raw files, and the marketplace entry defines which of those files are exposed as skills, agents, hooks, etc. Useful when the marketplace restructures or curates a plugin's components differently than the plugin author intended."

So in your own `marketplace.json` you can point at their repository as a `github` source and define only `hooks`:

```json
{
  "name": "their-plugin-hooks-only",
  "source": { "source": "github", "repo": "them/their-plugin", "sha": "abc123..." },
  "strict": false,
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit",
        "hooks": [{ "type": "command",
                    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh" }] }
    ]
  }
}
```

Advantages over §5.1: `${CLAUDE_PLUGIN_ROOT}` still works, because it is still a plugin; you can pin a `sha`; and no files are copied by hand.

Caveats, both from the docs: this fails to load if their `plugin.json` declares components of its own, and component paths must stay inside the plugin directory (`./../shared.md` is rejected with a `path escapes plugin directory` error, and the plugin loads without that component).

*Unverified:* the docs describe `strict: false` from the perspective of a marketplace operator curating plugins, not specifically as a way to consume a third party's plugin partially. Whether a `github` source you do not control behaves identically here is not spelled out; test before relying on it.

### 5.3 Fork or vendor the plugin

Clone it, delete the components you do not want, keep `hooks/`, and serve it from your own marketplace as a relative-path source. Most work, most control, and updates become a merge you perform deliberately.

### 5.4 The blunt instrument

If a plugin's hooks are actively harmful and you want its skills anyway, `"disableAllHooks": true` is available — but it disables **every** hook from every source, including your own, so it is a debugging tool rather than a configuration strategy. It respects the managed hierarchy: set outside managed settings it cannot disable managed hooks, or hooks from plugins force-enabled in managed `enabledPlugins`.

### 5.5 Before you enable anyone's plugin

Read `hooks/hooks.json` first. Enabling a plugin registers arbitrary shell commands that run automatically at lifecycle points, with your credentials, in every session. `/hooks` shows the merged result afterwards, labelled `Plugin Hooks`, which is a good post-install audit — but it is an audit after the fact.

---

## 6. How this repo uses both mechanisms

This repo is simultaneously a **plugin** and an **installer**. Both routes serve the same content from the same files; they differ in how it reaches `~/.claude` and what the resulting names are.

### 6.1 The layout that exists

```text
C:\src\ai-tooling\
├── .claude-plugin\marketplace.json          # marketplace catalog, name: "ai-tooling"
├── tools\claude\
│   ├── .claude-plugin\plugin.json           # plugin manifest, name: "ai-tooling"
│   ├── CLAUDE.md
│   ├── skills\                              # checking-kafka-offset-lag, pr-review-cycle
│   ├── commands\                            # wip.md
│   ├── hooks\
│   │   ├── hooks.json                       # PLUGIN hook config (Claude Code schema)
│   │   ├── lib\hook-io.mjs
│   │   ├── skill-audit.mjs
│   │   └── no-comments.mjs
│   └── settings\
│       ├── hooks.json                       # NOT a Claude file — this repo's own catalog
│       └── settings.json                    # settings template with {{PLACEHOLDER}}s
└── scripts\claude-install.mjs               # the default installer
```

The marketplace points at the plugin with a relative path:

```json
{
  "name": "ai-tooling",
  "owner": { "name": "Danny Warren" },
  "plugins": [
    { "name": "ai-tooling", "source": "./tools/claude",
      "description": "Personal Claude Code hooks, skills and commands served live from the ai-tooling checkout." }
  ]
}
```

Both the marketplace and the plugin are named `ai-tooling`, so the install ID is `ai-tooling@ai-tooling`.

### 6.2 Two hook files that look alike and are not

This is the part to internalize before editing anything.

| File | Schema | Consumed by |
| :--- | :--- | :--- |
| `tools/claude/hooks/hooks.json` | **Claude Code's plugin hook schema** — a `hooks` object keyed by event | Claude Code, when the plugin is enabled |
| `tools/claude/settings/hooks.json` | **This repo's own catalog format** — a flat `hooks` **array** of catalog entries | `scripts/claude-install.mjs`, which renders it into `~/.claude/settings.json` |

The plugin file is Claude's:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Skill",
        "hooks": [{ "type": "command",
                    "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/skill-audit.mjs\"",
                    "timeout": 10,
                    "statusMessage": "Recording skill usage" }] }
    ]
  }
}
```

The catalog file is not — it is an array of records with `id`, `enabled`, `event`, `matcher`, `description`, and a nested `hook` object that *is* a Claude handler, using this repo's `{{REPO_ROOT_SLASH}}` placeholder instead of `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "managedBy": "ai-tooling",
  "hooks": [
    {
      "id": "skill-audit",
      "enabled": true,
      "event": "PreToolUse",
      "matcher": "Skill",
      "description": "Append one JSONL record per Skill invocation ... Passive: never blocks, always exits 0.",
      "hook": {
        "type": "command",
        "command": "node \"{{REPO_ROOT_SLASH}}/tools/claude/hooks/skill-audit.mjs\"",
        "timeout": 10,
        "statusMessage": "Recording skill usage"
      }
    }
  ]
}
```

The catalog format buys three things the Claude schema has no room for: a stable `id`, an `enabled` flag that lets a hook ship disabled (`no-comments` and `skill-audit-post` are both `false` today), and a `description` that survives into documentation. It is the source of truth for the installer route; see [hooks-catalog.md](./hooks-catalog.md) for the entries themselves.

`{{REPO_ROOT_SLASH}}` is the repo root with backslashes converted to forward slashes — `C:/src/ai-tooling`. That is the [safe shell-form spelling for Windows](./hooks.md#82-why-node-cpathtohookmjs-is-the-safe-shell-form-spelling): a real `node.exe`, an absolute path with a drive letter, forward slashes, double-quoted. Sibling placeholders exist for the other shapes (`_JSON` for backslash-escaped JSON, `_POSIX` for `/c/...` Git Bash style).

### 6.3 Route (a) — the installer. This is the default

```bash
node scripts/claude-install.mjs            # install
node scripts/claude-install.mjs --check    # dry run; exits 1 if changes are pending
node scripts/claude-install.mjs --uninstall
```

What it does:

1. Loads placeholder values — derived (`REPO_ROOT*`, `USER_HOME*`, `CLAUDE_HOME*`) plus private ones from `~/.ai-tooling/values.json`.
2. Renders and copies `tools/claude/CLAUDE.md`, `skills/`, and `commands/` into `~/.claude/`.
3. Reads the catalog at `tools/claude/settings/hooks.json`, drops every entry with `enabled: false`, renders the placeholders, and **merges the resulting handlers into `~/.claude/settings.json`** under the right event and matcher group.
4. Before writing, strips out any handler whose `command` contains `tools/claude/hooks/` — the ownership marker — so an install is idempotent and an uninstall is clean. Hooks you wrote by hand are untouched.
5. Backs up the previous `settings.json`.

Result: hooks run as `node "C:/src/ai-tooling/tools/claude/hooks/skill-audit.mjs"` — an absolute path straight into the working checkout, so **hook code is live** — while skills and commands are **copied** into `~/.claude/skills/` and `~/.claude/commands/`.

The names stay un-namespaced. `/wip` is `/wip`.

Tradeoffs:

- **+** Names you already type keep working. `/wip` does not become `/ai-tooling:wip`.
- **+** Hook scripts are live from the checkout — edit and the next event picks it up.
- **+** The `enabled` flag lets a hook ship in the repo but stay off in `~/.claude`.
- **−** Skills and commands are **copies**. Editing the repo does nothing until you re-run the installer.
- **−** It mutates `~/.claude/settings.json`, which is why it takes a backup.

### 6.4 Route (b) — the plugin. Documented alternative

```text
/plugin marketplace add C:\src\ai-tooling
/plugin install ai-tooling@ai-tooling
```

(If the absolute path is rejected, see the note in [§4.1](#41-the-flow).)

To persist it in settings rather than doing it interactively:

```json
{
  "extraKnownMarketplaces": {
    "ai-tooling": {
      "source": { "source": "directory", "path": "C:\\src\\ai-tooling" }
    }
  },
  "enabledPlugins": { "ai-tooling@ai-tooling": true }
}
```

Result: hooks, skills, **and** commands all come from the plugin at once, with **zero copying into `~/.claude`** — one enable/disable switch for everything.

Tradeoffs:

- **+** One switch. Enable or disable hooks, skills, and commands together.
- **+** No installer, no `settings.json` mutation, no backup file.
- **+** `/plugin` and `/hooks` show it as a first-class plugin, labelled `Plugin Hooks`.
- **−** **Everything is namespaced.** `/wip` becomes `/ai-tooling:wip`, and skills become `ai-tooling:checking-kafka-offset-lag` and `ai-tooling:pr-review-cycle`. That is not configurable per component — the prefix is the `name` in `plugin.json`.
- **−** All-or-nothing. The catalog's `enabled: false` flag has no equivalent; the plugin's `hooks/hooks.json` contains only what you want always on.
- **−** Installed plugins are **copied into `~/.claude/plugins/cache`**, so "live from the checkout" holds only under `--plugin-dir` or a `directory` marketplace source that Claude Code re-reads. A `github`-sourced install would be a cached snapshot.

That last point deserves a specific warning for this repo: `tools/claude/hooks/lib/hook-io.mjs` derives the repo root by walking four levels up from its own file location, and `skill-audit.mjs` uses that to decide where to write `tmp/logs/skill-audit.jsonl`. Under the installer route that resolves to `C:\src\ai-tooling`. Under a **copied** plugin install it resolves to a path inside the plugin cache, and the audit log lands there instead. Set `AI_TOOLING_SKILL_LOG` explicitly if you take the plugin route.

### 6.5 Which to use

**Route (a) is the default and what [../install.md](../install.md) documents.** The deciding factor is the namespace: `/wip` is muscle memory, and route (b) renames it.

Route (b) is documented here as the alternative, and it is genuinely better in two situations: trying the whole bundle on a machine you do not want to write into, and handing the repo to somebody else, since `/plugin marketplace add` plus one install is the entire setup.

Do not run both at once. You would get the hooks twice — plugin hooks and settings hooks **merge** rather than override ([hooks.md §6.2](./hooks.md#62-they-merge--they-do-not-override)), so `skill-audit` would fire twice per skill call and write two log lines. Skills would appear under both names.

---

## 7. Things this document could not verify

- **Whether `/plugin marketplace add` accepts a Windows absolute path** such as `C:\src\ai-tooling`. The docs show `./my-marketplace` and describe the argument as "GitHub `owner/repo` shorthand, git URL, remote URL to a `marketplace.json` file, or local directory path", with no Windows example. A scheme-less host string is explicitly rejected as of v2.1.196, which suggests the argument is pattern-matched before being stat'ed.
- **Whether a `directory`-sourced marketplace serves plugin content live from the checkout or copies it into the cache.** The docs say installation copies the plugin into `~/.claude/plugins/cache` except for a `command` source in link mode, and separately label `directory` as "for development only" — but never state whether `directory` skips the copy. The `--plugin-dir` flag is the only unambiguously no-copy path.
- **That there is no supported way to install a subset of a plugin's components.** This is inferred from the absence of any such control in the plugin, marketplace, hooks, and settings-reference pages; the docs never say it in those words. See [§5](#5-can-you-install-just-the-hooks-from-someone-elses-plugin).
- **Whether `strict: false` behaves identically for a `github` source pointing at a repository you do not control.** The docs frame it as a marketplace-operator curation feature and do not discuss third-party consumption.
