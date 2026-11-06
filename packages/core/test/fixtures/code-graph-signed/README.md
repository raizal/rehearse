# code-graph-signed fixture

A frozen copy of the live code-graph EPIC as the owner approved and signed it off
(main at 06272a3, before T35 applied the build corrections C4–C10). T35 made five live
scenarios and eight live stories stale on purpose; the owner approves and signs them off
again in the UI. The gate dogfood test (test/trust/gate.test.ts) checks this signed copy, so
it keeps proving a signed record passes the gate while the live one waits for the owner.
`docs/system/` and `docs/epics/2026-11-05-rehearse/brainstorm.md` are the versions of that
commit, for the decisions and the as-is the EPIC cites. The signatures are checked against
`.rehearse/allowed_signers` of the checkout, as for the live EPIC.
