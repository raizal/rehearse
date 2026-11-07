// The mark of an item that a small change added (T62): "New in C3", with the change title on hover.

import type { ChangeRef } from '../model/changes.js';

export function ChangeMark({ change, testId }: { change: ChangeRef; testId?: string }) {
  return (
    <span className="badge change-mark" data-testid={testId} title={change.title}>
      New in {change.id}
    </span>
  );
}
