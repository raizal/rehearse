// The "Design" section of the build brief (T50, box `design-brief`): the FigCraft page the story's
// screens are drawn on, and its PNG, from design/links.yaml (gathered by the caller). Agents read
// the PNG; they may inspect a running FigCraft read-only and never write a design file.

import type { DesignLink, StoryDesignLinks } from '../design/links.js';
import { designPageText } from '../design/links.js';

/** The story's links as the brief gets them. */
export type BriefDesign = StoryDesignLinks;

export const DESIGN_HEADING = '## Design';
export const NO_DESIGN_LINE = 'No design linked for this story.';

function linkText(link: DesignLink): string {
  return `\`${link.file}\`, ${designPageText(link.page)}${link.png ? `, picture \`${link.png}\`` : ' (no PNG linked)'}`;
}

/** The section; one line when the story and its boxes have no link. */
export function designSection(design: BriefDesign | undefined): string {
  const boxes = Object.entries(design?.boxes ?? {});
  if (!design?.story && boxes.length === 0) return `${DESIGN_HEADING}\n\n${NO_DESIGN_LINE}`;
  const lines = [DESIGN_HEADING, ''];
  if (design?.story) lines.push(`- The story: ${linkText(design.story)}.`);
  for (const [box, link] of boxes) lines.push(`- Box \`${box}\`: ${linkText(link)}.`);
  lines.push(
    '',
    'Build the screen to match this: read the PNG. If FigCraft runs on 127.0.0.1:4800 you may inspect the page read-only with the figcraft-use skill. Never write to the design file, and never call `POST /api/design/save`: only the owner saves designs, in the rehearse UI.',
  );
  return lines.join('\n');
}
