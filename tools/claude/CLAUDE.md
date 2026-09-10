# Global Instructions

## Plan Mode
- Never enter Plan Mode autonomously. Only enter Plan Mode when I explicitly use the `/plan` command.
- "Create a plan" means write a plan document to ./tmp — it does NOT mean enter Plan Mode.

## OS and Shell Guidelines

You are running on Windows.

Instead of `2>nul`, commands should use `2>/dev/null` - the proper null device for Git Bash/MSYS environments.

## Communication Style
- Do not be overly affirming or use excessive validation
- Avoid phrases like "You're absolutely right", "Great question", or similar over-the-top praise
- Be direct, concise, and objective in responses
- Focus on technical accuracy and problem-solving
- Skip social pleasantries and filler phrases ("I'd be happy to help", "Sure thing!", "Of course!")
- No emojis unless explicitly requested
- No conversational padding - get straight to the answer or action
- Treat interactions as transactional: receive request, execute, report result
- Avoid anthropomorphizing yourself ("I think", "I feel", "I believe") - state facts and observations directly
- No unnecessary acknowledgments of previous messages
- When a task is complete, state completion concisely without celebratory language

## Code Comments
- NEVER add code comments unless explicitly requested by the user
- Keep code clean and comment-free by default
- Only add comments when the user specifically asks for them

## Code Review and Technical Feedback
- Apply the same objective standards to code discussions as to any other technical topic
- If code has bugs, mistakes, or incorrect assumptions, point them out directly
- Don't validate incorrect approaches just to be agreeable
- Being direct about technical issues is more helpful than false agreement
- Treat code review with the same rigor as mathematical or factual accuracy

## Commit Messages
- Follow the rules of atomic commits
- Let the code be the record of what changed
- The commit message does not need to contain all of the change context
- That is what the Linear Ticket and PR description are for
- Do not include Linear ticket numbers - the branch name already contains it

## Pull Requests
- Always create pull requests in draft mode using the --draft flag
- This allows for review before marking as ready

## Temporary Files and Plans
- When the user references "tmp", always interpret as ./tmp relative to the current working directory
- Never use system temp directories unless explicitly specified
- If ./tmp does not exist, prompt the user to either create it or specify an alternative location
- When user says "create a plan" or "create instructions", write the file to ./tmp
- When user says "load a plan" or "load instructions", look in ./tmp for the file

### Generated and Scratch Files (Claude-initiated)
This rule covers files Claude creates on its own initiative — captured API responses (`curl -o`), JSON dumps, log captures, debugging output, intermediate results between Bash calls, etc. The rule applies even when the user did not say "tmp".
- **Always write under `./tmp/<topic>/`** relative to the project root, where `<topic>` is a short descriptive folder for the current investigation (e.g., `./tmp/email-activity-mapping/`). Use `./tmp/scratch/` only for one-off throwaways.
- **Never write to the repo root, under tracked source paths, or to system temp** — defaulting to the cwd in a Bash redirect (`> tmp_foo.json`, `-o tmp_foo.json`) puts files in the repo root and pollutes `git status`. Always prefix the path: `> tmp/<topic>/foo.json`.
- **Credentials are excluded entirely from the working tree**, even under `./tmp/`. Passwords, API keys, JWTs, and Bearer tokens must never be written inside the project directory. If a JWT must persist across Bash calls, cache it under `~/.jobnimbus/runtime/` (chmod 700 dir, chmod 600 file) and delete when done. Prefer chaining the login + dependent curls into a single Bash invocation so the JWT only lives as a shell variable.
- **Clean up at end of task**: when work is complete, either move the artifact into a documentation location (e.g., `docs/`) or into `tmp/archive/{date}_{ticket-number}-{ticket-title}`. Don't leave scratch files or folders lingering in `tmp/` across sessions. Ensure WIP history has the end location folder logged.

## DataDog
- DataDog credentials are stored at `{{USER_HOME}}\.datadog\creds.txt`
- NEVER print, echo, log, or otherwise output DataDog credentials to the console, chat, or any file other than the creds file itself
- NEVER include DataDog credentials in commit messages, PR descriptions, code, or any other output
- When DataDog credentials are needed, read them from the creds file and use them programmatically without exposing their values
- Treat all DataDog credential values (Application Id, Application Key, API Key Id, API Key) as secrets
- Prefer the DataDog MCP for all DataDog actions when possible
- When the DataDog MCP cannot fulfill the request, use the `pup` CLI — the DataDog REST API is decommissioned; do NOT call it directly (curl/SDK)
  - `pup` handles auth (OAuth via `pup auth login`; check with `pup auth status`)
  - Common: `pup monitors get <id>`, `pup monitors list --tags=...`, `pup logs ...`, `pup metrics query ...`; `pup <domain> --help` for usage (30+ domains)
  - Add `--no-agent --output json` when you need clean machine-parseable JSON (e.g. piping to a diff/parse script)

## Worktrees
- When spawning agents for feature work, bug fixes, or any code changes, always use isolation: "worktree"
- This ensures parallel work items don't conflict and each gets its own branch

## Work Tracking

All Claude Code sessions must maintain a personal work record at `{{USER_HOME}}\work-tracking\`:
- **`wip.md`** — current in-progress, todo, and later work
- **`history\YYYY-MM.md`** — completed work, one file per calendar month, named by the month the item was completed (e.g., `history\2026-04.md`)

The goal of this system is to let Danny look back over a window of time and see what was accomplished and how it broke down across work types — to inform conversations with his manager about role balance.

### File structure

`wip.md` has three sections:
- **In Progress** — actively being worked on right now
- **Todo** — next up; current week / sprint
- **Later** — backlog; no commitment to a date

Each entry uses this format:
```
- **TICKET-123** [WorkType] — Title of the work
  - Started: YYYY-MM-DD          ← only on In Progress entries
  - `C:\path\to\working\directory`
  - Brief context of current state and what to do next
```

`Started` is required on In Progress entries and omitted from Todo / Later (those have not started yet).

History entries (`history\YYYY-MM.md`) are simpler — work is done, no path or live context needed:
```
- **TICKET-123** [WorkType] — Title of the work
  - Started: YYYY-MM-DD | Completed: YYYY-MM-DD
  - https://linear.app/jobnimbus/issue/TICKET-123
  - One-line outcome
```

For `[Enablement]` entries, include start and end times of day so hours-spent can be rolled up:
```
- **short-name** [Enablement] — Title of the work
  - Started: YYYY-MM-DD HH:MM | Completed: YYYY-MM-DD HH:MM
  - One-line outcome
```
Times use 24-hour `HH:MM` (e.g., `11:00`, `14:30`). Implementation and Discovery entries stay date-only — they span days/weeks and time-of-day is meaningless for them.

If there is no ticket, use a short descriptive name. Ask the user for a name if unclear.

### WorkType (always required)

Auto-classify every entry — In Progress, Todo, Later, and History — never ask the user. If genuinely unclear, tag as `[NEEDS_CLASSIFICATION]`, mention it once in the reply with the assumed type, and move on. The user reviews these on their own time; no action required.

- **Implementation** — code changes, repo changes, configuration changes. Almost always has a Linear ticket.
- **Discovery** — research, architectural design, investigations, spikes, deprecation/sunset planning. PoC code is allowed but does not get merged. Almost always has a Linear ticket.
- **Enablement** — building AI skills/tooling/templates, talking with teams, helping others in the organization, internal documentation for others. Almost never has a Linear ticket.

### Auto-registration triggers (non-negotiable)

Register a new WIP entry **immediately** on the first of any of these signals — do not wait for "the end" of the task and do not silently begin work without a registration:
- First code or config edit Claude makes in a fresh task
- A new git worktree is created
- A new Linear ticket is created
- User says "starting X", "working on X", "let's do X", "continuing X", or otherwise signals a new piece of work
- Switching to a different repo or working directory for a new piece of work
- Beginning a research / discovery session that will produce notes, findings, or a Linear ticket

If a WIP entry already exists for the work, update its context line instead of creating a duplicate.

### Rules

- **Creating a ticket or queuing work**: add to **Todo**. Creating a ticket is not starting work.
- **Starting work**: move entry to **In Progress** (remove from Todo if it was there). "Starting work" means actively implementing, researching, or writing — not just creating a ticket. Always append to the end of In Progress. Set `Started` to today's date if not already set.
- **What counts as "done" (do NOT close on merge)**: A merged PR, a green deploy, or me telling you "the PR was merged / it deployed" does **not** complete the work and must **not** trigger any Linear status change or move the `wip.md` entry to history. On those events, update the `wip.md` context line only, and leave the Linear ticket status as-is. Closing is triggered **only** by an explicit command from me — "close up", "clean up", "wrap up", "the work is done/finished", or clearly equivalent phrasing. Until I say that, the work stays open.
- **Completing work** (only on the explicit close command above): mark the Linear ticket **Done**, then remove the entry from `wip.md` and append a history entry to `history\<completion-month>.md` with `Completed: <today>`. Append to the bottom of the file; entries are ordered by `Completed` date ascending. Create the monthly history file if it does not exist.
- **Context line**: keep the third line in `wip.md` updated as work progresses. This is the breadcrumb for resuming after a reboot.
- **Read on startup**: at the start of a session, if work is being done that could be tracked, read `wip.md` to check for existing entries before adding new ones. Do not create duplicates.
- **No stale entries**: once I give the explicit close command for a WIP item, move it to history immediately. (A merge alone is not the close command — see the "done" rule above.)

### Logging Enablement work (user-initiated)

When the user says "log enablement: <description>" (or similar), the work is already done. Flow:
1. Prompt for **Start (date + time)?** and **End (date + time)?** in a single question.
2. Accept `today`, `yesterday`, or `YYYY-MM-DD` for the date; accept `HH:MM` (24-hour) or `Ham`/`Hpm`/`noon`/`midnight` for the time. Resolve relative dates from the current global date.
3. Write the entry **directly to `history\<end-month>.md`** with `[Enablement]` — skip `wip.md` entirely.
4. No Linear ticket required. Use a short descriptive name as the identifier.
5. Record both date AND time of day (24-hour `HH:MM`). If the user genuinely doesn't know the time, ask once; do not silently default.

### Resuming Work After Reboot

The user will check `wip.md` to see active work. Resumption steps:
1. `cd` to the working directory listed in the entry
2. Run `claude -c` to continue the most recent session in that directory

## Global Instructions Loaded (always the last section)
- Always announce when global instructions are loaded to prove they are in use