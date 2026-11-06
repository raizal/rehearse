---
name: rehearse
description: Use the rehearse bb plugin. Open an EPIC record in the rehearse panel, or run the read-only rehearse commands (validate, simulate, gate check, new) through `bb rehearse`.
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
```

- `validate`, `simulate`, `gate check` and `new` run the rehearse CLI in the
  thread's checkout (the caller's folder when it is inside it). Output and exit
  codes are the CLI's: 0 OK, 1 findings, 2 usage error, 3 internal error.
- `simulate --drafts` counts draft and stale scenarios as if approved, so a
  contract error in a draft shows before the builder approves it. Its output is
  findings only, never evidence: the gate does not read it.
- There is no approve and no sign-off command, and there never will be (R13,
  R14). The builder approves and signs off in the panel, which signs with their
  SSH key (D41). An agent cannot approve.

## Panel

- Route: `/plugins/<pluginId>/rehearse/<projectId>/<slug>`. Without a slug the
  panel lists `docs/epics/*` of the project's repo (the EPIC picker). The picker
  shows even when the repo has a single EPIC: it does not open it by itself.
- With an EPIC open, a bar above the review page shows its slug in a menu of
  every EPIC. Picking another EPIC switches the panel to it (the old EPIC's
  serve lease is released); "All EPICs…" goes back to the picker.
- The plugin's host worker runs `rehearse serve <slug> --port <free port>` on the
  machine that has the repo, as the user, outside agent sandboxes. So serve can
  reach the user's ssh-agent. When no agent is found, the panel says so.
- One process per repo and EPIC, shared by every open panel. It stops when the
  last panel closes, when panels stop renewing for 45 s (closed tab or project),
  and when the plugin reloads or is disabled.
- A browser on another machine sees the panel through bb connect
  (`https://<host>--<port>.<domain>/`).

## Settings

- `rehearseCommand`: the rehearse command to run. Empty: the repo's
  `node_modules/.bin/rehearse`, then `packages/cli/bin/rehearse.js`, then
  `rehearse` on PATH. A `.js` path runs with node.
