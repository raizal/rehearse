// Box render-deck-html (T52): the deck as ONE self-contained HTML file. CSS and SVG are inline,
// pictures are data URIs, nothing is fetched. A little inline script turns the page into slides
// (arrow keys, a counter) and shrinks text that would overflow a slide; with scripts off it reads
// as one long page. Printing gives one landscape slide per page.

import type { Block, CheckRow, Deck, ListItem, Mark, ProgressStep, Slide, TestState } from './deck.js';
import { PROGRESS_STEPS } from './deck.js';
import { escapeXml as esc } from './svg.js';

export interface DeckAsset {
  mime: string;
  data: Uint8Array;
  width?: number;
  height?: number;
}

/** Asset key → picture; the deck's image blocks name them. */
export type DeckAssets = Record<string, DeckAsset>;

/** The width and height of a slide in CSS pixels (16:9); the print page is the same size. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const MARK_ICON: Record<Mark, string> = { done: '✓', partly: '◐', 'not-yet': '○', failed: '✕' };
const MARK_WORD: Record<Mark, string> = { done: 'done', partly: 'partly', 'not-yet': 'not yet', failed: 'problem' };
const TEST_WORD: Record<TestState | 'not approved', string> = { passed: 'test passed', failed: 'test failed', 'not-run': 'test not run', 'not-written': 'test not written', 'not approved': 'no test until approved' };
const TEST_MARK: Record<TestState | 'not approved', Mark> = { passed: 'done', failed: 'failed', 'not-run': 'partly', 'not-written': 'not-yet', 'not approved': 'not-yet' };

const CSS = `
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#e2e8f0;color:#0f172a;font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.deck{padding:24px 0}
.slide{position:relative;width:${SLIDE_W}px;min-height:${SLIDE_H}px;margin:0 auto 24px;background:#fff;box-shadow:0 2px 12px rgba(15,23,42,.18);display:flex;flex-direction:column;padding:40px 56px 0;overflow:hidden;--fit:1}
.fixed .slide{height:${SLIDE_H}px}
.slide h1,.slide h2{margin:0 0 6px;font-weight:700;letter-spacing:-.01em;padding-right:220px}
.slide h1{font-size:44px;line-height:1.1;margin-top:120px}
.slide h2{font-size:30px;line-height:1.15}
.ids{position:absolute;top:14px;right:20px;max-width:240px;text-align:right;font-size:10px;line-height:1.3;color:#94a3b8;font-family:ui-monospace,Menlo,monospace}
.content{flex:1;min-height:0;overflow:hidden;font-size:calc(17px * var(--fit));padding-top:10px}
.fixed .content{overflow:hidden}
.split .content{display:grid;grid-template-columns:minmax(0,38%) minmax(0,1fr);gap:28px;align-items:start}
.split .content>.col{min-width:0}
.narration{margin:10px 0 0;padding:10px 14px;border-left:4px solid #6366f1;background:#eef2ff;color:#312e81;font-size:15px;font-style:italic}
.slide>footer{display:flex;justify-content:space-between;gap:16px;padding:10px 0 14px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;margin-top:12px}
.lead{font-size:1.3em;line-height:1.35;margin:0 0 .7em}
.title-slide .lead{font-size:1.45em;color:#334155}
.text{margin:.4em 0}
.tone-muted{color:#475569}.tone-warn{color:#b45309;font-weight:600}.tone-good{color:#047857;font-weight:600}
.notice{margin:.6em 0;padding:10px 14px;border:2px solid #f59e0b;background:#fffbeb;color:#92400e;font-weight:600;border-radius:6px}
.list{margin:.3em 0 .6em}
.list h3,.checks h3{font-size:.85em;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:.2em 0 .4em}
.list ul{list-style:none;margin:0;padding:0}
.list.cols-2 ul{columns:2;column-gap:32px}
.list li{display:flex;gap:10px;align-items:baseline;margin:0 0 .45em;break-inside:avoid}
.list li .t{flex:1}
.id{font-size:10px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
.mark{display:inline-flex;align-items:center;justify-content:center;width:1.25em;height:1.25em;border-radius:50%;font-size:.8em;font-weight:700;flex:none}
.mark-done{background:#d1fae5;color:#047857}.mark-partly{background:#fef3c7;color:#b45309}.mark-not-yet{background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1}.mark-failed{background:#fee2e2;color:#b91c1c}
.legend{font-size:.72em;color:#64748b;margin:.2em 0 .5em;display:flex;gap:16px;flex-wrap:wrap}
.legend span{display:inline-flex;gap:5px;align-items:center}
.bullet{width:.45em;height:.45em;border-radius:50%;background:#94a3b8;flex:none;transform:translateY(-.1em)}
table.progress{width:100%;border-collapse:collapse;font-size:.78em}
table.progress th{font-size:.82em;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left;font-weight:600;padding:3px 6px;border-bottom:2px solid #e2e8f0}
table.progress td{padding:3px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
table.progress td.step{white-space:nowrap}
table.progress td.step .n{color:#64748b;font-size:.85em;margin-left:4px}
table.progress td.alarm .n{color:#b91c1c;font-weight:600}
.stats{display:flex;gap:16px;flex-wrap:wrap;margin:.3em 0 .8em}
.stat{flex:1 1 180px;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px}
.stat .v{font-size:2em;font-weight:700;line-height:1.1}
.stat .l{font-size:.8em;color:#475569}
.stat.tone-good .v{color:#047857}.stat.tone-warn .v{color:#b45309}.stat.tone-bad .v{color:#b91c1c}
.stat.tone-good,.stat.tone-warn,.stat.tone-bad{font-weight:400}
.map{display:flex;gap:12px;align-items:stretch}
.map .role{flex:1;min-width:0;border-top:5px solid var(--c);background:#f8fafc;border-radius:8px;padding:10px}
.map .role h3{margin:0;font-size:.95em}
.map .role .kind{font-size:.7em;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.map .role .about{font-size:.72em;color:#475569;margin:.3em 0 .5em}
.map .card{display:flex;gap:6px;align-items:baseline;background:#fff;border:1px solid #e2e8f0;border-left:3px solid var(--c);border-radius:6px;padding:4px 7px;margin:0 0 5px;font-size:.72em}
.map .card .t{flex:1}
figure{margin:0}
figure img{display:block;max-width:100%;max-height:440px;margin:0 auto;border:1px solid #e2e8f0;border-radius:6px}
figcaption{font-size:.75em;color:#64748b;margin-top:4px;text-align:center}
.flow svg{display:block;width:100%;height:auto;max-height:470px}
.checks .row{border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;margin:0 0 7px;break-inside:avoid}
.checks .head{display:flex;gap:8px;align-items:baseline}
.checks .head .t{flex:1;font-weight:600;font-size:.9em}
.checks .gwt{font-size:.78em;color:#334155;margin:.2em 0}
.checks .gwt b{color:#6366f1;font-weight:600}
.checks .meta{display:flex;gap:14px;font-size:.72em;color:#64748b;align-items:center;flex-wrap:wrap}
.checks .meta .test{display:inline-flex;gap:5px;align-items:center}
.checks .meta .test.failed{color:#b91c1c;font-weight:700}.checks .meta .test.passed{color:#047857;font-weight:600}
.checks .row.waiting{background:#fffbeb}
dl.glossary{display:grid;grid-template-columns:200px 1fr;gap:12px 24px;margin:.4em 0}
dl.glossary dt{font-weight:700}
dl.glossary dd{margin:0;color:#334155}
.deck-nav{display:none}
.js body{overflow:hidden;background:#0f172a;height:100vh}
.js .deck{padding:0}
.js .slide{display:none;position:fixed;left:50%;top:calc(50% - 22px);margin:0;transform:translate(-50%,-50%) scale(var(--scale,1));transform-origin:center}
.js .slide.current{display:flex}
.js .deck-nav{display:flex;position:fixed;left:0;right:0;bottom:0;height:44px;align-items:center;justify-content:center;gap:16px;color:#e2e8f0;font-size:14px}
.deck-nav button{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 12px;font-size:14px;cursor:pointer}
.deck-nav .hint{color:#64748b;font-size:12px}
@page{size:${SLIDE_W}px ${SLIDE_H}px;margin:0}
@media print{
  html,body,.js body{background:#fff;overflow:visible;height:auto}
  .deck,.js .deck{padding:0}
  .slide,.js .slide,.js .slide.current{display:flex!important;position:relative!important;left:auto;top:auto;transform:none!important;margin:0!important;box-shadow:none;height:${SLIDE_H}px;break-after:page;page-break-after:always}
  .deck-nav,.js .deck-nav{display:none!important}
}
`;

// Fit, then slides: measure every slide at its fixed size while all are shown, shrink the text of
// those that overflow, then show one at a time. Keys: ← → (also PageUp/PageDown, Space, Home, End).
const SCRIPT = `
(function(){
var d=document.documentElement;d.classList.add('fixed');
var s=[].slice.call(document.querySelectorAll('.slide'));
s.forEach(function(el){var c=el.querySelector('.content');if(!c)return;var f=1;while(c.scrollHeight>c.clientHeight+2&&f>0.56){f-=0.04;el.style.setProperty('--fit',f.toFixed(2));}});
d.classList.add('js');
var nav=document.querySelector('.deck-nav'),count=nav.querySelector('.count'),i=0;
function scale(){d.style.setProperty('--scale',Math.min(innerWidth/${SLIDE_W},(innerHeight-52)/${SLIDE_H}).toFixed(4));}
function show(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(el,k){el.classList.toggle('current',k===i);});count.textContent=(i+1)+' / '+s.length;try{history.replaceState(null,'','#'+(i+1));}catch(e){}}
addEventListener('resize',scale);scale();
addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowRight'||k==='PageDown'||k===' '){show(i+1);e.preventDefault();}else if(k==='ArrowLeft'||k==='PageUp'){show(i-1);e.preventDefault();}else if(k==='Home'){show(0);}else if(k==='End'){show(s.length-1);}});
nav.querySelector('.prev').onclick=function(){show(i-1);};nav.querySelector('.next').onclick=function(){show(i+1);};
var h=parseInt((location.hash||'').slice(1),10);show(h>0?h-1:0);
})();
`;

function mark(m: Mark): string {
  return `<span class="mark mark-${m}" title="${MARK_WORD[m]}" aria-label="${MARK_WORD[m]}">${MARK_ICON[m]}</span>`;
}

function listItem(it: ListItem): string {
  const lead = it.mark ? mark(it.mark) : '<span class="bullet"></span>';
  return `<li>${lead}<span class="t">${esc(it.text)}</span>${it.id ? `<span class="id">${esc(it.id)}</span>` : ''}</li>`;
}

function legend(): string {
  return `<div class="legend">${(['done', 'partly', 'not-yet', 'failed'] as Mark[]).map((m) => `<span>${mark(m)} ${MARK_WORD[m]}</span>`).join('')}</div>`;
}

function step(s: ProgressStep): string {
  return `<td class="step${s.alarm ? ' alarm' : ''}">${mark(s.alarm ? 'failed' : s.state)}<span class="n">${esc(s.note)}</span></td>`;
}

function checkRow(r: CheckRow): string {
  const gwt =
    r.given !== undefined
      ? `<div class="gwt"><b>Given</b> ${esc(r.given)}. <b>When</b> ${esc(r.when ?? '')}. <b>Then</b> ${esc(r.then ?? '')}${/[.!?]$/.test(r.then ?? '') ? '' : '.'}</div>`
      : '';
  return `<div class="row${r.approved ? '' : ' waiting'}"><div class="head"><span class="t">${esc(r.title)}</span><span class="id">${esc(r.id)}</span></div>${gwt}<div class="meta"><span>${esc(r.approval)}</span><span class="test ${r.test === 'passed' ? 'passed' : r.test === 'failed' ? 'failed' : ''}">${mark(TEST_MARK[r.test])} ${esc(TEST_WORD[r.test])}</span></div></div>`;
}

function block(b: Block, assets: DeckAssets): string {
  switch (b.type) {
    case 'lead':
      return `<p class="lead">${esc(b.text)}</p>`;
    case 'text':
      return `<p class="text${b.tone ? ` tone-${b.tone}` : ''}">${esc(b.text)}</p>`;
    case 'notice':
      return `<div class="notice" role="note">${esc(b.text)}</div>`;
    case 'list':
      return `<div class="list${b.columns === 2 ? ' cols-2' : ''}">${b.title ? `<h3>${esc(b.title)}</h3>` : ''}${b.legend ? legend() : ''}<ul>${b.items.map(listItem).join('')}</ul></div>`;
    case 'stats':
      return `<div class="stats">${b.items.map((s) => `<div class="stat${s.tone ? ` tone-${s.tone}` : ''}"><div class="v">${esc(s.value)}</div><div class="l">${esc(s.label)}</div></div>`).join('')}</div>`;
    case 'progress':
      return `${legend()}<table class="progress"><thead><tr><th>Story</th>${PROGRESS_STEPS.map((p) => `<th>${esc(p)}</th>`).join('')}</tr></thead><tbody>${b.rows
        .map((r) => `<tr><td>${esc(r.title)} <span class="id">${esc(r.id)}</span></td>${r.steps.map(step).join('')}</tr>`)
        .join('')}</tbody></table>`;
    case 'map':
      return `${legend()}<div class="map">${b.columns
        .map(
          (c) =>
            `<div class="role" style="--c:${esc(c.color)}"><h3>${esc(c.role)}</h3><div class="kind">${esc(c.kind)}</div>${c.about ? `<div class="about">${esc(c.about)}</div>` : ''}${c.stories
              .map((s) => `<div class="card">${mark(s.state)}<span class="t">${esc(s.title)}</span><span class="id">${esc(s.id)}</span></div>`)
              .join('')}</div>`,
        )
        .join('')}</div>`;
    case 'image': {
      const a = assets[b.asset];
      if (!a) return '';
      const data = Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength).toString('base64');
      return `<figure><img src="data:${esc(a.mime)};base64,${data}" alt="${esc(b.caption)}"${a.width ? ` width="${a.width}"` : ''}${a.height ? ` height="${a.height}"` : ''}><figcaption>${esc(b.caption)}</figcaption></figure>`;
    }
    case 'flow':
      return `<figure class="flow">${b.svg}<figcaption>${esc(b.caption)}</figcaption></figure>`;
    case 'checks':
      return `<div class="checks"><h3>What we checked</h3>${b.rows.map(checkRow).join('')}</div>`;
    case 'glossary':
      return `<dl class="glossary">${b.items.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd>`).join('')}</dl>`;
  }
}

function slideHtml(deck: Deck, s: Slide, n: number, total: number, assets: DeckAssets): string {
  // An image block whose picture is missing leaves no empty box.
  const blocks = s.blocks.filter((b) => b.type !== 'image' || assets[b.asset] !== undefined);
  const split = s.layout === 'split' && blocks.length > 1;
  const body = split ? `<div class="col">${block(blocks[0]!, assets)}</div><div class="col">${blocks.slice(1).map((b) => block(b, assets)).join('')}</div>` : blocks.map((b) => block(b, assets)).join('');
  const heading = s.key === 'title' ? `<h1>${esc(s.title)}</h1>` : `<h2>${esc(s.title)}</h2>`;
  return `<section class="slide${split ? ' split' : ''}${s.key === 'title' ? ' title-slide' : ''}" id="slide-${n}" data-key="${esc(s.key)}" aria-label="Slide ${n} of ${total}: ${esc(s.title)}">
${s.ids.length > 0 ? `<div class="ids">${esc(s.ids.join(' · '))}</div>` : ''}${heading}
<div class="content">${body}</div>
<p class="narration">${esc(s.narration)}</p>
<footer><span class="foot">${esc(deck.footer)}</span><span class="num">${n} / ${total}</span></footer>
</section>`;
}

/** The deck as one HTML document: no external file, font, script or style. */
export function deckHtml(deck: Deck, assets: DeckAssets = {}): string {
  const total = deck.slides.length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="rehearse present">
<title>${esc(deck.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="deck">
${deck.slides.map((s, i) => slideHtml(deck, s, i + 1, total, assets)).join('\n')}
</main>
<nav class="deck-nav" aria-label="Slides"><button type="button" class="prev" aria-label="Previous slide">←</button><span class="count">1 / ${total}</span><button type="button" class="next" aria-label="Next slide">→</button><span class="hint">arrow keys move · print for a PDF</span></nav>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
