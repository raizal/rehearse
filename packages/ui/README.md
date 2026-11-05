# @rehearse/ui

The rehearse review UI (React, React Flow, ELK — D32). `rehearse serve` serves
`dist/` and the JSON API `GET api/epic` on 127.0.0.1 (R12, R20). The same URL
works full screen in a browser and inside the bb panel iframe (D31).

- Flow: one swimlane per role in `flow.yaml` lane order; click a box with
  children to open its nested diagram; the breadcrumb goes back (S4).
- Playback: pick a scenario and step through it; the current leaf box is
  highlighted and its input, output and state change are shown (S5).
- The other tabs (permission matrix, readiness, sign-off) come in wave 2.

`pnpm build` builds `dist/`. `pnpm dev` runs Vite and sends `/api` to a running
`rehearse serve` on port 4700 (set `REHEARSE_API` to change it).
