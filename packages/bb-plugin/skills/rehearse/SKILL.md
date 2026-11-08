---
name: rehearse
description: Use the rehearse bb plugin. In the rehearse panel, open an EPIC record. Run the read-only commands through `bb rehearse`: validate, simulate, gate check, new, brief, progress, status. Or work on a signed story that the panel gives to a thread.
---

# rehearse in bb

The plugin shows `rehearse serve` in a bb panel. The panel and a browser tab on
the serve URL show the same UI (R12, D31).

## Commands

```
bb rehearse [open]                             open the panel on the EPIC picker
bb rehearse [open] <slug>                      open the panel on one EPIC under docs/epics/
bb rehearse validate <epic-dir-or-slug> [--json]
bb rehearse simulate <epic-dir-or-slug> [--drafts] [--json]
bb rehearse gate check <epic-dir-or-slug> [--json]
bb rehearse new <slug> --title "<title>"
bb rehearse brief <epic-dir-or-slug> <story> [--scenario <id>]… [--allow-unsigned] [--json]
bb rehearse brief <epic-dir-or-slug> <story> --tests [--scenario <id>]… [--json]
bb rehearse progress <epic-dir-or-slug> <story> [--json]
bb rehearse status <epic-dir-or-slug> [--json] [--not-done]
```

- `validate`, `simulate`, `gate check`, `new`, `brief`, `progress` and `status` run the rehearse CLI in the
  thread's checkout. If the caller's folder is inside the checkout, they run in that folder. Output and
  exit codes are the CLI's: 0 OK, 1 findings, 2 usage error, 3 internal error.

- `simulate --drafts` counts draft and stale scenarios as if approved. Thus a
  contract error in a draft shows before the builder approves it. Its output is
  findings only, never evidence: the gate does not read it.

- `brief` prints the build brief of a signed story: the story, its approved
  scenarios, boxes, decisions, entities and how to work. It refuses an unsigned
  or stale story (exit 1) unless `--allow-unsigned`. With `--tests`, it prints
  the test brief of the approved scenarios of the story that have no e2e test.
  With `--tests` and `--scenario`, it prints the test brief of the named scenarios.
  It refuses a draft or stale scenario (exit 1).

- `progress` prints what rehearse sees of the work on a story. It gives these items:

  - Per box, one of three states. "Built" means `Flow-Box:` commits on every branch, and code that
    the code graph maps to the box. "No code of its own" means a start or end box, or a decision that
    a built neighbour branches on, with the file and line. "Not built" comes with what rehearse looked for.

  - Per approved scenario, the e2e test that rehearse found, if there is one, and its result.

  - The gate findings.

  - The sign-off.

- `status` prints what is not done yet, with one row for each story. The columns are signed,
  built, tests on the real screens, automated tests and done. The last column, "What's missing —
  who acts", tells what is not done and who acts. Stories that are not done come first; `--not-done` shows only those. Exit 0.

  The panel's Status page and the EPIC picker's "Status" button show the same table.

- There is no approve and no sign-off command, and there never will be (R13,
  R14). The builder approves and signs off in the panel. The panel signs with the
  SSH key of the builder (D41). An agent cannot approve.

## Working on a story

A thread started from the panel ("Build with an agent") gets the build brief of
a signed story. A thread started from the story Tests tab gets the test brief.
Both briefs end with the lines below, with each command as it runs in the repo.
The command is `pnpm rehearse …` where the root package.json has a `rehearse` script.
The setup line comes from the lockfile of the repo. Work on the story like this:

- Commit on your thread's branch. Do not merge, push or rebase onto main yourself, and never turn the sandbox off. When done, say so in the thread: the owner merges from rehearse.

- Set up first: `pnpm install --frozen-lockfile && pnpm -r build`. The install needs network access. If the sandbox blocks it, say so in the thread.

- Every commit carries a `Flow-Box: <box path>` trailer for each box it builds: that is how rehearse links code to the plan. Add the `Co-Authored-By` line your own rules ask for.

- Start from the section *Code you start from*; use `rehearse context <box path>` before reading files by hand. Use `rehearse find|show|near` for the rest and `rehearse coverage` for unit test coverage.

- Re-read the plan any time with `rehearse brief <epic> <story>`; see what rehearse sees of your work with `rehearse progress <epic> <story>`.

- Run e2e tests through Birdview with `rehearse play <epic> <story> --test <file:line> --wait`. This command plays one test and waits for it. It exits 0 when the test passed, and 1 when it failed or timed out. Do not try to start Chromium in the sandbox.

- Before you say done: `rehearse validate <epic>`, `rehearse simulate <epic>` and `rehearse gate check <epic>`, the repo's tests, and one e2e test per approved scenario, named after the scenario id.

- Never approve a scenario or sign off a story. No command does it; only the owner, in the rehearse UI.

- Never merge your branch: no command does it. Only the owner merges, with "Merge into <branch>" in the rehearse UI; an agent never calls `POST /api/thread/merge`.

- Never write a design file (`design/*.figcraft`) and never call `POST /api/design/save`: only the owner saves designs, in the rehearse UI. Build the screen from the PNG named in the brief's *Design* section.

- Never pick a story's main path and never call `POST /api/review/main-path`. Only the owner picks it, in the rehearse UI. The owner's choice goes in `docs/epics/<slug>/review.yaml` (`mainPath: {<story id>: <scenario id>}`). This file is not part of the signed record. Approvals, sign-offs, `simulate` and `gate` ignore it. `rehearse validate` checks only its shape and reports an unknown story or scenario in its findings.

  If the file names no main path for a story, rehearse selects one with these rules, in this order.
  First, the scenario with no error edge that the other scenarios follow the furthest. Next, the
  scenario that walks the most of the story's boxes. Last, the first scenario in file order. Every
  other scenario shows as a branch of the main path.

- Ask in the thread before you edit the record (`docs/epics/…`). A change to a story, its scenarios or its boxes makes the owner's approvals and sign-off stale. If the plan is wrong, say so and propose the change. Something found after the build goes in `corrections.md`.

- If the owner asks for a small addition to a signed story, write a small change: `rehearse change new <epic> <story> --title "<one sentence>"`. This command makes `docs/epics/<slug>/changes/C<n>.yaml` with 1 to 3 new criteria and 5 scenarios or fewer. A change only adds items. It does not edit an item of the record, so the old approvals stay valid.

  The scenarios of a change are drafts. Only the owner approves them and signs off the story again. Every tool marks the new items "New in C<n>".

- Report in the thread in plain words: what is done per box, what is not, and the test results. Then stop: the owner merges.


If you design a new screen in FigCraft, name its top frame `[<story id>] <what it shows>` so it links itself.
For a box, use `[<story id>/<box path>]`. If two EPICs have that story id, use `[<epic slug>:<story id>]`.
A links.yaml entry still wins over the frame name. To see which design pages and frames match the
stories without a design, run `rehearse design suggest <epic> [--json]`. This command only reads: the
owner links in the rehearse UI.

## Draft or fix the record

An agent drafts the record files of an EPIC, or fixes them after `rehearse validate` (box
`draft-record`, S2). Do this:

- Run `rehearse validate <epic>`. Each finding names the file, the path in the file and what is wrong.
  A YAML syntax error names the line.

- Edit the file at that path. Then run `rehearse validate <epic>` again, until it says OK.

- Write only `Requirement.*`, the story text, `Box.*`, `Example.*` and a scenario status of `draft`
  (C16). The story text is `role`, `want`, `soThat`, `requirements` and `acceptance`. If the report
  of `validate` has findings, its text gives this list again.

- Do not write `Story.status`, `Story.signedHash` or the approval of a scenario. The owner and
  rehearse write them.

## Write the e2e tests of a story

A thread started from the story Tests tab gets the test brief of the approved scenarios that have
no e2e test yet. The tab has two buttons for this: "Write this test with an agent" and "Write the K
missing tests with an agent". To read the brief again, run
`rehearse brief <epic> <story> --tests [--scenario <id>]…`. More scenarios can come to the same
thread while you work.

- Name each test exactly as its scenario id, in the spec file that the brief names: `test('S1-buy', async ({ page }) => {`.

- Write one `test.step` for each scenario step, with the title `<box path>: …`.

- Write only tests. Do not change app code. Do not change a scenario to fit the app. If the app
  cannot do what a scenario says, stop and say so in the thread.

- Each scenario of the brief tells where its expected results show in the app. It also tells which
  fixture to start from: the test project's `tests/serve.ts` for a UI scenario, `tests/cli.ts` for a CLI scenario.

- Run each test through Birdview with `rehearse play <epic> <story> --test <file:line> --wait`.
  Report the result for each scenario: written, run, passed or failed.

- Commit on the thread's branch and stop: the owner merges.

## Present an EPIC

The present command shows the status of an EPIC to a person who does not read the record
(a supervisor). Run `pnpm rehearse present <epic> [--full] [--out <file.html>] [--pdf <file.pdf>] [--committed-only]`.
You can also use the Present button on the EPIC page of the panel.

By default, the deck is an executive summary of about six slides. The slides tell where we are, what
is done, what is not done and why, how we know, and what is next. `--full` (or Full deck in the
panel) adds every story slide after the summary as an appendix.

The command makes one self-contained HTML deck from the record. The default file is
`presentations/<slug>-<date>-<sha>.html`, and git ignores it. The deck uses plain words, with ids
only in a corner. It is honest about unsigned stories, approvals that wait, missing tests, tests
that fail and gate findings.

`--pdf` prints the deck with the Chromium of Playwright from `e2e/`. If that Chromium cannot start,
open the HTML in a browser and print it (one slide per page). `--committed-only` refuses a deck
while the EPIC folder has uncommitted changes (exit 1). Without this flag, every slide tells about
the uncommitted changes.

The owner's own words go in `docs/epics/<slug>/presentation.yaml`. The keys are `asks`, `next`,
`risks`, `areas: [{title, stories}]` to group what is done, `narration: {<slide key>: text}` and
`hide: [<story id>]`. This file is not part of the signed record. Thus a change to it never makes an
approval or sign-off stale. `rehearse validate` checks only its shape. The command that makes a deck
only reads.

The deck tells what is done and what is not done, and shows the proof. Right after the title, a
recap slide lists the stories in two columns, Done and Not done. One sentence above the columns
gives the count ("6 of 18 stories are done. 9 are in progress. 3 are not started."). Done has one
rule, printed small on the slide: the plan is approved, it is built, its checks pass, and it is
signed off.

Every story slide has these proof rows: E2E, a picture of the last screen, Unit tests, Simulation,
Built and Signed. The picture has a link to the recording. An evidence page before the glossary names
every source.

The E2E row uses the Birdview player if it runs. Else it uses the saved results of Birdview. If this
worktree has no saved results, the deck uses the saved results of the main checkout. If a saved line
moved, the deck matches it by the title of its test. The deck leaves out a result that matches no
test, and counts it.

Add `--with-recordings <dir>` to put the deck and the videos it links in `<dir>` (`<dir>/<deck>-media/`).
In the panel, "HTML + recordings (zip)" does the same. Without this flag, the deck says that the
owner keeps the recording.

The deck counts unit tests from `.rehearse/unit-report.json`, or from `--unit-report <file>`.
`pnpm test:report` writes `.rehearse/unit-report.json` (git ignores it). If the command cannot read
the report, the deck says so. The command still writes the deck, and the exit code is 1.

A unit test counts only for the EPIC of the code next to it. `testPaths:` in `.rehearse/config.yaml`
gives an EPIC the globs of its test files (`packages/graph/**`). An EPIC that is not in this list gets
all tests that no listed EPIC gets. If the report does not show the test files, the ids alone decide.
The Status page tells this.

`--birdview-data <dir>` names the data folder of Birdview. Without this flag, the deck uses
`REHEARSE_BIRDVIEW_DATA`, then the `dataDir` of the plugin. The command only reads the Birdview folder.

## Panel

- Route: `/plugins/<pluginId>/rehearse/<projectId>/<slug>`. Without a slug the
  panel lists `docs/epics/*` of the project's repo (the EPIC picker). The picker
  shows even when the repo has a single EPIC: it does not open it by itself.

- With an EPIC open, a bar above the review page shows its slug in a menu of
  every EPIC. If you pick another EPIC, the panel switches to it and releases the
  serve lease of the old EPIC. "All EPICs…" goes back to the picker.

- The plugin's host worker runs `rehearse serve <slug> --port <free port>` on the
  machine that has the repo, as the user, outside agent sandboxes. So serve can
  reach the user's ssh-agent. When no agent is found, the panel says so.

- One process per repo and EPIC, shared by every open panel. It stops when the
  last panel closes, or when the plugin reloads or is disabled. It also stops
  when no panel renews the lease for 45 s (closed tab or project).

- A browser on another machine sees the panel through bb connect
  (`https://<host>--<port>.<domain>/`).

- The host can have no bb connect machine credential. Then, if the repo is on
  the bb server's machine, the panel uses the relay route of the plugin
  (`/api/v1/plugins/<id>/http/relay`). FigCraft does not open through the relay.
  If no way works, the panel shows the command `bb connect expose <port>`.

## Settings

- `rehearseCommand`: the rehearse command to run. Empty: the repo's
  `node_modules/.bin/rehearse`, then `packages/cli/bin/rehearse.js`, then
  `rehearse` on PATH. A `.js` path runs with node.

- `threadModel`, `threadReasoning`: the model and the `--reasoning-level` value of
  threads that the panel starts on a story. Empty: bb's defaults (bb gets no
  `--model` or `--reasoning-level`).
