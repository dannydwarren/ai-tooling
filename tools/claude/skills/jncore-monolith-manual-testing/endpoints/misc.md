# Misc producers

Lane K. Endpoints that create activities as a side effect of something other than record CRUD.

| Endpoint | Side effect |
|---|---|
| `PUT /api1/contacts/:docid?skip=system_update_activity` | **no activity** |
| `POST /api1/hover/job` | Hover activity via `jn-hover-helper.js` |
| `POST /api1/hover/event/:id/:loc` | Hover activity |
| `POST /api1/utility/qbchild/:docid` | QBD child sync |
| `POST /api1/auth`, `POST /api1/mobile/auth` | `web login` / `mobile login`, saved `persist: false` |

```bash
A2125_RUN_ID=<id> node lanes/k-misc.mjs
```

## skip=system_update_activity

The third `skip` value, and the one that applies to **record** handlers rather than activity
writes. It sets `createUpdateActivity: false` and suppresses the Modified side-effect activity
entirely. The case is a record update that must produce no activity at all.

## Gotchas

- **`hover` and `qbchild` are skipped in prod** by a guard in the lane. Leave that in place.
- **`POST /hover/job` returns 200 but can enqueue an unprocessable message** — KI-3. The message
  carries only `customer` and no `id`, the worker hits the same empty-key error as KI-2, retries
  once and routes to `hover-job-request.dlq`. The caller sees success. Running this in prod lands
  a real message on a real DLQ; that is why the prod guard exists.
- `hover-job` returns 200 with no entity id in the response, so the manifest row has an empty
  jnid. That is expected for this route and not a sign the call failed.
- Auth types are not under test. The auth calls exist for code-path coverage only.
