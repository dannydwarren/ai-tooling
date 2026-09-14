---
name: deploy-regression-watch
description: Use when checking whether a deploy or release introduced errors in a running environment — phrasings include "watch this deploy", "did this release cause regressions", "is this deploy safe", "check for errors since the deploy", "any new errors after the release", "should we roll back", "did my changes break anything in prod", "is it safe to widen the rollout". Covers generating the affected-service list, per-service deploy boundaries via task_version, and set-difference on DataDog log patterns before and after each boundary.
---

# Deploy Regression Watch

## Overview

The question is narrow: **did this deploy make something worse?** The answer comes from one detector —
the **complete set of error patterns for a service before its own deploy boundary, differenced
against the same set after it.** Anything new is suspect by default.

Everything else in this skill exists to make that difference trustworthy: the right list of services,
the right boundary per service, and a baseline that is actually complete.

A curated list of known error signatures cannot do this job. It only finds what someone already
thought to look for. This skill was written after a `TypeError` crashed a service's write path and
went unnoticed, for two structural reasons:

- The watch used a **hand-picked service list** while nine packages vendored the changed library. The
  crashing service was simply not being looked at.
- The watch window started at **one release-wide timestamp**. Services deploy independently, and the
  crashing service had taken the same code **2 days 16 hours earlier** — outside every query by
  construction.

Both failures are structural, not analytical. Neither is fixed by looking harder at the wrong data.

## When to Use

- "Watch this deploy" / "did this release cause regressions" / "is this deploy safe"
- "Check for errors since the deploy" / "any new errors after the release"
- "Should we roll back" / "did my changes break anything in prod"
- Before widening a rollout, a percentage, or a flag
- A shared library changed and you need to know who else took it

**Not for:** a known error you are already debugging (that is an investigation, not a watch), latency
or saturation regressions (this skill is error-pattern based), or pre-deploy risk review.

## Inputs

- Environment (`${ENV}`) and the approximate deploy time.
- The repo, and the unit of change — usually a package or shared library, not a service.
- Whether a feature flag is involved, and what it actually gates.

## 0. Derive the watch context from terraform and DataDog tags

Do not look for a bespoke watch-config file and do not ask a repo to adopt one. The facts this skill
needs are already encoded where monitors are defined.

**Terraform is the primary source.** Where a repo defines its DataDog monitors in terraform, that
directory is the service inventory, the monitor list, and the package-to-`service`-tag mapping at
once — maintained by whoever changes the services, so it does not drift the way a hand-written doc
does.

```bash
# Find the monitor definitions
grep -rl "datadog_monitor\|tf-module-datadog-monitoring" --include='*.tf' .

# The tag locals carry the service names — this is the mapping that is otherwise guessed wrong
grep -rn "service:" --include='locals.tf' .
```

Read from it:

| what you need | where it is |
| -- | -- |
| service inventory | one `monitor_<service>.tf` per deployable |
| package → DataDog `service` tag | the `tags_*` locals, which spell out each `service:` value |
| existing monitors and thresholds | the module blocks — tells you what is *already* alerted, so you watch the gaps |
| owning team, runbooks | `owner`, `service_name`, runbook locals |

**Read it rather than inferring.** A package whose name differs from its `service` tag is the common
case, not the exception, and the tag locals are where that difference is already written down. A
service missing from a hand-built inventory, or filed under a guessed tag, is a service nobody is
watching.

**DataDog tags are the cross-check.** Whatever terraform claims, confirm each `service` value
actually returns logs (step 1) — terraform can name a monitor for something renamed or retired.
Where a repo has no terraform monitors, fall back to the dependency manifest for the inventory and
to DataDog's own tag values (`service`, `task_family`, `project`, `app`) to map packages to services.

## 1. Generate the affected-service list

The blast radius is every deployable that vendors the changed unit. **Generate it from the manifest
every time. Never from memory, habit, or the last watch.**

```bash
# Node monorepo
grep -l '"<changed-package>"' */package.json

# .NET
grep -rl '<changed-project>' --include='*.csproj' .

# Then map each package to its DataDog `service` tag — they rarely match.
```

**Verify every mapped name before trusting the table.** Package name and `service` tag agree often
enough to feel safe and not often enough to be assumed. Query each candidate and require non-zero
volume:

```
mcp__datadog__analyze_datadog_logs
  filter: env:${ENV} service:${SERVICE}
  sql:    SELECT service, task_family, count(*) AS n FROM logs GROUP BY service, task_family
  extra_columns: [{"name": "task_family", "type": "varchar"}]
  from: now-6h
```

Zero rows means the mapping is wrong, not that the service is healthy. Resolve the real name — search
logs by `task_family`, by a string unique to that package, or by listing services under the env — and
record it. A package whose service name you cannot confirm is marked **unverified**, out loud, in the
table. Never fill the cell with the package name to make the table look complete.

> If a package vendors the changed code and you cannot state its error baseline, it is not being
> watched. Say so explicitly rather than leaving it off the list silently.

Also list downstream consumers of the changed endpoints or message contracts. They do not vendor the
code, but they see its output.

## 2. Establish the deploy boundary — per service, not per release

Independently deployed services in one release have been observed **2 days 16 hours apart**. Derive
each boundary from the logs themselves:

```
mcp__datadog__analyze_datadog_logs
  filter: env:${ENV} service:${SERVICE}
  sql:    SELECT task_version, min(timestamp) AS first_seen, max(timestamp) AS last_seen,
                 count(*) AS n
          FROM logs GROUP BY task_version ORDER BY min(timestamp)
  extra_columns: [{"name": "task_version", "type": "varchar"}]
  from: now-7d
```

Record, per service: old version, new version, rollout start, and when the old version drained.

**Every window in steps 3-5 is scoped from that service's own boundary.** Where a single release-wide
window is genuinely needed, it starts at the **earliest** rollout, never the most recent or the most
convenient.

A release is not "deployed" until every service from step 1 shows its new `task_version`.

## 3. Capture the complete baseline pattern set

For each service, the 24 hours (or one full traffic cycle) before *its* rollout:

```
mcp__datadog__search_datadog_logs
  query: env:${ENV} status:error service:${SERVICE}
  use_log_patterns: true
  pattern_group_by: ["service"]
  from: <rollout - 24h>   to: <rollout>
```

**Paginate with `start_at` until the result set is exhausted.** A truncated first page is the
original bug wearing a different hat: the pattern that matters is rarely the loudest one, and a
baseline missing it makes the new pattern in step 4 look pre-existing. Note each pattern and its
count per hour, not just the pattern text.

Log retention is finite (often ~3 days in non-prod). A baseline you plan to re-derive later may no
longer exist — capture it now.

## 4. Set-difference — the primary detector

Same query, after the boundary:

```
mcp__datadog__search_datadog_logs
  query: env:${ENV} status:error service:${SERVICE}
  use_log_patterns: true
  pattern_group_by: ["service"]
  from: <rollout>
```

Difference the two sets:

1. **Present after, absent before** → investigate **every one**. No triage by apparent severity, no
   skipping the ones that look cosmetic. The crash that motivated this skill was a brand-new
   pattern that no signature list predicted.
2. **Present in both, materially changed in rate** → investigate. A ~40x rate change inside an
   existing message family was a real regression that a presence/absence check would have passed.
3. **Present before, absent after** → note it. A failure that stopped can mean a code path stopped
   running, not that it was fixed. Disappearance is diagnostic, not reassuring.

Then the catch-all that needs no prediction — total error rate per service per hour, read across each
service's own boundary:

```
mcp__datadog__analyze_datadog_logs
  filter: env:${ENV} status:error service:(<all services from step 1>)
  sql:    SELECT DATE_TRUNC('hour', timestamp) AS hr, service, count(*) AS n
          FROM logs GROUP BY DATE_TRUNC('hour', timestamp), service
          ORDER BY DATE_TRUNC('hour', timestamp)
  from: <earliest rollout - 24h>
```

## 5. Attribute before concluding

Never call a pattern new or pre-existing from message text alone.

```
mcp__datadog__analyze_datadog_logs
  filter: env:${ENV} "<the message>"
  sql:    SELECT DATE_TRUNC('hour', timestamp) AS hr, task_version, count(*) AS n
          FROM logs GROUP BY DATE_TRUNC('hour', timestamp), task_version
          ORDER BY DATE_TRUNC('hour', timestamp)
  extra_columns: [{"name": "task_version", "type": "varchar"}]
```

Then compare **shape, not message text**: endpoint, caller frame, which fields, which array indices,
which customer. Two different defects share a message family more often than is comfortable — one
validation error was twice dismissed as pre-existing before the endpoint and index showed the
post-deploy occurrences were a different defect on a different path.

**Rule out volume.** A rate rise with flat request volume is a per-request regression. A rate rise
proportional to request volume is traffic, not a regression. Pull request counts over the same
window before saying either.

## 6. Verdict and rollback

**Rolling back is the developer's decision, never an automatic action.** This skill reports; a human
decides. Once they decide, they can delegate the mechanics of queuing the rollback back to you.

Recommend a rollback — clearly, and without waiting to establish root cause — when any of these hold
and are unexplained:

- A **new** error pattern on an affected service after its own boundary.
- A sustained step change in a service's total error rate across its own boundary.
- Any crash-class error (`TypeError`, null dereference, unhandled rejection) in the changed code's
  files or a caller's write path.
- Any error that leaves a record **persisted while the request failed** — partial writes are worse
  than failures.

Root cause is not a precondition for the recommendation. The defect behind this skill was
diagnosable in minutes once somebody looked; the cost was entirely in how long nobody did.
Waiting to fully explain a signal before surfacing it is how that happens.

State the recommendation explicitly rather than burying it in findings — name the service, the
boundary, the evidence, and what rolling back would and would not fix. Then stop and let the
developer choose. If they ask you to proceed, queue the rollback for them.

If a feature flag is in play, establish what it **actually gates** before treating it as the lever.
Code that ships alongside a flag usually runs for 100% of traffic regardless of flag state, and the
flag is then not a rollback mechanism at all. Read the flag's rules and its off-variation, not the
toggle: if the off-variation serves `true`, turning the flag "off" bypasses every rule and enables
the feature for everyone.

## Failure Modes

These are the traps. They are the reason this skill exists — each one produced a wrong "all clear"
in practice.

| Trap | What actually happens | What to do instead |
|---|---|---|
| Hand-picked service list | The one service nobody named is the one that breaks | Generate from the dependency manifest, every time |
| Assuming the DataDog `service` equals the package name | The query returns nothing and reads as a quiet service, hiding a real error stream behind a table that looked complete | Query every candidate name for non-zero volume; resolve or mark **unverified**, never guess |
| One release-wide window | Services that deployed earlier fall outside every query | Scope each window to that service's own `task_version` boundary |
| First page of patterns only | The new pattern is not the loudest; baseline looks complete and is not | Paginate with `start_at` until exhausted |
| Curated signature list as primary detector | Finds only what was predicted; misses everything novel | Set-difference first; signature lists are a secondary pass |
| Judging by message text | Two defects share a message family; one masks the other | Compare shape — endpoint, caller frame, fields, indices, customer |
| "It existed before" from memory | The before-occurrence was a different defect on a different path | Attribute to `task_version` with a per-hour breakdown |
| Rate rise = regression | Traffic doubled | Rule out request volume first |
| Consumer logs prove producer health | Other producers emit the same event type; counts predate the deploy entirely | Confirm the producer directly, by its own identifier or key prefix |
| No log means no event | Class and module names often appear only in stack traces | Absence of a log line is not evidence; query the thing itself |
| No errors means it works | The path was never exercised | Verify the path ran before reading silence as success |
| Error disappeared, so it is fixed | A code path stopped running | Treat disappearance as a finding to explain |
| Flag is off, so the deploy is safe | Most of the changed code runs unflagged | Watch every deploy the same way regardless of flag state |
| Flat volume across the window proves stability | The window is shorter than retention, or shorter than one traffic cycle | Confirm the window covers a full cycle and lies inside retention |

## Quick Reference

| Want to know | Approach |
|---|---|
| Who is affected | `grep -l` the dependency manifest, map package → DataDog `service` |
| Is a service name real | `analyze_datadog_logs` grouped by `service`, `task_family`; require non-zero rows |
| When each service deployed | `analyze_datadog_logs`, group by `task_version`, `from: now-7d` |
| Baseline patterns | `search_datadog_logs`, `use_log_patterns: true`, before-window, **paginated** |
| New patterns | Same query after the boundary, then set-difference |
| Rate step change, all services | `analyze_datadog_logs`, count by hour and `service` |
| Is this pattern new | Per-hour counts grouped by `task_version` |
| Is this a regression or traffic | Compare error rate against request volume over the same window |
| Service inventory and `service` tags | The repo's terraform monitor definitions — `monitor_*.tf` and the `tags_*` locals |
