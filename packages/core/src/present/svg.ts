// "How it works" in the deck (T52): one scenario's path as SVG swimlanes, from the same model and
// layout as the review UI's storyboard flowchart (layout/storyflow.ts). Static: no script, no fonts
// to fetch; the text is the box titles and the role names only.

import { SF, type SfLayout, type SfRect, type StoryFlow } from '../layout/storyflow.js';
import { plain } from './plain.js';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Words wrapped into lines of about `width` px at `size` px text; the last line ends in … when cut. */
export function wrapText(text: string, width: number, size: number, maxLines: number): string[] {
  const perLine = Math.max(4, Math.floor(width / (size * 0.56)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line === '' ? w : `${line} ${w}`;
    if (next.length <= perLine) line = next;
    else {
      if (line !== '') lines.push(line);
      line = w.length > perLine ? `${w.slice(0, perLine - 1)}…` : w;
    }
  }
  if (line !== '') lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = `${last.length >= perLine ? last.slice(0, perLine - 1) : last}…`;
  return kept;
}

function textLines(lines: string[], cx: number, cy: number, size: number, attrs = ''): string {
  const lh = size * 1.25;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  return lines.map((l, i) => `<text x="${cx}" y="${(y0 + i * lh).toFixed(1)}" font-size="${size}" text-anchor="middle" dominant-baseline="middle"${attrs}>${escapeXml(l)}</text>`).join('');
}

const mid = (r: SfRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The flowchart of one scenario as an inline SVG element (viewBox in layout pixels); `uid` keeps its marker id unique in the page. */
export function storyFlowSvg(sf: StoryFlow, layout: SfLayout, uid = 'flow'): string {
  const arrow = `${uid}-arrow`;
  const { width, height } = layout;
  const out: string[] = [];
  out.push(
    `<svg class="flow-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(`The path of the scenario: ${sf.steps.map((s) => plain(s.title)).join(', then ')}`)}">`,
    `<defs><marker id="${arrow}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>`,
  );
  for (const l of layout.lanes) {
    out.push(`<rect x="${l.x}" y="0" width="${l.w}" height="${height}" fill="${l.color}" fill-opacity="0.07" stroke="${l.color}" stroke-opacity="0.35"/>`);
    out.push(`<rect x="${l.x}" y="0" width="${l.w}" height="${SF.headerH}" fill="${l.color}" fill-opacity="0.18"/>`);
    out.push(textLines(wrapText(l.label, l.w - 12, 14, 1), l.x + l.w / 2, SF.headerH / 2, 14, ' font-weight="600" fill="#0f172a"'));
  }
  const lane = new Map(layout.lanes.map((l) => [l.role, l]));
  for (const e of sf.edges) {
    const a = layout.nodes[e.from];
    const b = layout.nodes[e.to];
    if (!a || !b) continue;
    const color = e.error ? '#b91c1c' : '#334155';
    let d: string;
    let lx: number;
    let ly: number;
    if (e.taken) {
      const s = { x: a.x + a.w / 2, y: a.y + a.h };
      const t = { x: b.x + b.w / 2, y: b.y };
      const my = (s.y + t.y) / 2;
      d = Math.abs(s.x - t.x) < 1 ? `M${s.x},${s.y} L${t.x},${t.y}` : `M${s.x},${s.y} L${s.x},${my} L${t.x},${my} L${t.x},${t.y}`;
      lx = (s.x + t.x) / 2;
      ly = my;
    } else {
      const left = b.x + b.w <= a.x;
      const s = { x: left ? a.x : a.x + a.w, y: mid(a).y };
      const t = { x: left ? b.x + b.w : b.x, y: mid(b).y };
      const mx = (s.x + t.x) / 2;
      d = `M${s.x},${s.y} L${mx},${s.y} L${mx},${t.y} L${t.x},${t.y}`;
      lx = mx;
      ly = (s.y + t.y) / 2;
    }
    out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${e.taken ? 2 : 1.2}"${e.taken ? ` marker-end="url(#${arrow})"` : ' stroke-dasharray="5 4" stroke-opacity="0.6"'}/>`);
    if (e.label !== undefined) {
      const label = wrapText(plain(e.label), 150, 11, 1)[0] ?? '';
      const w = Math.min(160, label.length * 6.4 + 10);
      out.push(`<rect x="${(lx - w / 2).toFixed(1)}" y="${ly - 9}" width="${w.toFixed(1)}" height="18" rx="4" fill="#fff" stroke="${color}" stroke-opacity="0.4"/>`);
      out.push(textLines([label], lx, ly, 11, ` fill="${color}"`));
    }
  }
  for (const s of sf.steps) {
    const r = layout.nodes[s.id];
    if (!r) continue;
    const color = lane.get(s.lane)?.color ?? '#94A3B8';
    const c = mid(r);
    if (s.decision) out.push(`<polygon points="${c.x},${r.y} ${r.x + r.w},${c.y} ${c.x},${r.y + r.h} ${r.x},${c.y}" fill="#fff" stroke="${color}" stroke-width="2"/>`);
    else out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="#fff" stroke="${color}" stroke-width="2"/>`);
    out.push(`<circle cx="${r.x + (s.decision ? r.w / 2 : 14)}" cy="${r.y + (s.decision ? 14 : 14)}" r="10" fill="${color}"/>`);
    out.push(textLines([String(s.index + 1)], r.x + (s.decision ? r.w / 2 : 14), r.y + 14, 11, ' fill="#fff" font-weight="700"'));
    const innerW = s.decision ? r.w * 0.6 : r.w - 34;
    out.push(textLines(wrapText(plain(s.title), innerW, 13, s.decision ? 2 : 3), s.decision ? c.x : c.x + 9, s.decision ? c.y + 6 : c.y, 13, ' fill="#0f172a"'));
  }
  for (const g of sf.ghosts) {
    const r = layout.nodes[g.id];
    if (!r) continue;
    const color = g.error ? '#b91c1c' : (lane.get(g.lane)?.color ?? '#94A3B8');
    out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="#fff" fill-opacity="0.7" stroke="${color}" stroke-dasharray="4 3" stroke-opacity="0.7"/>`);
    out.push(textLines(wrapText(plain(g.title), r.w - 12, 11, 2), r.x + r.w / 2, r.y + r.h / 2, 11, ' fill="#475569"'));
  }
  out.push('</svg>');
  return out.join('');
}
