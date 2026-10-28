# Endpoints

One file per endpoint family. Each says what to call, what side effect to expect, and which
assumptions about it are false.

| Doc | Lane | Endpoints |
|---|---|---|
| [activities](activities.md) | A | `POST`/`PUT /api1/activities`, `skip` suppression |
| [contacts](contacts.md) | B | `/api1/contacts` CRUD + undelete |
| [jobs](jobs.md) | C | `/api1/jobs` CRUD + undelete |
| [tasks](tasks.md) | D | `/api1/tasks` CRUD + undelete, completion |
| [workorders](workorders.md) | E | `/api1/workorders` and `/api1/v2/workorders` |
| [materialorders](materialorders.md) | F | `/api1/materialorders`, `/api1/v2/materialorders`, supplier submit |
| [estimates](estimates.md) | G | `/api1/v2/estimates`, undelete, `PUT /api1/htmls/:docid` |
| [invoices](invoices.md) | H | `/api1/v2/invoices`, undelete |
| [creditmemos](creditmemos.md) | J | `POST /api1/creditmemos/:docid/undelete` |
| [files](files.md) | I, L | `/api1/files/*` upload, modify, delete, presigned upload through the postprocessor |
| [deployables](deployables.md) | — | which jncore-monolith package each lane reaches; postprocessor, timebased automation, adhoc scripts |
| [proposals](proposals.md) | L | `PUT /api1/htmls/:docid/proposal` |
| [misc](misc.md) | K | auth, hover, QBD child sync, `skip=system_update_activity` |
| [account-settings](account-settings.md) | M | `GET /api1/account/settings`, read-only fixture source |

## The five side-effect actions

Record writes produce an activity through `activityCreateUpdate`: **Created**, **Modified**,
**Deleted**, **Undeleted**, plus **Status Changed** and **Task Completed/Incompleted** where the
type supports them. Delete is a soft delete — `PUT` with `is_active: false`, not a `DELETE` verb.

## Out of scope

The QuickBooks Desktop sync helper and the jncore workers both create activities, but neither is
reachable from API1. Do not call them from here.

`payment` has no write route at all — `payments-route.js` registers `GET` alone — so Created,
Modified and Deleted are unreachable for it through API1.
