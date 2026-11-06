// T39, box `sign-off`: the sign-off preview lists exactly the content of story hash rule 2, and
// the change list says in plain words what changed between two such contents.

import { describe, expect, it } from 'vitest';
import { allScenarios, diffStoryContent, loadEpic, previewContent, previewCounts, sha256, storyContentV2, storyHashV2, wordDiff } from '../../src/index.js';
import { makeEpic, REAL_EPIC, type Docs } from '../helpers.js';

function content(edit?: (d: Docs) => void, id = 'S1'): Record<string, unknown> {
  const { record } = loadEpic(makeEpic(edit ? { edit } : {}));
  const story = record.prd!.stories.find((s) => s.id === id)!;
  return storyContentV2(story, record.prd!, record.flow, allScenarios(record));
}

describe('T39 sign-off preview: the content of story hash rule 2', () => {
  it('lists the story sentence, its requirements, criteria, scenarios, boxes and lane roles', () => {
    const p = previewContent(content());
    expect(p.story).toEqual({ id: 'S1', role: 'buyer', want: 'to pay for my cart', soThat: 'I get my items' });
    expect(p.requirements).toEqual([{ id: 'R1', kind: 'functional', text: 'The buyer pays for an order.' }]);
    expect(p.criteria).toEqual([{ id: 'S1-A1', given: 'a cart with items', when: 'the buyer pays', then: 'the order is shipped' }]);
    expect(p.scenarios.map((s) => s.id)).toEqual(['S1-buy', 'S1-empty']);
    expect(p.scenarios[0]!.steps).toEqual(['start', 'cart', 'pay', 'in-stock', 'ship/pack', 'ship/send', 'done']);
    expect(p.boxes).toEqual([
      { path: 'cart', title: 'Check out the cart', kind: 'input', lane: 'buyer', relation: 'serves' },
      { path: 'pay', title: 'Charge the buyer', kind: 'process', lane: 'shop', relation: 'serves' },
    ]);
    expect(p.roles).toEqual([
      { id: 'buyer', name: 'Buyer' },
      { id: 'shop', name: 'Shop' },
    ]);
    expect(previewCounts(p)).toEqual({ requirements: 1, criteria: 1, scenarios: 2, boxes: 2 });
  });

  it('lists the children of a serving box and the ancestors of a serving child, nothing else', () => {
    const p = previewContent(content(undefined, 'S2'));
    expect(p.boxes.map((b) => [b.path, b.relation])).toEqual([
      ['ship', 'serves'],
      ['ship/pack', 'inside'],
      ['ship/send', 'inside'],
    ]);
    const child = previewContent(
      content((d) => {
        const ship = d['flow.yaml'].root.boxes[4];
        delete ship.stories;
        ship.children.boxes[1].stories = ['S2'];
      }, 'S2'),
    );
    expect(child.boxes.map((b) => [b.path, b.relation])).toEqual([
      ['ship/send', 'serves'],
      ['ship', 'parent'],
    ]);
  });

  it('every part of the preview is in the hashed content: a change to any listed item changes the hash', () => {
    const { record } = loadEpic(REAL_EPIC);
    const scenarios = allScenarios(record);
    for (const story of record.prd!.stories) {
      const c = storyContentV2(story, record.prd!, record.flow, scenarios);
      expect(sha256(c)).toBe(storyHashV2(story, record.prd!, record.flow, scenarios));
      const p = previewContent(c);
      const boxes = c.boxes as Record<string, unknown>;
      // Each listed top-level box is a key of the hashed boxes, and each hashed box is listed.
      for (const path of Object.keys(boxes)) expect(p.boxes.map((b) => b.path)).toContain(path);
      expect(p.requirements.map((r) => r.id)).toEqual(record.prd!.requirements.filter((r) => story.requirements.includes(r.id)).map((r) => r.id));
      expect(p.scenarios.map((s) => s.id)).toEqual(scenarios.filter((s) => s.story === story.id).map((s) => s.id));
      expect(p.criteria.map((x) => x.id)).toEqual(story.acceptance.map((a) => a.id));
    }
  });
});

describe('T39 what changed since the last sign-off', () => {
  const before = content();

  it('no change gives an empty list', () => {
    expect(diffStoryContent(before, content())).toEqual([]);
  });

  it('a changed criterion names the criterion and the field, old and new, with a word diff', () => {
    const after = content((d) => (d['prd.yaml'].stories[0].acceptance[0].then = 'the order is paid and shipped'));
    const changes = diffStoryContent(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      part: 'criterion',
      id: 'S1-A1',
      change: 'changed',
      field: 'then',
      before: 'the order is shipped',
      after: 'the order is paid and shipped',
      text: 'criterion S1-A1 "then" changed',
    });
    expect(changes[0]!.words).toEqual([
      { kind: 'same', text: 'the order is ' },
      { kind: 'added', text: 'paid and ' },
      { kind: 'same', text: 'shipped' },
    ]);
  });

  it('a scenario added or removed', () => {
    const removed = diffStoryContent(before, content((d) => d['scenarios/S1.yaml'].scenarios.pop()));
    expect(removed).toEqual([{ part: 'scenario', id: 'S1-empty', change: 'removed', text: 'scenario S1-empty removed' }]);
    const added = diffStoryContent(content((d) => d['scenarios/S1.yaml'].scenarios.pop()), before);
    expect(added).toEqual([{ part: 'scenario', id: 'S1-empty', change: 'added', text: 'scenario S1-empty added' }]);
  });

  it('a changed scenario example names the step; a changed step list shows both lists', () => {
    const example = diffStoryContent(before, content((d) => (d['scenarios/S1.yaml'].scenarios[0].steps[1].example.then.orderId = 'o2')));
    expect(example.map((c) => c.text)).toEqual(['scenario S1-buy example of step 2 (cart) changed']);
    expect(example[0]!.before).toContain('"orderId":"o1"');
    expect(example[0]!.after).toContain('"orderId":"o2"');
    const steps = diffStoryContent(before, content((d) => d['scenarios/S1.yaml'].scenarios[1].steps.splice(1, 1)));
    expect(steps[0]).toMatchObject({ text: 'scenario S1-empty steps changed (3 → 2 steps)', before: 'start → cart (empty-cart) → failed', after: 'start → failed' });
  });

  it('a changed box title, an added serving box, a child box of a serving box', () => {
    const title = diffStoryContent(before, content((d) => (d['flow.yaml'].root.boxes[2].title = 'Charge the card')));
    expect(title).toMatchObject([{ part: 'box', id: 'pay', field: 'title', before: 'Charge the buyer', after: 'Charge the card', text: 'box pay: title changed' }]);
    const added = diffStoryContent(before, content((d) => (d['flow.yaml'].root.boxes[3].stories = ['S1'])));
    expect(added.map((c) => c.text)).toEqual(['box in-stock added']);
    const s2 = content(undefined, 'S2');
    const child = diffStoryContent(s2, content((d) => (d['flow.yaml'].root.boxes[4].children.boxes[0].title = 'Pack well'), 'S2'));
    expect(child.map((c) => c.text)).toEqual(['box ship/pack: title changed']);
  });

  it('a changed requirement text, a requirement added to the story, the story sentence', () => {
    const text = diffStoryContent(before, content((d) => (d['prd.yaml'].requirements[0].text = 'The buyer pays for an order by card.')));
    expect(text.map((c) => c.text)).toEqual(['requirement R1 text changed']);
    const added = diffStoryContent(before, content((d) => d['prd.yaml'].stories[0].requirements.push('R2')));
    expect(added.map((c) => c.text)).toEqual(['requirement R2 added']);
    const want = diffStoryContent(before, content((d) => (d['prd.yaml'].stories[0].want = 'to pay for my whole cart')));
    expect(want).toMatchObject([{ part: 'story', id: 'S1', field: 'want', text: 'story S1 "I want" changed' }]);
  });

  it('a changed lane role', () => {
    const role = diffStoryContent(before, content((d) => (d['prd.yaml'].roles[1].name = 'Store')));
    expect(role).toMatchObject([{ part: 'role', id: 'shop', field: 'name', before: 'Shop', after: 'Store' }]);
  });
});

describe('T39 wordDiff', () => {
  it('keeps the same words and marks removed and added ones', () => {
    expect(wordDiff('a b c', 'a x c')).toEqual([
      { kind: 'same', text: 'a ' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: ' c' },
    ]);
    expect(wordDiff('', 'new')).toEqual([{ kind: 'added', text: 'new' }]);
    expect(wordDiff('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  });

  it('joins the parts back to the two texts', () => {
    const a = 'the owner signs the story when the gate is clean';
    const b = 'the owner signs every story once the gate is clean and green';
    const parts = wordDiff(a, b);
    expect(parts.filter((p) => p.kind !== 'added').map((p) => p.text).join('')).toBe(a);
    expect(parts.filter((p) => p.kind !== 'removed').map((p) => p.text).join('')).toBe(b);
  });
});
