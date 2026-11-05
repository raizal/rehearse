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
- **C11** `caught-in-simulation` · entity `Story`, R15 · DONE in T4 (thread thr_ncedfwrufr)
  - What: The story hash in signoff.yaml covers the story, its requirements and its scenarios only. C8 changed boxes that serve stories, but no story became stale.
  - Why: R15 says changed signed content makes the affected stories stale. Boxes, lanes and roles are signed content too.
  - Fix: Hash rule 2 also covers each box that serves the story (with its ancestors and children) and the roles of their lanes. A sign-off records `hashRule` (missing means 1). The gate reports each story signed under rule 1 as "must be signed again".
  - Correction to the first text of C11: Under rule 2, all 10 stories differ from the bootstrap, not only S4, S5, S7, S8 and S9. Reason 1: C6 and C8 changed boxes of S3, S4, S5, S7, S8 and S9 (the first list missed S3, through `simulate/report`). Reason 2: C7 and C9 changed the roles, and every story has boxes in those lanes.

The prototype checks found C1–C5. The real validator found C6–C10, which the prototypes did not find.

## 2026-11-05 — first real `rehearse simulate` run (T2, thread thr_57cetxdrrg)

The simulator ran on the record and gave 18 contract findings. The
validator and the prototypes found none of them.

- **C12** `caught-in-simulation` · boxes `simulate/{contracts,coverage,lifecycles,acceptance,permissions}`
  - What: Each check box gave only `findings`, but the next box needs `scenarios`. `permissions` needed `epicDir`, and `report` needed `findings`, but `permissions` gave only `matrix`.
  - Fix: Each check box passes on `{scenarios, findings}`. `permissions` gives `{findings, matrix}`.
- **C13** `caught-in-simulation` · box `validate/schema`
  - What: `refs` needs `docs`, but `schema` gave only `findings`.
  - Fix: `schema` outputs `{docs, findings}`.
- **C14** `caught-in-simulation` · edges into `draft-record`, `simulate/load`, `gate/traced` and `review/*` · OPEN, for thread T5
  - What: `epicDir` was lost on 8 root edges, for example `valid → draft-record` and `content-changed → review/swimlanes`.
  - Why: Every box works on one EPIC folder. To repeat `epicDir` in every contract adds noise and hides the real data.
  - Fix (T5): Flow-level `context: { epicDir: string }`. Every box has the context fields as inputs without declaring them.
- **C15** `caught-in-simulation` · boxes `review/{playback,matrix}`
  - What: `playback` needed `scenarioId` and `step`, which `swimlanes` does not give. `matrix` needed `report`, which `playback` does not give, and the `content-changed` path has no report at all.
  - Fix: `playback` is an `input` box (the builder's click). `matrix` loads the report from `epicDir`. `review` takes `report` as optional.
- **C16** `caught-in-simulation` · box `draft-record`, permission matrix
  - What: The agent lane wrote `Story.*`, which includes `Story.status` and `Story.signedHash`.
  - Why: Only the builder (sign-off) and rehearse (stale) may change those.
  - Fix: `draft-record` lists the story fields that the agent drafts.

## 2026-11-05 — found while building wave 1 (T1, T2, T4)

These came from agents who built the code, not from a rehearse check.

- **C17** `caught-after-build` · R6 · OPEN, for thread T5
  - What: No check compares the `by` role of a lifecycle transition with the lane of the box that makes it. In the shop fixture, `pay` is in lane `shop`, but its transition says `by: buyer`.
  - Fix: R6 adds the check. T5 builds it.
- **C18** `caught-after-build` · R1, box `new-epic`
  - What: R1 said "empty, valid record files", but the schemas need one lane, one root box and a goal.
  - Fix: R1 says "the smallest valid record".
- **C19** `caught-after-build` · S1-A1
  - What: S1-A1 listed `scenarios/`, but git does not keep an empty folder.
  - Fix: S1-A1 says the folder is empty and validate accepts a missing `scenarios/`.
- **C20** `caught-after-build` · box `new-epic`
  - What: The box had no rule for an empty title.
  - Fix: A note: a missing or empty title is a usage error (exit 2), not an error exit.
- **C21** `caught-after-build` · S1-A1, S2-A1, S3-A1
  - What: The criteria said `bb rehearse`, but the binary is `rehearse`.
  - Fix: The criteria say `rehearse`. The `bb rehearse` form comes with the bb plugin (D26).
- **C22** `caught-after-build` · entity `Finding` · OPEN, for thread T5
  - What: Gate findings had no kind. T4 used `coverage` and `lifecycle`.
  - Fix: Add `gate` to Finding.kind. All gate findings use it.
- **C23** `caught-after-build` · entity `SignOff`
  - What: The schema has `hashRule` (C11), but the entity did not.
  - Fix: Added `hashRule: number?`.
- **C24** `caught-after-build` · R11, box `review/readiness`
  - What: R11 did not say whether start, end and decision boxes count as "no requirement".
  - Fix: R11 says they are not in that list.

Count so far: 16 `caught-in-simulation` (C1–C16), 8 `caught-after-build` (C17–C24).
