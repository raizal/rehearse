# Overlays of the linker tests (T30)

Each folder is copied over a copy of `../shop` (see `../../link-helpers.ts`). The git history is
made in the test, in the temporary copy; no test reads the history of this repo.

- `record/` is one EPIC of the shop: requirement R1, story S1 (R1), the boxes `orders`,
  `orders/get` (S1), `checkout` and `checkout/pay` (S1), and the scenario S1-get through
  `orders/get`. The `orders/get` box is the box of S2-A2.
- `openapi/` is an OpenAPI spec with the operation `getOrder` on `GET /api/orders/{order_id}` (S7-A2).
