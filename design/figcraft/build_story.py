"""Pages 13-14: a story with its code, its e2e tests (Birdview player) and its thread.

Real data: story S6, box `approve`, the diff 66ddcb5 -> c480012 of packages/core/src/trust/write.ts,
and the task threads that built it. Per-story threads and Playwright tests do not exist yet.

Run: python3 build_story.py   (redraws pages 1-14, then saves)
"""
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import build_design as bd
import build_flows as bf
import build_docs as bdoc
import build_compare as bc
from build_design import ex, rect, ellipse, text, path, arrow, head, chip, size, frame, wrap, find_box, ROLE, INK, MUTED, LINE, BG, CARD, OK, WARN
from build_docs import link, links, tag
from build_compare import seg, STATE

BLUE, BTINT = ROLE['builder']
AMBER = '#D97706'
MONO = 'Menlo'
STORY_TABS = ['WHAT', 'HOW', 'OUTPUT', 'Before / after', 'Code', 'Tests']
RAIL_X, RAIL_W = 1460, 420
BODY_W = 1400


def mono(p, x, y, s, color=INK, fs=12, weight=400):
    return ex('text.create', text=s, x=x, y=y, parent=p, select=False,
              props={"fontSize": fs, "fontFamily": MONO, "fontWeight": weight, "fills": [color]})['id']


def circled(p, x, y, n, fg=BLUE, d=18):
    ellipse(p, x, y, d, d, fg)
    text(p, x, y + (d - 14) / 2, str(n), 11 if d >= 18 else 9, 700, CARD, width=d, align='center')


# ---- shared: story header and thread rail --------------------------------
def story_head(f, active):
    text(f, 40, 84, 'Stories  /  S6', 13, 600, MUTED)
    c = frame('Story card', 40, 108, BODY_W, 118, f, CARD, 12, LINE)
    x = 20 + link(c, 20, 16, 'story', 'S6', 13, 24) + 6
    for s, fg, bg in [('Builder', BLUE, BTINT), ('R13', INK, '#F1F5F9'), ('3 scenarios', INK, '#F1F5F9'), ('Not signed', WARN, '#FEF2F2')]:
        x += chip(c, x, 18, s, fg, bg, 11, 600, 8, 20, 10)[1] + 6
    text(c, 20, 50, 'As a Builder, I want to approve the scenarios that agents drafted, so that only scenarios I trust count as evidence.', 17, 600)
    x = 20
    for s, fg, bg in [('</>  Code: 4 of 5 boxes have code', INK, '#F1F5F9'), ('▶  E2E: 2 of 3 tests pass', WARN, '#FEF2F2'),
                      ('●  Thread: S6 · idle', ROLE['agent'][0], ROLE['agent'][1])]:
        x += chip(c, x, 84, s, fg, bg, 11, 600, 10, 22, 11)[1] + 8
    seg(f, 40, 242, STORY_TABS, active)


def msg(p, y, who, role, when, body, w=380, extra=None):
    fg, bg = ROLE[role] if role in ROLE else (MUTED, '#F1F5F9')
    ellipse(p, 20, y, 24, 24, bg, fg, 1.5)
    text(p, 20, y + 5, who[0], 11, 700, fg, width=24, align='center')
    t = text(p, 52, y + 2, who, 12, 700)
    text(p, 52 + size(t)[0] + 8, y + 3, when, 11, 500, MUTED)
    t = text(p, 52, y + 22, wrap(body, 50), 12, 400, INK, lh='145%')
    h = size(t)[1]
    if extra: extra(p, y + 22 + h + 8); h += 36
    return y + 22 + h + 18


def thread_rail(f, mode):
    r = frame('Story thread', RAIL_X, 84, RAIL_W, 1076, f, CARD, 12, LINE, clip=True)
    text(r, 20, 18, 'Story thread', 16, 700)
    chip(r, 140, 18, '● idle', OK, '#F0FDF4', 11, 600, 8, 20, 10)
    rect(r, 250, 14, 110, 28, CARD, 6, LINE)
    text(r, 250, 21, 'Open in bb  ↗', 12, 600, BLUE, width=110, align='center')
    rect(r, 368, 14, 32, 28, CARD, 6, LINE, name='collapse button')
    text(r, 368, 19, '»', 15, 700, MUTED, width=32, align='center')
    text(r, 20, 48, 'S6 · approve drafted scenarios', 13, 600, INK)
    text(r, 20, 68, 'One thread per story. It starts with the story brief:', 11, 500, MUTED)
    x = 20
    for k, s in [('story', 'S6'), ('box', 'approve'), ('box', 'gate'), ('scn', '3 scenarios')]:
        x += link(r, x, 88, k, s) + 6
    rect(r, 0, 120, RAIL_W, 1, LINE)

    y = 136
    y = msg(r, y, 'You', 'builder', '14:52', 'Make approve sign each approval with my SSH key (D41). Write nothing when signing fails.')
    y = msg(r, y, 'Agent', 'agent', '15:03',
            'Done in c480012. approve signs first, checks the key in .rehearse/allowed_signers, then writes. 196 tests pass.',
            extra=lambda p, yy: (link(p, 52, yy, 'dec', 'c480012'), link(p, 130, yy, 'box', 'approve · diff')))
    if mode == 'tests':
        def fail(p, yy):
            rect(p, 52, yy, 128, 26, WARN, 6); text(p, 52, yy + 6, 'Watch the failure', 12, 700, CARD, width=128, align='center')
            rect(p, 188, yy, 90, 26, CARD, 6, LINE); text(p, 188, yy + 6, 'Fix it', 12, 600, INK, width=90, align='center')
        rect(r, 12, y - 8, RAIL_W - 24, 150, '#FEF2F2', 8)
        y = msg(r, y, 'Birdview', 'x', '16:10',
                'S6-stale failed at step 2 “content changed”: the review panel still shows “approved”, the test expects “stale”. All windows are held on the failure screen.',
                extra=fail)
    else:
        y = msg(r, y, 'You', 'builder', '16:20', 'Why does approve now return before it writes any file?')
        y = msg(r, y, 'Agent', 'agent', '16:20',
                'So a failure leaves no half-written record: each approval is signed in the first loop (lines 137-145). Files change only after every signature is good.')

    # earlier work
    y = max(y + 8, 690)
    rect(r, 0, y, RAIL_W, 1, LINE)
    text(r, 20, y + 16, 'EARLIER WORK ON THIS STORY', 10, 700, MUTED)
    text(r, 20, y + 34, 'Task threads found by Flow-Box trailers', 11, 500, MUTED)
    yy = y + 60
    for tid, title, commit in [('thr_ncedfwrufr', 'Implement trust core and gate logic', '66ddcb5'),
                               ('thr_iayeg6das6', 'Implement cryptographic signing system', 'c480012'),
                               ('thr_sgk9fwxd5q', 'Implement visual scenario approval UI', 'ddb1628')]:
        rect(r, 20, yy, RAIL_W - 40, 48, BG, 8, LINE)
        text(r, 32, yy + 7, title, 12, 600, INK)
        mono(r, 32, yy + 27, '@thread:' + tid, ROLE['agent'][0], 11)
        mono(r, RAIL_W - 96, yy + 27, commit, MUTED, 11)
        yy += 56

    # composer
    rect(r, 0, 960, RAIL_W, 1, LINE)
    ctx = 'context: S6-stale failure' if mode == 'tests' else 'context: approve · write.ts diff'
    chip(r, 20, 974, ctx, BLUE, BTINT, 11, 600, 8, 20, 10)
    rect(r, 20, 1002, RAIL_W - 40, 56, BG, 8, LINE)
    text(r, 32, 1012, 'Ask about this code…' if mode == 'code' else 'Tell the thread what to fix…', 13, 400, MUTED)
    rect(r, RAIL_W - 96, 1022, 64, 28, BLUE, 6)
    text(r, RAIL_W - 96, 1028, 'Send', 12, 700, CARD, width=64, align='center')
    return r


# ---- 13 story · code -----------------------------------------------------
HOW = [('review', 3, None), ('happy', 0, None), ('approve', 5, 'chg'), ('gate', 4, 'chg'), ('content-changed', 2, None)]

DIFF = [
    ('@', '@@ -92,20 +131,28 @@ export function approveScenarios(dir, ids, identity, opts)'),
    (' ', "  if (findings.length > 0) return { ok: false, findings: sortFindings(findings) };"),
    (' ', ''),
    (' ', '  const at = timestamp(opts.now);'),
    ('-', '  const approval = (hash: string): Approval =>'),
    ('-', '    identity.threadId ? { by: identity.by, threadId: identity.threadId, at, hash } : { by: identity.by, at, hash };'),
    ('+', '  const verifier = opts.verifier ?? defaultVerifier(abs);'),
    ('+', '  // Sign every approval before any file changes.'),
    ('+', '  const signed = new Map<Id, SignedApproval>();'),
    ('+', '  for (const list of byFile.values()) {'),
    ('+', '    for (const { id, hash } of list) {'),
    ('+', '      const a: Approval = identity.threadId ? { by: identity.by, threadId: identity.threadId, at, hash } : { … };'),
    ('+', '      const sig = signChecked(approvalPayload(record.slug, id, a), identity.by, opts, verifier);', 1),
    ('+', "      if (typeof sig !== 'string') return sig;", 2),
    ('+', '      signed.set(id, { ...a, sig });'),
    ('+', '    }'),
    ('+', '  }'),
    (' ', '  const docs: [string, Document][] = [];'),
    ('~', '  ⋯ 4 lines with no change'),
    ('-', '    for (const { id, hash } of list) {'),
    ('+', '    for (const { id } of list) {'),
    ('-', '      const a = approval(hash);'),
    ('-', "      const old = node.get('approval', true);"),
    ('+', '      const a = signed.get(id)!;'),
    ('+', '      // A multi-line signature needs block style, so the approval map is never a flow map.'),
    (' ', '      const fresh = eventNode(doc, a) as YAMLMap;'),
    ('-', '      if (isMap(old) && old.flow) fresh.flow = true;', 3),
]


def how_strip(f):
    p = frame('HOW · code', 40, 286, BODY_W, 186, f, CARD, 12, LINE)
    text(p, 20, 16, 'HOW', 13, 800, BLUE)
    text(p, 66, 16, 'Click a box to see its code. Marks compare 66ddcb5 → c480012.', 13, 500, MUTED)
    W = 232
    x, G = 20, (BODY_W - 40 - 5 * W) / 4
    SHORT = {'review': 'Review in panel', 'approve': 'Approve scenarios', 'gate': 'Gate check', 'content-changed': 'Detect changed content'}
    for i, (bid, nfiles, st) in enumerate(HOW):
        b = find_box(bid)
        fg, bg = ROLE[b['lane']]
        sel = bid == 'approve'
        if sel: rect(p, x - 5, 51, W + 10, 108, CARD, 13, BLUE, 3, name='selected ring')
        if b['kind'] == 'decision':
            rect(p, x, 76, W, 56, CARD, 28, fg, 1.5, dashes=[4, 3])
            text(p, x, 86, '◆  ' + b['title'], 13, 600, INK, width=W, align='center')
            text(p, x, 106, 'decision · no code', 11, 500, MUTED, width=W, align='center')
        else:
            rect(p, x, 56, W, 98, bg if sel else CARD, 10, STATE[st][0] if st else fg, 2)
            text(p, x + 14, 68, SHORT.get(bid, b['title']), 14, 700, INK)
            text(p, x + 14, 90, bd.role_name(b['lane']) + '  ·  ' + bid, 11, 500, fg)
            chip(p, x + 14, 120, f'</>  {nfiles} files', INK if sel else MUTED, '#F1F5F9', 11, 600, 8, 22, 6)
            if st: bc.badge(p, x, 56, W, st)
        if i < len(HOW) - 1: arrow(p, [[x + W + 6, 105], [x + W + G - 6, 105]], MUTED)
        x += W + G
    head(p, 20 + 2 * (W + G) + W / 2, 172, 'd', BLUE, 10)
    return p


def code_panel(f):
    p = frame('Code · approve', 40, 488, BODY_W, 672, f, CARD, 12, BLUE, 2, clip=True)
    text(p, 20, 18, 'approve', 18, 700)
    tag(p, 100, 20, 'box approve')
    text(p, 200, 22, '5 files · found by Flow-Box trailers and git blame', 12, 500, MUTED)
    seg(p, BODY_W - 336, 14, ['Code', 'Diff', 'Calls', 'Tests'], 'Diff')
    # compare bar
    rect(p, 20, 52, BODY_W - 40, 40, BG, 8, LINE)
    text(p, 34, 64, 'Compare', 12, 700, MUTED)
    x = 104
    for lab, h, why, tid in [('Before', '66ddcb5', 'trust core', 'thr_ncedfwrufr'), ('After', 'c480012', 'SSH signing (D41)', 'thr_iayeg6das6')]:
        rect(p, x, 58, 330, 28, CARD, 6, LINE)
        text(p, x + 10, 64, lab, 12, 700, MUTED if lab == 'Before' else OK)
        mono(p, x + 60, 65, h, INK, 12, 700)
        text(p, x + 130, 64, why, 12, 500, INK)
        mono(p, x + 250, 66, tid[:10] + '…', ROLE['agent'][0], 10)
        if lab == 'Before': text(p, x + 338, 63, '→', 14, 700, MUTED)
        x += 360
    text(p, 840, 64, 'Other: HEAD · any commit · the to-be of this EPIC', 12, 500, MUTED)

    # plain words
    w = frame('In plain words', 20, 104, BODY_W - 40, 112, p, '#EFF6FF', 8, '#BFDBFE')
    text(w, 16, 12, 'What changed, in plain words', 13, 700, '#1E40AF')
    links(w, 230, 10, 'dec', ['D41', 'R13'])
    for i, s in enumerate([
        'Before it writes, approve signs each approval with your SSH key and checks that the key is in .rehearse/allowed_signers.',
        'If signing fails (no key, or the key is not allowed), approve stops and writes nothing. Before, it always wrote.',
        'The approval is now always a block map in YAML, because the signature has many lines.']):
        circled(w, 16, 38 + i * 24, i + 1)
        text(w, 44, 39 + i * 24, s, 13, 500, '#1E3A8A')

    # files
    fl = frame('Files', 20, 232, 300, 420, p, CARD, 8, LINE)
    text(fl, 14, 12, 'FILES IN THIS CHANGE', 10, 700, MUTED)
    y = 34
    for name, d, add, rem, sel in [('core/src/trust/write.ts', 'chg', 69, 17, True), ('core/src/trust/signature.ts', 'add', 245, 0, False),
                                   ('core/src/trust/evidence.ts', 'add', 155, 0, False), ('core/src/trust/index.ts', 'chg', 39, 1, False)]:
        if sel: rect(fl, 6, y - 4, 288, 40, BTINT, 6)
        mono(fl, 14, y, name.split('/')[-1], INK, 12, 700 if sel else 400)
        text(fl, 14, y + 18, 'packages/' + name.rsplit('/', 1)[0], 11, 500, MUTED)
        mono(fl, 200, y, f'+{add}', OK, 11); mono(fl, 248, y, f'−{rem}', WARN, 11)
        y += 46
    text(fl, 14, y + 4, 'NO CHANGE IN THIS RANGE', 10, 700, MUTED)
    y += 26
    for name in ['server/src/http.ts', 'ui/src/components/Approve.tsx']:
        mono(fl, 14, y, name.split('/')[-1], MUTED, 12)
        text(fl, 14, y + 16, 'packages/' + name.rsplit('/', 1)[0], 11, 500, MUTED)
        y += 38
    rect(fl, 0, y + 2, 300, 1, LINE)
    text(fl, 14, y + 14, 'IN write.ts', 10, 700, MUTED)
    y += 36
    for fn, st in [('approveScenarios()', 'chg'), ('signChecked()', 'add'), ('signingFailure()', 'add')]:
        fg = STATE[st][0]
        mono(fl, 14, y, fn, INK, 11, 700 if fn.startswith('approve') else 400)
        text(fl, 200, y, STATE[st][2], 10, 700, fg)
        y += 18

    # diff
    DW = BODY_W - 356
    d = frame('Diff', 336, 232, DW, 420, p, CARD, 8, LINE, clip=True)
    rect(d, 0, 0, DW, 32, BG)
    mono(d, 14, 9, 'packages/core/src/trust/write.ts', INK, 12, 700)
    text(d, 290, 9, '·  approveScenarios()', 12, 500, MUTED)
    seg(d, DW - 144, 2, ['Unified', 'Split'], 'Unified')
    o, n, y = 92, 131, 36
    for row in DIFF:
        k, s = row[0], row[1]
        bg = {'+': '#E6FFEC', '-': '#FFEBE9', '@': '#F1F8FF', '~': '#F8FAFC'}.get(k)
        if bg: rect(d, 0, y, DW, 14, bg)
        if k in ' -': mono(d, 8, y, str(o), '#94A3B8', 10)
        if k in ' +': mono(d, 44, y, str(n), '#94A3B8', 10)
        col = {'+': '#166534', '-': '#991B1B', '@': '#1D4ED8', '~': MUTED}.get(k, INK)
        mono(d, 82, y, (k if k in '+-' else ' ') + ' ' + s if k not in '@~' else s, col, 11)
        if len(row) > 2: circled(d, DW - 22, y, row[2], d=14)
        if k == ' ': o += 1; n += 1
        elif k == '-': o += 1
        elif k == '+': n += 1
        elif k == '~': o += 4; n += 4
        y += 14
    return p


def code_page():
    f = bd.app_shell('Story · code', 'Stories')
    story_head(f, 'Code')
    how_strip(f)
    code_panel(f)
    thread_rail(f, 'code')
    return f


# ---- 14 story · e2e tests (Birdview) -------------------------------------
def mini_ui(p, x, y, w, h):
    """The rehearse story view inside a browser tile, with S6-approve now stale."""
    rect(p, x, y, w, 30, '#F1F5F9')
    for i, c in enumerate(['#F87171', '#FBBF24', '#34D399']): ellipse(p, x + 12 + i * 16, y + 10, 10, 10, c)
    rect(p, x + 70, y + 6, 360, 18, CARD, 9)
    mono(p, x + 80, y + 9, '127.0.0.1:4700/#/stories/S6', MUTED, 10)
    yy = y + 30
    rect(p, x, yy, w, h - 30, BG)
    text(p, x + 20, yy + 16, 'rehearse', 14, 700)
    text(p, x + 20, yy + 48, 'S6 · Builder wants to approve the scenarios that agents drafted', 16, 700)
    for i, (sid, title, st) in enumerate([('S6-approve', 'Builder approves a draft scenario', 'approved'),
                                         ('S6-agent-cli', 'Agent has CLI access only', 'draft'),
                                         ('S6-stale', 'An approved scenario changes', 'approved')]):
        cx = x + 20 + i * 250
        rect(p, cx, yy + 86, 236, 150, CARD, 10, WARN if i == 0 else LINE, 3 if i == 0 else 1)
        text(p, cx + 14, yy + 100, sid, 11, 700, BLUE)
        text(p, cx + 14, yy + 120, title, 13, 700)
        fg, bg = {'stale': (WARN, '#FEF2F2'), 'draft': (MUTED, '#F1F5F9'), 'approved': (OK, '#F0FDF4')}[st]
        chip(p, cx + 14, yy + 150, st, fg, bg, 11, 700, 8, 22, 11)
        rect(p, cx + 112, yy + 192, 110, 30, BLUE, 6)
        text(p, cx + 112, yy + 199, 'Open', 12, 700, CARD, width=110, align='center')
    # pointer + highlight of what the test checks
    rect(p, x + 14, yy + 80, 248, 162, 'none', 12, '#F59E0B', 3, dashes=[6, 4])
    pts = [[x + 120, yy + 160], [x + 120, yy + 182], [x + 126, yy + 177], [x + 131, yy + 187], [x + 135, yy + 185], [x + 130, yy + 175], [x + 138, yy + 175]]
    ex('vector.create', parent=p, points=[[a - x - 120, b - yy - 160] for a, b in pts], x=x + 120, y=yy + 160, closed=True,
       name='pointer', props={"fill": INK, "stroke": CARD, "strokeWeight": 1.5}, select=False)


def tests_page():
    f = bd.app_shell('Story · tests', 'Stories')
    story_head(f, 'Tests')
    b = frame('Birdview player', 40, 286, BODY_W, 874, f, CARD, 12, LINE, clip=True)
    text(b, 20, 18, 'E2E tests', 16, 700)
    chip(b, 112, 18, 'Birdview player', ROLE['agent'][0], ROLE['agent'][1], 11, 600, 8, 20, 10)
    text(b, 240, 20, 'playlist S6 · e2e/birdview/playlists/S6.json', 12, 500, MUTED)
    x = seg(b, 880, 12, ['Active', 'Grid'], 'Active')
    for s, prim in [('Retry', False), ('▶  Play all', True), ('↗  Big screen', False)]:
        tmp = text(b, 0, -100, s, 12, 700); tw = size(tmp)[0] + 24; ex('edit.delete', ids=[tmp])
        rect(b, x + 8, 12, tw, 28, BLUE if prim else CARD, 6, None if prim else LINE)
        text(b, x + 8, 19, s, 12, 700, CARD if prim else INK, width=tw, align='center')
        x += tw + 8

    # test list = scenarios
    l = frame('Tests', 20, 56, 340, 798, b, BG, 8, LINE)
    text(l, 14, 14, 'ONE TEST PER SCENARIO', 10, 700, MUTED)
    y = 38
    for sid, title, key, st, extra in [
            ('S6-approve', 'Builder approves a draft scenario, gate still fails', 'e2e/s6/approve.spec.ts:8', 'pass', '14 s · 9 steps'),
            ('S6-agent-cli', 'Agent has CLI access only', 'e2e/s6/agent-cli.spec.ts:6', 'pass', '3 s · 1 step'),
            ('S6-stale', 'An approved scenario changes', 'e2e/s6/stale.spec.ts:10', 'fail', 'failed at step 2 of 3')]:
        sel = st == 'fail'
        rect(l, 8, y, 324, 104, CARD, 8, WARN if sel else LINE, 2 if sel else 1)
        link(l, 20, y + 12, 'scn', sid)
        fg, bg, s = (OK, '#F0FDF4', '✓ passed') if st == 'pass' else (WARN, '#FEF2F2', '✕ failed · held')
        r, cw = chip(l, 0, y + 12, s, fg, bg, 11, 700, 8, 20, 10)
        ex('node.set', ids=[r], props={"x": 320 - cw}); ex('node.set', ids=[ex('node.find', root=l)['ids'][-1]], props={"x": 328 - cw})
        text(l, 20, y + 40, wrap(title, 40), 13, 600, INK, lh='130%')
        mono(l, 20, y + 80, key, MUTED, 10)
        text(l, 224, y + 80, extra, 11, 500, WARN if sel else MUTED)
        y += 114
    rect(l, 8, y, 324, 32, CARD, 8, LINE, dashes=[4, 3])
    text(l, 8, y + 8, '＋  Add test', 12, 600, MUTED, width=324, align='center')
    n = frame('Note', 8, y + 52, 324, 168, l, '#FFFBEB', 8, '#FCD34D')
    text(n, 12, 10, 'Not built yet', 12, 700, '#B45309')
    text(n, 12, 30, wrap('rehearse has no Playwright tests today. Each scenario needs one Playwright test; its steps use the box paths of the scenario. An agent writes them, the scenario stays the spec.', 44), 12, 500, '#92400E', lh='145%')
    n = frame('Failure note', 8, y + 232, 324, 120, l, '#F5F3FF', 8, '#DDD6FE')
    text(n, 12, 10, 'A failure goes to the story thread', 12, 700, ROLE['agent'][0])
    text(n, 12, 30, wrap('Birdview holds every window on the failure screen and sends the failure to the S6 thread, not to a separate Birdview chat.', 44), 12, 500, '#5B21B6', lh='145%')

    # player
    pl = frame('Player', 376, 56, 1004, 560, b, '#0F172A', 10, clip=True)
    big = frame('Tile Builder', 12, 12, 780, 536, pl, CARD, 8, '#F59E0B', 3, clip=True)
    mini_ui(big, 0, 30, 780, 506)
    rect(big, 0, 0, 780, 30, '#FFFBEB')
    text(big, 12, 7, 'Builder · Review panel', 12, 700, INK)
    text(big, 170, 8, 'checks the scenario status', 11, 500, MUTED)
    chip(big, 680, 5, '■ held', WARN, '#FEF2F2', 11, 700, 8, 20, 10)
    now = frame('NOW', 24, 448, 600, 76, big, '#0F172A', 10)
    text(now, 14, 10, 'NOW', 10, 800, '#FBBF24')
    text(now, 14, 28, 'Builder opens S6 and reads the status of S6-approve.', 13, 600, CARD)
    text(now, 14, 50, 'Expected “stale”, saw “approved”.', 12, 600, '#FCA5A5')
    for i, (role, win, purpose, done) in enumerate([('Agent', 'Terminal', 'edits the scenario', True), ('CI', 'Gate report', 'reads the gate', False)]):
        fg, bg = ROLE[role.lower()]
        t = frame(f'Tile {role}', 804, 12 + i * 180, 188, 168, pl, CARD, 8, LINE, clip=True)
        rect(t, 0, 0, 188, 26, bg)
        text(t, 8, 6, f'{role} · {win}', 11, 700, fg)
        text(t, 8, 34, purpose, 10, 500, MUTED)
        for j in range(5): rect(t, 8, 56 + j * 14, [150, 120, 160, 90, 130][j], 6, '#E2E8F0', 3)
        if done: chip(t, 8, 138, 'done ✓', OK, '#F0FDF4', 10, 700, 7, 18, 9)
    text(pl, 804, 380, 'Click a tile to pin it big.', 11, 500, '#94A3B8')

    # steps = scenario steps -> boxes
    s = frame('Steps', 376, 632, 1004, 222, b, CARD, 8, LINE)
    text(s, 16, 14, 'S6-stale  ·  steps', 13, 700)
    text(s, 150, 15, 'Each step is a box of the flow. Click a box to see its code.', 12, 500, MUTED)
    x = 16
    for i, (bid, plain, st) in enumerate([('signed-edit', 'Agent changes the given of S6-approve', 'ok'),
                                          ('content-changed', 'rehearse marks S6-approve stale', 'fail'),
                                          ('review/swimlanes', 'Builder sees the stale mark', 'todo')]):
        fg, bg = {'ok': (OK, '#F0FDF4'), 'fail': (WARN, '#FEF2F2'), 'todo': (MUTED, BG)}[st]
        rect(s, x, 46, 310, 120, bg, 8, fg, 2 if st == 'fail' else 1)
        circled(s, x + 12, 58, i + 1, fg)
        text(s, x + 40, 58, {'ok': 'passed', 'fail': 'failed here', 'todo': 'not run'}[st], 11, 700, fg)
        text(s, x + 12, 86, wrap(plain, 40), 13, 600, INK, lh='130%')
        link(s, x + 12, 132, 'box', bid)
        if st == 'fail': text(s, x + 170, 135, '</> code', 12, 700, BLUE)
        if i < 2: arrow(s, [[x + 312, 106], [x + 328, 106]], MUTED)
        x += 330
    rect(s, 16, 182, 972, 6, '#F1F5F9', 3)
    rect(s, 16, 182, 972 * 0.5, 6, WARN, 3)
    text(s, 16, 196, 'Video, trace and HTML report are kept for each run.', 11, 500, MUTED)
    thread_rail(f, 'tests')
    return f


# ---- 15 story · code, thread collapsed -----------------------------------
def collapsed_rail(f):
    """The thread panel folded to a strip. Click the strip, the » button, or the Thread chip to open it."""
    x0 = 1920 - 40 - 56
    r = frame('Story thread · collapsed', x0, 84, 56, 1076, f, CARD, 12, LINE)
    rect(r, 12, 14, 32, 28, CARD, 6, LINE, name='expand button')
    text(r, 12, 19, '«', 15, 700, MUTED, width=32, align='center')
    # chat bubble with an unread count
    rect(r, 14, 66, 28, 22, ROLE['agent'][1], 6, ROLE['agent'][0], 1.5, name='thread icon')
    ex('vector.create', parent=r, points=[[0, 0], [8, 0], [0, 7]], x=20, y=87, closed=True, name='bubble tail',
       props={"fill": ROLE['agent'][0], "stroke": "none"}, select=False)
    ellipse(r, 34, 58, 18, 18, WARN, CARD, 2, name='unread')
    text(r, 34, 60, '1', 10, 800, CARD, width=18, align='center')
    ellipse(r, 24, 108, 8, 8, OK, name='status idle')
    t = text(r, 0, 0, 'S6 thread  ·  1 new: S6-stale failed', 12, 600, INK, name='vertical label')
    w, h = size(t)
    ex('node.set', ids=[t], props={"rotation": -90})
    ex('node.set', ids=[t], props={"x": 28 - h / 2, "y": 136 + w})
    return r


def code_page_collapsed():
    global BODY_W
    f = bd.app_shell('Story · code · thread collapsed', 'Stories')
    BODY_W = 1920 - 40 - 56 - 20 - 40
    try:
        story_head(f, 'Code')
        how_strip(f)
        code_panel(f)
    finally:
        BODY_W = 1400
    collapsed_rail(f)
    # toast that explains the toggle once
    t = frame('Toast', 1384, 1164, 420, 32, f, INK, 8)
    text(t, 16, 8, 'Thread hidden. Press  ]  or click the strip to show it.', 13, 500, CARD)
    return f


if __name__ == '__main__':
    bd.clear_document()
    p1 = bd.big_picture(); bf.subnav(p1, 'Feature map')
    pages = [('2 Story view', bd.story_view), ('3 Scenario storyboard', bd.storyboard), ('4 Use cases', bd.use_cases),
             ('5 User flow', bf.user_flow), ('6 Data flow', bf.data_flow), ('7 System flowchart', bf.system_flowchart),
             ('8 System architecture', bf.architecture), ('9 PRD', bdoc.prd_page), ('10 Tech spec', bdoc.spec_page),
             ('11 Before after', bc.compare_page), ('12 Story before after', bc.story_page),
             ('13 Story code', code_page), ('14 Story tests', tests_page),
             ('15 Story code thread hidden', code_page_collapsed)]
    for name, fn in pages:
        bd.new_page(name); fn()
    print(ex('file.saveAs', path=ROOT + '/design/rehearse-review.figcraft'))
