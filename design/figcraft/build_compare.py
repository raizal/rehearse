"""Pages 11-12: before / after. As-is = rehearse v1 as built. To-be = the code-graph EPIC (draft, from G1-G19).

Run: python3 build_compare.py   (redraws pages 1-10 too, then saves)
"""
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import build_design as bd
import build_flows as bf
import build_docs as bdoc
from build_design import ex, rect, ellipse, text, path, arrow, chip, size, frame, wrap, ROLE, INK, MUTED, LINE, BG, CARD, OK, WARN
from build_flows import node, label, subnav, cyl
from build_docs import link, links, tag, card, LINK

CG = 'code-graph  ·  draft'
STATE = {'add': ('#16A34A', '#F0FDF4', '+ added'), 'chg': ('#D97706', '#FFFBEB', '~ changed'),
         'same': ('#94A3B8', '#FFFFFF', None), 'del': ('#DC2626', '#FEF2F2', '− removed')}
GRAY = '#94A3B8'


def badge(p, x, y, w, state):
    fg, bg, b = STATE[state]
    if not b: return
    r, cw = chip(p, x + w - 84, y - 10, b, CARD, fg, 10, 700, 7, 18, 9)
    ex('node.set', ids=[r], props={"x": x + w - cw - 8})
    # move the text with the pill
    t = ex('node.find', root=p)['ids'][-1]
    ex('node.set', ids=[t], props={"x": x + w - cw - 1})


def dnode(p, x, y, w, h, s, state='same', sub=None):
    fg, bg, _ = STATE[state]
    node(p, x, y, w, h, s, fg, bg, 6, sub=sub, sw=1.5 if state == 'same' else 2, dashes=[5, 4] if state == 'del' else None)
    badge(p, x, y, w, state)


def dcyl(p, x, y, w, h, s, state='same'):
    cyl(p, x, y, w, h, s, STATE[state][0])
    badge(p, x, y + 6, w, state)


def legend_diff(p, x, y):
    for st, s in [('add', 'Added by this EPIC'), ('chg', 'Changed'), ('same', 'Same as before'), ('del', 'Removed')]:
        fg, bg, _ = STATE[st]
        rect(p, x, y, 28, 18, bg, 4, fg, 2, dashes=[4, 3] if st == 'del' else None)
        t = text(p, x + 36, y + 1, s, 12, 500, MUTED)
        x += 36 + size(t)[0] + 22
    path(p, [[x, y + 9], [x + 28, y + 9]], OK, 2)
    t = text(p, x + 36, y + 1, 'New link', 12, 500, MUTED)
    return x + 36 + size(t)[0]


def seg(p, x, y, items, active):
    t0 = x
    for s in items:
        t = text(p, 0, 0, s, 12, 600); w = size(t)[0] + 24; ex('edit.delete', ids=[t])
        if s == active: rect(p, x, y, w, 28, ROLE['builder'][0], 6)
        else: rect(p, x, y, w, 28, CARD, 6, LINE)
        text(p, x, y + 7, s, 12, 700 if s == active else 500, CARD if s == active else INK, width=w, align='center')
        x += w + 4
    return x


# ---- 11 system before / after --------------------------------------------
def arch_canvas(f, x, after):
    title = 'AFTER  ·  to-be with the code graph' if after else 'BEFORE  ·  as-is, rehearse v1 as built'
    c = frame('After' if after else 'Before', x, 236, 910, 660, f, CARD, 12, LINE, clip=True)
    rect(c, 0, 0, 910, 40, '#F0FDF4' if after else '#F8FAFC', 0)
    text(c, 20, 12, title, 13, 800, OK if after else MUTED)
    if after: tag(c, 700, 10, 'draft: from G1–G19', '#92400E', '#FEF3C7')
    else: tag(c, 760, 10, 'docs/system/')
    S = lambda st: st if after else 'same'
    # people
    for (nm, role, yy) in [('Builder', 'builder', 80), ('Agent', 'agent', 330), ('CI', 'ci', 570)]:
        fg, bg = ROLE[role]
        node(c, 20, yy, 130, 50, nm, fg, bg, 4, sw=2)
    dnode(c, 190, 70, 210, 60, 'bb panel', 'same')
    dnode(c, 190, 170, 210, 60, 'host worker', 'same')
    dnode(c, 190, 300, 210, 104 if after else 80, 'rehearse CLI', S('chg'), 'new · validate · simulate\n· gate · serve' + ('\n+ find · show · near · path · context' if after else ''))
    dnode(c, 190, 560, 210, 64, 'rehearse gate check', 'same', 'uses @rehearse/core')
    dnode(c, 450, 70, 220, 60, '@rehearse/ui', S('chg'), '+ code drill-down (D19)' if after else 'Big picture · Stories · …')
    dnode(c, 450, 170, 220, 60, 'rehearse serve', S('chg'), '+ file watcher, graph queries' if after else 'UI + /api/*')
    dnode(c, 450, 270, 220, 64, '@rehearse/core', 'same', 'loader · validate · simulate · trust')
    dcyl(c, 450, 430, 220, 110, 'git repo\ndocs/epics/*.yaml\ncommits' + (' + Flow-Box trailers' if after else ''), S('chg'))
    dnode(c, 720, 560, 170, 64, 'TS + Python source', 'same', '(+ venv)')
    if after:
        dnode(c, 720, 260, 170, 120, '@rehearse/graph', 'add', 'tree-sitter · ts-morph\nPyright · BM25 · PageRank')
        dcyl(c, 740, 430, 150, 100, '.rehearse/\ngraph.db', 'add')
    else:
        rect(c, 720, 260, 170, 270, '#F8FAFC', 8, LINE, 1, dashes=[4, 4], name='empty slot')
        text(c, 730, 380, 'no code graph', 12, 600, GRAY, width=150, align='center')
    # same links
    arrow(c, [[150, 100], [188, 100]], GRAY)
    arrow(c, [[400, 100], [448, 100]], GRAY); label(c, 424, 84, 'iframe')
    arrow(c, [[400, 200], [448, 200]], GRAY); label(c, 424, 184, 'spawns')
    arrow(c, [[560, 132], [560, 168]], GRAY)
    arrow(c, [[560, 232], [560, 268]], GRAY)
    arrow(c, [[150, 355], [188, 355]], GRAY)
    arrow(c, [[400, 320], [448, 320]], GRAY); label(c, 424, 304, 'uses')
    arrow(c, [[560, 336], [560, 428]], GRAY); label(c, 560, 400, 'read / write YAML')
    arrow(c, [[150, 595], [188, 595]], GRAY)
    if after:
        arrow(c, [[400, 365], [718, 365]], OK); label(c, 640, 365, 'find · context', OK)
        path(c, [[670, 200], [805, 200]], OK, 2); arrow(c, [[805, 200], [805, 258]], OK); label(c, 740, 200, 'queries', OK)
        arrow(c, [[815, 382], [815, 434]], OK); label(c, 850, 405, 'cache', OK)
        path(c, [[890, 320], [900, 320], [900, 592]], OK, 2); arrow(c, [[900, 592], [892, 592]], OK)
        label(c, 880, 545, 'parse', OK)
        path(c, [[730, 382], [730, 485]], OK, 2); arrow(c, [[730, 485], [672, 485]], OK)
        label(c, 700, 470, 'trailers', OK)
    return c


def compare_page():
    f = bd.app_shell('Before / after — system', 'Big picture', CG)
    subnav(f, 'Before / after')
    text(f, 40, 88, 'Before / after', 28, 700)
    text(f, 40, 128, 'What this EPIC adds to and changes in the current system. As-is comes from docs/system/; to-be from this EPIC.', 14, 400, MUTED)
    x = seg(f, 40, 160, ['Architecture', 'Flow', 'Entities'], 'Architecture')
    x = seg(f, x + 24, 160, ['Side by side', 'After with diff', 'Before only'], 'Side by side')
    legend_diff(f, x + 40, 166)
    arch_canvas(f, 40, False)
    arch_canvas(f, 970, True)

    # change list
    t = card(f, 'Changes', 40, 912, 1840, 248)
    text(t, 20, 14, 'Changes in this EPIC', 15, 700)
    tag(t, 200, 13, '2 added · 4 changed · 5 same')
    text(t, 400, 16, 'Stories: none yet. This EPIC has only brainstorm.md, so each change links to its decisions. After prd.yaml, each change also links to its story.', 12, 500, '#92400E')
    cols = [(20, 'CHANGE'), (120, 'PART'), (300, 'BEFORE'), (620, 'AFTER'), (1200, 'WHY'), (1560, 'STORY')]
    for cx, s in cols: text(t, cx, 46, s, 10, 700, MUTED)
    rows = [
        ('add', '@rehearse/graph', '—', 'indexer and queries: tree-sitter, ts-morph, Pyright; BM25; PageRank', ['G2', 'G4', 'G14', 'G15']),
        ('add', '.rehearse/graph.db', '—', 'SQLite FTS5 cache; git ignores it; a rebuild makes it again', ['G3', 'G5']),
        ('chg', '@rehearse/cli', 'new · validate · simulate · gate · serve', '+ find · show · near · path · context, each with --json', ['G1', 'G7']),
        ('chg', 'rehearse serve', 'serves the UI and /api/*', '+ watches files, answers graph queries for the panel', ['G5', 'G8']),
        ('chg', '@rehearse/ui', 'review views', '+ code drill-down below a leaf box: code, AST, call graph', ['D19', 'G8']),
        ('chg', 'git repo', 'YAML records, allowed_signers', '+ reads Flow-Box: commit trailers for box → code links', ['G13']),
    ]
    y = 70
    for st, part, before, after, why in rows:
        fg, bg, b = STATE[st]
        chip(t, 20, y, b, fg, bg, 10, 700, 7, 20, 10)
        text(t, 120, y + 3, part, 12, 700, INK)
        text(t, 300, y + 3, before, 12, 500, MUTED)
        text(t, 620, y + 3, after, 12, 500, INK)
        links(t, 1200, y, 'dec', why)
        tag(t, 1560, y, 'no story yet', '#92400E', '#FEF3C7')
        rect(t, 20, y + 26, 1800, 1, LINE)
        y += 28
    return f


# ---- 12 story before / after ---------------------------------------------
def lanes(c, rows):
    for nm, role, y, h in rows:
        fg, bg = ROLE[role] if role else (MUTED, '#F8FAFC')
        rect(c, 0, y, 910, h, bg, 0, name=f'lane {nm}')
        rect(c, 0, y + h - 1, 910, 1, LINE)
        text(c, 12, y + 10, nm, 12, 800, fg)


def story_canvas(f, x, after):
    title = 'AFTER  ·  to-be' if after else 'BEFORE  ·  as-is'
    c = frame('Story after' if after else 'Story before', x, 340, 910, 470, f, CARD, 12, LINE, clip=True)
    rect(c, 0, 0, 910, 40, '#F0FDF4' if after else '#F8FAFC', 0)
    text(c, 20, 12, title, 13, 800, OK if after else MUTED)
    lanes(c, [('Agent', 'agent', 40, 160), ('rehearse', 'rehearse', 200, 160), ('Files', None, 360, 110)])
    S = lambda st: st if after else 'same'
    dnode(c, 600, 90, 140, 64, 'draft-record', S('chg'), '+ in: contextBundle' if after else 'in: epicDir, findings')
    dnode(c, 760, 250, 130, 60, 'validate', 'same')
    path(c, [[740, 122], [825, 122]], GRAY, 2); arrow(c, [[825, 122], [825, 248]], GRAY); label(c, 825, 190, 'epicDir')
    if not after:
        node(c, 110, 90, 380, 64, 'Agent reads code with grep and cat', WARN, '#FEF2F2', 6,
             sub='outside rehearse · not in the record · no budget, no ranking', sw=1.5, dashes=[5, 4])
        path(c, [[490, 122], [598, 122]], GRAY, 2, [5, 4]); arrow(c, [[590, 122], [598, 122]], GRAY)
        text(c, 120, 410, 'no graph.db', 12, 600, GRAY)
        return c
    dnode(c, 110, 90, 140, 64, 'ask for context', 'add', 'in: target, budget')
    dnode(c, 110, 250, 140, 60, 'check freshness', 'add', 'hash, update files')
    dnode(c, 290, 250, 140, 60, 'rank nodes', 'add', 'distance + PageRank')
    dnode(c, 470, 250, 140, 60, 'fill budget', 'add', 'chars ÷ 4 = tokens')
    dcyl(c, 290, 375, 140, 80, 'graph.db', 'add')
    arrow(c, [[180, 156], [180, 248]], OK); label(c, 180, 200, 'target, budget', OK)
    arrow(c, [[250, 280], [288, 280]], OK)
    arrow(c, [[430, 280], [468, 280]], OK)
    path(c, [[610, 280], [670, 280]], OK, 2); arrow(c, [[670, 280], [670, 156]], OK); label(c, 670, 225, 'contextBundle', OK)
    arrow(c, [[360, 312], [360, 373]], OK); label(c, 395, 343, 'read', OK)
    path(c, [[150, 312], [150, 415]], OK, 2); arrow(c, [[150, 415], [288, 415]], OK); label(c, 215, 415, 'update', OK)
    return c


def story_page():
    f = bd.app_shell('Story before / after', 'Stories', CG)
    text(f, 40, 84, 'Stories  /  S1', 13, 600, MUTED)
    c = frame('Story card', 40, 108, 1840, 150, f, CARD, 12, LINE)
    x = 20 + link(c, 20, 18, 'story', 'S1', 13, 24) + 6
    x += chip(c, x, 20, 'Agent', *ROLE['agent'], 11, 600, 8, 20, 10)[1] + 6
    tag(c, x, 20, 'draft · not in prd.yaml yet', '#92400E', '#FEF3C7')
    text(c, 20, 54, 'As an Agent, I want `rehearse context <target> --budget <tokens>`, so that I get the right code in a fixed token budget.', 17, 600, INK)
    text(c, 20, 92, 'Decisions', 11, 700, MUTED)
    links(c, 90, 89, 'dec', ['G1', 'G5', 'G6', 'G11', 'G14'])
    text(c, 20, 120, 'Change in this story', 11, 700, MUTED)
    x = 160
    for st, s in [('add', '4 boxes, 2 entities, 1 NFR'), ('chg', '1 box'), ('same', '1 box')]:
        fg, bg, b = STATE[st]
        x += chip(c, x, 117, f"{b or '= same'}: {s}", fg, bg, 11, 600, 8, 20, 10)[1] + 8
    seg(f, 40, 284, ['WHAT', 'HOW', 'OUTPUT', 'Before / after', 'Code', 'Tests'], 'Before / after')
    legend_diff(f, 560, 290)
    story_canvas(f, 40, False)
    story_canvas(f, 970, True)

    t = card(f, 'Story changes', 40, 826, 1200, 334)
    text(t, 20, 14, 'What changes in this story', 15, 700)
    for cx, s in [(20, 'CHANGE'), (120, 'ITEM'), (330, 'BEFORE'), (560, 'AFTER'), (1010, 'WHY')]:
        text(t, cx, 44, s, 10, 700, MUTED)
    rows = [
        ('add', 'box', 'ask for context', '—', 'in: target, budget → out: contextBundle', ['G1', 'G6']),
        ('add', 'box', 'check freshness', '—', 'compare file hashes, update changed files', ['G5']),
        ('add', 'box', 'rank nodes', '—', 'graph distance + PageRank', ['G6', 'G14']),
        ('add', 'box', 'fill budget', '—', 'fill the token budget; chars ÷ 4', ['G6']),
        ('chg', 'box', 'draft-record', 'in: epicDir, findings', 'in: + contextBundle', ['G8']),
        ('add', 'ent', 'GraphNode, Edge', '—', 'edge trust: exact · name-match · unresolved', ['G4', 'G10']),
        ('add', 'req', 'performance', '—', 'query < 100 ms; one-file update < 300 ms', ['G11']),
        ('same', 'box', 'validate', 'in: epicDir', 'no change', []),
    ]
    y = 66
    for st, kind, item, before, after, why in rows:
        fg, bg, b = STATE[st]
        chip(t, 20, y, b or '= same', fg if st != 'same' else MUTED, bg if st != 'same' else '#F1F5F9', 10, 700, 7, 20, 10)
        link(t, 120, y, kind, item)
        text(t, 330, y + 3, before, 12, 500, MUTED)
        text(t, 560, y + 3, after, 12, 500, INK)
        if why: links(t, 1010, y, 'dec', why)
        rect(t, 20, y + 26, 1160, 1, LINE)
        y += 31

    r = card(f, 'Impact', 1260, 826, 620, 334)
    text(r, 20, 14, 'Impact on the current system', 15, 700)
    n = frame('Impact note', 20, 46, 580, 100, r, '#F0FDF4', 8, '#86EFAC')
    text(n, 14, 12, 'v1 stays valid', 13, 700, '#166534')
    text(n, 14, 34, wrap('draft-record belongs to v1 story S2, which is frozen. This EPIC does not make S2 stale. Its change is a diff on top of the as-is; finalize merges it into docs/system/ (D4, D7, D9).', 84), 12, 500, '#166534', lh='145%')
    text(r, 20, 182, 'TOUCHES IN AS-IS', 11, 700, MUTED)
    x = links(r, 20, 204, 'box', ['draft-record', 'validate'])
    links(r, x, 204, 'story', ['v1 S2'])
    n = frame('Scenario note', 20, 242, 580, 74, r, '#FFFBEB', 8, '#FCD34D')
    text(n, 14, 12, 'Scenarios: 0 of 4 written', 13, 700, '#B45309')
    text(n, 14, 34, wrap('Each new box needs a given/when/then example before the gate (D15). An agent drafts them; you approve them.', 84), 12, 500, '#92400E', lh='145%')
    return f


if __name__ == '__main__':
    bd.clear_document()
    p1 = bd.big_picture(); subnav(p1, 'Feature map')
    bd.new_page('2 Story view'); bd.story_view()
    bd.new_page('3 Scenario storyboard'); bd.storyboard()
    bd.new_page('4 Use cases'); bd.use_cases()
    bd.new_page('5 User flow'); bf.user_flow()
    bd.new_page('6 Data flow'); bf.data_flow()
    bd.new_page('7 System flowchart'); bf.system_flowchart()
    bd.new_page('8 System architecture'); bf.architecture()
    bd.new_page('9 PRD'); bdoc.prd_page()
    bd.new_page('10 Tech spec'); bdoc.spec_page()
    bd.new_page('11 Before after'); compare_page()
    bd.new_page('12 Story before after'); story_page()
    print(ex('file.saveAs', path=ROOT + '/design/rehearse-review.figcraft'))
