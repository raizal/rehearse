# rehearse code graph — decisions (fixture)

- **G1 Commands**: Five CLI verbs: find, show, near, path, context.
- **G2 Search**: BM25 through SQLite FTS5.
- **G3 Storage**: .rehearse/graph.db is a cache.
- **G4 Nodes and edges**: code, record and commit nodes.
- **G5 Freshness**: Each query first compares file hashes.
- **G6 Context bundle**: rank by distance and PageRank, fill the budget.
- **G7 Access**: CLI first.
- **G8 One graph**: the panel drill-down and the agent queries use the same graph.
- **G10 IDs and trust**: exact, name-match, unresolved.
- **G11 Speed targets**: query < 100 ms.
- **G13 Record links**: Flow-Box commit trailers.
- **G14 Ranking**: PageRank now.
- **G15 Readers**: tree-sitter, ts-morph, Pyright.
