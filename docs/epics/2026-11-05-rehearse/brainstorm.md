# rehearse — brainstorm decisions log

Date: 2026-11-05
Source: grilling session (thread thr_zpd73mnmgy)
Status: no gate. This file is the "why" behind `prd.yaml`.

## Idea

Product development becomes a visual workflow. You simulate each change first.
When the flow is correct, agents build it piece by piece, in parallel.
The chain is: brainstorm → PRD → tech spec → process simulation → features → code.
Each process and each flow has its own evidence. The evidence shows the owner
that the system is ready.

## Blind spots found

1. "Simulation" had no definition. Fixed by D3.
2. Flowcharts show control flow, but most bugs are in data and state. Fixed by D10, D21.
3. Code and AST do not exist before the build. Fixed by D19.
4. Drift between diagram and code. Fixed by D5, D7, D23.
5. Passing tests do not prove that the correct thing was built. Fixed by D11, D17.
6. Happy-path diagrams hide failures, permissions and non-functional requirements. Fixed by D10, D22.
7. The scope is large. Fixed by D30.
8. Frozen records hide the current state of the system. Fixed by D29.
9. One user story touches many boxes. Fixed by D14.

## Decisions

### Audience and form
- **D1 Audience**: A builder who works with AI agents. The evidence makes agent output trustworthy. The tool shows *why* a system is ready, not only a green badge.
- **D2/D6/D12 Relation to Drilldown**: A new project, forked as a clean break. It has its own format. It keeps the Drilldown ideas: nested boxes, `verify` evidence, `Flow-Box:` commit trailers, review marks, needs-fix issues, finalize. The existing Drilldown continues without change. (Drilldown source is not available locally. Only a built bundle exists, so the fork is a rebuild.)
- **D26 Form**: A bb plugin with a visual panel and a CLI (`bb rehearse …`). The core is a separate TypeScript library, so CI can run it.
- **D31 Browser mode**: `rehearse serve` serves one UI. The bb panel and a full-screen browser show the same UI. For remote use: `bb connect expose <port>`. The bb panel uses the same bb connect address for remote viewers (C26).
- **D32 UI technology**: React, React Flow (xyflow), ELK layout.
- **D36 Name**: `rehearse` for the CLI, plugin and package. "Rehearsal" means one scenario run, in text only.

### Simulation model
- **D3 Simulation**: Scenarios that run. Each box declares inputs, outputs and state effects. A scenario follows a path and gives expected outputs. Each scenario becomes a test case. A visual walkthrough is only the display.
- **D10 Box contract**: Each non-start/end box declares typed inputs and outputs (edges carry data shapes), state reads and writes, side effects, error exits (each one is an edge), the user story and the role.
- **D13 Swimlanes**: One lane for each role or external system. Each box is in one lane. A hand-off crosses a lane boundary.
- **D15 Scenario execution**: Given/when/then examples on each box. Agents write drafts. The human approves them. The simulator is plain code with no LLM. It checks that outputs fit inputs, that every branch and error exit is covered, and that end states agree with acceptance criteria. After the build, the same examples become unit tests (box) and e2e tests (story).
- **D21 Entity model**: Entities, fields and lifecycles (for example `Order: draft → paid → shipped`). The simulator rejects transitions that the lifecycle does not permit. It flags lifecycle states that cannot be reached.
- **D22 Non-functional requirements**: Requirements have a kind (`functional`, `performance`, `security`, `permission`, …). Other checks prove non-functional requirements (load test, scan, signed manual review). A permission matrix (role × entity × action) is made from lanes and state access. You review it at the gate.

### Records and lifecycle
- **D4 As-is and to-be**: A change is a to-be diff on top of the as-is flow. A new product has an empty as-is.
- **D5 Source of truth**: The diagram is the contract. The code is the behavior. Tests linked to boxes find drift. There is no codegen and no reverse sync.
- **D7 Freeze**: The flow can change while its PRs are open. Each change to an approved box goes into `corrections.md` with a reason. At merge or finalize, the flow is frozen. A new change needs a new EPIC.
- **D8 Record ↔ PR**: One EPIC record for each feature change. Many sibling or stacked PRs build its parts. Each PR finalizes its own boxes. The record is frozen when the last PR merges.
- **D9/D29 System map**: Finalize merges the to-be flow of each frozen EPIC into `docs/system/`. Nobody edits it by hand. A new EPIC copies its as-is flow from it. A one-time code pull fills gaps in existing code. These boxes have the mark "unverified".
- **D43 System record and EPIC change**: `docs/system/` records the system as built (`architecture.yaml`). An EPIC may add an `architecture.yaml` that holds only its change: added, changed or removed, with `why` and `stories`. The to-be is computed as the as-is plus the change. Frozen stories of finished EPICs stay valid. Reason: each change can be reviewed per EPIC and per story, and earlier sign-offs do not go stale (C32).
- **D46 Record loading**: The loader gives one `EpicRecord`. It holds the record files and, when they apply, `architecture` (the EPIC's `architecture.yaml`, D43), `system` (`docs/system/`, read only when the EPIC has `architecture.yaml`) and `decisions` (the decision ids of every `brainstorm.md` in `docs/epics/`, read when the EPIC has `architecture.yaml` or a box names `decisions`). `RECORD_FILES.architecture` is `architecture.yaml`. A box may name its `package` and its `decisions`; validate reports a decision id that no `brainstorm.md` has. An entity names its record `file`. A part of the system may be `planned: true` (drawn, but no code builds it yet); page 11 leaves planned parts out of its count and says so. Each corrections.md entry has a `- Status:` line (C36, C37, C38).
- **D11 Traceability**: Requirements have IDs (`R1`…). Boxes and scenarios link to requirements. "Ready" means that each requirement has at least one passing scenario test at story (e2e) level. Requirements with no proof and boxes with no requirement are flagged.
- **D20 Stage outputs**: Brainstorm → this decisions log (no gate). PRD/EPIC → requirements, stories, roles, acceptance criteria (gated). Tech spec → flow + contracts + entity model + non-functional requirements. It is not prose.
- **D28 Files**: `docs/epics/<slug>/` contains `brainstorm.md`, `prd.yaml`, `entities.yaml`, `flow.yaml`, `scenarios/`, `wireframes/`, `evidence.json`, `corrections.md`, and an optional `architecture.yaml` (D43). A JSON Schema validates each YAML file.

### Gate, change and trust
- **D17 EPIC gate**: Each requirement has a story. Each story has scenarios. The simulator passes. The contracts on shared boxes are frozen. The UX of each story is reviewed. The owner signs off explicitly. The sign-off is a recorded event (who and when).
- **D23 Change after sign-off**: A changed requirement or story makes all dependent items stale (boxes, contracts, scenarios, test runs, wireframes). Tasks in that area stop. You sign off again for the affected part only.
- **D42 Review layout**: The review goes from big to small. (1) Big picture: every role, the main processes in flow order, and one coloured line per story (feature) through its processes, so shared processes are clear. (2) Per story: WHAT (story and criteria), HOW (a swimlane of only its boxes) and OUTPUT (each data change as before → after, and what the user sees). (3) Per scenario: the storyboard card (C30). The permission matrix is shown as a use case diagram: actors → actions (boxes) → the data each action changes. Reason: the owner learns visually and could not follow titles, a flat flow and a matrix (C31).
- **D41 Signed approvals**: "UI button only" stops the CLI, but not an agent with a shell: it can post to the local server or write the YAML with a correct hash. So every approval and sign-off carries an SSH signature (`ssh-keygen -Y sign`, namespace `rehearse`) over its canonical content. The serve process signs with the builder's git signing key (`user.signingkey`). The gate (and so CI) verifies each signature against `.rehearse/allowed_signers` at the repo root (git's allowed-signers format; the principal is the `by` email). An unsigned or badly signed approval is not evidence. Keep the key in the ssh-agent or behind a passphrase: sandboxed agents cannot reach the ssh-agent socket. Remaining risk: an agent could add its own key to allowed_signers. The gate shows the key fingerprint of each signer, and a change to allowed_signers needs human review.
- **D34 Success measure**: Each correction gets a tag: `caught-in-simulation` or `caught-after-build`. Version 1 succeeds when most design errors are `caught-in-simulation`.

### Build
- **D14 Parallel unit**: One task = one user story (a vertical slice) = one PR. Shared boxes are built against frozen contracts. If two stories change the same box, the tool flags it and puts them in order.
- **D16 Tracker**: The repo is the source of truth. Tasks go one way to Linear with the `linear` CLI (installed at `/opt/homebrew/bin/linear`). PR merges update the record.
- **D24 Agents**: Each story task is a bb child thread in its own worktree (Opus 5.5, medium effort, sandbox never off). The tool generates its brief from the record. The task is done only when its examples pass as tests and its evidence is pinned.
- **D19 Code level**: A leaf box is one function or small module that you can test on its own. Its examples are its unit tests. Design stops at leaves. Below a leaf, the tool shows a read-only code, AST and call-graph view. The tool never designs at AST level.
- **D40 Code graph**: Not graphify (too heavy). rehearse has its own code graph with no LLM, for TypeScript and Python. The D19 view and the D29 code pull use it. It is a separate EPIC: see [`../2026-11-05-code-graph/brainstorm.md`](../2026-11-05-code-graph/brainstorm.md) (G1–G19). That file is the source of truth for storage, queries and readers.

### Code and serve (after the build)
- **D44 Code of a box**: A box gets its code only from `Flow-Box:` commit trailers. A parent box includes the commits of its children. Decision, start and end boxes never have code. A commit may also have a `Thread: thr_…` trailer. It names the bb thread that made the commit, so the story view can show the story thread (C33, C34).
- **D45 Serve routes**: In addition to `GET /api/session`, `GET /api/epic`, `POST /api/approve` and `POST /api/sign-off`, `rehearse serve` has these routes: `GET /api/code-index` and `GET /api/box-code` (the code of a box, D44); `GET` and `HEAD /api/story-thread`, and `POST /api/story-thread/link`, `/api/story-thread/start`, `/api/story-thread/send` and `/api/story-thread/open` (the story thread); `GET /api/birdview` and `POST /api/birdview/action` (the Birdview player; the only action is `playlist-select`). Each of these new routes needs the session token and the same-origin check, like approve and sign-off (R20, C27, C33).

### UX
- **D18 UX simulation**: Each `input`/`output` box in a human lane links to a screen state, as a low-fidelity HTML wireframe. A scenario plays through the screens, and the diagram highlights each box. After the build, the same scenario runs as a Playwright e2e test on the real UI. Screenshots are shown next to the wireframes.
- **D25 FigCraft**: A screen state can link to a `.figcraft` file or a `figcraft://` URL (FigCraft 0.15.1 is installed). Agents do not write `.figcraft` files in version 1. Research of the file format comes later.
- **D27 Test adapter**: Examples are data that does not depend on a language. Version 1 targets one adapter: TypeScript with Vitest and Playwright.
- **D37 Birdview**: Birdview is the e2e player. The adapter writes one spec for each story and one Birdview playlist for each EPIC. Swimlane roles become actors. Each `test.step` title is a box path.
- **D38 One player**: Before the build, the same tests run on the wireframes that `rehearse serve` serves. After the build, they run on the real UI. Wireframes define `data-testid` values as the UI contract. A missing test ID fails the test.

## Version 1 scope (D30, D39)

1. Schemas and validator.
2. Simulator (contracts, coverage, error exits, lifecycles, acceptance criteria).
3. Visual panel (swimlanes, drill-down, scenario playback).
4. Readiness view (requirement → box → scenario → test run).
5. EPIC gate with recorded sign-off.

Rule from day one: scenario steps use box paths as names.

**Later**: wireframe playback; Vitest and Playwright adapter with Birdview (including a live link from the Birdview "NOW" step to the box); Linear sync; child-thread orchestration; code graph, code pull and AST view (D40); FigCraft links; `.figcraft` file format research.

## First EPIC (D33)

The first EPIC is rehearse itself. This file is its brainstorm. The record is complete: `prd.yaml`, `entities.yaml`, `flow.yaml`, `scenarios/`, `corrections.md`. Because the tool does not exist yet, this EPIC gets a manual sign-off tagged `bootstrap`. The real gate runs on it again when v1 works.
