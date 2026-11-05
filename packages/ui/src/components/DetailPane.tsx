// The box contract (D10): inputs, outputs, reads, writes, side effects, error exits, stories.

import type { Box } from '@rehearse/core';
import { KeyValues, Tags } from './Values.js';

export function BoxContract({ box, path }: { box: Box | undefined; path: string | undefined }) {
  if (!path) return <p className="muted" data-testid="contract-empty">Click a box to see its contract.</p>;
  if (!box) return <p className="muted">No box at {path}.</p>;
  return (
    <div className="contract" data-testid="contract">
      <header>
        <div className="contract-path" data-testid="contract-path">{path}</div>
        <h3>{box.title}</h3>
        <div className="contract-meta">
          <span className={`pill kind-${box.kind}`}>{box.kind}</span>
          <span className="pill">lane: {box.lane}</span>
        </div>
      </header>
      <h4>Inputs</h4>
      <KeyValues values={box.inputs} testId="contract-inputs" />
      <h4>Outputs</h4>
      <KeyValues values={box.outputs} testId="contract-outputs" />
      <h4>Reads</h4>
      <Tags items={box.reads} testId="contract-reads" />
      <h4>Writes</h4>
      <Tags items={box.writes} testId="contract-writes" kind="writes" />
      <h4>Side effects</h4>
      <Tags items={box.sideEffects} testId="contract-side-effects" />
      <h4>Error exits</h4>
      <Tags items={box.errorExits} testId="contract-error-exits" kind="errors" />
      <h4>Stories</h4>
      <Tags items={box.stories} testId="contract-stories" />
    </div>
  );
}
