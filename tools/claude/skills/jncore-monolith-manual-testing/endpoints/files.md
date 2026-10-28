# Files

Lanes I and L. The files API is a separate deployable but mounts on the same `api1_prefix`, so
these are `/api1/files/...` on the same host — there is no separate base URL.

| Endpoint | Expect |
|---|---|
| `POST /files`, `/files/multipart`, `/files/fromUrl`, `/files/url`, `/files/v2/url` | **no activity** |
| `PUT /files/:docid`, `PUT /files/v2/:docid` | **no activity** |
| `DELETE /api1/files/:docid` | `ActivityBulk` |

```bash
A2125_RUN_ID=<id> node lanes/i-files.mjs
A2125_RUN_ID=<id> node lanes/l-control.mjs
```

## Create and modify produce no activity — these are negative cases

There is no create-activity or modify-activity producer anywhere: not in jncore-monolith, not in
dotnet-monolith's Worker, not in domain-event-bridge. `postFileMultipart` ends at a raw
`jnCb.upsert` and never calls `JnRecord.save`, so the activity path is never reached.

These rows assert that **no** activity appears. A new activity on a file create or modify is the
finding, not its absence.

## Delete is the high-value case

`DELETE /api1/files/:docid` calls `createDeleteAttachmentActivity` with `skipAutomation: true`,
and is the **only API1-reachable `ActivityBulk` producer**. If you only have budget for one file
case, run this one.

`created_by` on the resulting activity distinguishes the path taken: `System` marks the outbox
producer, a user name marks the legacy path.

## Gotchas

- **`POST /files/v2/url` 500s on an empty `jnid`** — KI-2. The client-supplied value goes straight
  to a Couchbase key lookup, which rejects anything shorter than two characters, and the catch only
  swallows `key does not exist`. Expected in the control lane; every other call to the route
  returns 200. The fault is the empty input, not the route.
- In jncore-monolith, `attachment` is the File record type. Side-effect activities are *enrolled*
  in a record save, never "attached".
- The multipart upload takes `related` as a form field. Both the with-related and without-related
  shapes are worth exercising; they take different branches.
