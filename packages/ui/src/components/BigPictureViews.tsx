// The big picture views (D42): the feature map and the standard diagrams of the EPIC, each one
// generated from the record. Add a view with one line in BIG_VIEWS.

import type { ComponentType } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { ArchitectureView } from './ArchitectureView.js';
import { BeforeAfterView } from './BeforeAfterView.js';
import { BigPicture } from './BigPicture.js';
import { DataFlowView } from './DataFlowView.js';
import { SystemFlowchartView } from './SystemFlowchartView.js';
import { UserFlowView } from './UserFlowView.js';

export interface BigViewProps {
  view: ReviewEpicView;
  onOpenStory: (id: Id) => void;
  onOpenBox: (path: string) => void;
}

export const BIG_VIEWS: readonly { id: string; label: string; View: ComponentType<BigViewProps> }[] = [
  { id: 'features', label: 'Feature map', View: BigPicture },
  { id: 'userflow', label: 'User flow', View: UserFlowView },
  { id: 'dataflow', label: 'Data flow', View: DataFlowView },
  { id: 'sysflow', label: 'System flowchart', View: SystemFlowchartView },
  { id: 'architecture', label: 'Architecture', View: ArchitectureView },
  { id: 'before-after', label: 'Before / after', View: BeforeAfterView },
];

export interface BigPictureViewsProps extends BigViewProps {
  /** Id of the view to show; the feature map when unknown. */
  active: string;
  onPick: (id: string) => void;
}

export function BigPictureViews({ active, onPick, ...props }: BigPictureViewsProps) {
  const current = BIG_VIEWS.find((v) => v.id === active) ?? BIG_VIEWS[0]!;
  return (
    <>
      <nav className="bpv-switch" aria-label="Big picture views" data-testid="bpv-switch">
        {BIG_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={v.id === current.id ? 'bpv-tab is-active' : 'bpv-tab'}
            data-testid={`bpv-${v.id}`}
            aria-pressed={v.id === current.id}
            onClick={() => onPick(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <current.View {...props} />
    </>
  );
}
