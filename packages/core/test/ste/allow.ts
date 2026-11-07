// The STE allow list (T60): old findings in the product text that the rewrite cannot fix. Each entry
// names the file, the rule, the text of the finding, a phrase of the source text and the reason.
// An entry allows the finding only in a text that has the phrase. Keep this list short.

import type { SteRule } from '../../src/present/plain.js';

export interface SteAllow {
  file: string;
  rule: SteRule;
  /** The `text` of the finding. */
  text: string;
  /** A phrase of the source text. The entry allows the finding only in a text with this phrase. */
  in: string;
  reason: string;
}

const PLAYER_OFF = 'Signed plan text: the S12 message "Birdview is not running; open it from the bb sidebar." (S12-A4, prd.yaml S12).';
const SEND_LABEL = 'Signed plan text: the S13 button label "Send these scenarios to the running thread" (prd.yaml S13, S13.yaml send-label).';

const HOW_TO_WORK_S15 = 'Signed plan text: "use `rehearse context <box path>` before reading files by hand" (S15.yaml how-to-work, prd.yaml S15).';

export const STE_ALLOW: readonly SteAllow[] = [
  { file: 'packages/server/src/birdview-play.ts', rule: 'ing-form', text: 'running', in: 'Birdview is not running; open it from the bb sidebar.', reason: PLAYER_OFF },
  { file: 'packages/ui/src/model/tests.ts', rule: 'ing-form', text: 'running', in: 'Birdview is not running; open it from the bb sidebar.', reason: PLAYER_OFF },
  { file: 'packages/ui/src/components/StoryTests.tsx', rule: 'ing-form', text: 'running', in: 'Birdview is not running', reason: `The short title of the same message. ${PLAYER_OFF}` },
  { file: 'packages/ui/src/components/StoryTests.tsx', rule: 'ing-form', text: 'running', in: 'Send these scenarios to the running thread', reason: SEND_LABEL },
  { file: 'packages/ui/src/components/StoryTests.tsx', rule: 'ing-form', text: 'running', in: 'Send this scenario to the running thread', reason: `The one-scenario form of the label. It must agree with the signed label. ${SEND_LABEL}` },
  { file: 'packages/server/src/design-link.ts', rule: 'ing-form', text: 'running', in: 'FigCraft not running', reason: 'Signed error exit "FigCraft not running" (flow.yaml refresh-design-pictures, S17.yaml closed-port).' },
  { file: 'packages/server/src/thread-merge.ts', rule: 'ing-form', text: 'working', in: 'The thread is still working', reason: 'Signed plan text: the S14 error "The thread is still working (bb says working). Merge when bb says it is idle." (S14.yaml still-working).' },
  { file: 'packages/server/src/unit-report.ts', rule: 'ing-form', text: 'missing', in: 'unit report missing or unreadable', reason: 'Signed error exit "unit report missing or unreadable" (flow.yaml read-unit-report, S19.yaml unreadable).' },
  { file: 'packages/server/src/http.ts', rule: 'ing-form', text: 'missing', in: 'missing or wrong', reason: 'Protocol text: the UI (session-client.ts TOKEN_ERROR) compares this error body with ===. A change breaks old panels.' },
  { file: 'packages/ui/src/session-client.ts', rule: 'ing-form', text: 'missing', in: 'missing or wrong', reason: 'Protocol text: it must be equal to the error body of the server (http.ts). A change breaks the token check.' },
  { file: 'packages/core/src/present/summary.ts', rule: 'ing-form', text: 'Waiting', in: 'Waiting for my', reason: 'Signed plan text: the S20 group names "Waiting for my approval" and "Waiting for my sign-off" (S20.yaml reasons, S20-A4).' },
  { file: 'packages/core/src/present/summary.ts', rule: 'ing-form', text: 'Being', in: 'Being built', reason: 'Signed plan text: the S20 group name "Being built" (S20.yaml reasons, S20-A4).' },
  { file: 'packages/core/src/present/proof.ts', rule: 'ing-form', text: 'waiting', in: 'waiting for my approval', reason: 'Signed plan text: "waiting for my approval" (S20-A4 in prd.yaml, flow.yaml).' },
  { file: 'packages/core/src/present/proof.ts', rule: 'ing-form', text: 'planning', in: 'planning agent', reason: 'Signed actor name "planning agent" (S23.yaml actors, flow.yaml).' },
  { file: 'packages/core/src/present/status.ts', rule: 'ing-form', text: 'Showing', in: 'Showing the', reason: 'Signed plan text: "Showing the 3 stories not done." (S23.yaml example text).' },
  { file: 'packages/core/src/validate/structure.ts', rule: 'ing-form', text: 'incoming', in: 'incoming edge', reason: 'Signed plan term "incoming edges" (prd.yaml requirement text). Here it is an adjective, not a verb.' },
  { file: 'packages/core/src/validate/structure.ts', rule: 'ing-form', text: 'outgoing', in: 'outgoing edge', reason: 'Signed plan term "outgoing edges" (prd.yaml requirement text). Here it is an adjective, not a verb.' },
  { file: 'packages/core/src/simulate/contracts.ts', rule: 'ing-form', text: 'missing', in: 'missing field', reason: 'Signed plan text: the S2 finding "missing field" (S2.yaml example, prd.yaml S2). Findings keep the same words.' },
  { file: 'packages/core/src/trust/code-start.ts', rule: 'ing-form', text: 'existing', in: 'Nearest existing code', reason: 'Signed plan text: "No code yet. Nearest existing code:" (S15.yaml guesses, prd.yaml S15).' },
  { file: 'packages/core/src/trust/how-to-work.ts', rule: 'ing-form', text: 'reading', in: 'before reading files by hand', reason: HOW_TO_WORK_S15 },
  { file: 'packages/bb-plugin/skills/rehearse/SKILL.md', rule: 'ing-form', text: 'reading', in: 'before reading files by hand', reason: `A copy of the brief bullet. ${HOW_TO_WORK_S15}` },
  { file: 'packages/bb-plugin/skills/rehearse/SKILL.md', rule: 'ing-form', text: 'Working', in: 'Working on a story', reason: 'Signed plan text: the skill heading "Working on a story" (S11.yaml, prd.yaml S11). build-brief.test.ts finds this heading.' },
  { file: 'packages/core/src/validate/schema.ts', rule: 'ing-form', text: 'missing', in: 'missing field', reason: 'Signed plan text: the S2 finding "missing field" (S2.yaml example, prd.yaml S2).' },
  { file: 'packages/ui/src/model/progress.ts', rule: 'ing-form', text: 'failing', in: 'failing at', reason: 'Signed S11 state name "failing" (S11.yaml S11-A5 perScenario: found, passing, failing, missing).' },
  { file: 'packages/cli/src/index.ts', rule: 'ing-form', text: 'running', in: 'busy or not running', reason: 'Signed error exit "Birdview not running" (flow.yaml play-story). The help uses the same words as the message.' },
];
