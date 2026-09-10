# Claude Code

Everything this repo manages for Claude Code. Install instructions are in
[../../docs/install.md](../../docs/install.md).

| Path | What it is | How it reaches Claude |
|---|---|---|
| `CLAUDE.md` | Global instructions | Copied to `~/.claude/CLAUDE.md` |
| `skills/` | Personal skills | Copied to `~/.claude/skills/` |
| `commands/` | Personal slash commands | Copied to `~/.claude/commands/` |
| `hooks/` | Hook scripts | Referenced in place by absolute path |
| `hooks/hooks.json` | Plugin hook manifest | Only used on the plugin install route |
| `settings/hooks.json` | This repo's hook catalog | Read by the installer, not by Claude |
| `settings/settings.json` | Backup of live settings, managed hooks stripped | Not installed; for rebuilding a machine |
| `settings/mcp-servers.json` | Backup of the `mcpServers` block from `~/.claude.json` | Not installed; restore with `claude mcp add` |
| `.claude-plugin/plugin.json` | Plugin manifest | Only used on the plugin install route |

This directory doubles as a Claude plugin root, which is why the plugin manifest sits here. See
[../../docs/claude/plugins.md](../../docs/claude/plugins.md).

Files here contain `{{PLACEHOLDER}}` tokens. They are rendered on install and re-inserted on
capture. Do not replace one with a literal value — the scanner will fail the build if it is a
private value, and the file will stop being portable if it is a path. See
[../../docs/security.md](../../docs/security.md).
