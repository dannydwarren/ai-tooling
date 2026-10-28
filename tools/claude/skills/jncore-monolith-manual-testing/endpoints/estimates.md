# Estimates

Lane G. v2 tree for CRUD, v1 for undelete, plus the signing route — which is the one with the
trap in it.

| Action | Call | Activity |
|---|---|---|
| Create | `POST /api1/v2/estimates` | Estimate Created |
| Modify | `PUT /api1/v2/estimates/:docid` | Estimate Modified |
| Delete | `PUT /api1/v2/estimates/:docid` with `is_active: false` | Estimate Deleted |
| Undelete | `POST /api1/estimates/:docid/undelete` | Estimate Undeleted |
| Sign | `PUT /api1/htmls/:docid` | Estimate Modified |

```bash
A2125_RUN_ID=<id> node lanes/g-estimate.mjs
```

## The signing route takes a different id

`PUT /api1/htmls/:docid` saves the estimate with `createUpdateActivity: true`. Its `:docid` is the
**HTML state-doc key `{recordId}_html`, not the estimate id**. `html-route.js` derives the record
with `doc.jnid.replace('_html','')`, so a bare estimate id falls through to a 404.

A 404 here is almost always a caller error. Build the `_html` key.

Its sibling `PUT /api1/htmls/:docid/proposal` uses the opposite convention — see
[proposals](proposals.md). Two routes in the same file, two id schemes.

## Gotchas

- Undelete is on the v1 tree while everything else is v2.
- The delete call triggers KI-1, an unhandled rejection in `jn-cb.js` `_replace`, at 200. Expected
  until that is fixed.
- Estimate line-item diffs are verbose. The activity content guard measures **raw** length against
  10,000 characters while the Activities API measures length **after** HTML sanitization, which
  encodes `>` and `&` and grows the string. A diff full of arrows can pass the local guard and be
  rejected downstream.
- Needs a product fixture for line items.
