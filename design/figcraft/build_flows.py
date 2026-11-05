"""Pages 5-7: user flow, data flow (DFD) and system flowchart for rehearse.

Run: python3 build_flows.py   (redraws pages 1-4 too, then saves)
"""
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import build_design as bd
from build_design import ex, rect, ellipse, text, path, head, arrow, chip, size, frame, wrap, ROLE, INK, MUTED, LINE, BG, CARD, OK, WARN, SHARED

SUBNAV = ['Feature map', 'User flow', 'Data flow', 'System flowchart', 'Architecture', 'Before / after']


def subnav(f, active, x=1040, y=100):
    rect(f, x, y, 840, 36, CARD, 18, LINE, name='sub nav')
    cx = x + 4
    for t in SUBNAV:
        w = {'Feature map': 120, 'User flow': 110, 'Data flow': 110, 'System flowchart': 150, 'Architecture': 120, 'Before / after': 130}[t]
        if t == active: rect(f, cx, y + 4, w, 28, ROLE['builder'][0], 14)
        text(f, cx, y + 10, t, 13, 700 if t == active else 500, CARD if t == active else MUTED, width=w, align='center')
        cx += w + 8


def diamond(p, cx, cy, w, h, label, color, fill=CARD, size_=12):
    pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]
    ex('vector.create', parent=p, points=pts, x=cx - w / 2, y=cy - h / 2, closed=True, name=f'decision {label}',
       props={"fill": fill, "stroke": color, "strokeWeight": 2}, select=False)
    text(p, cx - w / 2 + 10, cy - 9 * (label.count('\n') + 1), label, size_, 700, INK, width=w - 20, align='center', lh='130%')


def node(p, x, y, w, h, label, color, fill=CARD, radius=10, sub=None, sw=2, name=None, dashes=None):
    rect(p, x, y, w, h, fill, radius, color, sw, name=name or f'node {label}', dashes=dashes)
    lines = label.count('\n') + 1 + (sub.count('\n') + 1 if sub else 0)
    ty = y + h / 2 - lines * 9 - (2 if sub else 0)
    t = text(p, x + 8, ty, label, 13, 700, INK, width=w - 16, align='center', lh='130%')
    if sub: text(p, x + 8, ty + size(t)[1] + 2, sub, 11, 500, color, width=w - 16, align='center', lh='140%')


def label(p, x, y, s, color=MUTED):
    """Edge label on a white pill, centred on (x, y)."""
    t = text(p, x, y, s, 11, 600, color)
    w, h = size(t)
    r = rect(p, x - w / 2 - 6, y - h / 2 - 2, w + 12, h + 4, CARD, 8, name=f'label {s}')
    ex('node.set', ids=[t], props={"x": x - w / 2, "y": y - h / 2})
    ex('arrange.front', ids=[t])


def legend(p, x, y, items):
    for kind, s in items:
        if kind == 'line':
            path(p, [[x, y + 8], [x + 28, y + 8]], MUTED, 2)
        elif kind == 'dash':
            path(p, [[x, y + 8], [x + 28, y + 8]], MUTED, 2, [5, 4])
        else:
            kind(p, x, y)
        t = text(p, x + 36, y, s, 12, 500, MUTED)
        x += 36 + size(t)[0] + 24


# ---- 5 user flow ----------------------------------------------------------
def user_flow():
    f = bd.app_shell('User flow — Builder reviews and signs', 'Big picture')
    subnav(f, 'User flow')
    text(f, 40, 96, 'User flow', 28, 700)
    text(f, 40, 136, 'The path the Builder takes through the UI, from opening the EPIC to signing it off.', 15, 400, MUTED)
    B = ROLE['builder'][0]
    m = frame('User flow canvas', 40, 180, 1840, 980, f, CARD, 12, LINE)
    legend(m, 24, 20, [
        (lambda p, x, y: rect(p, x, y, 28, 18, '#EFF6FF', 6, B, 2), 'Screen'),
        (lambda p, x, y: rect(p, x, y, 28, 18, CARD, 9, B, 1.5, dashes=[4, 3]), 'User action'),
        (lambda p, x, y: ex('vector.create', parent=p, points=[[14, 0], [28, 9], [14, 18], [0, 9]], x=x, y=y, closed=True, props={"fill": CARD, "stroke": INK, "strokeWeight": 1.5}, select=False), 'Decision'),
        (lambda p, x, y: ellipse(p, x + 5, y, 18, 18, INK), 'Start / end'),
    ])
    S, A = '#EFF6FF', CARD
    W, H = 190, 70
    # row 1: entry -> big picture -> story view -> storyboard
    ellipse(m, 40, 115, 30, 30, INK, name='start')
    text(m, 20, 152, 'Opens bb panel\nor browser', 11, 500, MUTED, width=70, align='center')
    node(m, 110, 95, W, H, 'Big picture', B, S, sub='feature map')
    node(m, 350, 105, 170, 50, 'Click a story', B, A, 25, sw=1.5, dashes=[4, 3])
    node(m, 570, 95, W, H, 'Story view', B, S, sub='WHAT · HOW · OUTPUT')
    node(m, 810, 105, 190, 50, 'Open storyboard', B, A, 25, sw=1.5, dashes=[4, 3])
    node(m, 1050, 95, W, H, 'Scenario storyboard', B, S, sub='one card per step')
    node(m, 1290, 105, 170, 50, 'Next step', B, A, 25, sw=1.5, dashes=[4, 3])
    diamond(m, 1610, 130, 200, 110, 'Every step\nseen?', INK)
    arrow(m, [[70, 130], [108, 130]], INK)
    for a_, b_ in [(300, 348), (520, 568), (760, 808), (1000, 1048), (1240, 1288), (1460, 1508)]:
        arrow(m, [[a_, 130], [b_, 130]], INK)
    # no -> loop back to Next step
    path(m, [[1610, 75], [1610, 50], [1375, 50]], MUTED, 2)
    arrow(m, [[1375, 50], [1375, 103]], MUTED)
    label(m, 1500, 50, 'no')
    # yes -> down
    arrow(m, [[1610, 185], [1610, 268]], INK)
    label(m, 1610, 225, 'yes')

    # row 2: approve, right to left
    node(m, 1520, 270, 180, 50, 'Click Approve', B, A, 25, sw=1.5, dashes=[4, 3])
    diamond(m, 1300, 295, 210, 110, 'Signing key\navailable?', INK)
    node(m, 1000, 260, W, H, 'Signing help', WARN, '#FEF2F2', sub='steps from docs/signing.md')
    arrow(m, [[1518, 295], [1407, 295]], INK)
    arrow(m, [[1195, 295], [1192, 295]], INK)
    label(m, 1215, 262, 'no', WARN)
    text(m, 1000, 338, 'fix setup, run serve again', 11, 500, MUTED, width=190, align='center')
    arrow(m, [[1300, 350], [1300, 418]], INK)
    label(m, 1300, 385, 'yes')
    node(m, 1205, 420, W, H, 'Scenario approved', OK, '#F0FDF4', sub='signed approval written')
    diamond(m, 930, 455, 230, 120, 'More draft\nscenarios?', INK)
    arrow(m, [[1203, 455], [1047, 455]], INK)
    # yes -> back to story view
    path(m, [[930, 395], [930, 380], [665, 380]], MUTED, 2)
    arrow(m, [[665, 380], [665, 167]], MUTED)
    label(m, 800, 380, 'yes: next scenario')

    # row 3: readiness and sign-off
    arrow(m, [[930, 517], [930, 598]], INK)
    label(m, 930, 557, 'no')
    node(m, 835, 600, W, H, 'Readiness', B, S, sub='why ready or not')
    diamond(m, 600, 635, 230, 120, 'Gate passes?', INK)
    arrow(m, [[833, 635], [717, 635]], INK)
    path(m, [[600, 575], [600, 540], [150, 540]], MUTED, 2)
    arrow(m, [[150, 540], [150, 167]], MUTED)
    label(m, 380, 540, 'no: see findings, ask agent to fix')
    path(m, [[483, 635], [400, 635]], INK, 2)
    label(m, 440, 610, 'yes')
    node(m, 210, 600, W, H, 'Sign off', B, S, sub='stories and hashes')
    arrow(m, [[400, 635], [402, 635]], INK)
    node(m, 220, 810, 170, 50, 'Click Sign off', B, A, 25, sw=1.5, dashes=[4, 3])
    arrow(m, [[305, 672], [305, 808]], INK)
    node(m, 460, 800, W, H, 'EPIC signed', OK, '#F0FDF4', sub='build may start')
    arrow(m, [[390, 835], [458, 835]], INK)
    ellipse(m, 720, 820, 30, 30, INK, name='end')
    ellipse(m, 714, 814, 42, 42, 'none', INK, 2, name='end ring')
    arrow(m, [[650, 835], [712, 835]], INK)

    # side note: later edits
    n = frame('Later', 1240, 600, 560, 260, m, '#FFFBEB', 10, '#FCD34D')
    text(n, 20, 16, 'Later: someone edits signed content', 14, 700, '#92400E')
    text(n, 20, 46, wrap('rehearse marks the changed stories stale and their scenarios stale. The Builder sees them in the review queue and goes through the same path again: storyboard, approve, readiness, sign off.', 62), 13, 400, '#92400E', lh='145%')
    chip(n, 20, 200, 'Story view queue shows: stale', '#92400E', '#FEF3C7', 12, 600, 10, 26, 13)
    return f


# ---- 6 data flow diagram -------------------------------------------------
def store(p, x, y, w, idn, name, color=INK):
    """Data store: open-ended box (Gane-Sarson)."""
    rect(p, x, y, w, 44, CARD, 0, name=f'store {idn}')
    path(p, [[x + w, y], [x, y], [x, y + 44], [x + w, y + 44]], color, 2)
    path(p, [[x + 44, y], [x + 44, y + 44]], color, 1.5)
    text(p, x + 6, y + 13, idn, 12, 700, MUTED, width=34, align='center')
    text(p, x + 54, y + 12, name, 13, 600, INK)


def proc(p, cx, cy, num, name, color):
    """Process: rounded box with number band."""
    w, h = 170, 96
    rect(p, cx - w / 2, cy - h / 2, w, h, CARD, 14, color, 2, name=f'process {num}')
    rect(p, cx - w / 2, cy - h / 2, w, 26, ROLE['rehearse'][1], 14)
    text(p, cx - w / 2, cy - h / 2 + 5, num, 12, 800, color, width=w, align='center')
    path(p, [[cx - w / 2, cy - h / 2 + 26], [cx + w / 2, cy - h / 2 + 26]], color, 1)
    text(p, cx - w / 2 + 8, cy - 10, name, 13, 700, INK, width=w - 16, align='center', lh='130%')


def entity(p, x, y, name, rid, w=150, h=60):
    c, t = ROLE[rid] if rid in ROLE else (INK, '#F1F5F9')
    rect(p, x + 5, y + 5, w, h, c, 2)
    rect(p, x, y, w, h, t, 2, c, 2, name=f'entity {name}')
    text(p, x, y + h / 2 - 9, name, 14, 700, c, width=w, align='center')


def data_flow():
    f = bd.app_shell('Data flow — what data moves where', 'Big picture')
    subnav(f, 'Data flow')
    text(f, 40, 96, 'Data flow diagram', 28, 700)
    text(f, 40, 136, 'Level 1. Squares are people and outside systems, rounded boxes are rehearse processes, open boxes are files.', 15, 400, MUTED)
    m = frame('DFD canvas', 40, 180, 1840, 980, f, CARD, 12, LINE)
    G = ROLE['rehearse'][0]
    legend(m, 24, 20, [
        (lambda p, x, y: (rect(p, x + 2, y + 2, 26, 16, INK, 2), rect(p, x, y, 26, 16, '#F1F5F9', 2, INK, 1.5)), 'External entity'),
        (lambda p, x, y: rect(p, x, y, 28, 18, CARD, 6, G, 2), 'Process'),
        (lambda p, x, y: path(p, [[x + 28, y], [x, y], [x, y + 18], [x + 28, y + 18]], INK, 2), 'Data store (file)'),
        ('line', 'Data flow'),
    ])
    # externals
    entity(m, 40, 140, 'Agent', 'agent')
    entity(m, 40, 520, 'Builder', 'builder')
    entity(m, 40, 840, 'CI', 'ci')
    entity(m, 1660, 520, 'ssh-agent', 'x', 150)
    # processes
    P = {'1': (420, 160, '1.0', 'Create record'), '2': (720, 160, '2.0', 'Validate'),
         '3': (1020, 160, '3.0', 'Simulate'), '4': (720, 560, '4.0', 'Review and\napprove'),
         '5': (1020, 560, '5.0', 'Gate check'), '6': (1320, 560, '6.0', 'Sign off'),
         '7': (1320, 160, '7.0', 'Detect stale'), '8': (420, 860, '8.0', 'CI check')}
    for k, (cx, cy, n, name) in P.items():
        proc(m, cx, cy, n, name, G)
    # stores
    store(m, 300, 340, 260, 'D1', 'prd.yaml  (roles, stories)')
    store(m, 600, 340, 260, 'D2', 'flow.yaml  (boxes, edges)')
    store(m, 900, 340, 280, 'D3', 'scenarios/*.yaml + approvals')
    store(m, 1220, 340, 230, 'D4', 'signoff.yaml')
    store(m, 1480, 340, 220, 'D5', 'corrections.md')
    store(m, 1480, 760, 260, 'D6', '.rehearse/allowed_signers')

    def fl(pts, s, at=None, color=INK, dash=None):
        arrow(m, pts, color, 1.6, dash)
        if s:
            (ax, ay), (bx, by) = at or (pts[len(pts) // 2 - 1], pts[len(pts) // 2])
            label(m, (ax + bx) / 2, (ay + by) / 2, s, color)

    A_, B_, C_ = ROLE['agent'][0], ROLE['builder'][0], ROLE['ci'][0]
    # agent
    fl([[190, 160], [333, 160]], 'slug, title', color=A_)
    fl([[80, 200], [80, 362], [298, 362]], 'record drafts (YAML)', at=([80, 362], [298, 362]), color=A_)
    fl([[420, 208], [420, 338]], 'empty record')
    fl([[805, 160], [933, 160]], 'valid record')
    fl([[720, 112], [720, 80], [150, 80], [150, 138]], 'findings (file, path, message)', at=([720, 80], [150, 80]), color=MUTED)
    fl([[720, 338], [720, 210]], 'read', at=([720, 300], [720, 250]), color=MUTED)
    fl([[1020, 338], [1020, 210]], 'approved scenarios', at=([1020, 300], [1020, 250]), color=MUTED)
    fl([[1060, 112], [1060, 96], [1590, 96], [1590, 338]], 'design errors → correction (by Agent)', at=([1060, 96], [1590, 96]))
    # stale detection
    fl([[1300, 338], [1300, 210]], 'signed hashes', at=([1300, 300], [1300, 250]), color=MUTED)
    fl([[1340, 210], [1340, 300], [1100, 300], [1100, 338]], None, color=MUTED)
    label(m, 1220, 300, 'status: stale', MUTED)
    # builder review/approve
    fl([[190, 540], [633, 540]], 'approve scenario ids', color=B_)
    fl([[633, 590], [190, 590]], 'storyboard, gate report', color=MUTED)
    fl([[780, 512], [780, 470], [940, 470], [940, 386]], 'approval + sig', at=([780, 470], [940, 470]))
    fl([[1658, 550], [1407, 550]], 'signature', color=MUTED)
    fl([[720, 608], [720, 660], [1735, 660], [1735, 582]], 'data to sign  →  signature', at=([1200, 660], [1400, 660]), color=MUTED)
    fl([[1050, 386], [1050, 510]], 'approvals', at=([1050, 420], [1050, 470]), color=MUTED)
    fl([[1107, 560], [1233, 560]], 'gate ok')
    fl([[190, 560], [200, 560]], None, color=B_) if False else None
    path(m, [[115, 580], [115, 720], [1320, 720]], B_, 1.6)
    arrow(m, [[1320, 720], [1320, 610]], B_, 1.6)
    label(m, 700, 720, 'sign off stories', B_)
    fl([[1340, 512], [1340, 386]], 'sign-off + sig', at=([1340, 470], [1340, 420]))
    fl([[1480, 782], [1407, 782], [1407, 608]], None, color=MUTED)
    label(m, 1440, 800, 'verify sigs', MUTED)
    fl([[1480, 790], [1100, 790], [1100, 610]], None, color=MUTED)
    # CI
    fl([[190, 870], [333, 870]], 'PR head', color=C_)
    fl([[333, 890], [190, 890]], 'exit code + JSON report', color=MUTED)
    fl([[507, 860], [612, 860], [612, 386]], 'reads all files', at=([612, 700], [612, 600]), color=MUTED)
    n = frame('Rule', 1480, 860, 330, 100, m, '#F0FDF4', 10, '#86EFAC')
    text(n, 16, 14, wrap('Only processes 4.0 and 6.0 write approvals and sign-offs, and only from the Builder, signed with SSH. The Agent and CI have no flow into D3 approvals or D4.', 46), 12, 500, '#166534', lh='140%')
    return f


# ---- 7 system flowchart --------------------------------------------------
def doc(p, x, y, w, h, label_, color=INK, fill=CARD):
    """Document symbol: box with a wavy bottom."""
    d = f"M0 0 H{w} V{h - 10} C{w * 0.75} {h - 24} {w * 0.5} {h + 4} {w * 0.25} {h - 6} C{w * 0.15} {h - 10} {w * 0.05} {h - 8} 0 {h - 4} Z"
    ex('vector.create', parent=p, path=d, x=x, y=y, name=f'doc {label_}', props={"fill": fill, "stroke": color, "strokeWeight": 2}, select=False)
    text(p, x + 8, y + h / 2 - 16, label_, 12, 600, INK, width=w - 16, align='center', lh='130%')


def cyl(p, x, y, w, h, label_, color=INK):
    """Disk storage symbol."""
    rect(p, x, y + 10, w, h - 20, CARD, 0, name=f'cyl {label_}')
    path(p, [[x, y + 10], [x, y + h - 10]], color, 2)
    path(p, [[x + w, y + 10], [x + w, y + h - 10]], color, 2)
    ellipse(p, x, y + h - 20, w, 20, CARD, color, 2)
    rect(p, x + 2, y + h - 30, w - 4, 20, CARD)
    ellipse(p, x, y, w, 20, '#F1F5F9', color, 2)
    text(p, x + 6, y + h / 2 - 6, label_, 12, 600, INK, width=w - 12, align='center', lh='130%')


def system_flowchart():
    f = bd.app_shell('System flowchart — how the parts run', 'Big picture')
    subnav(f, 'System flowchart')
    text(f, 40, 96, 'System flowchart', 28, 700)
    text(f, 40, 136, 'The programs, the files and the checks, from a command to a signed EPIC.', 15, 400, MUTED)
    m = frame('System canvas', 40, 180, 1840, 980, f, CARD, 12, LINE)
    G, B, C = ROLE['rehearse'][0], ROLE['builder'][0], ROLE['ci'][0]
    legend(m, 24, 20, [
        (lambda p, x, y: rect(p, x, y, 28, 18, CARD, 2, G, 2), 'Program step'),
        (lambda p, x, y: ex('vector.create', parent=p, path='M0 0 H28 V14 C20 10 14 20 7 16 C4 15 2 15 0 16 Z', x=x, y=y, props={"fill": CARD, "stroke": INK, "strokeWeight": 1.5}, select=False), 'File / report'),
        (lambda p, x, y: ex('vector.create', parent=p, points=[[14, 0], [28, 9], [14, 18], [0, 9]], x=x, y=y, closed=True, props={"fill": CARD, "stroke": INK, "strokeWeight": 1.5}, select=False), 'Check'),
        (lambda p, x, y: rect(p, x, y, 28, 18, '#F8FAFC', 6, LINE, 1.5, dashes=[4, 3]), 'Package'),
    ])

    # swim columns = packages
    cols = [('@rehearse/cli', 30, 330), ('@rehearse/core', 380, 520), ('@rehearse/server', 920, 400), ('@rehearse/ui  ·  bb-plugin', 1340, 470)]
    for name, x, w in cols:
        rect(m, x, 60, w, 900, '#F8FAFC', 10, LINE, 1.5, name=f'package {name}', dashes=[6, 4])
        text(m, x + 16, 74, name, 14, 800, MUTED)

    BW, BH = 220, 56
    def step(x, y, s, color=G, w=BW, h=BH): node(m, x, y, w, h, s, color, CARD, 4, sw=2)

    # CLI column
    step(85, 120, 'rehearse new <slug>', INK)
    step(85, 230, 'rehearse validate | simulate', INK)
    step(85, 330, 'rehearse serve <epic>', INK)
    step(85, 430, 'rehearse gate check', INK)
    diamond(m, 195, 600, 220, 100, 'exit code 0?', INK)
    doc(m, 70, 700, 120, 70, 'JSON report')
    node(m, 210, 700, 130, 56, 'CI: PR may\nmerge', OK, '#F0FDF4', 4)
    node(m, 210, 790, 130, 56, 'CI: PR\nblocked', WARN, '#FEF2F2', 4)

    # core column
    cyl(m, 420, 110, 200, 90, 'docs/epics/<slug>/\n*.yaml')
    step(660, 125, 'load + parse YAML')
    step(660, 225, 'schema + refs check')
    step(660, 325, 'simulate scenarios')
    step(660, 425, 'gate: traced, clean,\nno stale', G, BW, 64)
    step(660, 535, 'hash rule 1 / 2\n(stale detection)', G, BW, 64)
    step(410, 560, 'readiness +\npermission boxes', G, 170, 64)
    arrow(m, [[620, 155], [658, 155]], INK)
    for y1, y2 in [(181, 223), (281, 323), (381, 423), (489, 533)]:
        arrow(m, [[770, y1], [770, y2]], INK)
    arrow(m, [[680, 489], [680, 520], [495, 520], [495, 558]], INK)
    # cli -> core
    arrow(m, [[305, 148], [418, 148]], INK); label(m, 360, 148, 'write')
    arrow(m, [[305, 258], [400, 258], [400, 240], [658, 240]], INK)
    arrow(m, [[305, 368], [380, 368], [380, 520], [770, 520], [770, 491]], INK) if False else None
    arrow(m, [[305, 458], [658, 458]], INK)
    arrow(m, [[195, 398], [195, 458]], MUTED) if False else None
    arrow(m, [[195, 486], [195, 548]], MUTED); label(m, 195, 515, 'findings')
    path(m, [[85, 600], [50, 600], [50, 735], [68, 735]], INK, 2); head(m, 68, 735, 'r', INK)
    arrow(m, [[305, 600], [340, 600], [340, 690], [275, 690], [275, 698]], OK); label(m, 330, 640, 'yes', OK)
    arrow(m, [[195, 650], [195, 680], [200, 680], [200, 818], [208, 818]], WARN) if False else None
    path(m, [[195, 650], [195, 818]], WARN, 2); arrow(m, [[195, 818], [208, 818]], WARN); label(m, 195, 670, 'no', WARN)

    # server column
    step(960, 125, 'start: token, identity,\nsigning check', ROLE['rehearse'][0], 300, 64)
    step(960, 245, 'GET /api/session', C, 300)
    step(960, 335, 'GET /api/epic\n(+ gate, readiness)', C, 300, 64)
    step(960, 455, 'POST /api/approve\nPOST /api/sign-off', B, 300, 64)
    diamond(m, 1110, 610, 260, 110, 'token + Origin ok?\nrecord clean?', INK, size_=11)
    step(960, 700, 'ssh-keygen -Y sign\n-n rehearse', INK, 300, 64)
    step(960, 810, 'write approval /\nsign-off to YAML', G, 300, 64)
    arrow(m, [[305, 488], [958, 488]], INK) if False else None
    path(m, [[305, 358], [355, 358], [355, 930], [900, 930], [900, 157]], INK, 2)
    arrow(m, [[900, 157], [958, 157]], INK)
    label(m, 620, 930, 'serve starts the HTTP server')
    for y1, y2 in [(189, 243), (301, 333), (399, 453), (519, 553)]:
        arrow(m, [[1110, y1], [1110, y2]], INK)
    arrow(m, [[1110, 665], [1110, 698]], OK); label(m, 1150, 680, 'yes', OK)
    arrow(m, [[1110, 764], [1110, 808]], INK)
    path(m, [[1240, 610], [1300, 610]], WARN, 2); label(m, 1280, 590, '403 / 409', WARN)
    path(m, [[960, 842], [600, 842], [600, 180]], G, 2, [5, 4]); head(m, 600, 182, 'u', G)
    label(m, 600, 700, 'record changed', G)
    path(m, [[880, 367], [880, 457], [858, 457]], INK, 2) if False else None
    arrow(m, [[958, 367], [892, 367], [892, 457], [882, 457]], MUTED)
    label(m, 892, 410, 'uses', MUTED)

    # ui column
    step(1380, 125, 'bb panel (iframe)\nor browser tab', B, 390, 64)
    step(1380, 245, 'load session + epic', C, 390)
    step(1380, 335, 'Big picture · Stories ·\nUse cases · Readiness', B, 390, 64)
    step(1380, 455, 'Approve / Sign off button', B, 390)
    doc(m, 1380, 560, 180, 80, 'error card:\nfindings / forbidden')
    doc(m, 1590, 560, 180, 80, 'signed: ok card')
    for y1, y2 in [(189, 243), (301, 333), (399, 453)]:
        arrow(m, [[1575, y1], [1575, y2]], INK)
    path(m, [[1378, 273], [1260, 273]], C, 2, [5, 4]); head(m, 1262, 273, 'l', C)
    path(m, [[1378, 367], [1260, 367]], C, 2, [5, 4]); head(m, 1262, 367, 'l', C)
    path(m, [[1378, 483], [1260, 483]], B, 2); head(m, 1262, 483, 'l', B)
    label(m, 1320, 255, 'HTTP', C)
    path(m, [[1300, 610], [1300, 600], [1378, 600]], WARN, 2); head(m, 1378, 600, 'r', WARN)
    path(m, [[1260, 842], [1680, 842], [1680, 642]], OK, 2); head(m, 1680, 642, 'u', OK)
    label(m, 1470, 842, '200 + sigStatus valid', OK)
    return f


# ---- 8 system architecture -------------------------------------------------
def architecture():
    f = bd.app_shell('System architecture — where the parts run', 'Big picture')
    subnav(f, 'Architecture')
    text(f, 40, 96, 'System architecture', 28, 700)
    text(f, 40, 136, 'Where each part runs, what it talks to, and which trust zone it is in. Only the green zone can reach your SSH key.', 15, 400, MUTED)
    m = frame('Architecture canvas', 40, 180, 1840, 980, f, CARD, 12, LINE)
    G, B, A, C = ROLE['rehearse'][0], ROLE['builder'][0], ROLE['agent'][0], ROLE['ci'][0]
    legend(m, 24, 20, [
        (lambda p, x, y: rect(p, x, y, 28, 18, '#F8FAFC', 6, MUTED, 1.5, dashes=[4, 3]), 'Machine / trust zone'),
        (lambda p, x, y: rect(p, x, y, 28, 18, CARD, 4, INK, 2), 'Component'),
        (lambda p, x, y: rect(p, x, y, 28, 18, ROLE['builder'][1], 2, B, 2), 'Person / outside system'),
        ('line', 'Call or data'),
    ])

    def zone(x, y, w, h, title, color, fill):
        rect(m, x, y, w, h, fill, 12, color, 1.5, name=f'zone {title}', dashes=[6, 4])
        text(m, x + 16, y + 12, title, 13, 800, color)

    def comp(x, y, w, h, s, color=INK, sub=None):
        node(m, x, y, w, h, s, color, CARD, 6, sub=sub, sw=2)

    def actor(x, y, s, role, sub=None):
        fg, bg = ROLE[role]
        rect(m, x + 5, y + 5, 200, 80, fg, 4)
        node(m, x, y, 200, 80, s, fg, bg, 4, sub=sub, sw=2)

    # people and outside systems
    actor(30, 110, 'Builder', 'builder', 'reviews, approves, signs')
    actor(30, 520, 'Agent', 'agent', 'drafts the record')
    actor(30, 805, 'Pull request', 'ci', 'git host')

    # zones
    zone(290, 60, 500, 330, 'bb  ·  any machine', B, '#F8FBFF')
    zone(290, 440, 500, 270, 'Agent thread  ·  sandbox', A, '#FBFAFF')
    zone(840, 60, 980, 650, 'Repo machine  ·  your user account, outside the sandbox', G, '#F7FDFA')
    zone(290, 750, 1530, 170, 'CI  ·  on every pull request', C, '#FFFDF7')

    # bb zone
    comp(330, 110, 220, 80, 'bb panel (app.tsx)\nor browser tab', B, 'iframe of the serve URL')
    comp(330, 250, 220, 100, 'plugin server (server.ts)', B, 'RPC: projects, epics, open\nbb rehearse validate | simulate\n| gate check | new')
    comp(590, 200, 170, 80, 'bb connect', MUTED, 'expose port for\nremote browser (C27)')

    # agent zone
    comp(330, 510, 220, 100, 'rehearse CLI\n(@rehearse/cli)', A, 'new · validate · simulate\n· gate check')
    node(m, 580, 510, 180, 100, 'No approve and no\nsign-off command.\nNo ssh-agent socket.', WARN, '#FEF2F2', 6, sw=1.5, dashes=[4, 3])

    # repo machine zone
    comp(870, 110, 300, 100, 'rehearse serve\n(@rehearse/server)', G, '127.0.0.1:<port> · session token\nOrigin check · /api/*')
    comp(1230, 110, 250, 100, '@rehearse/ui', B, 'React app: Big picture, Stories,\nUse cases, Readiness, Sign off')
    comp(1540, 110, 250, 100, 'ssh-agent', INK, 'holds your key\n(SSH_AUTH_SOCK)')
    comp(870, 280, 300, 110, 'host worker (host.ts)', G, 'serve-manager: one process per EPIC\nleases renew 15 s, end after 45 s\nwatchdog · free port · finds ssh-agent')
    comp(1230, 270, 250, 130, '@rehearse/core', G, 'loader · validate · simulate\ntrust: gate, readiness,\nstory hash, stale, signature')
    comp(1540, 290, 250, 80, 'ssh-keygen', INK, '-Y sign / -Y verify\nnamespace rehearse')
    comp(870, 470, 300, 80, 'bb daemon', MUTED, 'starts the host worker as you')
    cyl(m, 1230, 470, 400, 160, 'git repo\ndocs/epics/<slug>/*.yaml\n.rehearse/allowed_signers')
    n = frame('Trust note', 870, 575, 300, 85, m, '#F0FDF4', 8, '#86EFAC')
    text(n, 12, 10, wrap('Signing happens only here: serve is started by the host worker as you, so it can reach ssh-agent. Agent threads cannot (D41).', 44), 11, 500, '#166534', lh='140%')

    # ci zone
    comp(330, 810, 220, 70, 'CI runner', C, 'checks out PR head')
    comp(620, 810, 260, 70, 'rehearse gate check', C, '@rehearse/cli + core')
    comp(950, 810, 260, 70, 'ssh-keygen -Y verify', C, 'against allowed_signers')
    node(m, 1280, 810, 240, 70, 'exit 0: PR may merge\nexit 1: PR blocked', C, '#FFFBEB', 6, sw=2)

    # edges
    arrow(m, [[230, 150], [328, 150]], B); label(m, 280, 150, 'opens', B)
    arrow(m, [[440, 190], [440, 248]], B); label(m, 440, 220, 'RPC', B)
    arrow(m, [[550, 150], [868, 150]], B); label(m, 815, 150, 'HTTP', B)
    arrow(m, [[550, 320], [868, 320]], INK); label(m, 700, 320, 'host RPC: start, renew lease')
    arrow(m, [[670, 190], [670, 232], [700, 232]], MUTED) if False else None
    arrow(m, [[1020, 468], [1020, 392]], MUTED); label(m, 1020, 430, 'runs')
    arrow(m, [[1020, 278], [1020, 212]], G); label(m, 1020, 245, 'spawns + watchdog', G)
    arrow(m, [[1170, 140], [1228, 140]], INK); label(m, 1199, 124, 'serves')
    arrow(m, [[1170, 190], [1200, 190], [1200, 335], [1228, 335]], INK); label(m, 1200, 255, 'uses')
    arrow(m, [[1480, 330], [1538, 330]], INK); label(m, 1509, 312, 'sign')
    arrow(m, [[1665, 288], [1665, 212]], INK); label(m, 1665, 250, 'key')
    arrow(m, [[1355, 402], [1355, 468]], INK); label(m, 1355, 435, 'read / write YAML')
    arrow(m, [[230, 560], [328, 560]], A); label(m, 280, 560, 'runs', A)
    path(m, [[440, 612], [440, 680], [1300, 680]], A, 2)
    arrow(m, [[1300, 680], [1300, 632]], A)
    label(m, 700, 680, 'edits YAML drafts (never approvals)', A)
    path(m, [[1500, 632], [1500, 730], [750, 730]], C, 2)
    arrow(m, [[750, 730], [750, 808]], C)
    label(m, 1120, 730, 'PR head: record + allowed_signers', C)
    arrow(m, [[230, 845], [328, 845]], C)
    for x1, x2 in [(550, 618), (880, 948), (1210, 1278)]:
        arrow(m, [[x1, 845], [x2, 845]], C)
    return f


if __name__ == '__main__':
    bd.clear_document()
    p1 = bd.big_picture()
    subnav(p1, 'Feature map')
    bd.new_page('2 Story view'); bd.story_view()
    bd.new_page('3 Scenario storyboard'); bd.storyboard()
    bd.new_page('4 Use cases'); bd.use_cases()
    bd.new_page('5 User flow'); user_flow()
    bd.new_page('6 Data flow'); data_flow()
    bd.new_page('7 System flowchart'); system_flowchart()
    bd.new_page('8 System architecture'); architecture()
    print(ex('file.saveAs', path=ROOT + '/design/rehearse-review.figcraft'))
