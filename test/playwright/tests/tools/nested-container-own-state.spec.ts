import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * A container's holder holds its children's holders, so a holder-wide DOM read
 * can see a CHILD's markup. These specs pin the user-visible cases where Blok
 * read a nested child's state as the container's own.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    capturedClipboard?: Record<string, string>;
  }
}

const HOLDER_ID = 'blok';

const createBlok = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initialBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks });
};

/** `id:type:parent` for every saved block, in saved order. */
const savedTree = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) => `${block.id}:${block.type}:${block.parent ?? 'root'}`);
  });

const editableOf = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

test.describe('nested containers — a container reads its own state, not a child\'s', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Backspace at the start of a callout\'s first line keeps it in the callout when a toggle follows', async ({ page }) => {
    await createBlok(page, [
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['P', 'S'] },
      { id: 'P', type: 'paragraph', data: { text: 'first' }, parent: 'C' },
      { id: 'S', type: 'toggle', data: { text: 'tog', isOpen: true }, parent: 'C' },
    ]);

    await editableOf(page, 'P').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');

    await expect.poll(() => savedTree(page)).toEqual([
      'C:callout:root',
      'P:paragraph:C',
      'S:toggle:C',
    ]);
  });

  test('Enter on the empty last line of a callout holding a toggle leaves the callout', async ({ page }) => {
    await createBlok(page, [
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'E'] },
      { id: 'S', type: 'toggle', data: { text: 'tog', isOpen: true }, parent: 'C' },
      { id: 'E', type: 'paragraph', data: { text: '' }, parent: 'C' },
    ]);

    await editableOf(page, 'E').click();
    await page.keyboard.press('Enter');

    await expect.poll(() => savedTree(page)).toEqual([
      'C:callout:root',
      'S:toggle:C',
      'E:paragraph:root',
    ]);
  });

  test('copying a selected toggle writes its child once and no placeholder text to text/html', async ({ page }) => {
    await createBlok(page, [
      { id: 'T', type: 'toggle', data: { text: 'TOGTITLE', isOpen: true }, content: ['K'] },
      { id: 'K', type: 'paragraph', data: { text: 'KIDTEXT' }, parent: 'T' },
      { id: 'Z', type: 'paragraph', data: { text: 'after' } },
    ]);

    await page.evaluate(() => {
      window.capturedClipboard = {};
      document.addEventListener('copy', (event) => {
        const data = event.clipboardData;

        if (data === null) {
          return;
        }
        const setData = data.setData.bind(data);

        data.setData = (format: string, value: string): void => {
          if (window.capturedClipboard !== undefined) {
            window.capturedClipboard[format] = value;
          }
          setData(format, value);
        };
      }, true);
    });

    await editableOf(page, 'Z').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);

    await page.keyboard.press('ControlOrMeta+c');

    await expect.poll(async () => await page.evaluate(() => window.capturedClipboard?.['text/html'] ?? '')).not.toBe('');

    const html = await page.evaluate(() => window.capturedClipboard?.['text/html'] ?? '');

    expect(html.split('KIDTEXT').length - 1).toBe(1);
    expect(html).not.toContain('Empty toggle');
    expect(html).toContain('TOGTITLE');
    expect(html).not.toContain('TOGTITLEKIDTEXT');
  });
});
