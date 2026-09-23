/**
 * Undo/redo audit, cross-browser layer (XBR): undo defects that show in one
 * engine only. Run with every browser project so Chromium is the control.
 */
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
// Yjs captureTimeout (500ms) plus a buffer: waiting this long closes the current undo entry.
const CAPTURE = 700;

type Blocks = OutputData['blocks'];

declare global {
  interface Window {
    b1?: Blok;
    b2?: Blok;
  }
}

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

const mountTwo = async (page: Page, first: Blocks, second: Blocks): Promise<void> => {
  await page.evaluate(async ({ a, b }) => {
    for (const [key, holder, blocks] of [['b1', 'ed1', a], ['b2', 'ed2', b]] as const) {
      document.getElementById(holder)?.remove();
      const d = document.createElement('div');

      d.id = holder;
      document.body.appendChild(d);
      const blok = new window.Blok({ holder, data: { blocks } });

      window[key] = blok;
      await blok.isReady;
    }
  }, { a: first, b: second });
};

const texts = async (page: Page, key: 'b1' | 'b2'): Promise<string[]> => page.evaluate(async (k) =>
  ((await window[k]?.save())?.blocks ?? []).map((b) => `${b.type}:${(b.data as { text?: string }).text ?? ''}`), key);

const typeAtEnd = async (page: Page, text: string, value: string): Promise<void> => {
  await page.getByText(text, { exact: true }).click();
  // Home/End do not move the caret on macOS Firefox/WebKit.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await page.keyboard.type(value);
};

const create = async (page: Page, blocks: Blocks): Promise<void> => {
  await page.evaluate(async (list) => {
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    document.body.appendChild(d);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.b1 = blok;
    await blok.isReady;
  }, blocks);
};

/** Put the caret at a UTF-16 offset in a block's editable, the way a click would. */
const placeCaret = async (page: Page, id: string, offset: number): Promise<void> => {
  await page.evaluate(({ blockId, off }) => {
    const editable = document.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [contenteditable="true"]`);

    if (editable === null) {
      throw new Error(`no editable in ${blockId}`);
    }
    editable.focus();
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let remaining = off;
    let node = walker.nextNode();

    while (node !== null && remaining > (node.textContent?.length ?? 0)) {
      remaining -= node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    if (node === null) {
      throw new Error(`offset ${off} out of range in ${blockId}`);
    }
    const range = document.createRange();

    range.setStart(node, remaining);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, { blockId: id, off: offset });
  // Let the debounced selectionchange settle currentBlock.
  await wait(page, 250);
};

/** Saved text of editor b1 per block, tags stripped. */
const plain = async (page: Page): Promise<string[]> =>
  (await texts(page, 'b1')).map((t) => t.replace(/^paragraph:/, '').replace(/<[^>]+>/g, ''));

const P = (id: string, text: string): Blocks[number] => ({ id, type: 'paragraph', data: { text } });

const BOARD: Blocks = [
  P('c', 'two'),
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' }] },
        },
      ],
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] }],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'prop-title': 'Card one', 'prop-status': 'opt-todo' } } },
];

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('undo audit: cross-browser', () => {
  // XBR-1. Source: multi-editor document-listener law, one press acts in one editor (ENT-1).
  // Only editor 2 has a board, so the add-card locator is unique.
  // WebKit does not focus a <button> on click, so focus falls to <body>. Only the editor used last acts.
  test('XBR-1: Cmd+Z after clicking a button in one editor leaves the other editor alone', async ({ page }) => {
    await mountTwo(page, [P('a', 'one')], BOARD);
    await typeAtEnd(page, 'one', 'X');
    await wait(page, CAPTURE);
    await page.locator('[data-blok-database-add-card][data-option-id="opt-todo"]').click();
    await wait(page, CAPTURE);
    expect((await texts(page, 'b2')).length).toBe(4);

    await page.keyboard.press(UNDO);
    await wait(page, CAPTURE);

    expect(await texts(page, 'b1')).toEqual(['paragraph:oneX']);
    expect((await texts(page, 'b2')).length).toBe(3);
  });

  // XBR-2. Source: undo-redo.spec.ts "undo after block split rejoins blocks (single undo)".
  // Found while probing, happens in every browser. Enter right after bold text needs two undos:
  // the first changes nothing and only enables redo. <i>, <em> and <u> at the same offset take one undo,
  // and so does Enter inside the bold text (offset 1).
  // Observed: Expected ["abcd", "end"], Received ["ab", "cd", "end"].
  for (const html of ['<strong>ab</strong>cd', '<b>ab</b>cd']) {
    test(`XBR-2: one undo rejoins a paragraph split right after bold text (${html})`, async ({ page }) => {
      test.fail();
      await create(page, [P('a', html), P('z', 'end')]);
      await wait(page, CAPTURE);
      await placeCaret(page, 'a', 2);
      await page.keyboard.press('Enter');
      await wait(page, CAPTURE);
      expect(await plain(page)).toEqual(['ab', 'cd', 'end']);

      await page.keyboard.press(UNDO);
      await wait(page, CAPTURE);

      expect(await plain(page)).toEqual(['abcd', 'end']);
      await expect(page.getByTestId('block-wrapper')).toHaveCount(2);
    });
  }
});
