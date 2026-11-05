# bb JSON fixtures

- `bb-thread-show.json` and `bb-thread-log.json`: captured once from a real thread
  (`bb thread show --self --json`, `bb thread log --self --json`), then trimmed: a few events of
  each kind, long text cut, the worktree path replaced. No tokens or secrets.
- `bb-error.json`: `bb thread show thr_zzzzzzzzzz --json` (an unknown thread).
- `bb-thread-spawn.json` and `bb-thread-tell.json`: written from the shapes `bb guide json`
  documents (no real thread was spawned or messaged).
