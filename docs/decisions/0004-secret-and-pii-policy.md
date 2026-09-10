# ADR 0004: Secret and PII policy — two severities

## Status

Accepted, 2026-09-09

## Context

The brief is unambiguous: the repo "should never contain secret information or reveal PII", it "should
have a build process by which these types of information are detected and reported", and there will be
"no AI code reviewer only static scripts written and contained in this repo".

The complication is that a personal configuration repo unavoidably contains things a naive secret scanner
flags. `tools/claude/CLAUDE.md` is full of absolute home-directory paths — `{{USER_HOME}}\work-tracking\`,
`{{USER_HOME}}\.datadog\creds.txt` — and referencing those paths is the entire point of the file. Test
fixtures deliberately contain known-bad strings. Documentation quotes the official Claude Code docs, which
use `/home/user` paths and a placeholder session UUID.

A single severity forces a bad choice. Fail on everything and the build never passes, so the scanner gets
ignored or bypassed — the classic failure mode. Warn on everything and a real credential slips through a
green build.

## Decision

Two severities, because they are two genuinely different risks:

- **`secret` fails the build, always.** Private keys, JWTs, AWS access keys and secret access keys,
  GitHub / Slack / npm / Google / LLM API keys, bearer tokens, literal `Authorization` headers, credentials
  assigned to a variable or key, connection strings with inline credentials, OTLP exporter headers, and
  fields copied out of a Claude credentials or state file. A secret in the tree is an incident, not a
  style issue.
- **`pii` is reported but does not fail.** Email addresses, phone numbers, absolute Windows and POSIX home
  paths, UUIDs. These are expected in this repo. `npm run scan:strict` (and `npm run build:strict`)
  promotes them to failures for a deliberate audit pass.

Exit behaviour in `scripts/checks/scan.mjs`:

```js
const failed = (counts.secret ?? 0) > 0 || (strict && (counts.pii ?? 0) > 0);
```

**Patterns are data, not code.** All 20 rules live in `security/patterns.json` as
`{id, severity, title, pattern}` objects. `compile()` supports a leading `(?i)` for case-insensitive rules.
Adding a detection is a JSON edit plus a fixture line, with no change to scanner logic. The file carries a
note stating that patterns themselves must be generic and publishable — anything sensitive in its own right
(internal hostnames, cluster names, private repo paths) goes in the private values file instead and is
caught by the private-value rule from ADR 0006.

**Allowlist entries require a written reason.** `security/allowlist.json` entries match on any of `file`
(glob, repo-relative, forward slashes), `rule`, and `fingerprint` (a truncated SHA-256 of
file + rule id + matched text). All present fields must match, and `isAllowed()` requires at least one
criterion to be present, so an entry with no criteria never matches and cannot silently disable the
scanner. `tests/scan.test.mjs` asserts every entry has a `reason` longer than 20 characters — a bare
`"reason": "ok"` fails the suite. The current entries cover only documentation quoting example credential
shapes, the deliberate fixture corpus, and test inputs containing invented paths.

**The test suite guards both directions of failure.** `tests/scan.test.mjs`:

- asserts every rule in `patterns.json` compiles and has the required fields;
- asserts `tests/fixtures/known-bad.txt` trips **every** `secret` rule;
- asserts the same corpus trips **every** `pii` rule;
- asserts `tests/fixtures/clean.txt` produces **zero** findings.

A rule that silently stops matching is a test failure (guards false negatives). A rule that starts matching
innocuous text is also a test failure (guards false positives). A new pattern cannot land without a fixture
line demonstrating it works.

**Scope is tracked plus untracked-but-not-ignored.** `candidateFiles()` runs
`git ls-files --cached --others --exclude-standard -z`. That deliberately includes files that are staged,
committed, or simply sitting unignored in the working tree — the state a careless `git add -A` would
commit. It excludes `.gitignore`d paths, which is what keeps `tmp/` (logs, scratch, captured API responses)
out of scope. Binary extensions and any file containing a NUL byte are skipped, as is
`security/allowlist.json` itself, since it necessarily quotes the rule ids it suppresses.

**The report never reproduces a full secret.** `preview()` collapses whitespace and, for `secret` severity,
renders anything over 24 characters as first 12 + `...` + last 6. A finding tells you where the credential
is and roughly what shape it has, without putting a working credential into build output, terminal
scrollback, or a pasted bug report. `pii` findings show up to 80 characters raw, because the point of a PII
finding is to read it and judge it.

## Consequences

### Good

- The build stays green in normal use, so a red build means something real.
- A leaked credential is a hard stop with no route around it short of an explicit, reasoned allowlist entry
  that a test scrutinises.
- Adding detections is cheap and reviewable: a JSON object and a fixture line.
- Allowlisting is auditable — every suppression carries a written justification in version control.
- `--strict` gives a way to review accumulated PII deliberately rather than continuously.
- Entirely static and self-contained: no network calls, no external service, no AI reviewer, exactly as the
  brief requires.

### Bad / accepted costs

- Regex detection has a ceiling. A high-entropy string matching no pattern and not a known private value
  passes. The pattern set mitigates this; it does not solve it.
- PII findings accumulate as background noise that nothing forces anyone to read, since only `--strict`
  fails on them.
- `--strict` cannot pass today without a large allowlist, so it is an audit tool rather than a gate.
- The `uuid` and `email-address` rules are broad and fire on innocuous text. That noise is the accepted
  price of catching an account or organisation identifier.
- Fingerprints are content-dependent, so a fingerprint-scoped allowlist entry goes stale as soon as the
  matched text changes. Intended, but it means occasional churn.

## Alternatives considered

**One severity, everything fails.** Rejected: `tools/claude/CLAUDE.md` cannot exist without absolute home
paths, so the build would be permanently red and the scanner would be routed around within a week.

**One severity, everything warns.** Rejected: it does not satisfy "never contain secret information". A
warning nothing enforces is documentation, not a control.

**An off-the-shelf scanner (gitleaks, trufflehog, detect-secrets).** Rejected: the brief specifies static
scripts *contained in this repo*. It also adds a binary or Python toolchain prerequisite, and none of them
support the private-value rule of ADR 0006, which is the mechanism that actually protects employer-internal
identifiers here.

**An AI reviewer over the diff.** Explicitly ruled out by the brief, and it would make a security control
non-deterministic.

**Patterns hard-coded in `scan.mjs`.** Rejected: rules would stop being reviewable as data, the "every rule
is exercised by a fixture" test would need reflection over the source, and adding a detection would mean
editing scanner logic.

**Scanning only tracked files (`git ls-files` alone).** Rejected: it misses the most likely accident — a
captured API response or a values file written into the working tree and not yet added, which is exactly
what a `git add -A` sweeps up.

**Printing the full matched text in the report.** Rejected: the report is the artefact most likely to be
copied into a ticket, a chat, or build output, so it must not carry a usable credential.
