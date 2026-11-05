"""Draw the rehearse review UI (D42) in FigCraft through its control server.

Run: python3 build_design.py   (FigCraft must listen on 127.0.0.1:4800)
Data: epic.json (a snapshot) in this folder, made from docs/epics/2026-11-05-rehearse.
"""
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, os, socket, textwrap

_id = [0]


def rpc(method, params=None, timeout=60):
    _id[0] += 1
    s = socket.create_connection(('127.0.0.1', 4800)); s.settimeout(timeout)
    s.sendall((json.dumps({"id": _id[0], "method": method, "params": params or {}}) + '\n').encode())
    b = b''
    while not b.endswith(b'\n'):
        d = s.recv(1 << 20)
        if not d: break
        b += d
    s.close(); r = json.loads(b)
    if not r.get('ok'):
        raise RuntimeError(f"{method} {json.dumps(params)[:300]}: {r.get('error')}")
    return r.get('result')


def ex(cmd, **p): return rpc('engine.execute', {"command": cmd, "params": p})


D = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'epic.json')))

# ---- palette -------------------------------------------------------------
INK, MUTED, LINE, BG, CARD = '#0F172A', '#64748B', '#E2E8F0', '#F8FAFC', '#FFFFFF'
ROLE = {  # main colour, tint
    'builder': ('#2563EB', '#EFF6FF'),
    'agent': ('#7C3AED', '#F5F3FF'),
    'rehearse': ('#059669', '#ECFDF5'),
    'ci': ('#D97706', '#FFFBEB'),
}
SHARED = '#EA580C'
OK, WARN = '#16A34A', '#DC2626'

# ---- primitives ----------------------------------------------------------
def frame(name, x, y, w, h, parent=None, fill=CARD, radius=0, stroke=None, sw=1, clip=False):
    props = {"fill": fill, "cornerRadius": radius, "clip": clip}
    if stroke: props.update(stroke=stroke, strokeWeight=sw, strokeAlign='inside')
    p = dict(type='frame', x=x, y=y, width=w, height=h, name=name, props=props, select=False)
    if parent: p['parent'] = parent
    return ex('node.create', **p)['id']


def rect(parent, x, y, w, h, fill, radius=0, stroke=None, sw=1, name='rect', dashes=None):
    props = {"fill": fill, "cornerRadius": radius}
    if stroke: props.update(stroke=stroke, strokeWeight=sw, strokeAlign='inside')
    if dashes: props['dashes'] = dashes
    return ex('node.create', type='rectangle', parent=parent, x=x, y=y, width=w, height=h, name=name, props=props, select=False)['id']


def ellipse(parent, x, y, w, h, fill, stroke=None, sw=1, name='ellipse'):
    props = {"fill": fill}
    if stroke: props.update(stroke=stroke, strokeWeight=sw, strokeAlign='inside')
    return ex('node.create', type='ellipse', parent=parent, x=x, y=y, width=w, height=h, name=name, props=props, select=False)['id']


def text(parent, x, y, s, size=14, weight=400, color=INK, width=None, align='left', name=None, lh=None):
    props = {"fontSize": size, "fontWeight": weight, "fills": [color], "textAlign": align}
    if lh: props['lineHeight'] = lh
    p = dict(text=s, x=x, y=y, parent=parent, props=props, select=False)
    if width: p['width'] = width
    if name: p['name'] = name
    return ex('text.create', **p)['id']


def size(nid):
    n = rpc('node.get', {"id": nid}); return n['width'], n['height']


def path(parent, pts, color=MUTED, sw=2, dashes=None, name='line'):
    x0 = min(p[0] for p in pts); y0 = min(p[1] for p in pts)
    props = {"stroke": color, "strokeWeight": sw, "fill": "none"}
    if dashes: props['dashes'] = dashes
    return ex('vector.create', parent=parent, points=[[p[0] - x0, p[1] - y0] for p in pts], x=x0, y=y0,
              closed=False, name=name, props=props, select=False)['id']


def head(parent, x, y, d, color=MUTED, s=8):
    """Arrowhead with its tip at (x, y), pointing r/l/u/d."""
    pts = {'r': [[x, y], [x - s, y - s / 1.6], [x - s, y + s / 1.6]],
           'l': [[x, y], [x + s, y - s / 1.6], [x + s, y + s / 1.6]],
           'd': [[x, y], [x - s / 1.6, y - s], [x + s / 1.6, y - s]],
           'u': [[x, y], [x - s / 1.6, y + s], [x + s / 1.6, y + s]]}[d]
    x0 = min(p[0] for p in pts); y0 = min(p[1] for p in pts)
    return ex('vector.create', parent=parent, points=[[p[0] - x0, p[1] - y0] for p in pts], x=x0, y=y0,
              closed=True, name='arrowhead', props={"fill": color, "stroke": "none"}, select=False)['id']


def arrow(parent, pts, color=MUTED, sw=2, dashes=None):
    path(parent, pts, color, sw, dashes, name='arrow')
    (ax, ay), (bx, by) = pts[-2], pts[-1]
    d = 'r' if bx > ax else 'l' if bx < ax else 'd' if by > ay else 'u'
    head(parent, bx, by, d, color)


def chip(parent, x, y, label, fg, bg, fs=11, weight=600, padx=8, h=20, radius=10, stroke=None):
    """Pill with a label. Returns (id, width)."""
    r = rect(parent, x, y, 10, h, bg, radius, stroke=stroke, name=f'chip {label}')
    t = text(parent, x + padx, y, label, fs, weight, fg)
    w, th = size(t)
    ex('node.set', ids=[r], props={"width": w + 2 * padx})
    ex('node.set', ids=[t], props={"y": y + (h - th) / 2})
    return r, w + 2 * padx


def size_of(nid):
    return size(nid)


def wrap(s, n): return '\n'.join(textwrap.wrap(s, n))


def role_name(rid): return next(r['name'] for r in D['roles'] if r['id'] == rid)


def find_box(path_):
    parts = path_.split('/')
    b = next((x for x in D['boxes'] if x['id'] == parts[0]), None)
    if b and len(parts) > 1:
        c = next((x for x in b['children'] if x['id'] == parts[1]), None)
        return c or b
    return b


def clear_document():
    pages = ex('page.list')
    keep = pages[0]['id']
    for p in pages[1:]:
        ex('page.delete', id=p['id'])
    ex('page.select', id=keep)
    ids = ex('node.find', root=keep)['ids']
    if ids: ex('edit.delete', ids=ids)
    ex('page.rename', id=keep, name='1 Big picture')
    ex('page.setBackground', id=keep, color='#E5E7EB')
    return keep


def new_page(name):
    pid = ex('page.add', name=name)['id']
    ex('page.select', id=pid)
    ex('page.setBackground', id=pid, color='#E5E7EB')
    return pid


def app_shell(name, tab, epic='2026-11-05-rehearse  ·  draft'):
    """Window frame with the top bar and tabs of the served UI. Returns (frame id, content y)."""
    f = frame(name, 0, 0, 1920, 1200, fill=BG, clip=True)
    rect(f, 0, 0, 1920, 64, CARD, name='top bar')
    rect(f, 0, 63, 1920, 1, LINE, name='top bar line')
    text(f, 32, 20, 'rehearse', 20, 700, INK)
    text(f, 140, 24, epic, 13, 500, MUTED)
    x = 480
    for t in ['PRD', 'Tech spec', 'Big picture', 'Stories', 'Use cases', 'Readiness', 'Sign off', 'Flow']:
        tid = text(f, x, 22, t, 14, 600 if t == tab else 500, ROLE['builder'][0] if t == tab else MUTED)
        w, _ = size(tid)
        if t == tab: rect(f, x, 61, w, 3, ROLE['builder'][0], 1, name='active tab')
        x += w + 36
    cid, cw = chip(f, 1640, 22, 'Signing: key SHA256:9fQ…k2', OK, '#F0FDF4')
    return f


# ---- page 1: big picture -------------------------------------------------
STORY_BOXES = ['new-epic', 'draft-record', 'validate', 'simulate', 'log-correction', 'review', 'approve', 'gate',
               'sign-off', 'content-changed', 'ci-run']
COL = {'new-epic': 0, 'draft-record': 1, 'validate': 2, 'simulate': 3, 'log-correction': 3, 'content-changed': 4,
       'review': 5, 'approve': 6, 'gate': 7, 'sign-off': 8, 'ci-run': 2}


def big_picture():
    f = app_shell('Big picture — whole EPIC', 'Big picture')
    text(f, 40, 96, 'The whole EPIC', 28, 700)
    text(f, 40, 136, wrap('Who does what, which processes each feature (story) runs through, and what the features share.', 120), 15, 400, MUTED)
    # counts
    n_sc = sum(len(v) for v in D['scenarios'].values())
    x = 40
    for label in [f"{len(D['roles'])} roles", f"{len(D['stories'])} stories", f"{len(STORY_BOXES)} processes",
                  f"{n_sc} scenarios", '0 of 10 stories signed']:
        _, w = chip(f, x, 172, label, INK, CARD, 12, 600, 10, 26, 13, stroke=LINE)
        x += w + 8

    # map card
    mx, my, mw, mh = 40, 220, 1456, 940
    m = frame('Feature map', mx, my, mw, mh, f, CARD, 12, LINE)
    text(m, 24, 20, 'Feature map', 18, 700)
    text(m, 24, 48, 'Rows are roles. Boxes are processes. Chips under a box are the stories that use it.', 13, 400, MUTED)
    # legend
    lx = 820
    rect(m, lx, 24, 16, 16, CARD, 4, SHARED, 2, name='legend shared'); text(m, lx + 22, 24, 'Shared by 2+ stories', 12, 500, MUTED)
    rect(m, lx + 190, 24, 16, 16, '#FEF3C7', 4, '#F59E0B', 2, name='legend selected'); text(m, lx + 212, 24, 'Selected story: S6', 12, 500, MUTED)
    path(m, [[lx + 360, 32], [lx + 390, 32]], MUTED, 2, [6, 4]); text(m, lx + 396, 24, 'loop back', 12, 500, MUTED)

    lanes = [l['role'] for l in sorted(D['lanes'], key=lambda l: l['order'])]
    LX, LY, LH, CW, BW, BH = 24, 88, 200, 146, 128, 84
    ox = LX + 116
    pos = {}
    for i, rid in enumerate(lanes):
        c, tint = ROLE[rid]
        y = LY + i * LH
        rect(m, LX, y, mw - 48, LH - 12, tint, 10, name=f'lane {rid}')
        rect(m, LX, y, 6, LH - 12, c, 3, name=f'lane mark {rid}')
        text(m, LX + 20, y + 16, role_name(rid), 16, 700, c)
        kind = next(r['kind'] for r in D['roles'] if r['id'] == rid)
        text(m, LX + 20, y + 40, kind, 12, 500, MUTED)
    selected = 'S6'
    for bid in STORY_BOXES:
        b = find_box(bid)
        i = lanes.index(b['lane'])
        x = ox + COL[bid] * CW
        y = LY + i * LH + 30
        pos[bid] = (x, y)
        c, tint = ROLE[b['lane']]
        shared = len(b['stories']) > 1
        sel = selected in b['stories']
        stroke, sw = (SHARED, 2.5) if shared else (c, 1.5)
        fill = '#FEF3C7' if sel else CARD
        rect(m, x, y, BW, BH, fill, 10, stroke, sw, name=f'box {bid}')
        title = {'ci-run': 'CI runs validate, simulate, gate'}.get(bid, b['title'])
        text(m, x + 10, y + 10, wrap(title, 16), 13, 600, INK, name=f'title {bid}', lh='130%')
        kinds = {'input': 'person acts', 'process': 'process', 'output': 'shows', 'external': 'external run'}
        text(m, x + 10, y + BH - 22, kinds.get(b['kind'], b['kind']), 11, 500, MUTED)
        if shared:
            _, w = chip(m, x + BW - 56, y - 10, 'shared', CARD, SHARED, 10, 700, 7, 18, 9)
        cx = x
        for s in b['stories']:
            sel_s = s == selected
            _, w = chip(m, cx, y + BH + 8, s, CARD if sel_s else c, '#F59E0B' if sel_s else CARD, 11, 700, 7, 20, 10,
                        stroke=None if sel_s else c)
            cx += w + 4

    def edge(a, b_, dash=None, label=None, color=MUTED):
        (ax, ay), (bx, by) = pos[a], pos[b_]
        if ay == by:  # same lane
            arrow(m, [[ax + BW, ay + BH / 2], [bx, by + BH / 2]], color, 2, dash)
        elif ax + BW <= bx:  # forward, other lane: elbow
            midx = ax + BW + (CW - BW) / 2
            arrow(m, [[ax + BW, ay + BH / 2], [midx, ay + BH / 2], [midx, by + BH / 2], [bx, by + BH / 2]], color, 2, dash)
        else:  # same column: vertical
            cx = ax + BW / 2
            if ay < by: arrow(m, [[cx, ay + BH + 34], [cx, by]], color, 2, dash)
            else: arrow(m, [[cx, ay], [cx, by + BH + 34]], color, 2, dash)
        if label and ax == bx:
            text(m, ax + BW / 2 + 8, (ay + by + BH) / 2 + 10, label, 11, 600, color)
        elif label:
            text(m, (ax + bx + BW) / 2 - 10, min(ay, by) + BH / 2 - 20, label, 11, 600, color)

    for a, b_ in [('new-epic', 'draft-record'), ('draft-record', 'validate'), ('validate', 'simulate'),
                  ('simulate', 'review'), ('review', 'approve'), ('approve', 'gate'), ('gate', 'sign-off')]:
        edge(a, b_)
    edge('simulate', 'log-correction', [6, 4], 'errors')
    edge('content-changed', 'review', [6, 4])
    # loops back to draft
    lc = pos['log-correction']; dr = pos['draft-record']
    arrow(m, [[lc[0], lc[1] + BH / 2], [dr[0] + BW, dr[1] + BH / 2]], MUTED, 2, [6, 4])
    text(m, dr[0] + BW + 14, dr[1] + BH / 2 - 20, 'fix the draft', 11, 600, MUTED)
    # CI note
    ci = pos['ci-run']
    text(m, ci[0] + BW + 20, ci[1] + 6, wrap('Runs validate, simulate and gate --json headless. Exit code 0 lets the PR merge.', 46), 12, 400, MUTED, lh='140%')

    # feature list
    px = 1516
    p = frame('Features', px, my, 364, mh, f, CARD, 12, LINE)
    text(p, 20, 20, 'Features (stories)', 18, 700)
    text(p, 20, 48, 'Click one to see its line on the map.', 13, 400, MUTED)
    y = 84
    for s in D['stories']:
        sel = s['id'] == selected
        c, tint = ROLE[s['role']]
        h = 78
        if sel: rect(p, 8, y - 6, 348, h, '#FEF3C7', 8, '#F59E0B', 1.5, name=f'selected {s["id"]}')
        text(p, 20, y, s['id'], 14, 700, INK)
        chip(p, 60, y, role_name(s['role']), c, tint, 11, 600, 7, 20, 10)
        boxes = [b['id'] for b in D['boxes'] if s['id'] in b['stories']]
        n = len(D['scenarios'].get(s['id'], []))
        text(p, 230, y + 2, f"{len(boxes)} proc · {n} scen", 11, 500, MUTED)
        text(p, 20, y + 26, wrap('wants ' + s['want'], 46), 12, 400, INK, lh='140%')
        y += h + 6
    return f


# ---- page 2: story view --------------------------------------------------
def story_view(sid='S6'):
    s = next(x for x in D['stories'] if x['id'] == sid)
    c, tint = ROLE[s['role']]
    f = app_shell(f'Story view — {sid}', 'Stories')
    # story queue on the left
    q = frame('Story queue', 0, 64, 300, 1136, f, CARD)
    rect(q, 299, 0, 1, 1136, LINE)
    text(q, 20, 20, 'Review queue', 16, 700)
    text(q, 20, 44, 'Stories with scenarios to approve', 12, 400, MUTED)
    y = 76
    for st in D['stories']:
        sc = D['scenarios'].get(st['id'], [])
        sel = st['id'] == sid
        if sel: rect(q, 8, y - 6, 284, 56, tint, 8, c, 1.5)
        text(q, 20, y, st['id'], 13, 700, c if sel else INK)
        text(q, 60, y, wrap(st['want'], 30).split('\n')[0] + ('…' if len(st['want']) > 30 else ''), 12, 500, INK)
        text(q, 60, y + 20, f"{len(sc)} scenarios · approvals not signed", 11, 400, MUTED)
        y += 64

    x0 = 332
    text(f, x0, 92, 'Big picture  /  Stories  /  ' + sid, 12, 500, MUTED)
    text(f, x0, 116, f"{sid} · {role_name(s['role'])} wants {s['want']}", 26, 700, INK)
    text(f, x0, 156, 'so that ' + s['soThat'], 16, 400, MUTED)
    cx = x0
    for label, fg, bg in [(role_name(s['role']), c, tint), ('R' + ', R'.join(r[1:] for r in s['requirements']), INK, CARD),
                          (f"{len(D['scenarios'][sid])} scenarios", INK, CARD), ('Not signed', WARN, '#FEF2F2')]:
        _, w = chip(f, cx, 190, label, fg, bg, 12, 600, 10, 26, 13, stroke=LINE if bg == CARD else None)
        cx += w + 8

    PW, PH, PY, G = 500, 560, 240, 20
    titles = [('1  WHAT', 'What this feature is about'), ('2  HOW', 'How it works: the processes it runs'),
              ('3  OUTPUT', 'What it leaves behind')]
    panels = []
    for i, (t, sub) in enumerate(titles):
        p = frame(t, x0 + i * (PW + G), PY, PW, PH, f, CARD, 12, LINE)
        text(p, 24, 20, t, 13, 800, c)
        text(p, 24, 42, sub, 18, 700, INK)
        panels.append(p)

    # WHAT: who + acceptance criteria as given/when/then rows
    p = panels[0]
    ellipse(p, 24, 84, 40, 40, tint, c, 2); text(p, 37, 93, 'B', 16, 700, c)
    text(p, 76, 84, role_name(s['role']), 15, 700, INK)
    text(p, 76, 106, next(r['about'] for r in D['roles'] if r['id'] == s['role'])[:60] + '…', 12, 400, MUTED)
    y = 148
    for a in s['acceptance']:
        rect(p, 24, y, PW - 48, 120, BG, 8, LINE)
        text(p, 36, y + 10, a['id'], 12, 700, c)
        yy = y + 32
        for k in ['given', 'when', 'then']:
            text(p, 36, yy, k.upper(), 10, 800, MUTED)
            t = text(p, 96, yy - 1, wrap(a[k], 54), 12, 400, INK, lh='135%')
            yy += max(22, size(t)[1] + 4)
        y += 132

    # HOW: vertical flow of the boxes this story uses, with lane colour
    p = panels[1]
    steps = ['review', 'happy', 'approve', 'gate', 'gate-ok', 'content-changed']
    y = 88
    for i, bid in enumerate(steps):
        b = find_box(bid)
        bc, bt = ROLE[b['lane']]
        uses = sid in b['stories']
        if b['kind'] == 'decision':
            rect(p, 120, y, 272, 40, CARD, 20, bc, 1.5, name=f'decision {bid}', dashes=[4, 3])
            text(p, 140, y + 11, '◆  ' + b['title'], 13, 600, INK)
            hgt = 40
        else:
            rect(p, 120, y, 272, 56, bt if uses else CARD, 10, bc, 2 if uses else 1, name=f'step {bid}')
            text(p, 136, y + 9, b['title'], 13, 700, INK)
            text(p, 136, y + 31, role_name(b['lane']) + (f" · also {', '.join(x for x in b['stories'] if x != sid)}" if len(b['stories']) > 1 else ''), 11, 500, bc)
            hgt = 56
        if len(b['stories']) > 1:
            chip(p, 400, y + 8, 'shared', CARD, SHARED, 10, 700, 7, 18, 9)
        chip(p, 24, y + (hgt - 20) / 2, role_name(b['lane']), bc, bt, 10, 600, 6, 20, 10)
        if i < len(steps) - 1:
            if bid == 'gate-ok':
                text(p, 404, y + 40, 'later, when someone\nedits approved content', 11, 400, MUTED, lh='135%')
                arrow(p, [[256, y + hgt + 4], [256, y + hgt + 26]], MUTED, 2, [5, 4])
            else:
                arrow(p, [[256, y + hgt + 4], [256, y + hgt + 26]], MUTED, 2)
                lbl = {'happy': 'approve', 'gate-ok': ''}.get(bid)
                if lbl: text(p, 264, y + hgt + 8, lbl, 11, 600, MUTED)
        y += hgt + 30

    # OUTPUT: data written + status lifecycle
    p = panels[2]
    text(p, 24, 84, 'Data it writes', 13, 700, INK)
    y = 110
    for w in ['Scenario.status  draft → approved', 'Scenario.status  stale → approved', 'Approval  by, at, hash, sig (SSH)']:
        rect(p, 24, y, PW - 48, 36, BG, 8, LINE)
        text(p, 38, y + 10, w, 13, 500, INK)
        y += 44
    text(p, 24, y + 14, 'Scenario status', 13, 700, INK)
    y += 48
    xs = [24, 184, 344]
    for i, (st, col) in enumerate([('draft', MUTED), ('approved', OK), ('stale', WARN)]):
        rect(p, xs[i], y, 132, 44, CARD, 22, col, 2, name=f'state {st}')
        text(p, xs[i] + 0, y + 13, st, 13, 700, col, width=132, align='center')
    arrow(p, [[156, y + 22], [184, y + 22]], MUTED, 2)
    arrow(p, [[316, y + 22], [344, y + 22]], MUTED, 2)
    text(p, 150, y + 52, 'Approve', 11, 600, MUTED)
    text(p, 300, y + 52, 'content changed', 11, 600, MUTED)
    path(p, [[410, y + 44], [410, y + 84], [250, y + 84], [250, y + 44]], MUTED, 1.5, [5, 4])
    head(p, 250, y + 44, 'u', MUTED)
    text(p, 262, y + 90, 'Approve again', 11, 600, MUTED)
    rect(p, 24, y + 130, PW - 48, 92, '#FFFBEB', 8, '#FCD34D')
    text(p, 38, y + 142, wrap('Evidence only when the approval has a valid SSH signature. A draft or stale scenario does not prove anything.', 60), 12, 500, '#92400E', lh='140%')

    # scenarios strip
    y = PY + PH + 28
    text(f, x0, y, 'Scenarios for this story', 18, 700)
    text(f, x0 + 250, y + 4, 'Open one to watch it step by step, then approve it.', 13, 400, MUTED)
    for i, sc in enumerate(D['scenarios'][sid]):
        cx = x0 + i * (PW + G)
        card = frame(f'scenario {sc["id"]}', cx, y + 40, PW, 196, f, CARD, 12, LINE)
        text(card, 20, 18, sc['id'], 12, 700, c)
        text(card, 20, 40, wrap(sc['title'], 50), 16, 700, INK, lh='130%')
        text(card, 20, 96, f"{len(sc['steps'])} steps · checks {sc['expect']['criterion']}", 12, 500, MUTED)
        # mini step dots
        dx = 20
        for st in sc['steps'][:12]:
            b = find_box(st['name'])
            ellipse(card, dx, 124, 14, 14, ROLE[b['lane']][0] if b else MUTED)
            dx += 22
        chip(card, 20, 154, 'approved, not signed', '#92400E', '#FEF3C7', 11, 600, 8, 22, 11)
        rect(card, PW - 148, 150, 128, 32, c, 8, name='open button')
        text(card, PW - 148, 157, 'Open storyboard', 13, 700, CARD, width=128, align='center')
    return f


# ---- page 3: storyboard card ---------------------------------------------
def kv(d, depth=0):
    if d is None: return '—'
    if isinstance(d, dict):
        return '\n'.join(f"{k}: {kv(v, depth + 1) if not isinstance(v, (dict, list)) else json.dumps(v)[:44]}" for k, v in d.items())
    return str(d)


def storyboard(sid='S6', scid='S6-approve'):
    sc = next(x for x in D['scenarios'][sid] if x['id'] == scid)
    s = next(x for x in D['stories'] if x['id'] == sid)
    c, tint = ROLE[s['role']]
    f = app_shell(f'Storyboard — {scid}', 'Stories')
    text(f, 40, 92, f'Big picture  /  Stories  /  {sid}  /  {scid}', 12, 500, MUTED)
    text(f, 40, 116, sc['title'], 26, 700)
    text(f, 40, 156, f"Proves {sc['expect']['criterion']}: " + next(a['then'] for a in s['acceptance'] if a['id'] == sc['expect']['criterion']), 15, 400, MUTED)

    # lane strip: which role is active at each step
    steps = sc['steps']
    CW_, CH, GX = 188, 320, 14
    y0 = 236
    seen = 4
    for i, st in enumerate(steps):
        b = find_box(st['name'])
        lane = b['lane'] if b else 'rehearse'
        bc, bt = ROLE[lane]
        x = 40 + i * (CW_ + GX)
        is_seen = i < seen
        cur = i == seen
        card = frame(f'step {i + 1} {st["name"]}', x, y0, CW_, CH, f, CARD, 12, c if cur else LINE, 3 if cur else 1)
        rect(card, 0, 0, CW_, 6, bc, 0)
        ellipse(card, 14, 18, 26, 26, bc if is_seen or cur else CARD, bc, 2)
        text(card, 14, 22, str(i + 1), 12, 700, CARD if is_seen or cur else bc, width=26, align='center')
        text(card, 48, 22, role_name(lane), 11, 700, bc)
        title = b['title'] if b else st['name']
        if '/' in st['name']:
            parent = find_box(st['name'].split('/')[0])
            title = f"{parent['title']} → {b['title']}" if b is not parent else b['title']
        tt = text(card, 14, 54, wrap(title, 22), 14, 700, INK, lh='130%')
        yy = max(120, 54 + size(tt)[1] + 16)
        if st.get('branch'):
            chip(card, 14, yy - 8, 'branch: ' + st['branch'], INK, BG, 10, 600, 6, 18, 9, stroke=LINE); yy += 20
        if st.get('given') is not None:
            text(card, 14, yy, 'GIVEN', 10, 800, MUTED)
            t = text(card, 14, yy + 16, wrap(kv(st['given']), 27), 11, 400, INK, lh='135%'); yy += 22 + size(t)[1]
        if st.get('then') is not None:
            text(card, 14, yy, 'THEN', 10, 800, OK)
            text(card, 14, yy + 16, wrap(kv(st['then']), 27), 11, 400, INK, lh='135%')
        if st.get('given') is None and st.get('then') is None:
            text(card, 14, yy, wrap('Passes through. No example on this step.', 26), 11, 400, MUTED, lh='135%')
        if is_seen: chip(card, CW_ - 64, 20, 'seen', OK, '#F0FDF4', 10, 700, 7, 20, 10)
        if i < len(steps) - 1:
            arrow(f, [[x + CW_ + 2, y0 + CH / 2], [x + CW_ + GX - 2, y0 + CH / 2]], MUTED, 2)

    # expected end state + approve bar
    y = y0 + CH + 40
    e = frame('Expected end state', 40, y, 900, 170, f, CARD, 12, LINE)
    text(e, 24, 20, 'Expected end state', 16, 700)
    text(e, 24, 46, f"checked against {sc['expect']['criterion']}", 12, 500, MUTED)
    yy = 80
    for k, v in sc['expect']['state'].items():
        rect(e, 24, yy, 420, 32, BG, 6, LINE); text(e, 36, yy + 8, f'{k} = {v}', 13, 600, INK); yy += 38
    text(e, 480, 84, wrap('The simulator checks this state at the end of the path. If it differs, simulate reports a finding.', 50), 12, 400, MUTED, lh='140%')

    a = frame('Approve bar', 970, y, 910, 170, f, CARD, 12, LINE)
    text(a, 24, 20, 'Approve this scenario', 16, 700)
    text(a, 24, 46, f'You saw {seen} of {len(steps)} steps. Approve turns on when you saw every step.', 13, 400, MUTED)
    rect(a, 24, 80, 560, 10, BG, 5, LINE)
    rect(a, 24, 80, 560 * seen / len(steps), 10, c, 5)
    rect(a, 24, 108, 160, 40, '#CBD5E1', 8, name='Approve (off)')
    text(a, 24, 119, 'Approve', 14, 700, CARD, width=160, align='center')
    rect(a, 200, 108, 120, 40, CARD, 8, LINE, name='Next step')
    text(a, 200, 119, 'Next step →', 14, 700, INK, width=120, align='center')
    text(a, 620, 76, wrap('Signs with SSH key SHA256:9fQ…k2 as raizal.pregnanta@… The approval counts as evidence only with a valid signature.', 40), 12, 400, MUTED, lh='140%')
    return f


# ---- page 4: use case diagram -------------------------------------------
def use_cases():
    f = app_shell('Use cases — who may change which data', 'Use cases')
    text(f, 40, 96, 'Who may change which data', 28, 700)
    text(f, 40, 136, 'Roles on the left. What they do in the middle. The data each action changes on the right.', 15, 400, MUTED)
    tid = text(f, 1500, 104, 'Table', 13, 600, MUTED)
    rect(f, 1440, 96, 200, 34, CARD, 17, LINE)
    rect(f, 1444, 100, 96, 26, ROLE['builder'][0], 13)
    text(f, 1444, 105, 'Diagram', 13, 700, CARD, width=96, align='center')
    ex('node.set', ids=[tid], props={"x": 1560})
    ex('arrange.front', ids=[tid])

    actions = []  # (role, box, entities)
    for b in D['boxes']:
        if not b['writes']: continue
        ents = []
        for w in b['writes']:
            e = w.split('.')[0]
            if e not in ents: ents.append(e)
        actions.append((b['lane'], b, ents))
    roles = [l['role'] for l in sorted(D['lanes'], key=lambda l: l['order'])]
    actions.sort(key=lambda a: roles.index(a[0]))
    entities = []
    for _, _, es in actions:
        for e in es:
            if e not in entities: entities.append(e)
    mean = {e: sum(i for i, a in enumerate(actions) if e in a[2]) / sum(1 for a in actions if e in a[2]) for e in entities}
    entities.sort(key=lambda e: mean[e])

    sys_ = frame('System: rehearse record', 520, 190, 760, 960, f, CARD, 16, LINE, 1.5)
    text(sys_, 24, 18, 'rehearse record', 14, 700, MUTED)
    UH, UG = 76, 22
    upos = {}
    total = len(actions) * (UH + UG) - UG
    uy0 = 190 + (960 - total) / 2
    for i, (rid, b, ents) in enumerate(actions):
        bc, bt = ROLE[rid]
        y = uy0 + i * (UH + UG)
        ellipse(f, 600, y, 360, UH, bt, bc, 2, name=f'use case {b["id"]}')
        text(f, 600, y + UH / 2 - 18, b['title'].replace(' (UI button only)', ''), 14, 700, INK, width=360, align='center')
        sub = 'UI button only, signed' if 'UI button only' in b['title'] else ', '.join(b['stories']) or 'automatic'
        text(f, 600, y + UH / 2 + 4, sub, 11, 500, bc, width=360, align='center')
        upos[b['id']] = (600, y + UH / 2)

    # actors
    ay = {}
    rgap = 960 / len(roles)
    for i, rid in enumerate(roles):
        bc, bt = ROLE[rid]
        y = 190 + i * rgap + rgap / 2 - 70
        cx = 160
        ellipse(f, cx - 22, y, 44, 44, bt, bc, 3, name=f'actor head {rid}')
        path(f, [[cx, y + 44], [cx, y + 100]], bc, 3)
        path(f, [[cx - 34, y + 64], [cx + 34, y + 64]], bc, 3)
        path(f, [[cx - 28, y + 140], [cx, y + 100], [cx + 28, y + 140]], bc, 3)
        text(f, cx - 100, y + 150, role_name(rid), 16, 700, bc, width=200, align='center')
        kind = next(r['kind'] for r in D['roles'] if r['id'] == rid)
        text(f, cx - 100, y + 172, kind, 12, 500, MUTED, width=200, align='center')
        ay[rid] = (cx + 40, y + 64)
        if not any(a[0] == rid for a in actions):
            text(f, cx + 60, y + 54, wrap('Changes no data. Runs checks only (reads).', 26), 12, 500, MUTED, lh='140%')
    for rid, b, _ in actions:
        (x1, y1), (x2, y2) = ay[rid], upos[b['id']]
        path(f, [[x1, y1], [x2, y2]], ROLE[rid][0], 1.5)

    # entities
    EH = 64
    eg = (960 - len(entities) * EH) / (len(entities) + 1)
    epos = {}
    for i, e in enumerate(entities):
        y = 190 + eg + i * (EH + eg)
        rect(f, 1380, y, 260, EH, CARD, 8, INK, 1.5, name=f'entity {e}')
        rect(f, 1380, y, 260, 22, '#F1F5F9', 8)
        text(f, 1392, y + 4, '«data»', 10, 600, MUTED)
        text(f, 1392, y + 28, e, 16, 700, INK)
        epos[e] = (1380, y + EH / 2)
    for rid, b, ents in actions:
        x1, y1 = upos[b['id']]
        for e in ents:
            x2, y2 = epos[e]
            arrow(f, [[x1 + 360, y1], [x2 - 2, y2]], ROLE[rid][0], 1.5, [5, 4])

    # check
    k = frame('Permission check', 1664, 190, 236, 300, f, CARD, 12, LINE)
    text(k, 16, 16, 'Check', 14, 700)
    text(k, 16, 44, wrap('Agent never changes Approval or SignOff.', 26), 12, 600, OK, lh='140%')
    text(k, 16, 92, wrap('Only Builder changes Approval and SignOff, with the UI button, signed with SSH.', 26), 12, 400, INK, lh='140%')
    text(k, 16, 176, wrap('Click a role, an action or a data box to light up its lines.', 26), 12, 400, MUTED, lh='140%')
    return f


if __name__ == '__main__':
    clear_document()
    big_picture()
    new_page('2 Story view'); story_view()
    new_page('3 Scenario storyboard'); storyboard()
    new_page('4 Use cases'); use_cases()
    out = ROOT + '/design/rehearse-review.figcraft'
    print(ex('file.saveAs', path=out))
