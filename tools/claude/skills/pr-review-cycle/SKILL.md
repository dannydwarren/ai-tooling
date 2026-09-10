---
name: pr-review-cycle
description: Use when the user wants to loop review-and-address passes on a PR until all automated reviewers (CodeRabbit, code-scanning, claude) stop producing new unresolved comments. Triggers include "review the PR in a cycle", "review this PR until no more feedback", "run the review loop on this PR", "loop until Rabbit is done".
---

# PR Review Cycle

## Overview

Run the `/address-review-comments all` workflow in a loop: address comments, push, wait for CodeRabbit to re-review, then check for new comments. Exit when a full cycle produces zero new unresolved comments.

The skill only runs when the user explicitly asks for the cycle. It does NOT auto-activate mid-conversation.

## When to Use

- User asks to loop PR review passes until reviewers go quiet
- User wants CodeRabbit re-review picked up automatically after each push
- A PR exists on the current branch (or user supplies number/URL)

**Not for:**
- One-off review pass → use `/address-review-comments` directly
- Rebasing, conflict resolution, creating new PRs (out of scope)
- PRs that aren't mergeable (halt and surface error)

## Inputs

- PR detected from current branch via `gh pr view`.
- If no PR linked, prompt the user for a PR number or URL (match `/address-review-comments` behavior).

## Algorithm

```
addressed = []                     # cumulative terse notes across all cycles
start_timestamp = now()            # for final summary
cycle_start_timestamp = now()      # bumped whenever new comments appear
cycle_count = 0
MAX_CYCLES = 5

loop:
  cycle_count += 1
  if cycle_count > MAX_CYCLES: halt with "circuit breaker: max 5 cycles"

  1. Invoke `/address-review-comments all` verbatim.
     - It fetches unresolved comments (code-scanning → coderabbit → claude),
       categorizes (APPLY / DISMISS / CLARIFY), applies changes, resolves threads.
     - For each comment handled, append one terse note to `addressed`.

  2. If no comments were found AND this is not the first iteration → exit loop.

  3. If new commits exist locally → `git push` (normal push, never --force).
     - If push fails (hook rejection, conflict, etc.) → halt, surface error, do NOT retry.

  4. If nothing was pushed this cycle → skip to step 7.

  5. Wait 5 min, then poll CodeRabbit check-run status.
     - First check at t+5min
     - If not completed: wait 5 min, check again
     - If not completed: wait 5 min, check again (third and final check at t+15min)
     - Still not completed after 20 min total → proceed anyway

  6. (continuation of step 5 — poll uses `gh` check-runs API for the latest commit)

  7. Re-fetch unresolved comments.
     - If any new unresolved comments since `cycle_start_timestamp`:
         cycle_start_timestamp = now()
         continue loop
     - Else: exit loop

print summary
```

### Terse Note Format

Imperative past-tense, ≤10 words, references target.

- `fixed typo in P11b §10a`
- `fixed dead link in implementation-plan.md`
- `dismissed false-positive XSS in Login.tsx:42`
- `asked for clarification on auth boundary in api.ts:120`

DISMISS and CLARIFY both count as "addressed".

### Final Summary Format

```
# PR #<number>: <title>
<pr-url>

- <terse note>
- <terse note>
- <terse note>

N comments addressed
Start:   2026-04-20 14:32 MDT
End:     2026-04-20 15:18 MDT
Elapsed: 46m
```

- Header shows the PR number, title, and full URL so the PR is one click away from the summary.
- Timestamps use local timezone, `YYYY-MM-DD HH:MM TZ`.
- Elapsed format: `Xh Ym` if ≥1 hour, else `Ym`.
- Capture `start_timestamp` at cycle entry, `end_timestamp` just before printing.

## Reuses

- `/address-review-comments all` — do NOT re-implement comment fetching, categorization, threaded replies, resolve mutations, or JN decision criteria. Invoke it verbatim for each review pass.

## Safety

- Skill only runs when the user explicitly asks for the cycle.
- Force push is never used. Always normal `git push`.
- Push failure (hook rejection, merge conflict, remote diverged) → halt and surface the error. Do not retry around broken state.
- Max 5 cycles as a circuit breaker.
- Skill assumes a live, mergeable PR. If not mergeable, halt.

## Out of Scope

- Rebasing the branch
- Resolving merge conflicts
- Creating new PRs
- Marking the PR ready / merging / any state transitions

## Quick Reference

| Step | Action | Tool |
|------|--------|------|
| Detect PR | `gh pr view` on current branch | `gh` |
| Review pass | `/address-review-comments all` | slash command |
| Push | Normal `git push` | `git` |
| Wait for Rabbit | 5 min sleeps, poll check-runs | `gh api` check-runs |
| Re-fetch comments | via `/address-review-comments all` | slash command |
| Exit | Zero new unresolved comments this cycle, OR 5-cycle cap hit | — |

## Common Mistakes

- Exiting on iteration 1 with zero comments → should run at least one pass; zero-on-first-iteration is still a valid exit but only AFTER the pass runs.
- Force-pushing after amends → never. Push fails are halts, not retry triggers.
- Counting only APPLY comments in summary → DISMISS and CLARIFY also count.
- Using relative times in the summary → use absolute timestamps with timezone.
- Re-implementing comment fetching logic → always delegate to `/address-review-comments all`.
