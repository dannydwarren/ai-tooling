# Proposals

Lane L. One route, kept as a case because it proves an exclusion still holds.

| Endpoint | Expect |
|---|---|
| `PUT /api1/htmls/:docid/proposal` | **no activity** |

```bash
A2125_RUN_ID=<id> node lanes/l-control.mjs
```

## Why no activity is the correct answer

The route saves a proposal with `createUpdateActivity: true`, which would normally produce a
Modified activity — but `proposal` is excluded from the Modified list in code. The case exists to
confirm the exclusion holds.

## The id convention is the opposite of its sibling

`html-route.js` uses `:docid` **directly as the proposal id**, with no state-doc lookup. Its
sibling `PUT /api1/htmls/:docid` takes the `{recordId}_html` state-doc key instead — see
[estimates](estimates.md).

There is also no `!jnRec` guard before `jnRec.customer` on this route, so a bad id **throws rather
than 404s**. The harness keeps a deliberate bad-id case for it, which returns 401
(`You do not have access to the requested record`). That 401 is the expected result, not a defect.

`POST /api1/proposals/:docid/undelete` exists but is not exercised.
