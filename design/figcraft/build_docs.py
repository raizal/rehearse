"""Pages 9-10: the PRD and the tech spec as documents. Every ID links into rehearse.

Run: python3 build_docs.py   (redraws pages 1-8 too, then saves)
"""
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, os
import yaml
import build_design as bd
import build_flows as bf
from build_design import ex, rect, ellipse, text, path, arrow, chip, size, frame, wrap, ROLE, INK, MUTED, LINE, BG, CARD, OK, WARN

EPIC = ROOT + '/docs/epics/2026-11-05-rehearse/'
PRD = yaml.safe_load(open(EPIC + 'prd.yaml'))
ENT = {e['id']: e for e in yaml.safe_load(open(EPIC + 'entities.yaml'))['entities']}
REQ = {r['id']: r for r in PRD['requirements']}
STORY = {s['id']: s for s in PRD['stories']}
D = bd.D
BOX = {b['id']: b for b in D['boxes']}
AMBER = '#B45309'

# link kinds: (fg, bg, where the link opens)
LINK = {
    'req': ('#334155', '#F1F5F9', 'Readiness row'),
    'story': ('#2563EB', '#EFF6FF', 'Story view'),
    'box': ('#059669', '#ECFDF5', 'Flow / Tech spec contract'),
    'scn': ('#DB2777', '#FDF2F8', 'Storyboard'),
    'ent': ('#0891B2', '#ECFEFF', 'Tech spec entity'),
    'dec': ('#475569', '#FFFFFF', 'Decision log'),
}


def link(p, x, y, kind, s, fs=11, h=20):
    fg, bg, _ = LINK[kind]
    return chip(p, x, y, s, fg, bg, fs, 600, 7, h, 5, stroke=fg if kind == 'dec' else None)[1]


def links(p, x, y, kind, items, gap=6):
    for s in items:
        x += link(p, x, y, kind, s) + gap
    return x


def tag(p, x, y, s, fg=MUTED, bg='#F1F5F9'):
    return chip(p, x, y, s, fg, bg, 11, 600, 7, 20, 10)[1]


def dot(p, x, y, color):
    ellipse(p, x, y, 8, 8, color, name='status dot')


def scen_state(story_ids):
    sc = [x for sid in story_ids for x in D['scenarios'].get(sid, [])]
    return sum(1 for x in sc if x['status'] == 'approved'), len(sc)


def header(f, title, sub, file_):
    text(f, 40, 88, title, 28, 700)
    text(f, 40, 128, sub, 14, 400, MUTED)
    x = 40
    t = text(f, x, 156, 'Link colours:', 12, 600, MUTED); x += size(t)[0] + 10
    for k, sample in [('req', 'R13'), ('story', 'S6'), ('box', 'approve'), ('scn', 'S6-approve'), ('ent', 'Approval'), ('dec', 'D41')]:
        x += link(f, x, 154, k, sample) + 6
        t = text(f, x, 157, '→ ' + LINK[k][2], 11, 500, MUTED); x += size(t)[0] + 18
    chip(f, 1640, 92, 'Source: ' + file_, MUTED, CARD, 12, 600, 10, 28, 6, LINE)


def card(f, name, x, y, w, h):
    return frame(name, x, y, w, h, f, CARD, 12, LINE, clip=True)


def toc(f, items, active):
    t = card(f, 'Contents', 40, 190, 220, 970)
    text(t, 18, 18, 'CONTENTS', 11, 700, MUTED)
    y = 46
    for s, n in items:
        if s == active: rect(t, 8, y - 6, 204, 30, '#EFF6FF', 6)
        text(t, 18, y, s, 13, 700 if s == active else 500, ROLE['builder'][0] if s == active else INK)
        if n: text(t, 170, y, n, 12, 500, MUTED, width=34, align='right')
        y += 34
    return t


def section(p, x, y, s, n=None):
    t = text(p, x, y, s, 16, 700)
    if n: tag(p, x + size(t)[0] + 10, y + 1, n)


def open_rows(p, x, y, w, rows):
    for kind, a, b in rows:
        rect(p, x, y, w, 34, CARD, 6, LINE)
        fg = LINK[kind][0]
        rect(p, x, y, 4, 34, fg, 2)
        t = text(p, x + 16, y + 9, a, 12, 700, INK)
        text(p, x + 24 + size(t)[0], y + 9, b, 12, 500, MUTED)
        text(p, x + w - 30, y + 8, '→', 13, 700, fg)
        y += 40
    return y


# ---- 9 PRD ---------------------------------------------------------------
def prd_page():
    f = bd.app_shell('PRD — prd.yaml as a document', 'PRD')
    e = PRD['epic']
    header(f, 'PRD', f"prd.yaml · {len(REQ)} requirements · {len(STORY)} stories · {len(PRD['roles'])} roles. Every ID opens the place in rehearse where it lives.", 'prd.yaml')
    toc(f, [('Goal', ''), ('Roles', str(len(PRD['roles']))), ('Requirements', str(len(REQ))), ('Stories', str(len(STORY))),
            ('Out of scope', str(len(e['outOfScope']))), ('Resolved questions', str(len(PRD['resolvedQuestions'])))], 'Requirements')

    d = card(f, 'PRD document', 280, 190, 1020, 970)
    text(d, 32, 24, 'EPIC  ·  2026-11-05-rehearse', 11, 700, MUTED)
    text(d, 32, 42, e['title'], 20, 700)
    t = text(d, 32, 76, wrap(e['goal'], 130), 14, 400, INK, lh='150%')
    y = 76 + size(t)[1] + 12
    text(d, 32, y, 'Success measure', 11, 700, MUTED)
    t = text(d, 150, y - 1, e['successMeasure'].replace(' (D34)', ''), 12, 500, INK)
    x = 150 + size(t)[0] + 8
    x += link(d, x, y - 3, 'dec', 'D34') + 6
    link(d, x, y - 3, 'ent', 'Correction')
    y += 34
    text(d, 32, y, 'Roles', 11, 700, MUTED)
    x = 150
    for r in PRD['roles']:
        fg, bg = ROLE[r['id']]
        x += chip(d, x, y - 3, f"{r['name']} · {r['kind']}", fg, bg, 11, 600, 8, 20, 10)[1] + 6
    text(d, x + 8, y, '→ lane in Flow, actor in Use cases', 11, 500, MUTED)

    # requirements table
    y += 44
    section(d, 32, y, 'Requirements', str(len(REQ)))
    kinds = {}
    for r in REQ.values(): kinds[r['kind']] = kinds.get(r['kind'], 0) + 1
    x = 600
    for k, n in [('All', len(REQ))] + sorted(kinds.items(), key=lambda kv: -kv[1]):
        x += tag(d, x, y + 1, f'{k} {n}', CARD if k == 'All' else MUTED, ROLE['builder'][0] if k == 'All' else '#F1F5F9') + 6
    y += 36
    for cx, s in [(32, 'ID'), (92, 'KIND'), (196, 'REQUIREMENT'), (700, 'STORIES'), (800, 'PROOF IN REHEARSE')]:
        text(d, cx, y, s, 10, 700, MUTED)
    rect(d, 32, y + 20, 956, 1, LINE)
    y += 28
    for rid in ['R11', 'R12', 'R13', 'R14', 'R15', 'R16']:
        r = REQ[rid]
        sel = rid == 'R13'
        if sel:
            rect(d, 24, y, 972, 56, '#EFF6FF', 6, name='selected row')
            rect(d, 24, y, 4, 56, ROLE['builder'][0], 2)
        link(d, 32, y + 10, 'req', rid)
        tag(d, 92, y + 10, r['kind'])
        lines = wrap(r['text'], 82).split('\n')
        txt = '\n'.join(lines[:2]) + (' …' if len(lines) > 2 else '')
        text(d, 196, y + 8, txt, 12, 400, INK, lh='140%')
        sids = [s['id'] for s in PRD['stories'] if rid in s['requirements']]
        links(d, 700, y + 10, 'story', sids)
        a, n = scen_state(sids)
        dot(d, 800, y + 14, AMBER if a else MUTED)
        text(d, 814, y + 9, f'{a}/{n} scenarios approved', 12, 600, INK)
        text(d, 814, y + 27, 'approvals not signed yet', 11, 500, AMBER)
        rect(d, 32, y + 56, 956, 1, LINE)
        y += 58
    text(d, 32, y + 8, f'Show {len(REQ) - 6} more requirements', 12, 600, ROLE['builder'][0])

    # story card
    y += 44
    section(d, 32, y, 'Stories', str(len(STORY)))
    y += 32
    s6 = STORY['S6']
    c = frame('Story S6', 32, y, 956, 208, d, CARD, 10, ROLE['builder'][0], 1.5)
    x = 16 + link(c, 16, 14, 'story', 'S6') + 6
    x += chip(c, x, 14, 'Builder', *ROLE['builder'], 11, 600, 8, 20, 10)[1] + 6
    tag(c, x, 14, 'draft · not signed')
    text(c, 16, 44, f"As a Builder, I want {s6['want']}, so that {s6['soThat']}.", 15, 600, INK)
    text(c, 16, 76, 'ACCEPTANCE CRITERIA', 10, 700, MUTED)
    scn = [x_['id'] for x_ in D['scenarios']['S6']]
    for i, ac in enumerate(s6['acceptance']):
        yy = 94 + i * 26
        tag(c, 16, yy, ac['id'])
        s = f"Given {ac['given']}, when {ac['when']}, then {ac['then']}"
        text(c, 82, yy + 3, s if len(s) < 108 else s[:105] + '…', 12, 400, INK)
        text(c, 730, yy + 3, 'proved by', 11, 500, MUTED)
        w = link(c, 790, yy, 'scn', scn[i])
        dot(c, 796 + w, yy + 6, AMBER)
    yy = 174
    text(c, 16, yy + 3, 'Requirement', 11, 700, MUTED)
    link(c, 96, yy, 'req', 'R13')
    text(c, 150, yy + 3, 'Boxes', 11, 700, MUTED)
    bx = 196
    approve_x = bx
    bx += link(c, bx, yy, 'box', 'approve') + 6
    link(c, bx, yy, 'box', 'content-changed')
    x = 956 - 16
    for s in ['Open storyboard  →', 'Open story view  →']:
        t = text(c, 0, 0, s, 12, 700, ROLE['builder'][0]); w = size(t)[0]; ex('edit.delete', ids=[t])
        x -= w + 24
        chip(c, x, yy - 4, s, ROLE['builder'][0], CARD, 12, 700, 12, 28, 6, ROLE['builder'][0])
        x -= 8

    # hover popover on the 'approve' box link
    px, py = 32 + approve_x - 20, y + yy - 168
    rect(d, px + 4, py + 6, 360, 150, '#0F172A22', 10, name='popover shadow')
    pop = frame('Popover box approve', px, py, 360, 150, d, CARD, 10, LINK['box'][0], 1.5)
    x = 14 + link(pop, 14, 12, 'box', 'approve') + 6
    tag(pop, x, 12, 'input · Builder lane')
    text(pop, 14, 40, BOX['approve']['title'], 13, 700)
    text(pop, 14, 62, 'in  scenarioIds   →   out  approvals', 12, 500, INK)
    text(pop, 14, 82, 'writes', 11, 700, MUTED)
    x = 60 + link(pop, 60, 79, 'ent', 'Scenario.status  draft → approved') + 6
    link(pop, 60, 103, 'ent', 'Approval.*')
    text(pop, 14, 126, 'Open in Flow   ·   Contract in Tech spec  →', 12, 700, LINK['box'][0])
    ex('vector.create', parent=d, points=[[0, 0], [16, 0], [8, 9]], x=px + 28, y=py + 149, closed=True,
       props={"fill": CARD, "stroke": LINK['box'][0], "strokeWeight": 1.5}, select=False)

    # right panel: what R13 links to
    r = card(f, 'Linked in rehearse', 1320, 190, 560, 970)
    text(r, 20, 18, 'SELECTED  ·  LINKED IN REHEARSE', 11, 700, MUTED)
    x = 20 + link(r, 20, 40, 'req', 'R13', 13, 24) + 6
    tag(r, x, 42, 'functional')
    body = REQ['R13']['text'].replace(' (D41)', '')
    t = text(r, 20, 76, wrap(body, 74), 12, 400, INK, lh='150%')
    y = 76 + size(t)[1] + 6
    text(r, 20, y + 3, 'Cites', 11, 700, MUTED); link(r, 60, y, 'dec', 'D41')
    y += 40

    text(r, 20, y, 'TRACE', 11, 700, MUTED)
    y += 24
    cols = [20, 96, 176, 340]
    link(r, cols[0], y + 46, 'req', 'R13')
    link(r, cols[1], y + 46, 'story', 'S6')
    path(r, [[62, y + 56], [94, y + 56]], LINE, 2)
    for i, b in enumerate(['approve', 'content-changed']):
        by = y + 26 + i * 40
        link(r, cols[2], by, 'box', b)
        path(r, [[124, y + 56], [150, y + 56], [150, by + 10], [174, by + 10]], LINE, 2)
    for i, sc in enumerate(scn):
        sy = y + i * 46
        link(r, cols[3], sy + 4, 'scn', sc)
        dot(r, cols[3], sy + 30, AMBER)
        text(r, cols[3] + 14, sy + 27, 'approved · not signed', 11, 500, AMBER)
        path(r, [[248, y + 36], [300, y + 36], [300, sy + 14], [338, sy + 14]], LINE, 2)
    y += 150

    text(r, 20, y, 'OPEN IN REHEARSE', 11, 700, MUTED)
    y = open_rows(r, 20, y + 22, 520, [
        ('story', 'Story view', 'S6  ·  WHAT · HOW · OUTPUT'),
        ('scn', 'Storyboard', 'S6-approve  ·  one card per step'),
        ('box', 'Flow', 'box approve in the Builder lane'),
        ('box', 'Use cases', 'Builder → Approve → Scenario, Approval'),
        ('req', 'Readiness', 'row R13: requirement → story → box → scenario'),
    ])
    y += 14
    text(r, 20, y, 'LINKED FROM TECH SPEC', 11, 700, MUTED)
    x = links(r, 20, y + 22, 'ent', ['Approval', 'Scenario'])
    x = links(r, x, y + 22, 'box', ['approve'])
    links(r, x, y + 22, 'dec', ['D15', 'D41'])
    y += 66
    n = frame('Gate note', 20, y, 520, 92, r, '#FFFBEB', 8, '#FCD34D')
    text(n, 14, 12, 'Gate: R13 is not proved yet', 13, 700, AMBER)
    text(n, 14, 34, wrap('The 3 scenarios are approved, but the approvals have no SSH signature. Approve them again in the UI, then they count as evidence.', 80), 12, 500, '#92400E', lh='145%')
    return f


# ---- 10 tech spec --------------------------------------------------------
def ents_of(writes):
    out = []
    for w in writes:
        e_ = w.split('.')[0]
        if e_ not in out: out.append(e_)
    return out


def spec_page():
    f = bd.app_shell('Tech spec — flow, contracts, entities', 'Tech spec')
    header(f, 'Tech spec', 'flow.yaml + entities.yaml + non-functional requirements. Not prose (D20). Every name opens the place in rehearse where it lives.', 'flow.yaml · entities.yaml')
    toc(f, [('Box contracts', str(len(BOX))), ('Entity model', str(len(ENT))), ('Lifecycles', '3'),
            ('Non-functional', '2'), ('Decisions', '42'), ('Corrections', '')], 'Box contracts')

    d = card(f, 'Tech spec document', 280, 190, 1020, 970)
    section(d, 32, 24, 'Box contracts', f'{len(BOX)} root boxes')
    text(d, 270, 27, 'Each box declares its inputs, outputs, state writes and error exits (D10).', 12, 500, MUTED)
    y = 60
    for cx, s in [(32, 'BOX'), (190, 'LANE'), (290, 'IN  →  OUT'), (530, 'WRITES'), (760, 'STORIES'), (880, 'SCENARIOS')]:
        text(d, cx, y, s, 10, 700, MUTED)
    rect(d, 32, y + 20, 956, 1, LINE)
    y += 26
    for bid in ['new-epic', 'draft-record', 'validate', 'simulate', 'review', 'approve', 'gate', 'sign-off', 'content-changed', 'ci-run']:
        b = BOX[bid]
        if bid == 'approve':
            rect(d, 24, y, 972, 38, '#ECFDF5', 6, name='selected row')
            rect(d, 24, y, 4, 38, LINK['box'][0], 2)
        link(d, 32, y + 9, 'box', bid)
        fg, bg = ROLE[b['lane']]
        chip(d, 190, y + 9, bd.role_name(b['lane']), fg, bg, 11, 600, 8, 20, 10)
        io = f"{', '.join(b['inputs']) or '—'}  →  {', '.join(b['outputs']) or '—'}"
        text(d, 290, y + 11, io if len(io) < 36 else io[:34] + '…', 12, 500, INK)
        es = ents_of(b['writes'])
        if es: links(d, 530, y + 9, 'ent', es[:3])
        else: text(d, 530, y + 11, 'reads only', 12, 500, MUTED)
        links(d, 760, y + 9, 'story', b['stories'][:2])
        a, n = scen_state(b['stories'])
        if n:
            dot(d, 880, y + 15, AMBER if a else MUTED); text(d, 894, y + 11, f'{a}/{n} approved', 12, 500, INK)
        rect(d, 32, y + 38, 956, 1, LINE)
        y += 40
    text(d, 32, y + 8, f'Show {len(BOX) - 10} more boxes (decisions, start and end)', 12, 600, ROLE['builder'][0])

    # entity model
    y += 44
    section(d, 32, y, 'Entity model', f'{len(ENT)} entities')
    y += 34
    for i, eid in enumerate(['Story', 'Scenario', 'Approval']):
        e = ENT[eid]
        cx = 32 + i * 322
        c = frame(f'Entity {eid}', cx, y, 306, 190, d, CARD, 10, LINK['ent'][0] if eid != 'Story' else LINE, 1.5)
        link(c, 14, 12, 'ent', eid, 13, 24)
        if e.get('about'): text(c, 14, 42, wrap(e['about'], 46), 11, 500, MUTED, lh='140%')
        fy = 76 if e.get('about') else 46
        for k, v in list(e['fields'].items())[:7]:
            text(c, 14, fy, k, 11, 600, INK)
            if 'ref ' in v:
                pre, ref = v.split('ref ')
                x = 120
                if pre.strip(): t = text(c, x, fy, pre.strip(), 11, 500, MUTED); x += size(t)[0] + 6
                link(c, x, fy - 3, 'ent', ref, 10, 18)
            else:
                text(c, 120, fy, v if len(v) < 28 else v[:26] + '…', 11, 500, MUTED)
            fy += 20 if 'ref ' in v else 17
    y += 206

    # lifecycle
    text(d, 32, y, 'Lifecycle', 13, 700)
    x = 32 + 80
    link(d, x, y - 3, 'ent', 'Scenario.status')
    text(d, 300, y, 'Any other transition is an error. Each arrow is done by one box.', 12, 500, MUTED)
    y += 30
    st = [('draft', 60), ('approved', 330), ('stale', 600)]
    for s, sx in st:
        rect(d, sx, y, 130, 40, '#F8FAFC', 20, INK, 1.5, name=f'state {s}')
        text(d, sx, y + 11, s, 13, 700, INK, width=130, align='center')
    arrow(d, [[190, y + 20], [328, y + 20]], INK)
    link(d, 216, y - 2, 'box', 'approve', 10, 18)
    arrow(d, [[460, y + 14], [598, y + 14]], INK)
    link(d, 470, y - 10, 'box', 'content-changed', 10, 18)
    arrow(d, [[598, y + 28], [462, y + 28]], INK)
    link(d, 500, y + 32, 'box', 'approve', 10, 18)
    text(d, 760, y + 4, 'by Builder: approve', 11, 600, ROLE['builder'][0])
    text(d, 760, y + 22, 'by rehearse: content-changed', 11, 600, ROLE['rehearse'][0])
    ellipse(d, 30, y + 14, 12, 12, INK); arrow(d, [[42, y + 20], [58, y + 20]], INK)

    # non-functional
    y += 74
    section(d, 32, y, 'Non-functional requirements', '2')
    y += 30
    for rid in ['R17', 'R20']:
        rq = REQ[rid]
        link(d, 32, y, 'req', rid); tag(d, 86, y, rq['kind'])
        t = rq['text']
        text(d, 196, y + 3, t if len(t) < 72 else t[:70] + '…', 12, 400, INK)
        text(d, 660, y + 3, 'proved by: ' + rq['provenBy'], 11, 600, OK)
        y += 28

    # right panel: the approve box
    r = card(f, 'Linked in rehearse', 1320, 190, 560, 970)
    text(r, 20, 18, 'SELECTED BOX  ·  LINKED IN REHEARSE', 11, 700, MUTED)
    b = BOX['approve']
    x = 20 + link(r, 20, 40, 'box', 'approve', 13, 24) + 6
    x += tag(r, x, 42, 'input') + 6
    chip(r, x, 42, 'Builder lane', *ROLE['builder'], 11, 600, 8, 20, 10)
    text(r, 20, 76, b['title'], 17, 700)
    c = frame('Contract', 20, 108, 520, 168, r, '#F8FAFC', 8, LINE)
    rows = [('inputs', 'scenarioIds'), ('outputs', 'approvals'), ('writes', None), ('', None), ('', None), ('errors', 'none')]
    wr = ['Scenario.status  draft → approved', 'Scenario.status  stale → approved', 'Approval.*']
    yy = 14
    for i, (k, v) in enumerate(rows):
        text(c, 16, yy + 2, k, 12, 700, MUTED)
        if v: text(c, 100, yy + 2, v, 12, 600, INK)
        else: link(c, 100, yy, 'ent', wr[i - 2])
        yy += 25
    y = 292
    text(r, 20, y, 'TRACES TO', 11, 700, MUTED)
    x = links(r, 20, y + 22, 'story', ['S6'])
    x = links(r, x, y + 22, 'req', ['R13'])
    links(r, x, y + 22, 'dec', ['D10', 'D15', 'D41'])
    y += 62
    text(r, 20, y, 'PROVED BY', 11, 700, MUTED)
    x = 20
    for sc in [x_['id'] for x_ in D['scenarios']['S6']]:
        w = link(r, x, y + 22, 'scn', sc); dot(r, x + w + 4, y + 28, AMBER); x += w + 22
    text(r, 20, y + 50, '3 approved · approvals not signed yet', 11, 500, AMBER)
    y += 86
    text(r, 20, y, 'SHOWN IN THE TOOL', 11, 700, MUTED)
    y = open_rows(r, 20, y + 22, 520, [
        ('box', 'Big picture', 'column approve, story line S6'),
        ('story', 'Story view', 'S6  ·  HOW lane'),
        ('scn', 'Storyboard', 'S6-approve, card 1'),
        ('box', 'Use cases', 'Builder → Approve'),
        ('box', 'Data flow', '4.0 Review and approve'),
        ('box', 'System flowchart', 'POST /api/approve'),
        ('req', 'PRD', 'R13, story S6'),
    ])
    y += 14
    n = frame('Change rule', 20, y, 520, 76, r, '#F0FDF4', 8, '#86EFAC')
    text(n, 14, 12, 'Change rule', 13, 700, '#166534')
    text(n, 14, 34, wrap('A change to this contract goes in corrections.md with a reason, and makes S6 and its scenarios stale (D7, D23).', 82), 12, 500, '#166534', lh='145%')
    return f


if __name__ == '__main__':
    bd.clear_document()
    p1 = bd.big_picture(); bf.subnav(p1, 'Feature map')
    bd.new_page('2 Story view'); bd.story_view()
    bd.new_page('3 Scenario storyboard'); bd.storyboard()
    bd.new_page('4 Use cases'); bd.use_cases()
    bd.new_page('5 User flow'); bf.user_flow()
    bd.new_page('6 Data flow'); bf.data_flow()
    bd.new_page('7 System flowchart'); bf.system_flowchart()
    bd.new_page('8 System architecture'); bf.architecture()
    bd.new_page('9 PRD'); prd_page()
    bd.new_page('10 Tech spec'); spec_page()
    print(ex('file.saveAs', path=ROOT + '/design/rehearse-review.figcraft'))
