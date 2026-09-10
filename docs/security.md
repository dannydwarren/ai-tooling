# Secrets and PII

This repo is public. It also mirrors a working configuration that legitimately references home
directories, an employer's internal systems, and tooling paths. Those two facts are in tension, and
this document is how the tension is resolved.

There is no AI involved in any of this. The build is static scripts contained in this repo.

## The rules

1. **No credentials in the tree, ever.** Not in `tmp/`, not in a fixture, not "temporarily".
   Anything that authenticates belongs in `~/.ai-tooling/` or `~/.jobnimbus/runtime/`, outside the
   working tree.
2. **No employer-internal identifiers in tracked files.** Internal hostnames, cluster names, private
   repo names. These go in the private values file and appear in the repo as `{{PLACEHOLDER}}`.
3. **PII is minimised, not banned.** Absolute home paths are templated away where practical. What
   remains is reported on every build so it stays a conscious choice rather than an accident.

## Two severities

The scanner classifies every finding as one of two severities, because they carry genuinely
different risk.

| Severity | Examples | Build behaviour |
|---|---|---|
| `secret` | private keys, JWTs, cloud keys, tokens, connection strings, any private value from the values file | **Fails the build** |
| `pii` | email addresses, phone numbers, absolute home paths, UUIDs | **Reported**, does not fail |

PII does not fail the build because a personal configuration repo unavoidably contains some. A rule
that fails on every home path would be turned off within a week, and a check that is off protects
nothing. Run `npm run scan:strict` (or `npm run build:strict`) to promote PII to a failure — that is
the right mode before making the repo more widely visible.

## Running it

```bash
npm run scan           # human readable report
npm run scan:strict    # PII also fails
npm run scan -- --json # machine readable, for piping
npm run build          # scan plus JSON validation, asset validation and tests
```

The scan covers `git ls-files --cached --others --exclude-standard`: every tracked file plus every
untracked file that is not gitignored. That deliberately includes files you have not committed yet,
so a secret is caught before it is ever staged. Binary files and `security/allowlist.json` are
skipped.

Secret previews in the report are truncated to first-and-last characters, so the report itself never
reproduces a full credential.

## Patterns

Rules live in [../security/patterns.json](../security/patterns.json) as data, not code. Each rule
has an `id`, a `severity`, a `title` and a `pattern`. A leading `(?i)` makes the pattern
case-insensitive; JavaScript has no inline flag syntax, so the scanner strips it and sets the flag.

Adding a rule means adding an entry there **and** a sample in
[../tests/fixtures/known-bad.mjs](../tests/fixtures/known-bad.mjs). The suite asserts that every
rule is exercised by the corpus and that each sample trips the specific rule it was written for, so
an untested rule fails the build. A separate fixture,
[clean.txt](../tests/fixtures/clean.txt), asserts zero findings and exists to catch false positives
— it contains near-misses like `https://` double slashes, `${ENV_VAR}` references and
`{{PLACEHOLDER}}` tokens that must not trip anything.

**The known-bad samples are assembled from fragments at runtime rather than stored as literals.**
This is not decoration. When the corpus was a plain `.txt` file, GitHub's push protection correctly
refused the push — it saw a well-formed Slack token and had no way to know it was a fixture. A
scanner cannot distinguish your fake credential from a real one, so a test corpus of literals is a
liability in any repo with push protection or third-party scanning. A test asserts the fixture
source itself contains no complete secret, so this property cannot regress.

Patterns in that file are generic and safe to publish. **A value that is itself sensitive must never
be added there** — that would put the secret in the repo in order to detect the secret in the repo.
Use the private values mechanism instead.

## Private values

Genuinely private strings live in `~/.ai-tooling/values.json`, outside the working tree:

```json
{
  "MSK_CLUSTER_NAME": "the-kafka-cluster-name",
  "WORK_MARKETPLACE_REPO": "the-internal-marketplace-repo-name"
}
```

Two things follow from this file.

**Templating.** Files under `tools/` store `{{MSK_CLUSTER_NAME}}`; the installer substitutes the
real value on the way to `~/.claude`, and `claude-capture` substitutes it back on the way in. The
repo never holds the literal.

**Enforcement.** The scanner turns each private value into a `secret`-severity rule matching the
literal string, case-insensitively. If an internal identifier ever lands in a tracked file verbatim
— pasted into a doc, captured from a new skill, typed by hand — the build fails and names the file
and line. This is the part that matters: "did I leak an internal name" becomes a mechanical check
instead of a judgement call.

Values shorter than six characters are ignored, since matching those produces noise rather than
signal.

## The allowlist

[../security/allowlist.json](../security/allowlist.json) suppresses known-acceptable findings. An
entry matches when all of its present fields match:

| Field | Meaning |
|---|---|
| `file` | Repo-relative glob, forward slashes. `*` matches any run of characters. |
| `rule` | Rule id from `patterns.json`. |
| `fingerprint` | The 16-character hash from the scan report — pins the entry to one exact match. |
| `reason` | Required prose. Not used for matching. |

Prefer the narrowest entry that works: a `fingerprint` over a `rule`, a `rule` over a bare `file`.
An entry with no matching fields at all never matches anything, by design.

Every entry needs a real reason, and a test asserts it — an entry whose `reason` is missing or
shorter than twenty characters fails the build. The allowlist is a record of decisions, not a
silencer.

Allowlisting a `secret`-severity rule should be rare and deliberate. The current entries exist
because the documentation shows example credential shapes and the test fixtures contain deliberate
known-bad strings that the suite asserts are detected.

## What is deliberately not in this repo

Backing up `~/.claude` wholesale would be a serious mistake. These were reviewed and excluded:

| Path | Why |
|---|---|
| `~/.claude/.credentials.json` | OAuth tokens |
| `~/.claude/remote-settings.json` | Contains a live bearer token in the OTLP exporter headers |
| `~/.claude/remote-settings-consent.json` | Account UUID |
| `~/.claude/backups/`, `~/.claude.json*` | Full copies of `.claude.json`, including the OAuth account block with name, email, org and workspace identifiers |
| `~/.claude/history.jsonl` | Every prompt ever typed |
| `~/.claude/projects/` | Full session transcripts, containing work code |
| `~/.claude/file-history/` | Edit snapshots of work source files |
| `~/.claude/plugins/cache`, `marketplaces/` | Regenerable, and includes employer plugin source |

Only four things are copied in: `CLAUDE.md`, `settings.json`, `skills/` and `commands/`. That is an
allowlist, not a denylist, which is the right shape for this problem — a new file appearing in
`~/.claude` is ignored by default rather than swept in.

The `.gitignore` additionally blocks `**/.credentials.json`, `**/settings.local.json`, `backups/`
and key material by extension, as a second line of defence.

## If something does leak

Rewriting history is not enough on its own — assume anything pushed to a public repo has been
fetched. Rotate the credential first, then clean the history, then push. For an internal identifier
rather than a credential: add it to the values file, re-run `npm run claude:capture` to replace it
with a placeholder, and confirm `npm run scan` is clean before pushing.
