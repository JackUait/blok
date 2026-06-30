import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

/**
 * Notion-parity coverage for MULTI-SELECT list keyboard nesting (findings M-9 / M-8):
 *
 * - M-9: selecting several list items and pressing Tab nests them STRUCTURALLY
 *        (parentId/contentIds), the same way single-item Tab does — so the indent
 *        survives a save()/reload, not just the rendered margin.
 * - M-8: Shift+Tab on a mixed-depth selection outdents each item that has a parent
 *        individually and leaves items already at the document root in place,
 *        instead of bailing out all-or-nothing.
 *
 * Driven through the real DOM keyboard pipeline and verified via save() (the unit
 * suite mocks the keyboard/DOM layer).
 */

declare global {
  interface Window {
    d?: Blok;
  }
}

const HOLDER_ID = 'blok';

const boot = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, seed }) => {
      if (window.d) {
        await window.d.destroy?.();
        window.d = undefined;
      }
      document.getElementById(holder)?.remove();
      const container = document.createElement('div');

      container.id = holder;
      container.setAttribute('data-blok-testid', holder);
      document.body.appendChild(container);

      const blok = new window.Blok({ holder, data: { blocks: seed } } as BlokConfig);

      window.d = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, seed: blocks }
  );
};

/** Compact view of each block: text, structural depth marker, and parent presence. */
const layout = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    if (!window.d) {
      throw new Error('Editor not found');
    }
    const out = await window.d.save();

    return out.blocks.map((b) => {
      const data = b.data as { text?: string; depth?: number };
      const depth = data.depth ? `@${data.depth}` : '';
      const parent = b.parent ? '/nested' : '/root';

      return `${data.text ?? ''}${depth}${parent}`;
    });
  });

const li = (text: string): OutputData['blocks'][number] => ({
  type: 'list',
  data: { style: 'unordered', text },
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('list multi-select keyboard nesting (Notion parity)', () => {
  test('M-9: multi-select Tab nests every selected item structurally (survives reload)', async ({ page }) => {
    await boot(page, [li('a'), li('b'), li('c')]);

    // Select 'b' + 'c' as a block-level range, then indent both.
    await page.getByText('b', { exact: true }).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Tab');

    // Both nest under 'a' as true children (parent set), not a flat depth bump.
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b@1/nested', 'c@1/nested']);

    // The structural nesting must survive a save()/reload round-trip.
    const saved = await page.evaluate(async () => {
      if (!window.d) {
        throw new Error('Editor not found');
      }

      return (await window.d.save()).blocks;
    });

    await boot(page, saved);
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b@1/nested', 'c@1/nested']);
  });

  test('M-8: Shift+Tab outdents nested items and leaves root items in place', async ({ page }) => {
    // Seed 'a' at root with 'b' nested under it, and 'c' at root.
    await boot(page, [
      { id: 'a', type: 'list', data: { style: 'unordered', text: 'a' } } as OutputData['blocks'][number],
      { id: 'b', type: 'list', data: { style: 'unordered', text: 'b', depth: 1 }, parent: 'a' } as OutputData['blocks'][number],
      { id: 'c', type: 'list', data: { style: 'unordered', text: 'c' } } as OutputData['blocks'][number],
    ]);

    await expect.poll(() => layout(page)).toEqual(['a/root', 'b@1/nested', 'c/root']);

    // Select the nested 'b' and the root 'c' together, then Shift+Tab.
    await page.getByText('b', { exact: true }).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+Tab');

    // 'b' outdents to the root; 'c' (already leftmost) stays put — no all-or-nothing.
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b/root', 'c/root']);
  });
});
