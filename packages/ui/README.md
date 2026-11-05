# @rehearse/ui

The rehearse review UI (React, React Flow, ELK — D32). `rehearse serve` serves
`dist/` and the JSON API on 127.0.0.1 (R12, R20). The same URL
works full screen in a browser and inside the bb panel iframe (D31).

- Flow: one swimlane per role in `flow.yaml` lane order; click a box with
  children to open its nested diagram; the breadcrumb goes back (S4).
- Playback: pick a scenario and step through it; the current leaf box is
  highlighted and its input, output and state change are shown (S5).
- Approve (S6): draft, stale and badly signed scenarios get an Approve button
  and a checkbox; "Approve selected" approves the checked ones. The bar shows
  who signs (session identity and key fingerprint). When signing is off, the
  buttons are disabled and the reason links to `docs/signing.md` (D41).
- Permission matrix (S7): roles × entities with the actions in each cell; each
  box link opens the box in the flow view.
- Readiness (S8): requirement → stories → boxes → scenarios → status, the
  requirements with no proof, the boxes with no requirement, the correction
  counts, and the gate findings by story.
- Sign-off (S9): gate findings and a checkbox per story. Sign off works only
  when no finding is about the selected stories; one confirmation step lists
  the stories and the identity. A 409 from the server lists its findings.

The write side uses `GET api/session` (token, identity, signing) and
`POST api/approve` / `POST api/sign-off` with the `X-Rehearse-Token` header.
After each successful POST the UI loads `GET api/epic` again.

`pnpm build` builds `dist/`. `pnpm dev` runs Vite and sends `/api` to a running
`rehearse serve` on port 4700 (set `REHEARSE_API` to change it).
