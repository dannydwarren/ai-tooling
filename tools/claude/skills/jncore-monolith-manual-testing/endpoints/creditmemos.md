# Credit memos

Lane J. Credit memos have **no create, update or delete route in API1** — only undelete. The
record has to be built elsewhere.

| Action | Call |
|---|---|
| Undelete | `POST /api1/creditmemos/:docid/undelete` |

Fixtures come from accounts-receivable:

| Need | Call |
|---|---|
| Create | `POST /v1/credit-memos` |
| Delete, to set up the undelete | `DELETE /v1/credit-memos/{id}` |

```bash
A2125_RUN_ID=<id> node lanes/j-ar-creditmemo.mjs
```

## Accounts-receivable is a fixture factory, not a test target

AR is a separate .NET service. Its writes do not run jncore's `JnRecord.save`, so they never reach
the jncore write path at all. **Do not report AR coverage as jncore coverage.** The only thing
under test in this lane is whether API1 can see and reverse an AR-created, AR-deleted record.

The lane gates on exactly that on its first credit memo, and stops rather than burning its
remaining cases on an unproven premise.

## Gotchas

- **`DELETE /v1/credit-memos/{id}` 404s on the first attempt routinely.** AR reads lag its own
  writes. The lane retries up to four times with a 2s gap; a 404 followed by a 204 on the same id
  is expected and is registered as such. Do not investigate it.
- The create needs an `Idempotency-Key` header and a line item referencing a real product.
- `payment` is the same shape of problem with no solution: `payments-route.js` registers `GET`
  only, so no payment action is reachable from API1.
