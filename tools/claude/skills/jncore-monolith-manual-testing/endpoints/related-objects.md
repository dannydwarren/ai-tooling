# Related-objects workers

Lane M. Checks the effect of the two queues jncore produces on every record save. Both are
consumed by dotnet-monolith's `worker` service; jncore only produces them, from every API1
contact, job, task, estimate, invoice, work order, material order and credit memo save.

| Queue | Message | Fires on | Effect |
|---|---|---|---|
| `related_objects_update` | `<jnid>;<type>;<ticks>[;;true]` | every save | rewrites the record's name into `related[].name` on its children |
| `related_objects_update_for_location` | `<customer>;<jnid>;<locationId>` | an update that changes `location.id` on an active record | moves the record's children (tasks, estimates, invoices, …) to the new location; related jobs do not move |

```bash
A2125_RUN_ID=<id> node lanes/m-related-objects.mjs
```

The lane creates a contact, a job and a task related to the job, all in the first location. It
renames the job, moves it to the second location, then modifies and moves the contact. It reads
the task back until both effects show, records the result in `on/M/checks.json`, and soft-deletes
all three records.

## Gotchas

- **The account needs two active locations.** The lane reads them from
  [`/account/settings`](account-settings.md) and gates when there are fewer.
- **Wait about 15 s after creating the task** before changing the job. The worker finds the
  children through Elasticsearch, so a task that is not indexed yet is not updated.
- **`related_objects_update` rewrites `related[].name`, not `primary.name`.** Read the job's
  entry in the task's `related` array.
- **The location worker logs only at debug**, which is not shipped. It writes no positive log line,
  so the task's changed `location.id` is the evidence it ran. `related_objects_update` logs
  `RelatedObjectsUpdateCommand … completed` at info.
- Polling uses unrecorded reads and the lane records one `task-read-after-workers`, so the call
  count does not depend on how fast the workers are.
- A missing effect fails the lane (`failed`, not `gated`): it is the behaviour under test.
