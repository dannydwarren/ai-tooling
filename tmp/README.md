# tmp

Gitignored scratch space. Nothing here is committed except this file and `.gitkeep`.

- `tmp/logs/skill-audit.jsonl` — the skill audit log, written by the audit hooks.
  See [../docs/claude/skill-audit.md](../docs/claude/skill-audit.md).
- `tmp/<topic>/` — working files for a specific investigation.
- `tmp/scratch/` — one-off throwaways.

Credentials never go here. `tmp/` being gitignored is not sufficient protection for a secret; a
secret belongs outside the working tree entirely. See [../docs/security.md](../docs/security.md).
