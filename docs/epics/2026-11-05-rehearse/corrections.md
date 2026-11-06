# Corrections — 2026-11-05-rehearse

Each entry has a tag: `caught-in-simulation` or `caught-after-build`. (D7, D34)
Each entry has its status in a fixed place: the first line under the head, `- Status:`
with `OPEN`, or `DONE` and where it was done. (C37)

## 2026-11-05 — first flow draft

A prototype structural check (precursor of `rehearse validate`) ran on the first
draft of `flow.yaml`. It found 5 design errors before any code existed.

- **C1** `caught-in-simulation` · box `start`
  - Status: DONE in the record
  - What: The error exits of `new-epic` went back to `start`, so the start box had incoming edges.
  - Why: A failed command must end visibly ("no file changed"), not restart the flow silently.
  - Fix: New end box `rejected`.
- **C2** `caught-in-simulation` · box `approve`
  - Status: DONE in the record
  - What: The error exit `not-in-ui` looped back to `approve`.
  - Why: The CLI has no approve command (R13). The rule is structural, not a runtime error, so the exit modelled a path that cannot happen.
  - Fix: Removed the error exit.
- **C3** `caught-in-simulation` · box `sign-off`
  - Status: DONE in the record
  - What: Same as C2 for sign-off (R14).
  - Fix: Removed the error exit.
- **C4** `caught-in-simulation` · box `signed`
  - Status: DONE in the record
  - What: The end box `signed` had an outgoing edge to `content-changed`.
  - Why: Stale detection starts from an edit, not from the sign-off. The flow hid the real trigger.
  - Fix: New start box `signed-edit` → `content-changed`.
- **C5** `caught-in-simulation` · box `ci-run`
  - Status: DONE in the record
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
  - Status: DONE in the record
  - What: An unquoted comma in a YAML flow mapping split each title into a second, unknown key.
  - Fix: Quoted both titles.
- **C7** `caught-in-simulation` · lane `rehearse`
  - Status: DONE in the record
  - What: Lane `rehearse` had no role in prd.yaml. The prototype check hid this: it added `rehearse` to the roles by hand.
  - Fix: Added role `rehearse` (kind `system`). Lifecycle transitions now use `by: rehearse`, not the unknown `by: system`.
- **C8** `caught-in-simulation` · boxes `review/{swimlanes,playback,matrix,readiness}`, `gate/{traced,sim-clean,no-stale,report}`
  - Status: DONE in the record
  - What: 8 leaf boxes had no inputs and no outputs (D10, S2-A1).
  - Fix: Added inputs, outputs and reads to each box.
- **C9** `caught-in-simulation` · prd.yaml roles
  - Status: DONE in the record
  - What: Roles had no `kind`, but entity Role.kind is required.
  - Fix: Added `kind` to each role. Role.kind stays required.
- **C10** `caught-in-simulation` · entity `Finding`
  - Status: DONE in the record
  - What: Finding.kind had no value for flow-structure and step-continuity findings (C1–C5).
  - Fix: Added `structure` to the enum.
- **C11** `caught-in-simulation` · entity `Story`, R15
  - Status: DONE in T4 (thread thr_ncedfwrufr)
  - What: The story hash in signoff.yaml covers the story, its requirements and its scenarios only. C8 changed boxes that serve stories, but no story became stale.
  - Why: R15 says changed signed content makes the affected stories stale. Boxes, lanes and roles are signed content too.
  - Fix: Hash rule 2 also covers each box that serves the story (with its ancestors and children) and the roles of their lanes. A sign-off records `hashRule` (missing means 1). The gate reports each story signed under rule 1 as "must be signed again".
  - Correction to the first text of C11: Under rule 2, all 10 stories differ from the bootstrap, not only S4, S5, S7, S8 and S9. Reason 1: C6 and C8 changed boxes of S3, S4, S5, S7, S8 and S9 (the first list missed S3, through `simulate/report`). Reason 2: C7 and C9 changed the roles, and every story has boxes in those lanes.

The prototype checks found C1–C5. The real validator found C6–C10, which the prototypes did not find.

## 2026-11-05 — first real `rehearse simulate` run (T2, thread thr_57cetxdrrg)

The simulator ran on the record and gave 18 contract findings. The
validator and the prototypes found none of them.

- **C12** `caught-in-simulation` · boxes `simulate/{contracts,coverage,lifecycles,acceptance,permissions}`
  - Status: DONE in the record
  - What: Each check box gave only `findings`, but the next box needs `scenarios`. `permissions` needed `epicDir`, and `report` needed `findings`, but `permissions` gave only `matrix`.
  - Fix: Each check box passes on `{scenarios, findings}`. `permissions` gives `{findings, matrix}`.
- **C13** `caught-in-simulation` · box `validate/schema`
  - Status: DONE in the record
  - What: `refs` needs `docs`, but `schema` gave only `findings`.
  - Fix: `schema` outputs `{docs, findings}`.
- **C14** `caught-in-simulation` · edges into `draft-record`, `simulate/load`, `gate/traced` and `review/*`
  - Status: DONE in T5 (thread thr_u4qmrgqjri)
  - What: `epicDir` was lost on 8 root edges, for example `valid → draft-record` and `content-changed → review/swimlanes`.
  - Why: Every box works on one EPIC folder. To repeat `epicDir` in every contract adds noise and hides the real data.
  - Fix (T5): Flow-level `context: { epicDir: string }`. Every box has the context fields as inputs without declaring them.
- **C15** `caught-in-simulation` · boxes `review/{playback,matrix}`
  - Status: DONE in the record
  - What: `playback` needed `scenarioId` and `step`, which `swimlanes` does not give. `matrix` needed `report`, which `playback` does not give, and the `content-changed` path has no report at all.
  - Fix: `playback` is an `input` box (the builder's click). `matrix` loads the report from `epicDir`. `review` takes `report` as optional.
- **C16** `caught-in-simulation` · box `draft-record`, permission matrix
  - Status: DONE in the record
  - What: The agent lane wrote `Story.*`, which includes `Story.status` and `Story.signedHash`.
  - Why: Only the builder (sign-off) and rehearse (stale) may change those.
  - Fix: `draft-record` lists the story fields that the agent drafts.

## 2026-11-05 — found while building wave 1 (T1, T2, T4)

These came from agents who built the code, not from a rehearse check.

- **C17** `caught-after-build` · R6
  - Status: DONE in T5
  - What: No check compares the `by` role of a lifecycle transition with the lane of the box that makes it. In the shop fixture, `pay` is in lane `shop`, but its transition says `by: buyer`.
  - Fix: R6 adds the check. T5 builds it.
- **C18** `caught-after-build` · R1, box `new-epic`
  - Status: DONE in the record
  - What: R1 said "empty, valid record files", but the schemas need one lane, one root box and a goal.
  - Fix: R1 says "the smallest valid record".
- **C19** `caught-after-build` · S1-A1
  - Status: DONE in the record
  - What: S1-A1 listed `scenarios/`, but git does not keep an empty folder.
  - Fix: S1-A1 says the folder is empty and validate accepts a missing `scenarios/`.
- **C20** `caught-after-build` · box `new-epic`
  - Status: DONE in the record
  - What: The box had no rule for an empty title.
  - Fix: A note: a missing or empty title is a usage error (exit 2), not an error exit.
- **C21** `caught-after-build` · S1-A1, S2-A1, S3-A1
  - Status: DONE in the record
  - What: The criteria said `bb rehearse`, but the binary is `rehearse`.
  - Fix: The criteria say `rehearse`. The `bb rehearse` form comes with the bb plugin (D26).
- **C22** `caught-after-build` · entity `Finding`
  - Status: DONE in T5
  - What: Gate findings had no kind. T4 used `coverage` and `lifecycle`.
  - Fix: Add `gate` to Finding.kind. All gate findings use it.
- **C23** `caught-after-build` · entity `SignOff`
  - Status: DONE in the record
  - What: The schema has `hashRule` (C11), but the entity did not.
  - Fix: Added `hashRule: number?`.
- **C24** `caught-after-build` · R11, box `review/readiness`
  - Status: DONE in the record
  - What: R11 did not say whether start, end and decision boxes count as "no requirement".
  - Fix: R11 says they are not in that list.

After T5: `rehearse simulate` gives no findings on this record. `rehearse gate check` gives 10 `gate` findings: S1, S2, S3 and S8 are stale, and the other 6 stories were signed under hash rule 1. The builder must sign off again in the UI (wave 2).

## 2026-11-05 — found while building wave 2 (T6, T7, T8)

These came from agents who built the code, not from a rehearse check.

- **C25** `caught-after-build` · D41
  - Status: DONE in the record
  - What: D41 said validate verifies signatures. Validate checks the record only; the gate verifies signatures (T6).
  - Fix: D41 says the gate (and so CI) verifies them.
- **C26** `caught-after-build` · D31, R12
  - Status: DONE in the record
  - What: D31 did not say how the bb panel reaches serve for a remote viewer. Also, serve takes one EPIC, so the plugin runs one serve process per repo and EPIC, not one per repo as the T8 brief said.
  - Fix: D31 says the panel uses the bb connect address. R12 already says "serves one UI" and needs no change.
- **C27** `caught-after-build` · R13, box `approve`, box `sign-off`
  - Status: OPEN
  - What: The server checks Origin against Host. That does not stop DNS rebinding, and a proxy such as `bb connect expose` may rewrite Host, so every POST could get 403 there.
  - Why: The session token is the real guard. The Origin check must not block the remote path.
  - Fix: Test approve and sign-off through `bb connect expose` before the first remote sign-off. Change the check if it blocks.
- **C28** `caught-after-build` · R11, box `review/readiness`
  - Status: DONE in T9 (thread thr_sgk9fwxd5q)
  - What: Readiness counts a requirement as proven when its scenarios are approved, even if the approvals are unsigned. The gate fails on the same record.
  - Fix: Readiness uses only approvals with `sigStatus: valid`. R11 and `review/readiness` say so.
- **C29** `caught-after-build` · box `approve`, D41
  - Status: DONE in T9
  - What: The UI links to `docs/signing.md` when signing is off, but `rehearse serve` does not serve `docs/`, so the link is dead.
  - Fix: The UI shows the guide path as text with the short steps. Serve does not serve `docs/`: a static route would widen its surface (R20).

- **C30** `caught-after-build` · S6, box `approve`, box `review/playback`
  - Status: DONE in T9
  - What: The owner opened the approve view and saw only scenario titles. They could not tell what they approved.
  - Why: S6 says what approval writes, but not what the approver must see first. An approval without review is not evidence either.
  - Fix (owner's choice): a storyboard card for each scenario (story, criterion, path map, step panels, result) and a review queue by story. Approve is active only after every step was seen. The seen state stays in the browser: it is a review aid, not evidence. The `approve` box has a note.

- **C31** `caught-after-build` · S4, S7, boxes `review/*`
  - Status: DONE in T10 (thread thr_ye6qgp44kp)
  - What: With the storyboard cards, the owner still could not see what the EPIC does as a whole, what each story is about, or who may change what. The permission matrix was hard to read.
  - Why: The review showed the parts (boxes, scenarios, matrix cells) but not the whole system, the features in it, and what they share.
  - Fix: D42. New criteria S4-A4 (big picture) and S4-A5 (story view). S7-A1 is a use case diagram.
  - Also: the first draft of S4-story-view listed `approve` as a box of S9. `approve` serves S6 only; T10 found it. The draft now lists `content-changed, gate, sign-off`.

Count so far: 16 `caught-in-simulation` (C1–C16), 15 `caught-after-build` (C17–C31).

After wave 2 (T6, T7, T8): `rehearse gate check` gives 38 `gate` findings: 28 approvals have no signature (D41), 6 stories are stale (S1, S2, S3, S6, S8, S9) and the other 4 were signed under hash rule 1. The builder sets up signing, approves the scenarios again and signs off in the UI.

## 2026-11-05 — found while building wave 3 and 4 (T11–T18), applied in T19 (thread thr_95qcghseih)

These came from agents who built the code, not from a rehearse check. T19 changed
the record to agree with the code. Approved scenarios changed: S4-drill and S6-approve.
The owner must approve them again.

- **C32** `caught-after-build` · D28, `docs/system/`, architecture.yaml
  - Status: DONE in T19
  - What: The record had no rule for the system as built. T16 (thread thr_wkf7hpaqit) built `docs/system/architecture.yaml` and an EPIC `architecture.yaml` that holds only the change, but no decision said so.
  - Why: Each change must be reviewed per EPIC and per story, and earlier sign-offs must not go stale.
  - Fix: New D43. D28 lists the optional `architecture.yaml`.
- **C33** `caught-after-build` · D19, R20, `rehearse serve`
  - Status: DONE in T19
  - What: T11 (thread thr_dg9fv2gqmc) built the code of a box from `Flow-Box:` trailers and added the routes `GET /api/code-index` and `GET /api/box-code`. The record had no rule for which box gets which code, and no list of these routes. T12 and T13 added the story-thread and Birdview routes, also not in the record.
  - Why: A route that the record does not list has no review. The rules decide what the code view shows for each box.
  - Fix: New D44 (only `Flow-Box:` trailers give code; a parent includes its children; decision, start and end boxes never have code) and D45 (every route; each one needs the session token and the same-origin check).
- **C34** `caught-after-build` · S4-A5, scenario S4-story-view
  - Status: DONE in T19
  - What: T12 (thread thr_sz8f4bedm4) added the `Thread: thr_…` commit trailer and a third, collapsible column in the story view: the story thread, opened and closed with the `]` key. The record had neither.
  - Fix: D44 names the `Thread:` trailer. S4-A5 and the draft S4-story-view show the third column and the `]` key.
- **C35** `caught-after-build` · S4, box `review/swimlanes`, scenarios S4-drill, S4-big-picture, S4-story-view
  - Status: DONE in T19
  - What: T13 (thread thr_vw2ctd5h85) found that all S4 steps used one box, `review/swimlanes`, so the S4 steps had no contract of their own. S4 had no criterion for the Tests tab. The S4-drill example drilled into `simulate`, but the e2e test uses the shop fixture and drills into `ship`.
  - Why: A box contract is the unit of review and test (D10, D19). One box for four different steps hides what each step needs and gives.
  - Fix: New leaf boxes `review/drill`, `review/big-picture`, `review/story-view` and `review/story-tests`, after `review/swimlanes`. `review/swimlanes` stays a leaf, because S5, S6, S7 and S9 use it as a step. New criterion S4-A6 and draft scenario S4-story-tests. S4-drill drills into `ship` on the shop fixture (approval changes).
- **C36** `caught-after-build` · role `ci`, box `ci-run`, entities.yaml, flow.yaml, S6
  - Status: DONE in T19
  - What: T14 (thread thr_ds5z4swsr3) found these gaps. Role `ci` had kind `system`, but CI is outside rehearse. `ci-run` did not declare what it reads and writes, so the permission matrix did not show CI. No entity named its record file, and no box named the package that builds it. The flow did not show two decisions that the UI makes: "signing key?" (C29) and "more scenarios?".
  - Fix: Role `ci` has kind `external`. `ci-run` reads the record and writes nothing. Each entity has `file`. Each box has `package`. New decision `signing-key` (with end box `no-key`) between `happy` and `approve`, and new decision `more-scenarios` after `approve`. New criteria S6-A4 and S6-A5, and draft scenarios S6-no-key and S6-more. S6-approve goes through both decisions (approval changes).
- **C37** `caught-after-build` · flow.yaml, corrections.md
  - Status: DONE in T19
  - What: T15 (thread thr_rzuwi7u79q) found that a box could not name the decisions behind it, and that the status of a correction was at the end of the head line in some entries and missing in others.
  - Fix: An optional box field `decisions: [D…]`; validate reports an id that no `brainstorm.md` has. Each entry here has a `- Status:` line as the first line under its head. The core schema, the loader, validate and the Tech spec page use both.
- **C38** `caught-after-build` · tech spec, `docs/system/architecture.yaml`, page 11
  - Status: DONE in T19
  - What: T16 (thread thr_wkf7hpaqit) found that the tech spec did not list `EpicRecord.architecture`, `EpicRecord.system`, `EpicRecord.decisions` or `RECORD_FILES.architecture`. The CI zone of `docs/system/architecture.yaml` drew CI as built, but the repo has no `.github/workflows`. Page 11's "same" count included CI.
  - Fix: New D46. The CI zone and its parts have `planned: true`. Page 11 leaves planned parts out of its count and says so. The CLI part already lists `serve` ("new · validate · simulate · gate check · serve"), so it did not change.
- **C39** `caught-after-build` · S6, boxes `review`, `happy`, `gate`, `gate-ok`
  - Status: DONE in T19
  - What: T18 (thread thr_ka4kzwxgib) found that the S6 HOW showed 2 boxes (`approve`, `content-changed`), but the design draws 6: Review in panel, Design correct?, Approve scenarios, Gate check, Gate passes? and Detect changed signed content.
  - Why: The story view finds the boxes of a story by the box `stories` field. Four boxes that serve S6 did not name it.
  - Fix: `review` (the builder reviews each scenario before approval, C30), `happy` (its approve branch starts the approval), `gate` (it counts only signed approvals, R13) and `gate-ok` (S6-approve goes through it) name S6. The new decisions `signing-key` and `more-scenarios` also name S6. `content-changed` and `approve` already did.

- **C40** `caught-after-build` · D17, R14, S9-A1, box `gate`
  - Status: DONE in T27
  - What: The parent thread (thr_zpd73mnmgy), in the owner's review of the code-graph gate, found that `rehearse gate check` said "gate: OK, no findings" on `docs/epics/2026-11-05-code-graph` with 29 signed approvals and no `signoff.yaml`. The gate checked traced, sim-clean, no-stale and the signatures, but a story with no sign-off at all was not a finding.
  - Why: D17 says the owner signs off explicitly and the sign-off is a recorded event. A gate that passes with no sign-off lets an EPIC through that nobody signed off.
  - Fix: A new gate check `signed-off`: each story in prd.yaml needs a sign-off in `signoff.yaml`. A story with none gives the finding "S… is not signed off; the owner signs it off in the UI". A stale sign-off, an old hash rule and a sign-off without a valid signature stay no-stale findings. A new sign-off of the story clears the finding, so it does not block that sign-off. No scenario, prd.yaml, signoff.yaml or approval changed.

- **C41** `caught-after-build` · R9, R10, S4-A1, S4-A2, S5-A1, scenario S4-drill, boxes `review/swimlanes`, `review/drill`, `review/playback`
  - Status: DONE in T37, T38
  - What: The owner found the Flow tab confusing: the Big picture already did its job, but links still went there. The storyboard showed steps as boxes to the right, which was hard to follow.
  - Why: R9, R10, S4 and S5 described a single panel that holds the flow, the drill-down and playback. The UI no longer has that panel.
  - Fix (owner's choice): The Flow tab is gone. A box link opens a drawer over the current page (`?box=<path>`); a box with children shows its steps there, with a breadcrumb of its parent boxes and Back. Old `#/flow/…` links open the Big picture with the drawer. Playback lives on the scenario storyboard, now a flowchart in role lanes with a step detail panel (Prev, Next, Play, arrow keys). R9, R10, S4-A1, S4-A2, S5-A1, S4-drill (the breadcrumb has no "root"), the `review/*` box titles and outputs, and brainstorm.md say so. Design page 3 (`3-scenario-storyboard.png`) still shows step panels left to right; the built storyboard is the reference until it is redrawn. A step has no link of its own yet.

- **C42** `caught-after-build` · S9, box `sign-off`
  - Status: DONE in T39
  - What: The owner did not know what a sign-off agrees to. The confirm step listed only story IDs.
  - Why: D17 makes the sign-off the owner's explicit agreement, but the owner could not see what they agreed to or what changed since the last sign-off.
  - Fix (owner's choice, "content + changes"): The confirm step says what a sign-off means and shows, per story, the content its hash covers and what changed since that story's last sign-off (read from the commit that added the sign-off; if git cannot be read it says so and never blocks). The button reads "I agree — sign off …". The story page links to the same preview. New criterion S9-A4, new draft scenario S9-preview, a note on the `sign-off` box. What a sign-off writes, the hash rules and the gate did not change.

Count so far: 16 `caught-in-simulation` (C1–C16), 26 `caught-after-build` (C17–C42).

After T19: `rehearse validate` gives no findings. `rehearse simulate` gives 13 findings: the new branches of `happy`, `signing-key` and `more-scenarios` and the criteria S4-A2, S4-A4, S4-A5, S4-A6, S6-A1, S6-A4, S6-A5 and S7-A1 have no approved scenario, and S4-drill, S6-approve and S7-matrix are stale. The builder approves S4-drill, S6-approve and the new drafts in the UI.
