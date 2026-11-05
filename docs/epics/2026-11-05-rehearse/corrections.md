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
