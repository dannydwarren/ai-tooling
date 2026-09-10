# ADR 0007: Secret test fixtures are assembled at runtime, not stored

## Status

Accepted, 2026-09-09

## Context

The scanner in `scripts/checks/scan.mjs` is only trustworthy if something proves its rules actually
fire. That proof is a corpus of known-bad strings that the suite asserts are detected — see
[ADR 0004](0004-secret-and-pii-policy.md).

The obvious implementation, and the first one built, was a plain text file:
`tests/fixtures/known-bad.txt`, holding one deliberately fake credential per line. Every value in it
was invented. Nothing in it authenticated against anything.

The first push to the public remote was rejected:

```
—— Slack API Token ———————————————————————————————
 locations:
   - commit: 41fafe2...
     path: tests/fixtures/known-bad.txt:8
remote: push declined due to repository rule violations
```

GitHub push protection was right to block it. The offending line was a structurally valid Slack bot
token: the `xoxb` prefix followed by the usual dash-separated segments. **No scanner can distinguish
a well-formed fake credential from a real one** — that is precisely why scanners work on structure.

(Writing this record proved the point twice. The first draft quoted the offending value in full, and
this repo's own scanner failed the build on it. The literal is paraphrased above for that reason.)

Our own scanner has the same property,
which is why the file needed an allowlist entry in the first place. An allowlist entry that says "the
secrets in this file are fine" is a local assertion; it carries no weight with GitHub, a CI secret
scanner, a future clone, or a security tool someone else runs.

The general problem: a repository whose job is detecting secrets needs examples of secrets, and
storing those examples as literals makes the repository indistinguishable from one that has leaked.

## Decision

The corpus lives in `tests/fixtures/known-bad.mjs` and every sample is **assembled from fragments at
import time**:

```js
{ rule: 'slack-token', text: j('xo', 'xb', '-', '1'.repeat(12), '-', 'c'.repeat(24)) }
```

No complete credential-shaped string exists in any committed file. The strings only exist in memory,
during the test run, which is the only place they were ever needed.

Three consequences were built in alongside it:

1. **Each sample declares the rule it is written for**, so the suite asserts not just that the corpus
   trips every rule, but that each individual sample trips its intended rule. This is strictly
   stronger than the previous "every rule fired somewhere in this blob" assertion.
2. **A test asserts the fixture source itself contains no complete secret** — it runs the scanner's
   secret rules over `known-bad.mjs` and requires zero findings. The property cannot silently regress
   the next time someone adds a sample as a literal for convenience.
3. **The `tests/fixtures/*` allowlist entry was deleted.** It is no longer needed, and the stale
   allowlist check introduced alongside it would have flagged it anyway.

The history was rewritten before pushing so the literal never existed in any reachable commit.
Rewriting was cheap because nothing had been pushed yet.

## Consequences

### Good

- The repo can be pushed to a host with secret scanning, cloned, forked, and scanned by third-party
  tooling without tripping anything. That was previously impossible.
- Coverage assertions got stronger, not weaker: per-sample rule pinning replaced a blob assertion.
- The invariant is enforced by a test rather than by remembering.
- The failure mode is now a red test locally instead of a rejected push after the work is done.

### Bad / accepted costs

- The corpus is less readable. `j('gh', 'p', '_', 'a'.repeat(36))` takes a moment to parse where
  `ghp_aaaa...` did not.
- Adding a rule takes slightly more thought, since the sample must be written in fragments.
- The fragmentation is arbitrary. Nothing enforces *how* a string is split, only that the assembled
  result is not present as a literal — which the guard test does check.

## Alternatives considered

**Use the GitHub unblock URL.** Rejected. It resolves this one push on this one host and leaves the
underlying problem: the repository still contains structurally valid credentials, and every other
scanner that ever looks at it will flag them again. It also trains the reflex of clicking through
secret-scanning warnings, which is exactly the wrong habit for a repo whose purpose includes not
leaking secrets.

**Mangle the fixtures so no real detector matches.** Rejected as unstable. Our rules and GitHub's
overlap heavily by design — both match on credential structure. Tuning a string to satisfy one and
not the other is guesswork against an undocumented, changing pattern set, and a future tightening on
either side silently breaks it.

**Drop the corpus and test the rules with inline strings in the test file.** Rejected: it moves the
literals rather than removing them, and the test file is committed too. It also scatters the corpus,
making "is every rule covered?" hard to answer.

**Keep the corpus in a gitignored file generated by a script.** Rejected: the generator would contain
the literals, or the corpus would not be reviewable, and a fixture that is not in the repo cannot be
relied on in CI.

**Encode the corpus, for example base64.** Rejected: it defeats scanners by obscurity, which is the
same trick real leaked secrets use to evade detection. Assembling from fragments is honest about what
it is doing and keeps the samples readable in source.
