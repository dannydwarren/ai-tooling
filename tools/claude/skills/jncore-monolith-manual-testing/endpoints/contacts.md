# Contacts

Lane B. The simplest full CRUD surface, and the one to reach for when you want a clean read on
whether record writes work at all.

| Action | Call | Activity |
|---|---|---|
| Create | `POST /api1/contacts` | Contact Created |
| Modify | `PUT /api1/contacts/:docid` | Contact Modified |
| Delete | `PUT /api1/contacts/:docid` with `is_active: false` | Contact Deleted |
| Undelete | `POST /api1/contacts/:docid/undelete` | Contact Undeleted |

```bash
A2125_RUN_ID=<id> node lanes/b-contact.mjs
```

## Gotchas

- Strip read-only fields before a `PUT`. `stripReadOnly` in `lib/fixtures.mjs` removes `recid`,
  `guid`, the `parent_*` rollups, `payments`, `total_paid` and `due`; echoing a create response
  straight back into an update without it is rejected.
- The contact created here is the primary record other lanes hang their fixtures off. If lane B
  gates, expect collateral failures elsewhere.
