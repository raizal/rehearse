# rehearse review UI — design

FigCraft file: `rehearse-review.figcraft`. Each page is also a PNG in this folder.

| Page | What it shows |
|---|---|
| 1 Big picture | Feature map: stories, boxes and roles (D42) |
| 2 Story view | One story: WHAT, HOW, OUTPUT and its scenarios |
| 3 Scenario storyboard | A scenario step by step: the path as a flowchart in role lanes, the step detail, playback and Approve |
| 4 Use cases | Roles and their use cases |
| 5–8 | User flow, data flow, system flowchart, system architecture |
| 9 PRD, 10 Tech spec | The record as documents, linked to stories, boxes and scenarios |
| 11 Before after | System as-is vs to-be (example: the code-graph EPIC, a draft) |
| 12 Story before after | The same compare for one story |
| 13 Story code | Click a box: its code, the before/after diff, and the change in plain words |
| 14 Story tests | The story's e2e tests in the Birdview player |
| 15 Story code thread hidden | The story thread panel, collapsed |

Pages 11–15 are proposals: they are not in the v1 record yet.

## Rebuild

FigCraft must listen on 127.0.0.1:4800.

```sh
cd design/figcraft
python3 build_story.py   # draws all pages and saves rehearse-review.figcraft
python3 export.py        # writes the PNGs
```

`python3 build_design.py 3` redraws page 3 only in `rehearse-review.figcraft`.

`figcraft/epic.json` is a snapshot of `docs/epics/2026-11-05-rehearse` that pages 1–4 use.
