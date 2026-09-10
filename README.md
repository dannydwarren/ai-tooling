# ai-tooling

Danny's personal AI tooling: skills, hooks, configuration and the scripts that install them.

This is a personal repo. It is MIT licensed and public, but nothing here is designed to be generic
or reusable by anyone else — it encodes one person's workflow on one machine. Take ideas from it
freely; do not expect it to work unmodified.

It holds both personal and work-adjacent configuration. Because it is public, employer-internal
identifiers are kept out of the tree by a templating layer and enforced by a scanner that runs in
the build. See [docs/security.md](docs/security.md).

## Layout

| Path | What lives there |
|---|---|
| [tools/](tools/) | One directory per AI tool. [tools/claude/](tools/claude/) is the only one so far. |
| [scripts/](scripts/) | Install, capture, build, scan and reporting scripts. No dependencies beyond Node. |
| [security/](security/) | Detection [patterns](security/patterns.json) and the justified [allowlist](security/allowlist.json). |
| [docs/](docs/) | How things work, and the [decision records](docs/decisions/). |
| [plans/](plans/) | Plans, kept as written. |
| [tests/](tests/) | `node:test` suites covering the hooks, the installer and the scanner. |
| `tmp/` | Gitignored scratch and logs, including the skill-audit log. |

## Quick start

```bash
npm run build            # json + asset validation, secret/PII scan, tests
npm run claude:check     # what would change in ~/.claude, without writing
npm run claude:install   # install hooks and copy skills/commands into ~/.claude
npm run skills:report    # which skills you actually use
npm run skills:inventory     # what every session is paying for in context
npm run claude:plugin-hooks  # what hooks your installed plugins run silently
```

There are no runtime dependencies and no install step — everything runs on the Node already on the
machine. Full instructions, including setting up a new machine, are in
[docs/install.md](docs/install.md).

## What it does today

**Backs up the Claude configuration.** `~/.claude/CLAUDE.md`, the global skills and commands, and
`settings.json` are mirrored under [tools/claude/](tools/claude/). `npm run claude:capture` pulls
changes from the machine into the repo; `npm run claude:install` pushes them back. Both take
`--check` to report drift without writing.

**Authors hooks in this repo and runs them from here.** The installer writes hook entries into
`~/.claude/settings.json` whose `command` points at the script inside this checkout, so editing a
hook takes effect immediately with no reinstall. The catalog is
[tools/claude/settings/hooks.json](tools/claude/settings/hooks.json); what each hook does is in
[docs/claude/hooks-catalog.md](docs/claude/hooks-catalog.md). The repo also ships a plugin manifest
so the same assets can be installed the plugin way instead — see
[docs/claude/plugins.md](docs/claude/plugins.md).

**Audits skill usage.** Two hooks record every skill invocation to `tmp/logs/skill-audit.jsonl`,
distinguishing the ones you type from the ones the model chooses. `npm run skills:report` turns that
into a usage table; `npm run skills:inventory` shows what each installed plugin costs you in context
whether you use it or not. Together they answer which plugins are bloat. See
[docs/claude/skill-audit.md](docs/claude/skill-audit.md).

**Keeps secrets and PII out.** `npm run build` runs a static scanner over every tracked and
untracked-but-not-ignored file. Secrets fail the build; PII is reported. There is no AI in the
build — only the scripts in this repo. See [docs/security.md](docs/security.md).

## Documentation

- [docs/install.md](docs/install.md) — installing to a tool, and setting up a new machine
- [docs/security.md](docs/security.md) — the secret/PII policy, the scanner, the allowlist
- [docs/claude/hooks.md](docs/claude/hooks.md) — how Claude Code hooks work and what is possible
- [docs/claude/hooks-catalog.md](docs/claude/hooks-catalog.md) — the hooks this repo ships
- [docs/claude/plugins.md](docs/claude/plugins.md) — plugins, marketplaces, installing hooks from plugins
- [docs/claude/skill-audit.md](docs/claude/skill-audit.md) — the skill audit and how to read it
- [docs/decisions/](docs/decisions/) — why things are the way they are

## License

MIT. See [LICENSE](LICENSE).
