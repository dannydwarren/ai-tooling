# Activities — direct writes

Lane A. The only endpoints that write an activity directly rather than as a side effect of a
record save.

| Endpoint | Expect |
|---|---|
| `POST /api1/activities` | create; stages `ActivityTriggers` + `AutomationRuleRecordScheduler` + `RecordUpdate`, and `Mentions` when notifications are on |
| `PUT /api1/activities/:docid` | update; `RecordUpdate` fires **only on a non-empty diff** |
| `POST /api1/activities?skip=automation` | no `ActivityTriggers`, no `AutomationRuleRecordScheduler` |
| `POST /api1/activities?skip=notification` | no `Mentions` |

```bash
A2125_RUN_ID=<id> node lanes/a-activities.mjs
```

## skip

`skip` is parsed by `jn-api-helper.getFlagsFromQueryString` and honoured on **both** POST and PUT.

It carries a third value, `skip=system_update_activity`, which sets `createUpdateActivity: false`
and suppresses the Modified side-effect activity entirely. That one applies to the **record**
handlers — contacts, jobs, tasks, estimates, invoices — not to activity writes. It is covered in
[misc](misc.md), not here.

## Gotchas

- An update that changes nothing still returns 200 but stages no `RecordUpdate`. The empty-diff
  case is a distinct test, not a duplicate of the update case.
- `{type} {action}` activity types are artifacts of how the label is derived. Type 0 with a
  derived label is correct; "no such activity type exists" is not a finding.
