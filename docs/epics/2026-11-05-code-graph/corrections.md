# Corrections — 2026-11-05-code-graph

Each entry has a tag: `caught-in-simulation` or `caught-after-build`. (D7, D34)
Each entry has its status in a fixed place: the first line under the head, `- Status:`
with `OPEN`, or `DONE` and where it was done. (C37)

## 2026-11-06 — first `rehearse validate` run on the draft record (T20)

- **C1** `caught-in-simulation` · entity `IndexRun`
  - Status: DONE in the record
  - What: The `when` text of the transition running → written had an unquoted comma in a YAML flow mapping. YAML split it into a second, unknown key (`edges and file hashes`).
  - Why: Same error as C6 of v1. A flow mapping ends a value at a comma.
  - Fix: Quoted the `when` text.
- **C2** `caught-in-simulation` · criterion `S8-A1`
  - Status: DONE in the record
  - What: The `given` text holds `Flow-Box: checkout/pay`. YAML read the colon as a nested mapping, and the file did not parse.
  - Why: A colon and a space start a mapping in a plain YAML scalar.
  - Fix: Single-quoted the whole `given` text.

## 2026-11-06 — simulate on the draft scenarios (T20)

`rehearse simulate` checks contracts only on approved scenarios, and an agent must not
approve. So the simulate engine (`simulateRecord` of @rehearse/core) also ran on an
in-memory copy of the record in which each draft counts as approved. No file was written
and no approval was made. That run gave 1 finding.

- **C3** `caught-in-simulation` · scenario `S6-scope`, boxes `update-graph/scope` → `update-graph/hash-files`
  - Status: DONE in the record
  - What: The example `scope-monorepo` gave `files` as a sentence. `update-graph/hash-files` needs `list string`.
  - Why: An example is test data for the box contract (D10). Prose in place of a value hides the contract.
  - Fix: `files` is now a list of two paths, one from each tsconfig.

## 2026-11-06 — validate and simulate after the owner's answers G20–G31 (T21)

`rehearse validate` gave no findings. The simulate engine ran again on an in-memory copy
in which each draft counts as approved (29 scenarios, the 3 new ones included). No file was
written and no approval was made. That run gave no findings, so this run adds no entry.

## 2026-11-06 — the record after the build (T28–T34, applied by T35)

The build threads T28–T34 proposed these corrections in their reports. The owner chose to
apply all of them. T35 checked each one against the code on main before writing it. The
edited scenarios and the stories they serve are stale until the builder approves and signs
off again; no approval and no sign-off was made.

- **C4** `caught-after-build` · architecture, entity `GraphNode` (T28)
  - Status: DONE in the record (docs/system/architecture.yaml, architecture.yaml, entities.yaml)
  - What: The as-is system had no `graph` component though packages/graph is built. `GraphNode.route` (method and full path of a route node) was built but not listed.
  - Why: D43: docs/system/ says what is built. An http-calls edge needs a route as its target.
  - Fix: docs/system/architecture.yaml has the `graph` component (`code: [packages/graph/src]`) and its links cli → graph, serve → graph and graph → repo. The EPIC's architecture.yaml now marks those as `changed`, not `added` (validate requires it). graph-db and graph-bench stay `added` in the EPIC. entities.yaml lists `GraphNode.route`. Checked with no change: the record already says `defines` (not "contains"), QueryAnswer already lists `bundle`, and the `exact` trust of the S2 and S3 examples is now true with the T29 resolvers.
- **C5** `caught-after-build` · scenario `S6-python-venv`, criteria `S6-A3`, `S6-A4`, boxes `update-graph/bulk-index`, `update-graph/warm-update` (T29)
  - Status: DONE in the record (prd.yaml R12, S6-A3, S6-A4; flow.yaml; S6.yaml)
  - What: S6-A3's example listed basedpyright on a cold index, but S6-A4 lists `[tree-sitter, ts-morph, scip-python]`. "No LSP request per call site" read as if it held for updates too. Nothing said that an update and a cold index give the same edges apart from `source`.
  - Why: basedpyright runs on updates only. An update sends one definition request for each reference site in the changed files and in the files that may point into them. The same edge comes from scip-python on a cold index and from basedpyright on an update.
  - Fix: S6-python-venv's resolvers are `[tree-sitter, scip-python]`; S6-A3 and S6-A4 say the cold-only scope; R12 and warm-update name the definition requests; warm-update says that its edges equal a cold index apart from `source`.
- **C6** `caught-after-build` · box `update-graph/link`, requirement `R11`, `R15`, scenarios `S2-near`, `S8-tests` (T30)
  - Status: DONE in the record (prd.yaml R11, R15; brainstorm.md G13; flow.yaml; entities.yaml; S2.yaml; S8.yaml)
  - What: A new commit or a record edit changes no source file, so the query would skip the update. D44 (a parent box includes its children's commits) is not in the graph. The S2 and S8 examples drew `tests` edges from the test file.
  - Why: Linkers declare themselves stale and keep their state in graph.db. A `builds` edge starts at the box the Flow-Box trailer names. A `tests` edge starts at the test node.
  - Fix: update-graph/link and hash-files say so; R11, R15 and G13 say so; S2-near and S8-tests start their `tests` edges at the test nodes (`orders > reads one order by its id`, `test_get_order_by_id`). Checked with no change: the edge kinds `http-calls`, `tests`, `builds`, `changes`, `references` and the node kinds `commit`, `box`, `requirement`, `story`, `scenario` were already in entities.yaml.
- **C7** `caught-after-build` · requirement `R3`, decision `G6`, scenario `S4-context-budget`, entity `ContextBundle` (T31)
  - Status: DONE in the record (prd.yaml R3; brainstorm.md G6; entities.yaml; flow.yaml; S4.yaml)
  - What: G6 and R3 set no default budget, and did not say what the tokens count. S4-context-budget named its fourth item `orders.test.ts` with 1,990 tokens. ContextItem's `role` and `distance` were not in entities.yaml.
  - Why: The built default is 2,000 tokens, and tokens count the code of the items, not the JSON or text around it. On the fixture the fourth item is the test node "orders > reads one order by its id, with the total of its lines in cents" in src/orders.test.ts, and the bundle has 1,988 tokens (context.test.ts).
  - Fix: R3, G6 and ContextBundle say both; the new entity ContextItem has node, role, distance, code and tokens; S4-context-budget has the test node and 1,988 tokens. Not applied as proposed: the item's role is `caller`, not `test`. The test node has a calls edge and a tests edge to getOrderById, the calls edge is found first, and context.test.ts asserts `caller`. The scenario's comment says so.
- **C8** `caught-after-build` · boxes `drill-code`, `serve-query`, `code-view`, requirements `R16`, `R17`, criterion `S9-A1` (T32)
  - Status: DONE in the record (prd.yaml R16, R17, S9-A1; flow.yaml; entities.yaml)
  - What: The record did not name the AST outline's source, the panel fields of the graph route, its 400 and 404 answers, the Flow-Box files fallback or the "Show all" button. S9-A1 said "the function the box builds", but with blame-based `builds` edges a box usually builds many.
  - Why: The outline is `outlineNode` (at most 300 nodes). Show answers carry `ends` and `outline`. Not found is 404, a bad query 400, and a token or Origin failure 403 before any graph work.
  - Fix: code-view, serve-query and drill-code comments, QueryAnswer's comment, R16, R17 and S9-A1 say so.
- **C9** `caught-after-build` · entity `FileHash`, box `update-graph/hash-files`, requirement `R6` (T34)
  - Status: DONE in the record (entities.yaml; flow.yaml; prd.yaml R6; brainstorm.md G5)
  - What: FileHash had no mtime or size, and the record said each query hashes every file and makes every edge again.
  - Why: FileHash has `mtimeMs` and `size` (store schema 2; an old store is rebuilt). The check skips a file whose mtime and size match; a file whose mtime is within 2 s of its last read is always read again; the hash stays the truth. Blind spot: an edit that keeps the size and leaves the old mtime is not seen until `--rebuild`. An update makes again only the reference edges that can point into what changed; files that come or go, or a workspace change, make every reference edge again.
  - Fix: FileHash lists both fields; hash-files reads them and names the blind spot; warm-update and R6 name the reference-edge rule.
- **C10** `caught-after-build` · requirement `R9`, decision `G11`, criterion `S10-A2`, scenario `S10-warm-bench` (T33, T34)
  - Status: DONE in the record (brainstorm.md G11, G32; prd.yaml R9, S10-A2; flow.yaml bench; S10.yaml)
  - What: The record did not say whether a query's time includes its freshness check, or which run the benchmark checks. The S10-warm-bench numbers (180 ms, 40 ms) were never measured. G11 did not say where the 300 ms update target holds.
  - Why: The bench includes the freshness check in each query and checks the median of its runs. Owner decision G32: the update target holds for the graph open in one process (serve, review page) with all resolvers, and for the CLI with wave 1; a CLI process per update with the exact resolvers takes about 0.4–0.7 s (T34), and that is accepted.
  - Fix: G11, R9 and S10-A2 say so; G32 is new. S10-warm-bench has the medians that `bench --files 1000 --seed 1 --runs 3` measured on 2026-11-06: wave1 update 249 ms, queries up to 37 ms (exact: 228 ms and 40 ms, in its comment). S10-cold-bench (21,000 ms) was not asked for and still passes its target; measured: 1,789 ms (wave1), 10,114 ms (exact).

- **C11** `caught-after-build` · criterion `S9-A1`, box `drill-code`, decisions `D19`, `G20` (T36)
  - Status: DONE in the record (prd.yaml S9-A1; flow.yaml drill-code)
  - What: S9-A1 said only "its call graph". The build first showed it as three lists; the owner asked for a real node graph.
  - Why: A list hides how the code connects. The UI already draws graphs with React Flow and elk.
  - Fix: S9-A1 names what the graph shows (callers, callees, tests and HTTP calls, with edge trust). drill-code says the graph comes from verb `near` (show gives the code and AST), at depth 1 or 2, with the trust styles, the fold at 12 per side, and recentering on click.


## 2026-11-06 — the Code map tab, built in T40, added as a new story

- **C12** `caught-after-build` · new story `S11`, requirement `R19`, boxes `open-map`, `code-map`, `map-level`, edges `asked → map-level` and `asker → code-map` (T40)
  - Status: DONE in the record (prd.yaml R19, S11; flow.yaml; scenarios/S11.yaml)
  - What: T40 built a Code map tab that the record did not have: the whole repo one level at a time (packages, one package, one file), a side panel with the boxes each node serves, find and path, filters, and the graph route's `verb=map|find|path|status`. R17 names only `verb=show|near`.
  - Why: The drill-down shows the code below one box; nothing showed where all the code is. The owner asked that it go in the record as a new story with its own boxes, so that no signed story goes stale.
  - Fix: New requirement R19 and story S11 (S11-A1…A8, with the readability pass: readable zoom on open, faint edges lit on hover, one outside group, folder groups, tests hidden at package level, one node per outside file with its calls). New boxes open-map, code-map and map-level, and new root edges only; no existing box, requirement, story or criterion changed, and R17 is left as signed. scenarios/S11.yaml has nine drafts (S11-A7 has two: not indexed and gone). They wait for the owner's approval and S11 for sign-off.
