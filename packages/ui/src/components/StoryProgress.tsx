// The progress block of the story thread panel (T44, box watch-build): what rehearse sees of the
// work on a story. The summary line, the thread (status, last activity, branch), per box whether
// it is built, needs no code of its own, or is not built, with the evidence (T58: Flow-Box commits on
// every branch, code the code graph maps to it, the neighbour a decision's branch is in) and its unit
// test coverage (T43), per approved
// scenario its e2e test, the gate findings of the story and whether the sign-off holds.

import { useId } from 'react';
import type { StoryProgress } from '../api.js';
import { boxEvidenceText, boxProgressText, scenarioStateText, signOffText } from '../model/progress.js';
import { timeLabel } from '../model/storythread.js';
import { CoverageBadge } from './CoverageBadge.js';

export function StoryProgressBlock({ progress, now }: { progress: StoryProgress; now: number }) {
  const id = useId();
  const branch = progress.thread?.branch ?? null;
  return (
    <section className="story-progress" data-testid="story-progress" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Progress</h3>
      <p className="progress-summary" data-testid="story-progress-summary">
        {progress.summary}
      </p>
      {progress.thread && (
        <p className="small muted" data-testid="story-progress-thread">
          Thread {progress.thread.statusText}
          {progress.thread.updatedAt !== null && <>, last activity {timeLabel(progress.thread.updatedAt, now)}</>}
          {branch && (
            <>
              , branch <code>{branch}</code>
            </>
          )}
        </p>
      )}
      <ul className="progress-rows" aria-label="Boxes">
        {progress.boxes.map((b) => (
          <li key={b.path} className={`progress-row is-${b.state}${b.built ? ' is-done' : ''}`} data-testid={`story-progress-box-${b.path}`}>
            <span className="progress-mark" aria-hidden="true">
              {b.state === 'built' ? '●' : b.state === 'no-code' ? '◐' : '○'}
            </span>
            <code className="progress-name" title={b.title}>
              {b.path}
            </code>
            <span className="progress-state small">{boxProgressText(b, branch)}</span>
            {b.coverage && <CoverageBadge stats={b.coverage} compact testId={`story-progress-cov-${b.path}`} />}
            <span className="progress-evidence small muted" data-testid={`story-progress-evidence-${b.path}`}>
              {boxEvidenceText(b)}
              {b.evidence.branch && <code className="progress-branch">{b.evidence.branch.text}</code>}
            </span>
          </li>
        ))}
      </ul>
      {progress.scenarios.length > 0 && (
        <ul className="progress-rows" aria-label="Approved scenarios">
          {progress.scenarios.map((s) => (
            <li key={s.id} className={`progress-row is-${s.state}`} data-testid={`story-progress-scenario-${s.id}`}>
              <span className="progress-mark" aria-hidden="true">
                {s.state === 'passing' ? '✓' : s.state === 'failing' ? '✗' : s.state === 'not-run' ? '◌' : '○'}
              </span>
              <span className="progress-name" title={s.title}>
                {s.id}
              </span>
              <span className="progress-state small">
                {scenarioStateText(s)}
                {s.test && <code className="muted"> {s.test}</code>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {progress.draftScenarios.length > 0 && (
        <p className="small muted" data-testid="story-progress-drafts">
          Not approved, not counted: {progress.draftScenarios.join(', ')}
        </p>
      )}
      <p className={progress.signOff.valid ? 'small' : 'small warn'} data-testid="story-progress-signoff">
        {signOffText(progress)}
      </p>
      {progress.gate.length === 0 ? (
        <p className="small muted" data-testid="story-progress-gate">
          Gate: no findings for this story.
        </p>
      ) : (
        <div data-testid="story-progress-gate">
          <p className="small warn">Gate: {progress.gate.length === 1 ? '1 finding' : `${progress.gate.length} findings`} for this story</p>
          <ul className="small progress-gate">
            {progress.gate.map((g, i) => (
              <li key={i}>
                <span className="muted">{g.check}:</span> {g.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
