# Work orders

Lane E. Work orders are routed by **two distinct handler trees** writing the same record type, so
both need exercising — a change can land in one and miss the other.

| Action | v1 | v2 |
|---|---|---|
| Create | `POST /api1/workorders` | `POST /api1/v2/workorders` |
| Modify | `PUT /api1/workorders/:docid` | `PUT /api1/v2/workorders/:docid` |
| Delete | `PUT` with `is_active: false` | `PUT` with `is_active: false` |
| Undelete | `POST /api1/workorders/:docid/undelete` | none |

```bash
A2125_RUN_ID=<id> node lanes/e-workorder.mjs
```

## Gotchas

- **There is no v2 undelete route.** Undelete exists only on the v1 tree. This is a real gap in
  API1, not a harness omission.
- Line items must reference a real product — `jn-financial-api-helper.js` rejects any line without
  a resolvable product jnid. The lane creates a product fixture first; a work order create that
  fails on a line item is usually a dead product reference.
- `description` is not in the work order schema and is not an allowed update field.
