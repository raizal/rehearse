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
