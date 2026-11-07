// The unit test coverage badge (T43, S12): `72% · 3 tests`, green from 80%, orange from 50%, red
// below, grey with "no coverage data"; a ⟳ when the coverage is older than the code.

import { useContext } from 'react';
import { BoxCoverageContext } from '../coverage-api.js';
import { badgeText, badgeTitle, coverageTone, hintOf, STALE_TEXT, type CoverageInfo, type CoverageStats, type NodeCoverage, type TestRef } from '../model/coverage.js';

export interface CoverageBadgeProps {
  stats: CoverageStats | undefined;
  testId?: string;
  /** Small, for diagram nodes: the percent only, the rest in the tooltip. */
  compact?: boolean;
}

export function CoverageBadge({ stats, testId, compact }: CoverageBadgeProps) {
  const tone = coverageTone(stats);
  const text = compact && stats?.percent !== null && stats?.percent !== undefined ? `${stats.percent}%` : badgeText(stats);
  const title = badgeTitle(stats);
  return (
    <span className={`cov-badge cov-${tone}${compact ? ' cov-compact' : ''}`} data-testid={testId} data-tone={tone} title={title} aria-label={`Unit test coverage: ${badgeText(stats)}. ${title}`}>
      {text}
      {stats?.stale && (
        <span className="cov-stale" aria-hidden="true">
          {' '}
          ⟳
        </span>
      )}
    </span>
  );
}

/** A box's badge, from the boxes' coverage on the page; nothing for a box with no code. */
export function BoxCoverageBadge({ path, testId, compact, always }: { path: string; testId?: string; compact?: boolean; always?: boolean }) {
  const cov = useContext(BoxCoverageContext);
  if (!cov) return null;
  const stats = cov.boxes[path];
  // No coverage file: the drawer says so in one line; the diagrams stay clean.
  if ((!stats || !cov.info.found) && !always) return null;
  return <CoverageBadge stats={stats} {...(testId ? { testId } : {})} {...(compact ? { compact } : {})} />;
}

/** A box's badge inside an SVG map (the Big picture feature map): the percent at the bottom right. */
export function SvgBoxCoverageBadge({ path, x, y, testId }: { path: string; x: number; y: number; testId?: string }) {
  const cov = useContext(BoxCoverageContext);
  const stats = cov?.boxes[path];
  if (!stats || !cov?.info.found) return null;
  const tone = coverageTone(stats);
  const text = stats.percent === null ? 'no data' : `${stats.percent}%${stats.stale ? ' ⟳' : ''}`;
  const w = text.length * 6.5 + 12;
  return (
    <g className={`cov-svg cov-${tone}`} data-testid={testId} data-tone={tone}>
      <title>{`Unit test coverage: ${badgeText(stats)}. ${badgeTitle(stats)}`}</title>
      <rect x={x - w} y={y - 14} width={w} height={16} rx={8} />
      <text x={x - w / 2} y={y - 2.5} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

/** The one plain line on how to make a coverage file, when the repo has none. */
export function CoverageHint({ info, testId }: { info: CoverageInfo | undefined; testId?: string }) {
  const hint = hintOf(info);
  if (!hint) return null;
  return (
    <p className="cov-hint" data-testid={testId}>
      {hint}
    </p>
  );
}

/** The no-data line under a box, from the boxes' coverage on the page. */
export function BoxCoverageHint({ testId }: { testId?: string }) {
  const cov = useContext(BoxCoverageContext);
  return <CoverageHint info={cov?.info} {...(testId ? { testId } : {})} />;
}

/** The coverage of one code node over its code: the badge, the stale line, the gutter legend, or the no-data line. */
export function CoverageSummary({ coverage, info, testId }: { coverage: NodeCoverage | undefined; info: CoverageInfo | undefined; testId: string }) {
  if (!coverage && !info) return null;
  if (info && !info.found) return <CoverageHint info={info} testId={`${testId}-hint`} />;
  const s = coverage?.stats;
  return (
    <div className="cov-row" data-testid={testId}>
      <CoverageBadge stats={s} testId={`${testId}-badge`} />
      {s && s.percent !== null && (
        <span className="cov-legend" aria-hidden="true">
          <span>
            <i className="lg-run" />
            run
          </span>
          <span>
            <i className="lg-missed" />
            not run
          </span>
          <span>◐ branches partly taken</span>
        </span>
      )}
      {s?.stale && (
        <span className="cov-stale-line" data-testid={`${testId}-stale`}>
          {STALE_TEXT}
        </span>
      )}
    </div>
  );
}

/** The tests that call a code node, direct ones first; each opens its code. */
export function TestedBy({ tests, onOpen, testId }: { tests: readonly TestRef[] | undefined; onOpen: (id: string) => void; testId: string }) {
  if (!tests) return null;
  return (
    <div className="tested-by" data-testid={testId}>
      <h4>Tested by</h4>
      {tests.length === 0 ? (
        <p className="muted small">No test calls this code.</p>
      ) : (
        <ul>
          {tests.map((t) => (
            <li key={t.id}>
              <button type="button" data-testid={`${testId}-${t.name}`} title={`Open the test ${t.name}`} onClick={() => onOpen(t.id)}>
                {t.name}
              </button>
              <div className="tb-where">
                {t.file && (
                  <code>
                    {t.file}
                    {t.range ? `:${t.range}` : ''}
                  </code>
                )}
                <span className="tb-via">{t.direct ? 'calls it' : 'through a helper'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
