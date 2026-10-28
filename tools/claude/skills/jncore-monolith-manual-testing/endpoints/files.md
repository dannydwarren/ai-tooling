# Files

Lanes I and L. The files API is a separate deployable but mounts on the same `api1_prefix`, so
these are `/api1/files/...` on the same host — there is no separate base URL.

| Endpoint | Expect |
|---|---|
| `POST /files`, `/files/multipart`, `/files/fromUrl`, `/files/url`, `/files/v2/url` | **no activity** |
| `PUT /files/:docid`, `PUT /files/v2/:docid` | **no activity** |
| S3 PUT to the `/files/v2/url` signed URL | postprocessor moves the record; **no activity** |
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

## Presigned upload is the only route to the postprocessor

Multipart upload writes the attachment directly and never touches `file-upload-postprocessor`.
The presigned flow does:

1. `POST /files/v2/url` with a client `jnid` writes `tmp-<jnid>` to the `tmp` bucket and returns
   a signed S3 PUT URL.
2. The S3 PUT raises an S3 event. That lands on the `file-upload-postprocessing-<env>` SQS queue.
3. The postprocessor moves the tmp record into `main`, with `createUpdateActivity: false`, so no
   activity results.

`GET /files/:jnid/meta` returns 404 until step 3 finishes and 200 afterwards, so it is the
completion signal. Lane I's `file-presigned-processed` polls it for up to a minute. Send the S3 PUT
with no `Authorization` header and no extra query string, or the signature breaks.

## Gotchas

- **`POST /files/v2/url` 500s on a missing or empty `jnid`** — KI-2. The client-supplied value
  goes straight to a Couchbase key lookup, and the catch only swallows `key does not exist`.
  Callers must send their own unique `jnid`. Expected in the control lane, which omits it.
- In jncore-monolith, `attachment` is the File record type. Side-effect activities are *enrolled*
  in a record save, never "attached".
- The multipart upload takes `related` as a form field. Both the with-related and without-related
  shapes are worth exercising; they take different branches.
