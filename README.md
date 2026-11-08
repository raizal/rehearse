# rehearse

Simulate a product change before you build it.

rehearse is a tool for a builder who works with AI agents. You write the plan of a change as files
in your repo: the stories, the flow and the scenarios. rehearse simulates the scenarios on the flow
and finds design errors before any code exists. You approve each scenario and sign off each story
with your SSH key. Then agents build the boxes of the flow, and rehearse shows the proof that each
story is done.

rehearse runs as a CLI, as a web UI on your machine, and as a panel in bb.

## The main ideas

- **EPIC**: one planned change. Its record is a folder: `docs/epics/<slug>/`.
- **Story**: what a role wants, and why. Each story has acceptance criteria.
- **Flow**: the boxes of the process, in lanes (who acts), with edges between them. Each box has a
  contract: its inputs, outputs, reads, writes and error exits.
- **Scenario**: one path through the flow, with example data. The simulation walks each scenario
  step by step and checks the contracts.
- **Approval and sign-off**: the owner approves scenarios and signs off stories in the UI. Each
  approval and sign-off has an SSH signature. An agent cannot approve.
- **Stale**: if signed text changes, its approval is stale. The owner must approve it again.
- **Gate**: `rehearse gate check` passes only when every story is traced, simulated without
  errors, not stale and signed off.
- **Done**: a story is done when it is signed off, not stale and built, and its main path test
  passed on the real screens (in the Birdview player).

## Requirements

- Node.js 24 or later, and pnpm 11 (`corepack enable`).
- git, and an SSH key that git uses as its signing key (for approvals and sign-offs).
- Optional: the bb app (the panel), the Birdview E2E player (real-screen
  tests) and FigCraft (the Design tab).

## Set up

```sh
pnpm install
pnpm build
pnpm rehearse --help
```

To sign approvals, set your git signing key, and add your key to `.rehearse/allowed_signers`. Read
[docs/signing.md](docs/signing.md).

## Quick start

1. Make a new EPIC:

   ```sh
   pnpm rehearse new 2026-12-01-checkout-coupons --title "Coupons at checkout"
   ```

2. Write or draft the record files in `docs/epics/2026-12-01-checkout-coupons/`: `prd.yaml` (the
   requirements and stories), `flow.yaml` (the boxes and edges), `entities.yaml` (the data) and
   `scenarios/S<n>.yaml`. An agent can draft them.
3. Check the record:

   ```sh
   pnpm rehearse validate 2026-12-01-checkout-coupons
   pnpm rehearse simulate 2026-12-01-checkout-coupons --drafts
   ```

4. Open the review UI, and approve the scenarios and sign off the stories there:

   ```sh
   pnpm rehearse serve 2026-12-01-checkout-coupons
   ```

   The UI is on `http://127.0.0.1:4700`.
5. Check the gate:

   ```sh
   pnpm rehearse gate check 2026-12-01-checkout-coupons
   ```

6. Give a signed story to an agent: `pnpm rehearse brief <epic> <story>` prints its build brief.
   In bb, the Build button on the story page starts a thread with this brief.
7. Follow the work:

   ```sh
   pnpm rehearse status 2026-12-01-checkout-coupons
   pnpm rehearse progress 2026-12-01-checkout-coupons S1
   ```

## The review UI

`rehearse serve` shows these pages:

- **EPIC picker**: all EPICs of the repo.
- **Big picture**: the flow as swimlanes. Click a box to see its contract and its parts.
- **Story page**: the criteria, the story map (the main path and the branches of each scenario), the
  progress, the tests and the design.
- **Storyboard**: play a scenario step by step, then approve it.
- **Sign off**: read what you sign, then sign off the story.
- **Status**: one row for each story: signed, built, tested on the real screens, done, and what is
  missing and who acts.
- **Present**: the EPIC as a short deck for a supervisor (`rehearse present` writes it as one HTML
  file).

The server listens on 127.0.0.1 only. Each write needs a session token and a same-origin request.

## The bb panel

The `packages/bb-plugin` package shows the review UI in a bb panel. The plugin starts
`rehearse serve` on the machine that has the repo, so the server can use your ssh-agent to sign.
Commands:

```sh
bb rehearse open <slug>
bb rehearse validate <slug>
bb rehearse simulate <slug> --drafts
bb rehearse gate check <slug>
bb rehearse new <slug> --title "<title>"
```

There is no approve or sign-off command. The owner approves and signs off in the panel. A phone
can open the panel through bb connect.

## Tests on the real screens

The e2e tests are in `e2e/tests/<story>.spec.ts`. Each test is named after a scenario, and each
`test.step` is a step of that scenario. They run in the Birdview player, which shows each browser
window on one screen.

```sh
pnpm rehearse e2e-start <epic> <story> --main-path       # write a start file for the main path test
pnpm rehearse play <epic> <story> --wait                 # play the story's tests in Birdview
```

Birdview saves the results for each test project folder. Only the results of the main checkout
count on the Status page.

## The code graph

`packages/graph` indexes the TypeScript and Python code of the repo into `.rehearse/graph.db`. It
does not use an LLM. rehearse uses it to find the code of each box. You can also query it:

```sh
pnpm rehearse find "sign off"
pnpm rehearse show <target>
pnpm rehearse path <from> <to>
pnpm rehearse coverage "box <path>"
```

## Repo layout

| Folder | What it contains |
| --- | --- |
| `packages/core` | The record types, the loader, validate, simulate, the gate, the trust rules and the status rules. It has no bb dependency. |
| `packages/cli` | The `rehearse` command. A thin wrapper over core. |
| `packages/server` | The HTTP server of the review UI, with signed approvals and sign-offs. |
| `packages/ui` | The review UI (React). `rehearse serve` serves its `dist/`. |
| `packages/graph` | The code graph. |
| `packages/bb-plugin` | The bb panel, and the `rehearse` skill for agents. |
| `e2e` | The Playwright tests that run in Birdview. |
| `docs/epics` | The EPIC records. rehearse plans itself: `2026-11-05-rehearse` and `2026-11-05-code-graph`. |
| `docs/system` | The architecture of the system. |
| `examples/ci` | An example CI job that runs the gate. |

## Development

```sh
pnpm build
pnpm typecheck
pnpm test               # the unit tests of all packages
pnpm test:report        # the unit tests, with a report for the Status page
pnpm coverage
```

Rules for agents in this repo are in [AGENTS.md](AGENTS.md). All new text uses ASD-STE100
Simplified Technical English. Commits that build a box name it with a `Flow-Box: <box path>`
trailer.

## Exit codes

All commands use the same exit codes: 0 OK, 1 findings, 2 usage error, 3 internal error.
