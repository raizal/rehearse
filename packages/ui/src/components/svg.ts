// An SVG element that acts as a button: focusable, named, and run by click, Enter or Space.

import type { KeyboardEvent } from 'react';

export function svgButton(label: string, onActivate: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<SVGElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onActivate();
    },
  } as const;
}

/** A smooth line through the points, left to right; a back step curves the same way. */
export function curvePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const mid = (a.x + b.x) / 2;
    d += ` C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`;
  }
  return d;
}
