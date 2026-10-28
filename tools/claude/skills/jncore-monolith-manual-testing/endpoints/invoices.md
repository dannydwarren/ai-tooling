# Invoices

Lane H. Lives on the v2 tree, but its undelete sits on the v1 tree.

| Action | Call | Activity |
|---|---|---|
| Create | `POST /api1/v2/invoices` | Invoice Created |
| Modify | `PUT /api1/v2/invoices/:docid` | Invoice Modified |
| Delete | `PUT /api1/v2/invoices/:docid` with `is_active: false` | Invoice Deleted |
| Undelete | `POST /api1/invoices/:docid/undelete` | Invoice Undeleted |

```bash
A2125_RUN_ID=<id> node lanes/h-invoice.mjs
```

## Gotchas

- **Note the tree switch on undelete** — create, modify and delete are `/api1/v2/invoices`, but
  undelete is `/api1/invoices`. Calling `/api1/v2/invoices/:docid/undelete` 404s.
- Needs a product fixture for its line items, same as the other financial types.
- The delete call triggers KI-1, an unhandled rejection in `jn-cb.js` `_replace`. The call still
  returns 200 and the record is deleted correctly. Check the register before treating it as new.
- Modify `internal_note` rather than a rollup field. The `parent_*` totals, `payments`,
  `total_paid` and `due` are read-only and `stripReadOnly` drops them.
