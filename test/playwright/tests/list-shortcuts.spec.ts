import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';

/**
 * End-to-end coverage for list keyboard shortcuts (Tab/Shift+Tab nesting, block
 * move, Enter), exercised through the real DOM keyboard pipeline and verified via
 * save(). The unit suite mocks the keyboard/DOM layer, so these flows had NO
 * automated guard — a regression in list nesting or movement could ship green.
 * This spec is that guard.
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

      const blok = new window.Blok({ holder, data: { blocks: seed } });

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

test.describe('list keyboard shortcuts', () => {
  test('Tab nests a list item under its preceding sibling; Shift+Tab outdents it', async ({ page }) => {
    await boot(page, [li('a'), li('b')]);

    await page.getByText('b', { exact: true }).click();
    await page.keyboard.press('Tab');
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b@1/nested']);

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b/root']);
  });

  test('Tab visually indents the nested list item (its list row gains left margin)', async ({ page }) => {
    await boot(page, [li('a'), li('b')]);

    const marginOf = (text: string): Promise<number> =>
      page.getByText(text, { exact: true }).evaluate((el) => {
        const wrapper = el.closest('[data-blok-testid="block-wrapper"]');
        const row = wrapper?.querySelector('[role="listitem"]');

        return row ? parseFloat(getComputedStyle(row).marginLeft) || 0 : -1;
      });

    expect(await marginOf('b')).toBe(0);

    await page.getByText('b', { exact: true }).click();
    await page.keyboard.press('Tab');

    // Nesting must produce a real visual indent, not just a model change.
    await expect.poll(() => marginOf('b')).toBeGreaterThan(0);
  });

  test('Tab is a no-op on the first list item (no preceding sibling)', async ({ page }) => {
    await boot(page, [li('a'), li('b')]);

    await page.getByText('a', { exact: true }).click();
    await page.keyboard.press('Tab');

    // The keydown handler is synchronous, so a poll right after the press reflects
    // the final state: it must stay flat (Tab cannot indent the first item).
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b/root']);
  });

  test('Cmd+Shift+Down / Up move a focused list item', async ({ page }) => {
    await boot(page, [li('a'), li('b'), li('c')]);

    await page.getByText('a', { exact: true }).click();
    await page.keyboard.press('Meta+Shift+ArrowDown');
    await expect.poll(() => layout(page)).toEqual(['b/root', 'a/root', 'c/root']);

    await page.getByText('c', { exact: true }).click();
    await page.keyboard.press('Meta+Shift+ArrowUp');
    await expect.poll(() => layout(page)).toEqual(['b/root', 'c/root', 'a/root']);
  });

  test('moving a list item carries its nested subtree and preserves the nesting', async ({ page }) => {
    await boot(page, [
      { id: 'pa', type: 'list', data: { style: 'unordered', text: 'a' }, content: ['ch'] },
      { id: 'ch', type: 'list', data: { style: 'unordered', text: 'b', depth: 1 }, parent: 'pa' },
      li('c'),
    ]);

    // Move the root item 'c' up past the a→b subtree; b must stay nested under a.
    await page.getByText('c', { exact: true }).click();
    await page.keyboard.press('Meta+Shift+ArrowUp');
    await expect.poll(() => layout(page)).toEqual(['c/root', 'a/root', 'b@1/nested']);
  });

  test('a nested list survives a save/reload round-trip and stays editable', async ({ page }) => {
    await boot(page, [li('a'), li('b')]);
    await page.getByText('b', { exact: true }).click();
    await page.keyboard.press('Tab');
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b@1/nested']);

    const saved = await page.evaluate(async () => {
      if (!window.d) {
        throw new Error('Editor not found');
      }

      return (await window.d.save()).blocks;
    });

    await boot(page, saved);
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b@1/nested']);
  });

  test('Tab on a MIXED list + non-list selection indents each kind (Notion parity, no longer a no-op)', async ({ page }) => {
    // Anchor paragraph 'a', then a paragraph 'b' and a list item 'c' that are
    // selected together. Tab must indent BOTH: 'b' nests structurally under 'a',
    // and 'c' gains one list depth level — instead of doing nothing.
    await boot(page, [
      { type: 'paragraph', data: { text: 'a' } },
      { type: 'paragraph', data: { text: 'b' } },
      li('c'),
    ]);

    // Select 'b' + 'c' via a cross-block selection.
    await page.getByText('b', { exact: true }).click();
    await page.keyboard.press('Shift+ArrowDown');

    await page.keyboard.press('Tab');

    // 'b' nested under 'a' (structural); 'c' indented one list depth level.
    await expect.poll(() => layout(page)).toEqual(['a/root', 'b/nested', 'c@1/root']);
  });
});
