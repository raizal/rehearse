// Linking a design without editing YAML (T51, boxes `link-design` and `suggest-design`): the picker
// of design files → pages → top-level frames with their pictures, where one click links, and the
// top 3 suggested pages and frames with the words that match and a one-click Link. A suggestion is
// never linked by itself. Used by the story Design tab and the box drawer.

import { useState } from 'react';
import type { DesignFileIndex, DesignPicture as PictureRef, DesignSuggestion } from '@rehearse/core';
import type { DesignTarget } from '../design-api.js';
import { pictureSrc, suggestionWords } from '../model/design.js';

/** A small picture of a page or frame, or nothing when there is none. */
function Thumb({ picture, alt, testId }: { picture: PictureRef | undefined; alt: string; testId: string }) {
  if (!picture) return null;
  return (
    <span className="design-thumb">
      <img src={pictureSrc(picture)} alt={alt} data-testid={testId} loading="lazy" />
      {picture.kind === 'file thumbnail' && <span className="small muted">file thumbnail</span>}
    </span>
  );
}

/** The top 3 suggestions, each with its reason and a Link button. Nothing when there are none. */
export function DesignSuggestions({ suggestions, busy, onLink, testId }: { suggestions: DesignSuggestion[] | undefined; busy: boolean; onLink: (t: DesignTarget) => void; testId: string }) {
  const top = (suggestions ?? []).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="design-suggestions" data-testid={testId}>
      <h4>Suggested</h4>
      <ol>
        {top.map((s, i) => (
          <li key={`${s.file}#${s.page}#${s.frame?.ref ?? ''}`} data-testid={`${testId}-${i}`}>
            <Thumb picture={s.picture} alt={suggestionWords(s)} testId={`${testId}-${i}-picture`} />
            <span className="design-suggestion-words">
              <span>{suggestionWords(s)}</span>
              <span className="small muted">
                {s.file} · {s.reason}
              </span>
            </span>
            <button
              type="button"
              className="action small"
              data-testid={`${testId}-${i}-link`}
              disabled={busy}
              onClick={() => onLink({ file: s.file, page: s.page, ...(s.frame ? { frame: s.frame.ref } : {}) })}
            >
              Link
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Files → pages → frames, with pictures; a click on "Link page" or "Link frame" links it. */
export function DesignPicker({ index, busy, onPick, onCancel, testId }: { index: DesignFileIndex[]; busy: boolean; onPick: (t: DesignTarget) => void; onCancel: () => void; testId: string }) {
  const [chosen, setChosen] = useState<string | undefined>(index.length === 1 ? index[0]!.file : undefined);
  const file = index.find((f) => f.file === chosen);
  return (
    <div className="design-picker" role="group" aria-label="Link a design" data-testid={testId}>
      <header className="design-picker-head">
        <h4>Link a design</h4>
        <button type="button" className="action small" data-testid={`${testId}-cancel`} onClick={onCancel}>
          Cancel
        </button>
      </header>
      {index.length === 0 ? (
        <p className="small muted" data-testid={`${testId}-empty`}>
          There is no FigCraft file under design/ to link. Save one there first.
        </p>
      ) : (
        <ul className="design-picker-files" aria-label="Design files">
          {index.map((f, i) => (
            <li key={f.file}>
              <button type="button" className="action small" aria-pressed={f.file === chosen} data-testid={`${testId}-file-${i}`} onClick={() => setChosen(f.file)}>
                {f.file}
              </button>
            </li>
          ))}
        </ul>
      )}
      {file && (
        <ol className="design-picker-pages" aria-label={`Pages of ${file.file}`} data-testid={`${testId}-pages`}>
          {file.pages.map((p) => {
            const picture: PictureRef | undefined = p.png ? { kind: 'page', png: p.png } : file.thumbnail ? { kind: 'file thumbnail', file: file.file } : undefined;
            return (
              <li key={p.id} data-testid={`${testId}-page-${p.number}`}>
                <Thumb picture={picture} alt={`Page ${p.number} ${p.name}`} testId={`${testId}-page-${p.number}-picture`} />
                <span className="design-picker-page-name">
                  {p.number}. {p.name}
                </span>
                <button type="button" className="action small" disabled={busy} data-testid={`${testId}-link-page-${p.number}`} onClick={() => onPick({ file: file.file, page: p.number })}>
                  Link page {p.number}
                </button>
                {p.frames.length > 0 && (
                  <ul className="design-picker-frames" aria-label={`Frames of page ${p.number}`}>
                    {p.frames.map((fr) => (
                      <li key={fr.id}>
                        <Thumb picture={fr.png ? { kind: 'frame', png: fr.png } : undefined} alt={`Frame ${fr.name}`} testId={`${testId}-frame-${fr.id}-picture`} />
                        <button type="button" className="action small" disabled={busy} data-testid={`${testId}-link-frame-${fr.id}`} onClick={() => onPick({ file: file.file, page: p.number, frame: fr.id })}>
                          Link frame “{fr.name}”
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
