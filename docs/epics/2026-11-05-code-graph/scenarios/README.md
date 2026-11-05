# Scenarios

One file per story. Each scenario is a path through `flow.yaml` (D15). The rules are
the same as in v1 (`../../2026-11-05-rehearse/scenarios/README.md`):

- `steps[].name` is a box path (R21 of v1). A step on a box with children names its
  child boxes, not the parent.
- Entering a box with children enters its child that has no incoming edge
  (`update-graph/scope`, `run-query/target`). Leaving it leaves from its child that
  has no outgoing edge (`update-graph/fresh`, `run-query/answer`).
- `example` is the given/then for that box. `then` holds the output values, or
  `exit: <error-exit>`.
- `branch` names the edge label taken from a decision or an error exit.
- `expect` links the end state to an acceptance criterion.
- Every scenario is `status: draft`. Agents write drafts. Only the builder approves,
  in the UI (v1 R13, D41).

The fixture repo of the examples has `src/orders.ts` (getOrderById), `src/pay.ts`
(charge), `api/orders.py` (get_order_by_id and the FastAPI route get_order) and their tests.
