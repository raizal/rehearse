// The sign-off preview (T39, box `sign-off`): what the owner agrees to when they sign off a story,
// and what changed since the story's last sign-off. The server reads the content that story hash
// rule 2 fingerprints (`GET api/sign-off/preview`); the scenario status and the approval with its
// signature state come from `GET api/epic`. Read only: the Sign off tab puts the confirm button
// under it, the story page shows it alone. When small changes (T62) are new since the last
// sign-off, the preview shows each new change and its items first, and folds the signed rest.

import { useEffect, useState } from 'react';
import type { ContentChange, Id, PreviewBox, StoryPreviewContent } from '@rehearse/core';
import { fetchSignOffPreview, type SignOffPreview as Preview, type SinceSignOff, type StorySignOffPreview } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { SigBadge } from './Review.js';
import { DesignBeside } from './DesignBeside.js';
import { newChangesOf, splitNewChanges } from '../model/changes.js';

/** What a sign-off is, in plain words. */
export const SIGN_OFF_MEANING =
  'You agree that this story, as written now, is what should be built: its sentence, requirements, criteria, approved scenarios and the boxes it uses. ' +
  'The record keeps your signature and a fingerprint of all of that. If any of it changes later, this sign-off goes stale and you sign again.';

export interface SignOffPreviewProps {
  view: ReviewEpicView;
  storyIds: Id[];
  /** The signer of this session: "your sign-off" when the last sign-off is theirs. */
  me?: string;
  onOpenBox?: (path: string) => void;
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; preview: Preview };

export function SignOffPreview({ view, storyIds, me, onOpenBox }: SignOffPreviewProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const key = storyIds.join(',');
  useEffect(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    void fetchSignOffPreview(key.split(',')).then((r) => {
      if (!live) return;
      setLoad(r.kind === 'ok' ? { kind: 'ok', preview: r.body } : { kind: 'error', message: r.message });
    });
    return () => {
      live = false;
    };
  }, [key]);

  return (
    <div className="signoff-preview" data-testid="signoff-preview">
      <p className="signoff-meaning" data-testid="signoff-meaning">
        {SIGN_OFF_MEANING}
      </p>
      {load.kind === 'loading' && (
        <p className="muted" data-testid="signoff-preview-loading">
          rehearse loads what you agree to…
        </p>
      )}
      {load.kind === 'error' && (
        <p className="warn" data-testid="signoff-preview-error">
          The preview cannot be loaded: {load.message}.
        </p>
      )}
      {load.kind === 'ok' &&
        load.preview.stories.map((s, i) => (
          <details key={s.id} className="signoff-story" open={i === 0} data-testid={`signoff-preview-${s.id}`}>
            <summary>
              <strong>{s.id}</strong> {s.content ? <span>{s.content.story.want}</span> : <span className="warn">not in prd.yaml</span>}{' '}
              {s.since && <SinceChip since={s.since} />}
            </summary>
            {s.content ? <StoryPreview view={view} s={s} content={s.content} me={me} onOpenBox={onOpenBox} /> : <p className="warn">prd.yaml has no story {s.id}.</p>}
          </details>
        ))}
    </div>
  );
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** `2026-11-05T10:00:00Z` → `2026-11-05 10:00 UTC`. */
export function formatAt(at: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(at);
  return m ? `${m[1]} ${m[2]} UTC` : at;
}

function SinceChip({ since }: { since: SinceSignOff }) {
  const [cls, text] =
    since.kind === 'first' ? ['is-first', 'first sign-off']
    : since.kind === 'unchanged' ? ['is-same', 'no change']
    : since.kind === 'changed' ? ['is-changed', since.changes.length === 0 ? 'changed' : plural(since.changes.length, 'change')]
    : ['is-changed', 'changed'];
  return <span className={`since-chip ${cls}`}>{text}</span>;
}

function StoryPreview({ view, s, content, me, onOpenBox }: { view: ReviewEpicView; s: StorySignOffPreview; content: StoryPreviewContent; me?: string; onOpenBox?: (path: string) => void }) {
  const roleName = (id: string) => content.roles.find((r) => r.id === id)?.name ?? id;
  const n = s.counts ?? { requirements: content.requirements.length, criteria: content.criteria.length, scenarios: content.scenarios.length, boxes: content.boxes.length };
  // Small changes that no sign-off covers (T62): show them first, and the signed rest folded.
  const fresh = newChangesOf(s.since);
  const { added, rest } = splitNewChanges(content, fresh);
  return (
    <div className="signoff-story-body">
      <p className="signoff-summary" data-testid={`signoff-preview-summary-${s.id}`}>
        You agree to {plural(n.requirements, 'requirement')}, {plural(n.criteria, 'criterion', 'criteria')}, {plural(n.scenarios, 'scenario')} and {plural(n.boxes, 'box', 'boxes')}.
      </p>
      {s.since && <Since id={s.id} since={s.since} me={me} />}
      <DesignBeside view={view} storyId={s.id} />
      {fresh.length === 0 ? (
        <StoryContent view={view} id={s.id} content={content} roleName={roleName} onOpenBox={onOpenBox} />
      ) : (
        <>
          {added.map((c) => (
            <section key={c.id} className="signoff-new" data-testid={`signoff-preview-new-${c.id}`}>
              <h4>
                New in {c.id}
                {c.title ? `: ${c.title}` : ''}
              </h4>
              {c.why && <p className="small">{c.why}</p>}
              {c.criteria.length > 0 && <CriteriaList criteria={c.criteria} testId={`signoff-preview-new-criteria-${c.id}`} />}
              {c.scenarios.length > 0 && <ScenarioList view={view} scenarios={c.scenarios} testId={`signoff-preview-new-scenarios-${c.id}`} />}
              {c.boxes.length > 0 && <BoxList boxes={c.boxes} roleName={roleName} onOpenBox={onOpenBox} testId={`signoff-preview-new-boxes-${c.id}`} />}
            </section>
          ))}
          <details className="signoff-rest" data-testid={`signoff-preview-rest-${s.id}`}>
            <summary>The rest of the story is as signed</summary>
            <StoryContent view={view} id={s.id} content={rest} roleName={roleName} onOpenBox={onOpenBox} />
          </details>
        </>
      )}
    </div>
  );
}

/** The story sentence, its requirements, criteria, scenarios and boxes. */
function StoryContent({ view, id, content, roleName, onOpenBox }: { view: ReviewEpicView; id: Id; content: StoryPreviewContent; roleName: (id: string) => string; onOpenBox?: (path: string) => void }) {
  const role = roleName(content.story.role);
  return (
    <>
      <h4>Story</h4>
      <p className="signoff-sentence" data-testid={`signoff-preview-sentence-${id}`}>
        As {/^[aeiou]/i.test(role) ? 'an' : 'a'} {role}, I want {content.story.want}, so that {content.story.soThat}.
      </p>

      <h4>Requirements</h4>
      {content.requirements.length === 0 ? (
        <p className="muted small">None.</p>
      ) : (
        <ul className="signoff-list" data-testid={`signoff-preview-requirements-${id}`}>
          {content.requirements.map((r) => (
            <li key={r.id}>
              <span className="pill">{r.id}</span> {r.text}
            </li>
          ))}
        </ul>
      )}

      <h4>Acceptance criteria</h4>
      {content.criteria.length === 0 ? <p className="muted small">None.</p> : <CriteriaList criteria={content.criteria} testId={`signoff-preview-criteria-${id}`} />}

      <h4>Scenarios</h4>
      {content.scenarios.length === 0 ? <p className="muted small">None.</p> : <ScenarioList view={view} scenarios={content.scenarios} testId={`signoff-preview-scenarios-${id}`} />}

      <h4>Boxes</h4>
      {content.boxes.length === 0 ? (
        <p className="muted small">No box serves this story.</p>
      ) : (
        <BoxList boxes={content.boxes} roleName={roleName} onOpenBox={onOpenBox} testId={`signoff-preview-boxes-${id}`} />
      )}
    </>
  );
}

function CriteriaList({ criteria, testId }: { criteria: StoryPreviewContent['criteria']; testId: string }) {
  return (
    <ul className="signoff-list" data-testid={testId}>
      {criteria.map((c) => (
        <li key={c.id}>
          <span className="pill">{c.id}</span>
          <dl className="gwt-rows">
            <dt>GIVEN</dt>
            <dd>{c.given}</dd>
            <dt>WHEN</dt>
            <dd>{c.when}</dd>
            <dt>THEN</dt>
            <dd>{c.then}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function ScenarioList({ view, scenarios, testId }: { view: ReviewEpicView; scenarios: StoryPreviewContent['scenarios']; testId: string }) {
  return (
    <ul className="signoff-list" data-testid={testId}>
      {scenarios.map((sc) => {
        const status = view.scenarios.find((v) => v.scenario.id === sc.id)?.status ?? 'draft';
        const approval = view.approvals?.[sc.id];
        return (
          <li key={sc.id} data-testid={`signoff-preview-scenario-${sc.id}`}>
            <span className="pill">{sc.id}</span> {sc.title} <span className={`badge status-${status}`}>{status}</span>{' '}
            {approval ? (
              <span className="small">
                approved by {approval.by} on {formatAt(approval.at)} <SigBadge status={approval.sigStatus} signer={approval.signer} testId={`signoff-preview-sig-${sc.id}`} />
              </span>
            ) : (
              <span className="muted small">not approved</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BoxList({ boxes, roleName, onOpenBox, testId }: { boxes: PreviewBox[]; roleName: (id: string) => string; onOpenBox?: (path: string) => void; testId: string }) {
  return (
    <ul className="signoff-list signoff-boxes" data-testid={testId}>
      {boxes.map((b) => (
        <BoxItem key={b.path} box={b} lane={roleName(b.lane)} onOpenBox={onOpenBox} />
      ))}
    </ul>
  );
}

/**
 * Rule 1 is the only story hash rule that does not cover the boxes. Rules 2 and 3 (T62) are
 * trusted, as core's TRUSTED_HASH_RULES says.
 */
const UNTRUSTED_RULE = 1;

const RELATION: Record<PreviewBox['relation'], string> = { serves: 'serves the story', parent: 'holds a box of the story', inside: 'inside a box of the story' };

function BoxItem({ box, lane, onOpenBox }: { box: PreviewBox; lane: string; onOpenBox?: (path: string) => void }) {
  return (
    <li className={box.path.includes('/') ? 'is-nested' : undefined}>
      {onOpenBox ? (
        <button type="button" className="link-button" data-testid={`signoff-preview-box-${box.path}`} onClick={() => onOpenBox(box.path)} title={`Open box ${box.path}`}>
          {box.title || box.path}
        </button>
      ) : (
        <strong>{box.title || box.path}</strong>
      )}{' '}
      <code className="small">{box.path}</code> <span className="muted small">
        {lane} · {box.kind} · {RELATION[box.relation]}
      </span>
    </li>
  );
}

function Since({ id, since, me }: { id: Id; since: SinceSignOff; me?: string }) {
  const testId = `signoff-preview-since-${id}`;
  if (since.kind === 'first') {
    return (
      <p className="since is-first" data-testid={testId}>
        First sign-off of this story.
      </p>
    );
  }
  const fresh = newChangesOf(since);
  const whose = `${me !== undefined && since.by === me ? 'your sign-off' : `the sign-off by ${since.by}`} on ${formatAt(since.at)}`;
  if (since.kind === 'unchanged') {
    return (
      <p className="since is-same" data-testid={testId}>
        No change since {whose}.
      </p>
    );
  }
  if (since.kind === 'unavailable') {
    return (
      <p className="since is-changed" data-testid={testId}>
        Changed since {whose}. What changed cannot be shown: {since.reason}. The content below is the content now.
      </p>
    );
  }
  return (
    <div className="since is-changed" data-testid={testId}>
      <p>
        {since.changes.length === 0 ? 'Changed' : `${plural(since.changes.length, 'change')}`} since {whose} (commit <code>{since.commit.short}</code>):
      </p>
      {since.changes.length === 0 ? (
        <p className="small">
          {since.hashRule === UNTRUSTED_RULE
            ? 'The content is the same, but that sign-off used hash rule 1, which did not cover the boxes. Sign again so the fingerprint covers them.'
            : fresh.length > 0
              ? `No sign-off covers ${fresh.join(', ')}. The rest of the story is as signed.`
              : 'No difference in the content was found against that commit.'}
        </p>
      ) : (
        <ul className="change-list" data-testid={`signoff-preview-changes-${id}`}>
          {since.changes.map((c, i) => (
            <ChangeItem key={i} change={c} />
          ))}
        </ul>
      )}
      {!since.exact && (
        <p className="muted small" data-testid={`signoff-preview-inexact-${id}`}>
          The files of commit {since.commit.short} do not match the signed fingerprint exactly. The commit of the record is not the commit of the sign-off. Thus this list can miss or add a change.
        </p>
      )}
    </div>
  );
}

function ChangeItem({ change: c }: { change: ContentChange }) {
  return (
    <li className={`change is-${c.change}`}>
      <span className="change-text">{c.text}</span>
      {c.words ? (
        <p className="change-words">
          {c.words.map((w, i) =>
            w.kind === 'same' ? <span key={i}>{w.text}</span>
            : w.kind === 'added' ? <ins key={i}>{w.text}</ins>
            : <del key={i}>{w.text}</del>,
          )}
        </p>
      ) : (
        (c.before !== undefined || c.after !== undefined) && (
          <dl className="change-values">
            {c.before !== undefined && (
              <>
                <dt>was</dt>
                <dd>
                  <del>{c.before}</del>
                </dd>
              </>
            )}
            {c.after !== undefined && (
              <>
                <dt>now</dt>
                <dd>
                  <ins>{c.after}</ins>
                </dd>
              </>
            )}
          </dl>
        )
      )}
    </li>
  );
}
