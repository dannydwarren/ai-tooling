---
name: pr-walkthrough
description: Use when a dev needs to understand a pull request before reviewing it — unfamiliar codebase, unfamiliar language, or a change too tangled to follow by reading the diff top to bottom. Triggers include "explain https://github.com/org/repo/pull/123", "explain PR 123", "explain #123", "explain this PR", "walk me through this PR", "help me understand PR 123", "I have to review this and I don't know this code" — and any bare "explain" naming a pull request by URL, number, or #number. Not for reviewing, critiquing, judging, or approving code.
---

# PR Walkthrough

## Overview

You produce an annotated diff: the whole PR on one page, with notes in the margin beside the code
they describe. The code is the content; your words are notes in the margin.

The dev is about to review this PR. They may not know the language, the framework, or the codebase.
Put the diff in front of them in an order that makes sense, and annotate only the blocks where
reading the code is not enough. The judgment stays theirs.

You do not write the page. `render.mjs` turns the diff plus a notes file into HTML. Your work is the
notes file — which is to say, the judgment.

## The one hard rule

**You are not reviewing this code.**

No critique. No suggestions. No risks. No praise. No "watch out for this". Do not tell the dev what
to look for — deciding what matters is the review, and the review is theirs.

| Excuse | Reality |
|---|---|
| "This looks like a real bug, I should say so" | Not your call. Show the code and let them see it. |
| "One small suggestion would help them" | A suggestion is a review. Cut it. |
| "I'll just flag the risky part" | Flagging is telling them what to look for. Cut it. |
| "The dev asked what I think of this code" | Answer what the code *does*. Say plainly: you explain, they judge. |
| "Naming an edge case is just explaining" | If the code handles it, annotate the mechanism. If the code misses it, say nothing. |
| "Ordering by risk is more useful" | Order by data flow, never by suspicion. Suspicion is a verdict. |

**Red flags — if these words appear in a note, delete the sentence:** should, consider, recommend,
risk, bug, concern, careful, watch out, make sure, verify that, nit, improvement, cleaner, better,
unfortunately, clever (as praise), well-written, problematic.

## When to use

- Unfamiliar codebase or a language the dev does not write
- A change whose pieces only make sense together
- The dev wants confidence before a hard review

**Not for:** every PR, code review (`/review-pr`), fixing anything, or a general tour of the codebase.

## Steps

1. **Pin the head.** `gh pr view <n> --repo <owner/repo> --json title,body,url,author,baseRefName,headRefName,headRefOid,files,commits`.
   Record `headRefOid` and put its short form in the page meta. A diff fetched without checking the
   head can be stale — this has happened, and the walkthrough was written against three of six
   commits.
2. **Get the diff.** `gh pr diff <n> --repo <owner/repo> > ./tmp/pr-walkthrough/<n>.diff`. Check the
   file list in the diff against the `files` list from step 1; if they disagree, re-fetch.
3. **Get the why.** Read the PR body. If it references a ticket (Linear/Jira id in branch, title, or
   body), pull the ticket. If the why is not stated in either, write "Not stated in the PR or
   ticket" — never invent a motive.
4. **Read the production code in the diff.** Open files beyond the diff only to answer a specific
   question, at most 5 of them and 5 greps. Never start a repo-wide exploration.
5. **Write `./tmp/pr-walkthrough/<n>.notes.json`** (schema below).
6. **Render:** `node "<skill dir>/render.mjs" ./tmp/pr-walkthrough/<n>.diff ./tmp/pr-walkthrough/<n>.notes.json ./tmp/pr-walkthrough/pr-<n>.html`
7. **Publish** the HTML with the Artifact tool and give the dev the link. Favicon `📖`. Re-publish the
   same file path to update in place.
8. Offer follow-up questions.

## The notes file

```json
{
  "pr": {
    "repo": "owner/repo", "number": 123, "title": "…",
    "author": "@who", "head": "branch", "base": "main",
    "url": "https://github.com/…"
  },
  "summary": "2-4 sentences. What the system does now that it did not before. Blank line separates paragraphs.",
  "why": "The stated reason, with its source in parentheses (PR description, TICKET-123, commit).",
  "order": ["path/read/first.ts", "path/read/second.ts", "…every other changed path…"],
  "annotations": [
    { "file": "path/read/first.ts", "line": 42, "title": "Short noun phrase", "text": "One paragraph." }
  ]
}
```

- **`order`** is reading order and controls the page. Entry point first (endpoint, handler, event,
  CLI, UI action), then each file the data reaches, in the order it reaches it. A type definition
  comes first only when the files after it are unreadable without it. Never order by importance,
  size, or suspicion. List every changed path — anything you omit falls to the bottom in diff order.
- **`line`** is a line number in the **new** file. The renderer splits the hunk there and puts the
  note beside the code that starts at that line, running to the next note. Point it at the line where
  the interesting thing starts. Omit `line` for a note about the file as a whole; it renders at the
  top of that file.
- **`title`** makes a note a numbered stop in the rail. A note without one renders as a quiet aside.
- Backticks in `summary`, `why`, `title` and `text` render as inline code.

## What gets a note

**A note is for a block whose meaning is not fully on the screen.** The whole diff is on the page
either way — a note is not how the dev sees the code, so it has to earn its place with something
reading the code cannot give them.

Before writing one, name in one sentence the thing the reviewer learns that they could not get from
the block itself. Cannot name it? Write no note. Most hunks get none.

Qualifying facts — each one lives outside the block:

- an effect elsewhere: state another component reads, a value that changes behavior in another file
- a consequence: what the system does down this path — retry, abandon, suppress, page, double-write
- a rule whose reason is external: a limit set by another service, a contract with a producer
- a guard held somewhere else: a test that fails the build if this set falls out of date
- a construct doing work that is invisible at the call site: an enricher, an interceptor, an
  attribute that rewrites behavior, generated dispatch, a scheduler

Never write a note for:

- a data shape, DTO, record, or interface declaration
- a try/catch that converts one error type into another
- linear code whose names already say what it does
- a check whose own failure message states the rule it enforces
- a constant, a dependency-injection or route registration, an import
- a rename, a move, or a signature change whose body is unchanged
- a test file, unless the PR's subject is test or fixture behavior, in which case the spec changes
  are the content

Ten notes on a thirty-file PR is a good ratio. Thirty is padding.

## Writing a note

- One paragraph, 60 words maximum. Two short paragraphs only when the second is a separate fact.
- Say the off-screen fact and the consequence that follows from it. Nothing else.
- **Never restate the code in prose.** If the paragraph tracks the code line by line, delete it.
- **Name the mechanism.** Use the construct's real name — `AsyncLocal`, a mutex, a circuit breaker,
  a Serilog enricher — not a phrase you invented to describe its effect. "Stored in `AsyncLocal`
  state so every consumer reads it without being passed it" is dev speak; "parked in ambient
  context" is not. If naming it means opening the dependency, do that; if you still cannot name it,
  say so rather than describing it in your own words.
- **Syntax is not a mechanism.** Never explain a language feature whose effect is local and visible
  in the line — null-conditional, null-coalescing, ternaries, destructuring, string interpolation,
  iteration, `async`/`await`. A reader who does not write the language can look those up in seconds.
  Do name a construct whose effect is non-local or deferred: Go's `defer`, deferred LINQ execution,
  an attribute or decorator that rewrites behavior, an `AsyncLocal`.
- Context with no verdict in it is welcome: where a limit comes from, what happens to an entry that
  trips a guard, which other file reads this value. That is explanation, not review.
- Short sentences. Active voice. Present tense. Banned: leverage, robust, seamless, simply, just,
  essentially, basically, comprehensive, powerful.

## What the renderer does

You do not hand-write HTML, and you do not need to describe the page in chat — hand over the link.

- Full diff, every file, in `order`. Files are expanded by default.
- Side-by-side by default with a unified toggle; horizontal scroll is synced across a file's
  segments. New and deleted files render one pane, not two.
- Syntax highlighting for C#, TS/JS, JSON, HCL, YAML, shell, SQL, Python, Go, CSS and XML-family
  files, by extension — keywords, strings, comments, numbers, types and call sites.
- Five palettes in a Theme picker, each defined for light and dark; the reader's choice persists.
- A reading-order rail, collapsible, listing every titled note.
- The note gutter is always reserved, so code width never changes down a file.

If the page needs a capability it does not have, change `render.mjs` — do not work around it by
moving content into chat.

## Follow-up questions

After the walkthrough, the dev will ask about specific code. Answer in chat — do not rebuild the page
and do not tour the codebase.

Per question: at most 3 file reads and 2 greps, answer under 150 words, every claim anchored to
`file:line`. If the honest answer needs more digging than that, give what you found, then name
exactly what is unresolved and where it lives.

Still no critique. Same red-flag words.

## Common mistakes

- Reviewing instead of explaining — the failure this skill exists to prevent.
- Writing a note for a constant, a registration, an import, or a DTO.
- A note that narrates the code instead of naming what is off-screen.
- Spending a sentence on language syntax the reader can look up.
- Ordering by risk or file size instead of data flow.
- Inventing a "why" the PR and ticket never state.
- Building the walkthrough from a diff fetched without checking the head SHA.
- Summarising the whole page back in chat after publishing it.

See [example-notes.json](example-notes.json) for a finished notes file.
