# Account settings

Lane M. A read-only fixture source: the account's configuration, including the lists a lane needs
ids from.

| Action | Call | Activity |
|---|---|---|
| Read | `GET /api1/account/settings` | none |

| Field | Holds |
|---|---|
| `locations` | `id`, `name`, `code`, `is_active` and address per location |
| `workflows` | record types per `object_type` (`contact`, `job`, …), each with its `status` list |
| `taskTypes`, `activityTypes`, `sources` | the names a create body can reference |

## Gotchas

- Use it to pick ids at run time rather than baking them into a lane. Location and workflow ids
  differ per account and per environment.
- Filter `locations` on `is_active !== false`; inactive locations stay in the list.
- It is a read. Never write account settings from the harness.
