# rehearse code graph — brainstorm decisions log

Date: 2026-11-05
Source: grilling session (threads thr_zpd73mnmgy, thr_5mpepq3ea3). Research: thread thr_6kne5m72ce.
Status: no gate. This is the second EPIC. It comes after rehearse v1. (G9)

## Idea

graphify is a good idea, but it is too heavy: it needs Python, uses LLM steps,
gives name-only call edges, and writes large output. rehearse gets its own
small code graph, as part of the plugin. It covers layer 1 (the graph) and
layer 3 (queries). It uses no LLM to build, update, search or query the graph.
The agent is the LLM. The tool gives deterministic answers to structured commands.

Goals:
1. Agent context: give an agent the right code in a fixed token budget.
2. Human drill-down: below a leaf box, show code, AST and call graph (D19).
3. Hidden links: show links between record, code, tests, commits and services.

Out of scope: layer 2 (LLM summaries, docs extraction, community names).

## Decisions

### Queries (layer 3)
- **G1 Commands**: Five CLI verbs: `find`, `show`, `near`, `path`, `context`. Each verb has `--json` output.
- **G2 Search**: BM25 through SQLite FTS5. Identifiers are split (`getOrderById` → get order by id; `snake_case` too). No embeddings.
- **G6 Context bundle**: `context <target> --budget <tokens>` ranks nodes by graph distance from the target and by PageRank, and fills the budget. Token estimate: characters ÷ 4.
- **G7 Access**: CLI first. An MCP server comes later, over the same core.

### Graph (layer 1)
- **G3 Storage**: `.rehearse/graph.db` with `node:sqlite` (FTS5 works on Node 24). It is a cache: git ignores it, and a full rebuild makes it again.
- **G4 Nodes and edges**: Node kinds: code (file, module, class, function, method, route, test), record (requirement, story, box, scenario), commit. Code edges: defines, imports, calls, references, extends/implements, tests. Links: box → code (`builds`), commit → code. Service edges: `http-calls` (G17).
- **G5 Freshness**: Each query first compares file content hashes and updates only the changed files. `rehearse serve` also watches files.
- **G10 IDs and trust**: SCIP-style symbol IDs. Each edge has a trust mark: `exact` (a resolver confirmed it), `name-match` (same name only), or `unresolved` (the target is not known, for example a third-party package with no venv).
- **G11 Speed targets**: A cold index takes less than 30 s for each 1,000 files. A one-file update takes less than 300 ms. A query takes less than 100 ms.
- **G12 Scope**: The indexer finds every `tsconfig*.json` in the repo. It does not index `node_modules` or the venv; their symbols stay as edge targets only.
- **G13 Record links**: `builds` links (box → code) come from `Flow-Box:` commit trailers plus `git blame` on the changed lines.
- **G14 Ranking**: PageRank now. Clusters (communities) later.

### Languages
- **G16 Python equal to TypeScript**: Each language has a reader adapter. Python and TypeScript have the same features and the same trust model.
- **G15 Readers** (from research, 2026-11-05):
  - **web-tree-sitter** for every language: structure, call sites, the AST view, and `name-match` edges. It updates one file in milliseconds.
  - **TypeScript resolver: ts-morph**, kept warm in the process, behind the resolver interface. Pin TypeScript 6.x until the TS 7.1 API is stable.
  - **Python resolver: the Pyright engine.** A cold index uses **scip-python**; its SCIP output goes into graph.db. Updates of changed files use a warm **basedpyright** language server. Both come from npm, so the host needs no Python.
  - A cold index must use a bulk source (SCIP or ts-morph), not one LSP request per call site.
  - Later: benchmark **pyrefly** as a replacement. Skip **ty** until it is stable.
- **G19 Python environment**: Look for `.venv`, then uv or poetry, then pyright config (`venvPath`/`venv`). With no environment, edges inside the repo stay `exact`, edges into third-party packages become `unresolved`, and nothing fails. `context` output says "no venv found".
- **G17 Links between services**: `http-calls` edges link a TS client call to a Python route.
  - Default: static matching. Tree-sitter reads FastAPI decorators, router prefixes and string-literal URLs in `fetch`/`axios`. It normalizes `{param}` segments and matches method and path. Trust: `name-match`.
  - With an OpenAPI spec: link both sides by `operationId`. Trust: `exact`. To make the spec from FastAPI runs the app code, so it is an opt-in CI step only.
- **G18 Test adapters**: A pytest adapter is planned together with the Vitest adapter (D27), so that `tests` edges exist in both languages.

### Product
- **G8 One graph**: The panel drill-down (D19) and the agent queries use the same graph.
- **G9 Separate EPIC**: The code graph is its own EPIC, after rehearse v1. v1 keeps it in "later".

### Owner answers to the questions of the draft record (T20)

Source of G20–G31: owner accepted T20's proposal, 2026-11-06. Each answer replaces one
question comment of the draft record.

- **G20 Graph serve route**: Serve gets one new route: `GET /api/graph?verb=show|near&target=…`. It needs the session token and the Origin check, like every route of D45. This decision adds the route to the D45 list. Source: owner accepted T20's proposal, 2026-11-06.
- **G21 Success measure**: On the fixture repo, an agent answers a question with `context` in fewer tokens than with grep and cat, and the answer is the same and correct. Source: owner accepted T20's proposal, 2026-11-06.
- **G22 No code pull**: The code pull for the as-is system map (D29) is out of scope for this EPIC. It gets its own EPIC. Source: owner accepted T20's proposal, 2026-11-06.
- **G23 OpenAPI spec**: rehearse reads an OpenAPI spec only when the repo has one. This EPIC adds no CI step that makes the spec (see G17). Source: owner accepted T20's proposal, 2026-11-06.
- **G24 Benchmark fixture**: The benchmark repo has 1,000 files (half TypeScript, half Python). A generator makes it from a fixed seed, so each run uses the same files. The `graph-bench` component stays `planned` until the repo has CI (C38 of v1). Source: owner accepted T20's proposal, 2026-11-06.
- **G25 Test adapters**: Only Vitest and pytest get a test adapter. The adapter makes static `tests` edges (a test → the code it calls). The adapters that run tests (D27) stay in "later". Source: owner accepted T20's proposal, 2026-11-06.
- **G26 `near` depth**: `near` follows one edge in each direction by default. `--depth <n>` follows n edges. Source: owner accepted T20's proposal, 2026-11-06.
- **G27 Unknown target**: When no node matches the target, the verb ends with exit code 1 and the note "not found", the same as a v1 finding. Source: owner accepted T20's proposal, 2026-11-06.
- **G28 No path**: When `path` finds no path between the two nodes, it ends with exit code 1 and the note "no path". Source: owner accepted T20's proposal, 2026-11-06.
- **G29 Rebuild**: Each query verb has a `--rebuild` option. It makes a cold index before the answer. `rehearse new` adds `.rehearse/graph.db*` to `.gitignore`, not all of `.rehearse/` (`allowed_signers` is there, D41). Source: owner accepted T20's proposal, 2026-11-06.
- **G30 Link edge kinds**: The commit → code link has the edge kind `changes`. The record links (story → requirement, box → story, scenario → box) have the edge kind `references`. Source: owner accepted T20's proposal, 2026-11-06.
- **G31 Trust zone**: The `graph` component is in zone `repo`. This is not a trust-zone problem: the graph does no signing and no approval, and it only reads the repo and writes its cache. Source: owner accepted T20's proposal, 2026-11-06.

## Open

None. The draft record has no open question.
