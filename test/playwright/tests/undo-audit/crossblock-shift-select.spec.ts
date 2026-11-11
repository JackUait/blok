import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

declare global {
  interface Window {
    blokInstance?: Blok;
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list }) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', tools: window.defaultBlockTools, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks });
};

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Selection as `anchorId@offset -> focusId@offset`. */
const selection = (page: Page): Promise<string> => page.evaluate(() => {
  const sel = document.getSelection();

  if (sel === null || sel.anchorNode === null || sel.focusNode === null) {
    return 'none';
  }
  const point = (node: Node, offset: number): string => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const host = element?.closest('[contenteditable="true"]');
    const holder = element?.closest('[data-blok-id]');

    if (!host || !holder) {
      return 'off';
    }
    const before = document.createRange();

    before.selectNodeContents(host);
    before.setEnd(node, offset);

    return `${holder.getAttribute('data-blok-id') ?? '?'}@${before.toString().length}`;
  };

  return `${point(sel.anchorNode, sel.anchorOffset)} -> ${point(sel.focusNode, sel.focusOffset)}`;
});

/**
 * The offset in `targetId` whose caret sits closest to the caret at
 * `sourceId@sourceOffset`. Glyph widths differ per OS font, so the column
 * cannot be a fixed number.
 */
const nearestColumn = (page: Page, sourceId: string, sourceOffset: number, targetId: string): Promise<number> => page.evaluate(({ from, at, to }) => {
  const textOf = (id: string): Text => {
    const node = document.querySelector(`[data-blok-id="${id}"] [contenteditable="true"]`)?.firstChild;

    if (!(node instanceof Text)) {
      throw new Error(`block ${id} is not plain text`);
    }

    return node;
  };
  const caretX = (text: Text, offset: number): number => {
    const range = document.createRange();

    range.setStart(text, offset);
    range.collapse(true);

    return range.getBoundingClientRect().left;
  };
  const goal = caretX(textOf(from), at);
  const target = textOf(to);
  const distances = Array.from({ length: target.length + 1 }, (_, offset) => Math.abs(caretX(target, offset) - goal));

  return distances.indexOf(Math.min(...distances));
}, { from: sourceId, at: sourceOffset, to: targetId });

const savedText = async (page: Page): Promise<string[]> => blocksAsHtml(await page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no editor');
  }

  return (await window.blokInstance.save()).blocks;
})).map((b) => `${b.id ?? '?'}:${(b.data as { text?: string }).text ?? ''}`);

const canUndo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canUndo() ?? false);

const pause = (page: Page, ms: number): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const SETUP: OutputData['blocks'] = [
  { id: 'b1', type: 'paragraph', data: { text: 'Alpha one' } },
  { id: 'b2', type: 'header', data: { text: 'Beta two', level: 2 } },
];

const SETUP_UP: OutputData['blocks'] = [
  ...SETUP,
  { id: 'b3', type: 'paragraph', data: { text: 'Gamma three' } },
];

const LONG = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';

/** b2 and b3 wrap onto several lines. */
const SETUP_WRAPPED: OutputData['blocks'] = [
  { id: 'b1', type: 'paragraph', data: { text: 'Alpha one' } },
  { id: 'b2', type: 'paragraph', data: { text: LONG } },
  { id: 'b3', type: 'paragraph', data: { text: LONG } },
];

const offsetOf = (point: string): number => Number(point.split('@')[1]);

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('undo audit: keyboard cross-block text selection (U072)', () => {
  test('Shift+ArrowDown then Shift+End from mid-text selects to the end of the next block, and one undo removes the bold from both', async ({ page }) => {
    await mount(page, SETUP);
    await editable(page, 'b1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await selection(page)).toBe('b1@6 -> b1@6');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');

    expect(await selection(page)).toBe('b1@6 -> b2@8');
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);

    await page.keyboard.press(`${MOD}+b`);
    await pause(page, 1000);

    expect(await savedText(page)).toEqual(['b1:Alpha <strong>one</strong>', 'b2:<strong>Beta two</strong>']);
    expect(await selection(page)).toBe('b1@6 -> b2@8');

    await page.keyboard.press(`${MOD}+z`);
    await pause(page, 300);

    expect(await savedText(page)).toEqual(['b1:Alpha one', 'b2:Beta two']);
    expect(await canUndo(page)).toBe(false);
    expect(await selection(page)).toBe('b1@6 -> b2@8');

    await page.keyboard.press(`${MOD}+Shift+z`);
    await pause(page, 300);

    expect(await savedText(page)).toEqual(['b1:Alpha <strong>one</strong>', 'b2:<strong>Beta two</strong>']);
    expect(await selection(page)).toBe('b1@6 -> b2@8');
  });

  test('Shift+ArrowDown from a text selection keeps the focus column in the next block', async ({ page }) => {
    await mount(page, SETUP);
    await editable(page, 'b1').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await selection(page)).toBe('b1@3 -> b1@6');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');

    const column = await nearestColumn(page, 'b1', 6, 'b2');

    expect(column).toBeGreaterThan(0);
    expect(await selection(page)).toBe(`b1@3 -> b2@${column}`);
  });

  test('Shift+ArrowUp then Shift+Home from mid-text selects to the start of the previous block, and undo and redo keep it backward', async ({ page }) => {
    await mount(page, SETUP_UP);
    await editable(page, 'b3').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await selection(page)).toBe('b3@3 -> b3@3');

    const column = await nearestColumn(page, 'b3', 3, 'b2');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    expect(await selection(page)).toBe(`b3@3 -> b2@${column}`);
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');

    expect(await selection(page)).toBe('b3@3 -> b2@0');
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);

    await page.keyboard.press(`${MOD}+b`);
    await pause(page, 1000);

    const bold = ['b1:Alpha one', 'b2:<strong>Beta two</strong>', 'b3:<strong>Gam</strong>ma three'];

    expect(await savedText(page)).toEqual(bold);
    expect(await selection(page)).toBe('b3@3 -> b2@0');

    await page.keyboard.press(`${MOD}+z`);
    await pause(page, 300);

    expect(await savedText(page)).toEqual(['b1:Alpha one', 'b2:Beta two', 'b3:Gamma three']);
    expect(await canUndo(page)).toBe(false);
    expect(await selection(page)).toBe('b3@3 -> b2@0');

    await page.keyboard.press(`${MOD}+Shift+z`);
    await pause(page, 300);

    expect(await savedText(page)).toEqual(bold);
    expect(await selection(page)).toBe('b3@3 -> b2@0');
  });

  test('Shift+ArrowUp from a backward text selection keeps the focus column in the previous block', async ({ page }) => {
    await mount(page, SETUP_UP);
    await editable(page, 'b3').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await selection(page)).toBe('b3@6 -> b3@3');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');

    const column = await nearestColumn(page, 'b3', 3, 'b2');

    expect(column).toBeGreaterThan(0);
    expect(await selection(page)).toBe(`b3@6 -> b2@${column}`);
  });
  test('Shift+ArrowUp inside a wrapped previous block keeps the range and moves the focus up one line', async ({ page }) => {
    await mount(page, SETUP_WRAPPED);
    await page.evaluate(() => {
      const holder = document.getElementById('blok');

      if (holder !== null) {
        holder.style.width = '420px';
      }
    });
    const lines = await page.evaluate(() => {
      const host = document.querySelector('[data-blok-id="b2"] [contenteditable="true"]');
      const lineHeight = host === null ? 0 : parseFloat(getComputedStyle(host).lineHeight);

      return host === null ? 0 : Math.round(host.getBoundingClientRect().height / lineHeight);
    });

    expect(lines).toBeGreaterThan(1);
    await editable(page, 'b3').click();
    /** Home goes to the start of the clicked line, which may not be the first. */
    await editable(page, 'b3').evaluate((host) => {
      const text = host.firstChild;

      if (text !== null) {
        document.getSelection()?.collapse(text, 3);
      }
    });
    expect(await selection(page)).toBe('b3@3 -> b3@3');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');

    const [anchor, intoB2] = (await selection(page)).split(' -> ');

    expect(anchor).toBe('b3@3');
    expect(intoB2).toMatch(/^b2@/);
    expect(offsetOf(intoB2)).toBeGreaterThan(LONG.length / 2);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');

    const [kept, upOneLine] = (await selection(page)).split(' -> ');

    expect(kept).toBe('b3@3');
    expect(upOneLine).toMatch(/^b2@/);
    expect(offsetOf(upOneLine)).toBeLessThan(offsetOf(intoB2));
  });

  test('Shift+ArrowUp in the first block keeps the range and moves the focus to the block start', async ({ page }) => {
    await mount(page, SETUP_UP);
    await editable(page, 'b2').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    expect(await selection(page)).toMatch(/^b2@3 -> b1@/);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');

    expect(await selection(page)).toBe('b2@3 -> b1@0');
  });
});
