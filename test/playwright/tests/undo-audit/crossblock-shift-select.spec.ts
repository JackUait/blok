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
});
