// T11 (story Code tab, design page 13): the story header chip, the Code tab's box strip, and
// the box panel (compare bar, plain words, files, diff, task threads). The code API is a fake
// through CodeApiContext; the model is tested in code-model.test.ts.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoxCodeQuery, BoxCodeView, CodeIndex } from '@rehearse/server';
import { App } from '../src/App.js';
import { CodeApiContext, httpCodeApi, type BoxCodeOutcome, type CodeApi } from '../src/code-api.js';
import { StoryView } from '../src/components/StoryView.js';
import { boxAt } from '../src/model/diagram.js';
import { reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const ref = (c: string, subject: string) => ({ sha: c.repeat(40), short: c.repeat(7), subject, date: '2026-11-05T10:00:00+07:00' });

const INDEX: CodeIndex = {
  ok: true,
  head: ref('9', 'Head'),
  boxes: {
    cart: { commits: [ref('1', 'Cart (D7)'), ref('2', 'Cart total (R13)')], files: ['src/cart.ts', 'src/old.ts', 'README.md'] },
    pay: { commits: [], files: [] },
    'in-stock': { commits: [], files: [] },
  },
};

const ctx = (o: number, n: number) => ({ kind: 'context' as const, text: `same ${o}`, old: o, new: n });

function cartView(q: BoxCodeQuery): BoxCodeView {
  const after = q.after === '9'.repeat(40) ? ref('9', 'Head') : ref('2', 'Cart total (R13)');
  return {
    ok: true,
    box: 'cart',
    commits: INDEX.ok ? INDEX.boxes.cart!.commits : [],
    head: ref('9', 'Head'),
    before: ref('0', 'Parent of cart'),
    after,
    range: [
      { ...ref('1', 'Cart (D7)'), body: '- The cart lists items.\n- An empty cart stops.\n\nFlow-Box: cart', boxes: ['cart'] },
      { ...ref('2', 'Cart total (R13)'), body: 'Done in thr_abc123.\n\nFlow-Box: cart', boxes: ['cart'] },
    ],
    changedBoxes: ['cart'],
    files: [
      { path: 'src/cart.ts', added: 3, removed: 1, binary: false },
      { path: 'README.md', added: 1, removed: 0, binary: false },
    ],
    unchanged: ['src/old.ts'],
    file: q.file ?? 'src/cart.ts',
    diff: {
      oldPath: q.file ?? 'src/cart.ts',
      newPath: q.file ?? 'src/cart.ts',
      status: 'modified',
      binary: false,
      more: q.file === 'README.md' ? 25 : 0,
      hunks: [
        {
          oldStart: 10,
          oldLines: 9,
          newStart: 10,
          newLines: 11,
          section: 'function cart()',
          lines: [ctx(10, 10), { kind: 'del', text: 'total = 0', old: 11 }, { kind: 'add', text: 'total = sum()', new: 11 }, ctx(12, 12), ctx(13, 13), ctx(14, 14), ctx(15, 15), ctx(16, 16), ctx(17, 17), { kind: 'add', text: 'check()', new: 18 }, { kind: 'add', text: 'done()', new: 19, noNewline: true }],
        },
      ],
    },
  };
}

function fakeApi(over: Partial<CodeApi> = {}): CodeApi & { boxCalls: BoxCodeQuery[] } {
  const boxCalls: BoxCodeQuery[] = [];
  return {
    boxCalls,
    index: async () => INDEX,
    box: async (q): Promise<BoxCodeOutcome> => {
      boxCalls.push(q);
      return { ok: true, view: cartView(q) };
    },
    ...over,
  };
}

function shop() {
  const view = reviewEpic();
  boxAt(view.flow, 'in-stock')!.stories = ['S1'];
  return view;
}

function renderStory(api: CodeApi = fakeApi()) {
  const user = userEvent.setup();
  render(
    <CodeApiContext.Provider value={api}>
      <StoryView view={shop()} storyId="S1" onOpenBox={() => undefined}>
        <p data-testid="scenario-cards">cards</p>
      </StoryView>
    </CodeApiContext.Provider>,
  );
  return { user };
}

async function openCode(api: CodeApi = fakeApi()) {
  const r = renderStory(api);
  await r.user.click(screen.getByTestId('story-tab-code'));
  return r;
}

describe('T11 1 story header chip', () => {
  it('says how many of the story boxes have code', async () => {
    renderStory();
    expect(await screen.findByText('Code: 1 of 3 boxes have code')).toBeInTheDocument();
  });

  it('says code is not available when the server finds no git repository', async () => {
    renderStory(fakeApi({ index: async () => ({ ok: false, reason: 'the EPIC folder is not in a git repository' }) }));
    expect(await screen.findByText('Code: not available')).toBeInTheDocument();
  });
});

describe('T11 2 story tabs and the Code tab box strip', () => {
  it('The story page (WHAT) is the default tab with WHAT, HOW, OUTPUT and the scenario cards; Code replaces them', async () => {
    const { user } = renderStory();
    expect(screen.getByTestId('story-tab-what')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('story-what')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-cards')).toBeInTheDocument();
    await user.click(screen.getByTestId('story-tab-code'));
    expect(screen.getByTestId('story-tab-code')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('story-what')).toBeNull();
    expect(screen.queryByTestId('scenario-cards')).toBeNull();
    expect(screen.getByTestId('story-code')).toBeInTheDocument();
  });

  it('shows the HOW boxes in flow order with kind, lane and N files or no code', async () => {
    await openCode();
    const boxes = within(screen.getByRole('list', { name: 'Boxes of S1 in flow order' })).getAllByRole('button');
    await waitFor(() => expect(boxes[0]).toHaveTextContent('3 files'));
    expect(boxes.map((b) => b.getAttribute('data-testid'))).toEqual(['code-box-cart', 'code-box-pay', 'code-box-in-stock']);
    expect(boxes[0]).toHaveTextContent(/input · Builder/);
    expect(boxes[0]).toHaveTextContent('3 files');
    expect(boxes[1]).toHaveTextContent('no code');
    expect(boxes[2]).toHaveTextContent(/decision · System.*no code/);
  });

  it('a click or Enter opens a box below and highlights it; boxes with commits in the range are marked changed in words', async () => {
    const api = fakeApi();
    const { user } = await openCode(api);
    const cart = screen.getByTestId('code-box-cart');
    await waitFor(() => expect(cart).toHaveTextContent('3 files'));
    cart.focus();
    await user.keyboard('{Enter}');
    expect(cart).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('compare-bar')).toBeInTheDocument();
    expect(api.boxCalls).toEqual([{ box: 'cart' }]);
    expect(cart).toHaveTextContent('~ changed');
    expect(cart).toHaveAccessibleName(/changed in the compare range/);
    expect(screen.getByTestId('code-hint')).toHaveTextContent('Marks compare 0000000 → 2222222.');

    await user.click(screen.getByTestId('code-box-pay'));
    expect(screen.getByTestId('code-box-pay')).toHaveAttribute('aria-pressed', 'true');
    expect(cart).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('code-none')).toHaveTextContent('No commit names this box in a Flow-Box: trailer.');
    await user.click(screen.getByTestId('code-box-in-stock'));
    expect(screen.getByTestId('code-none')).toHaveTextContent('A decision box has no code.');
    expect(api.boxCalls).toHaveLength(1);
  });
});

describe('T11 3 box panel', () => {
  async function openCart(api = fakeApi()) {
    const r = await openCode(api);
    await waitFor(() => expect(screen.getByTestId('code-box-cart')).toHaveTextContent('3 files'));
    await r.user.click(screen.getByTestId('code-box-cart'));
    await screen.findByTestId('compare-bar');
    return { ...r, api };
  }

  it('compare bar: before and after with short hash and subject; changing one loads that range', async () => {
    const { user, api } = await openCart();
    const before = screen.getByTestId('compare-before') as HTMLSelectElement;
    const after = screen.getByTestId('compare-after') as HTMLSelectElement;
    expect(before.selectedOptions[0]).toHaveTextContent('0000000 Parent of cart');
    expect(after.selectedOptions[0]).toHaveTextContent('2222222 Cart total (R13)');
    expect([...after.options].map((o) => o.textContent)).toEqual(['1111111 Cart (D7)', '2222222 Cart total (R13)', '9999999 Head (HEAD)']);
    await user.selectOptions(after, '9'.repeat(40));
    await waitFor(() => expect(api.boxCalls.at(-1)).toEqual({ box: 'cart', before: '0'.repeat(40), after: '9'.repeat(40) }));
    await waitFor(() => expect((screen.getByTestId('compare-after') as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('9999999 Head (HEAD)'));
  });

  it('what changed, in plain words: the bullets of the bodies, else the subject, with the record ids of the subjects', async () => {
    await openCart();
    const words = screen.getByTestId('plain-words');
    expect(within(words).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['The cart lists items. 1111111', 'An empty cart stops. 1111111', 'Cart total (R13) 2222222']);
    expect(within(words).getByRole('heading')).toHaveTextContent('What changed, in plain words D7R13');
  });

  it('files in this change with +/− counts, and the files with no change in this range', async () => {
    await openCart();
    const files = screen.getByTestId('code-files');
    expect(screen.getByTestId('code-file-src/cart.ts')).toHaveTextContent('cart.ts+3 −1src');
    expect(screen.getByTestId('code-file-src/cart.ts')).toHaveAccessibleName('Show the diff of src/cart.ts: 3 lines added, 1 removed');
    expect(screen.getByTestId('code-file-src/cart.ts')).toHaveAttribute('aria-current', 'true');
    expect(within(files).getByText('No change in this range')).toBeInTheDocument();
    expect(screen.getByTestId('code-unchanged')).toHaveTextContent('old.ts');
  });

  it('unified diff: old and new line numbers, added and removed lines in words as well as colour, folded unchanged runs', async () => {
    const { user } = await openCart();
    const table = screen.getByTestId('diff-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('@@ -10,9 +10,11 @@ function cart()');
    expect(rows[2]).toHaveClass('is-del');
    expect(rows[2]).toHaveTextContent('11−removed: total = 0');
    expect(rows[3]).toHaveClass('is-add');
    expect(rows[3]).toHaveTextContent('11+added: total = sum()');
    expect(within(table).getByText(/no newline at end of file/)).toBeInTheDocument();
    const fold = screen.getByRole('button', { name: 'Show 4 lines with no change' });
    expect(fold).toHaveTextContent('4 lines with no change');
    expect(table).not.toHaveTextContent('same 14');
    await user.click(fold);
    expect(screen.getByTestId('diff-table')).toHaveTextContent('same 14');
  });

  it('a Split toggle shows the change side by side', async () => {
    const { user } = await openCart();
    await user.click(screen.getByTestId('diff-split'));
    expect(screen.getByTestId('diff-split')).toHaveAttribute('aria-pressed', 'true');
    const split = screen.getByTestId('diff-split-table');
    const pair = within(split).getAllByRole('row').find((r) => r.textContent?.includes('total = 0'))!;
    expect(pair).toHaveTextContent('removed: total = 0');
    expect(pair).toHaveTextContent('added: total = sum()');
  });

  it('picking a file shows its diff; T11 4 a capped diff says how many lines are left out', async () => {
    const { user, api } = await openCart();
    expect(screen.queryByTestId('diff-too-long')).toBeNull();
    await user.click(screen.getByTestId('code-file-README.md'));
    await waitFor(() => expect(api.boxCalls.at(-1)).toEqual({ box: 'cart', before: '0'.repeat(40), after: '2'.repeat(40), file: 'README.md' }));
    expect(await screen.findByTestId('diff-too-long')).toHaveTextContent('Diff too long: 25 more lines not shown.');
    expect(screen.getByTestId('code-diff')).toHaveAccessibleName('Diff of README.md');
  });

  it('task threads: a thread a commit names shows as @thread:thr_…; none when no commit names one', async () => {
    await openCart();
    expect(within(screen.getByTestId('code-threads')).getByRole('link')).toHaveTextContent('@thread:thr_abc123');

    const plain = fakeApi({ box: async (q) => ({ ok: true, view: { ...cartView(q), range: [] } }) });
    document.body.innerHTML = '';
    await openCart(plain);
    expect(screen.queryByTestId('code-threads')).toBeNull();
  });

  it('says why the code did not load', async () => {
    const { user } = await openCode(fakeApi({ box: async () => ({ ok: false, error: 'no commit abc1234' }) }));
    await waitFor(() => expect(screen.getByTestId('code-box-cart')).toHaveTextContent('3 files'));
    await user.click(screen.getByTestId('code-box-cart'));
    expect(await screen.findByTestId('code-error')).toHaveTextContent('Could not load the code: no commit abc1234');
  });
});

describe('T11 code API client', () => {
  it('sends the session token on GET api/code-index and GET api/box-code', async () => {
    const server = mockServer({ epic: () => reviewEpic() });
    const api = httpCodeApi();
    expect(await api.index()).toEqual({ ok: false, reason: 'no endpoint api/code-index' });
    await api.box({ box: 'cart', before: 'abc1234', after: 'HEAD', file: 'src/a b.ts' });
    const code = server.calls.filter((c) => c.url.startsWith('api/code-index') || c.url.startsWith('api/box-code'));
    expect(code.map((c) => [c.url, c.headers['x-rehearse-token']])).toEqual([
      ['api/code-index', 'tok-123'],
      ['api/box-code?box=cart&before=abc1234&after=HEAD&file=src%2Fa+b.ts', 'tok-123'],
    ]);
  });

  it('the stories view in the app shows the chip and the tabs', async () => {
    mockServer({ epic: () => reviewEpic() });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('big-picture');
    await user.click(screen.getByTestId('nav-stories'));
    expect(await screen.findByTestId('story-code-chip')).toBeInTheDocument();
    expect(screen.getByTestId('story-scenarios')).toBeInTheDocument();
    await user.click(screen.getByTestId('story-tab-code'));
    expect(screen.queryByTestId('story-scenarios')).toBeNull();
    expect(screen.getByTestId('story-code')).toBeInTheDocument();
  });
});
