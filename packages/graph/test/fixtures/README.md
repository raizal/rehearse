# Fixtures of the code-graph EPIC

Tests copy a fixture into a temporary folder and index the copy, so these files never change.

- `shop/` is the fixture repo of the scenario examples (`docs/epics/2026-11-05-code-graph/scenarios/README.md`):
  `src/orders.ts` (getOrder → loadOrder → getOrderById → loadRow, lines 12-20 for getOrderById),
  `src/pay.ts` (charge, lines 10-30), `api/orders.py` (get_order_by_id and the FastAPI route get_order
  under `APIRouter(prefix="/api/orders")`) and their tests. `src/orders.ts` also has the computed call
  `handlers[name](id)` of S6-A2 and the fetch of `/api/orders/${id}` of S7.
- `monorepo/` is the scope fixture of S6-A1: `packages/a/tsconfig.json`, `packages/b/tsconfig.build.json`
  and a call to `lodash.get()`. The tests add `node_modules/` at run time (the repo ignores node_modules).
