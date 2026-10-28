# Material orders

Lane F. Same two-tree split as work orders, plus a supplier submit endpoint.

| Action | v1 | v2 |
|---|---|---|
| Create | `POST /api1/materialorders` | `POST /api1/v2/materialorders` |
| Modify | `PUT /api1/materialorders/:docid` | `PUT /api1/v2/materialorders/:docid` |
| Delete | `PUT` with `is_active: false` | `PUT` with `is_active: false` |
| Undelete | `POST /api1/materialorders/:docid/undelete` | none |

| Side effect | Call |
|---|---|
| Material order modification | `POST /api1/materialorders/:docid/supplier/submit` |

```bash
A2125_RUN_ID=<id> node lanes/f-materialorder.mjs
```

## Gotchas

- **`supplier/submit` returns 500 when no supplier is linked**, with the plain-text body
  `materialorder is not linked with any supplier`. That is a business-state condition returned as
  a server error — registered as KI-4, expected, do not chase it. Exercising the success path
  needs a supplier fixture the harness does not build.
- Nothing crashes on that 500, so no error-detail line is logged anywhere. The wide event is the
  only record of it.
- No v2 undelete route, same as work orders.
