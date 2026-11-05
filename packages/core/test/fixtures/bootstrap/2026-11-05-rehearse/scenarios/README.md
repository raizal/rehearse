# Scenarios

One file per story. Each scenario is a path through `flow.yaml` (D15).

- `steps[].name` is a box path (R21). A step on a box with children names its
  child boxes, not the parent.
- Entering a box with children enters its child that has no incoming edge.
  Leaving it leaves from its child that has no outgoing edge.
- `example` is the given/then for that box (entity `Example`). `then` holds the
  output values, or `exit: <error-exit>`.
- `branch` names the edge label taken from a decision or an error exit.
- `expect` links the end state to an acceptance criterion (R7).
- `status: draft` until the builder approves the scenario in the UI (R13).
