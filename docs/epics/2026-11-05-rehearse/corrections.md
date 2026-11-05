# Corrections — 2026-11-05-rehearse

Each entry has a tag: `caught-in-simulation` or `caught-after-build`. (D7, D34)

## 2026-11-05 — first flow draft

A prototype structural check (precursor of `rehearse validate`) ran on the first
draft of `flow.yaml`. It found 5 design errors before any code existed.

- **C1** `caught-in-simulation` · box `start`
  - What: The error exits of `new-epic` went back to `start`, so the start box had incoming edges.
  - Why: A failed command must end visibly ("no file changed"), not restart the flow silently.
  - Fix: New end box `rejected`.
- **C2** `caught-in-simulation` · box `approve`
  - What: The error exit `not-in-ui` looped back to `approve`.
  - Why: The CLI has no approve command (R13). The rule is structural, not a runtime error, so the exit modelled a path that cannot happen.
  - Fix: Removed the error exit.
- **C3** `caught-in-simulation` · box `sign-off`
  - What: Same as C2 for sign-off (R14).
  - Fix: Removed the error exit.
- **C4** `caught-in-simulation` · box `signed`
  - What: The end box `signed` had an outgoing edge to `content-changed`.
  - Why: Stale detection starts from an edit, not from the sign-off. The flow hid the real trigger.
  - Fix: New start box `signed-edit` → `content-changed`.
- **C5** `caught-in-simulation` · box `ci-run`
  - What: `ci-run` had no incoming edge, and it fed the builder's review loop.
  - Why: CI is headless (R19). It must end with an exit code, not ask an agent to fix a draft.
  - Fix: New start `pr-opened`, decision `ci-ok`, ends `ci-pass` and `ci-fail`.

Rules learned for the validator (add to R2/R3):
- A start box has no incoming edges. An end box has no outgoing edges.
- Each root box is reachable from a start box and reaches an end box.
- An error exit must not loop to its own box.

## 2026-11-05 — first real `rehearse validate` run (T0, thread thr_masx64a3yw)

The T0 validator ran on the signed record and gave 19 findings. The record was
corrected here; the code was not changed to fit the record.

- **C6** `caught-in-simulation` · boxes `gate/traced`, `simulate/report`
  - What: An unquoted comma in a YAML flow mapping split each title into a second, unknown key.
  - Fix: Quoted both titles.
- **C7** `caught-in-simulation` · lane `rehearse`
  - What: Lane `rehearse` had no role in prd.yaml. The prototype check hid this: it added `rehearse` to the roles by hand.
  - Fix: Added role `rehearse` (kind `system`). Lifecycle transitions now use `by: rehearse`, not the unknown `by: system`.
- **C8** `caught-in-simulation` · boxes `review/{swimlanes,playback,matrix,readiness}`, `gate/{traced,sim-clean,no-stale,report}`
  - What: 8 leaf boxes had no inputs and no outputs (D10, S2-A1).
  - Fix: Added inputs, outputs and reads to each box.
- **C9** `caught-in-simulation` · prd.yaml roles
  - What: Roles had no `kind`, but entity Role.kind is required.
  - Fix: Added `kind` to each role. Role.kind stays required.
- **C10** `caught-in-simulation` · entity `Finding`
  - What: Finding.kind had no value for flow-structure and step-continuity findings (C1–C5).
  - Fix: Added `structure` to the enum.
- **C11** `caught-in-simulation` · entity `Story`, R15 · OPEN, for thread T4
  - What: The story hash in signoff.yaml covers the story, its requirements and its scenarios only. C8 changed boxes that serve S4, S5, S7, S8 and S9, but no story became stale.
  - Why: R15 says changed signed content makes the affected stories stale. Boxes, lanes and roles are signed content too.
  - Fix (T4): The story hash also covers each box that serves the story (with its ancestors and children) and the roles of their lanes. Under that rule, the bootstrap sign-off is stale for S4, S5, S7, S8 and S9. Run the real gate again when v1 works.

The prototype checks found C1–C5. The real validator found C6–C10, which the prototypes did not find.
