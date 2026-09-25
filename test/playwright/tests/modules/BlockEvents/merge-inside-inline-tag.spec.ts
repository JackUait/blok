import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Firefox and WebKit on macOS do not move the caret on Home.
const LINE_START = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Blocks = OutputData['blocks'];

const create = async (page: Page, blocks: Blocks): Promise<void> => {
  await page.evaluate(async ({ holder, list }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, list: blocks });
};

/** Saved `id:text` of every block, in order. */
const saved = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const out = await window.blokInstance?.save();

  return (out?.blocks ?? []).map((b) => `${String(b.id)}:${String((b.data as { text?: unknown }).text)}`);
});

const editable = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Collapses the caret at `offset` of the first (or last) text node of the block's editable. */
const caretAtText = (page: Page, id: string, edge: 'first' | 'last'): Promise<void> =>
  editable(page, id).evaluate((el, which) => {
    (el as HTMLElement).focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];

    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      texts.push(n as Text);
    }
    const node = which === 'first' ? texts[0] : texts[texts.length - 1];
    const range = document.createRange();

    range.setStart(node, which === 'first' ? 0 : node.length);
    range.collapse(true);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, edge);

const LEADING_TAGS = [
  '<b>ld</b> tail',
  '<i>x</i> tail',
  '<a href="https://example.com">x</a> tail',
  '<mark style="background-color: rgb(251, 243, 219);">x</mark> tail',
  '<b><i>x</i></b> tail',
] as const;

/**
 * `presses`: Backspaces needed to merge. Header, list and quote first turn
 * into a paragraph, then merge — the same as with plain text.
 */
const CONTAINERS: Array<{ name: string; blocks: (a: string, b: string) => Blocks; a: string; b: string; presses: number }> = [
  {
    name: 'paragraph',
    presses: 1,
    a: 'a',
    b: 'b',
    blocks: (a, b) => [
      { id: 'a', type: 'paragraph', data: { text: a } },
      { id: 'b', type: 'paragraph', data: { text: b } },
    ],
  },
  {
    name: 'header',
    presses: 2,
    a: 'a',
    b: 'b',
    blocks: (a, b) => [
      { id: 'a', type: 'header', data: { text: a, level: 2 } },
      { id: 'b', type: 'header', data: { text: b, level: 2 } },
    ],
  },
  {
    name: 'list',
    presses: 2,
    a: 'a',
    b: 'b',
    blocks: (a, b) => [
      { id: 'a', type: 'list', data: { text: a, style: 'unordered' } },
      { id: 'b', type: 'list', data: { text: b, style: 'unordered' } },
    ],
  },
  {
    name: 'quote',
    presses: 2,
    a: 'a',
    b: 'b',
    blocks: (a, b) => [
      { id: 'a', type: 'quote', data: { text: a } },
      { id: 'b', type: 'quote', data: { text: b } },
    ],
  },
  {
    name: 'toggle child',
    presses: 1,
    a: 'a',
    b: 'b',
    blocks: (a, b) => [
      { id: 't', type: 'toggle', data: { text: 'T' }, content: ['a', 'b'] },
      { id: 'a', type: 'paragraph', data: { text: a }, parent: 't' },
      { id: 'b', type: 'paragraph', data: { text: b }, parent: 't' },
    ],
  },
  {
    name: 'callout child',
    presses: 1,
    a: 'a',
    b: 'b',
    blocks: (a, b) => [
      { id: 'c', type: 'callout', data: { emoji: '💡' }, content: ['a', 'b'] },
      { id: 'a', type: 'paragraph', data: { text: a }, parent: 'c' },
      { id: 'b', type: 'paragraph', data: { text: b }, parent: 'c' },
    ],
  },
];

test.describe('merging with the caret inside a leading or trailing inline tag', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  for (const second of LEADING_TAGS) {
    test(`Backspace after Home merges "first" + "${second}" and keeps the marks`, async ({ page }) => {
      await create(page, CONTAINERS[0].blocks('first', second));
      const before = await saved(page);

      await editable(page, 'b').click();
      await page.keyboard.press(LINE_START);
      await page.keyboard.press('Backspace');

      const after = await saved(page);

      expect(after).toEqual([`a:first${before[1].slice(2)}`]);
    });
  }

  for (const c of CONTAINERS) {
    test(`${c.name}: Backspace at offset 0 inside <strong> merges, undo restores both, redo merges again`, async ({ page }) => {
      // Saved form; a raw <b> comes back as <b> on undo while save gives <strong>.
      await create(page, c.blocks('first', '<strong>ld</strong> tail'));

      await editable(page, c.b).click();
      await caretAtText(page, c.b, 'first');
      for (let i = 1; i < c.presses; i++) {
        await page.keyboard.press('Backspace');
      }
      const before = await saved(page);

      await page.keyboard.press('Backspace');

      const merged = await saved(page);
      const texts = merged.filter((s) => s.startsWith(`${c.a}:`) || s.startsWith(`${c.b}:`));

      expect(texts).toEqual([`${c.a}:first<strong>ld</strong> tail`]);

      await page.keyboard.press(UNDO);
      await expect.poll(() => saved(page)).toEqual(before);

      await page.keyboard.press(REDO);
      await expect.poll(() => saved(page)).toEqual(merged);
    });

    test(`${c.name}: Delete at the end inside a trailing <b> merges the next block`, async ({ page }) => {
      await create(page, c.blocks('first <b>bo</b>', 'second'));

      await editable(page, c.a).click();
      await caretAtText(page, c.a, 'last');
      await page.keyboard.press('Delete');

      const merged = await saved(page);
      const texts = merged.filter((s) => s.startsWith(`${c.a}:`) || s.startsWith(`${c.b}:`));

      expect(texts).toEqual([`${c.a}:first <strong>bo</strong>second`]);
    });
  }

  test('Enter inside bold then Backspace rejoins the halves', async ({ page }) => {
    await create(page, [{ id: 'a', type: 'paragraph', data: { text: 'x <b>bold</b> y' } }]);
    const before = await saved(page);

    await editable(page, 'a').evaluate((el) => {
      (el as HTMLElement).focus();
      const text = el.querySelector('strong, b')?.firstChild;

      if (text === null || text === undefined) {
        throw new Error('no bold text');
      }
      const range = document.createRange();

      range.setStart(text, 2);
      range.collapse(true);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await saved(page)).length).toBe(2);

    await page.keyboard.press('Backspace');

    await expect.poll(() => saved(page)).toEqual(before);
  });
});
