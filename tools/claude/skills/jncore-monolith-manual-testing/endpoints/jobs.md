# Jobs

Lane C. Same CRUD shape as contacts, but a job needs a parent contact and a record type.

| Action | Call | Activity |
|---|---|---|
| Create | `POST /api1/jobs` | Job Created |
| Modify | `PUT /api1/jobs/:docid` | Job Modified |
| Delete | `PUT /api1/jobs/:docid` with `is_active: false` | Job Deleted |
| Undelete | `POST /api1/jobs/:docid/undelete` | Job Undeleted |

```bash
A2125_RUN_ID=<id> node lanes/c-job.mjs
```

## Gotchas

- **Record type is environment-specific.** `Residential` in dev, `Retail` in prod. It comes from
  `FIXTURES.JOB_RECORD_TYPE`, which `prod-env.sh` overrides. A type that does not exist in the
  target account fails the create.
- The lane creates its own parent contact rather than reusing the shared fixture, so a job failure
  is a job failure and not contact fallout.
- A status change on a job produces **Status Changed** in addition to Modified.
