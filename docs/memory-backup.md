# Backing up Claude auto-memory

Claude writes auto-memory to `~/.claude/projects/<project>/memory/` — short notes recording your
corrections, preferences and project context. The docs are explicit that it is
**machine-local**: *"Files are not shared across machines or cloud environments."* A wipe loses all
of it.

At the time of writing that is **107 files across 14 projects, ~419KB** of accumulated corrections.
Restoring them is the difference between a new machine being useful on day one and on month three.

## Why it is not simply committed

Every file was read and classified. The result:

| Classification | Count | Meaning |
|---|---:|---|
| SAFE | 25 | Generic engineering practice or personal preference |
| ORG-INTERNAL | 79 | Names employer services, repos, queues, topology, tickets, processes |
| THIRD-PARTY-PII | 3 | Information about identifiable people other than you |
| SECRET | 0 | No credential values found |

**Roughly three quarters is not publishable.** The ORG-INTERNAL files are not borderline: they name
internal event topics and queues, describe service-to-service auth and data-flow topology, record
cloud account numbers and IAM role names, map on-call and alert routing, quote production latency
and request volumes, and document unfixed defects.

Two reviewers additionally flagged that the *directory names* encode repository names and would be
visible in a public tree regardless of file contents. **That specific risk has been considered and
dismissed** — repository and directory names are not treated as sensitive in this repo. The
classification above stands on file contents alone.

Even so, a 25/107 publishable subset does not meet the goal, which is to restore *all* memory. Two
mechanisms — plaintext for the safe quarter, encrypted for the rest — would mean maintaining a
per-file manifest and a guard to enforce it, for the marginal benefit of making a quarter of the
notes greppable. Sealing everything is simpler and complete.

## How it works

```bash
npm run claude:memory:backup   # capture ~/.claude/projects/*/memory and encrypt it -> tools/claude/memory.sealed.json (committed)
npm run claude:memory:restore  # decrypt and restore onto a machine

npm run claude:memory:capture  # capture only, to tools/claude/memory/ (gitignored), if you want to read it first
```

`tools/claude/memory/` is gitignored. The only thing that ever enters git is
`memory.sealed.json`: AES-256-GCM, key derived with scrypt (N=2^15, r=8), random salt and IV per
seal, authentication tag verified on open so tampering fails loudly rather than silently.

A build check refuses to let plaintext memory become tracked, whatever `.gitignore` says, because a
`git add -f` or a future edit to the ignore rules should not be enough to publish it.

## The passphrase is the whole backup

The bundle is worthless without it. It lives at `~/.ai-tooling/memory-key`, outside the working
tree, alongside `values.json` — or set `AI_TOOLING_MEMORY_PASSPHRASE`.

**Put it in your password manager now.** If the machine dies with the key on it and nowhere else,
the encrypted backup is unrecoverable — you will have a perfect copy of your memory and no way to
read it. That failure mode is the entire risk of this design, and it is silent until the day you
need it.

## Restoring on a new machine

1. Install Node and Claude Code, clone this repo.
2. Put the passphrase at `~/.ai-tooling/memory-key`.
3. `npm run claude:memory:restore`

Memory lands at `~/.claude/projects/<project>/memory/`. The project directory name is derived from
the repository path, so restoring under the same paths (`C:\src\...`) puts each memory back with
its project. Check first with `npm run claude:memory:restore:check`.

`restore` will not overwrite a file that differs on the machine — Claude may have learned something
since the bundle was sealed. It lists the conflicts and exits non-zero; `--force` overrides.

## Things the review turned up that are not about backup

Three findings worth acting on regardless of what you decide here.

**One memory file documents a credential file's layout and records that a past leak of two keys was
accepted rather than rotated.** Those keys should be rotated. Nothing about the backup changes that;
the review simply surfaced it.

**Another describes a password's exact length and character class.** That is a partial credential
disclosure with no instructional value and should be deleted from the note.

**Three files contain assessments of named job candidates**, two of them in the `interviews`
project and — unexpectedly — one in a general project directory. These are adverse hiring
assessments tied to named individuals, generated in an employment process. They plausibly belong to
the employer's applicant records rather than your personal files, and are subject to retention
rules that a personal backup does not satisfy. Redaction is a poor remedy: the interviews are dated
and the roles named, so surrounding detail re-identifies the person to anyone inside the company.

The recommendation is to move those out of auto-memory into whatever system holds interview
scorecards, and delete them locally — a decision for you and probably HR, not one to settle from
the backup side. Until then they are sealed like everything else, which is safe but is not the same
as being handled correctly.

## Why not the alternatives

**Commit only the SAFE files.** Backs up 23% and leaves the rest unsolved, so it does not meet the
goal on its own. It would have to be combined with sealing the remainder, which means two
mechanisms and a per-file manifest to keep them apart — real ongoing cost, and a misclassification
publishes something it should not. Worth revisiting only if the passphrase model proves
uncomfortable.

**Scrub the org-internal ones into generic lessons.** The reviewers identified roughly 25 files
where a ticket ID or service name is the only thing making them internal, and scrubbing those is
genuinely worthwhile for a different reason — they would make good public notes. But it is
per-file manual work, it degrades the notes for your own use, and it leaves the other ~55 files
unsolved.

**A second, private repository.** Works, and is the conventional answer. It splits the tooling
across two repos and means the restore story depends on GitHub private-repo access at exactly the
moment you are rebuilding a machine. Reasonable if you would rather not depend on a passphrase.

**Encrypt, as implemented.** Backs up 100%, publishes nothing readable, restores with one command.
The cost is the passphrase becoming a single point of failure, which is why it is stated twice
above.
