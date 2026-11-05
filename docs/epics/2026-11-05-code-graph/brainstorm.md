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

## Open

None. Next step: write `prd.yaml` for this EPIC.
