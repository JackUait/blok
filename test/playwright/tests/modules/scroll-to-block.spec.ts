import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const makeParagraphBlocks = (count: number): OutputData['blocks'] =>
  Array.from({ length: count }, (_, i) => ({
    id: `scrolltest${String(i).padStart(2, '0')}00`,
    type: 'paragraph',
    data: { text: `Block ${i}` },
  }));

// Block at index 25 out of 30 — target for scroll tests
const SCROLL_TEST_BLOCKS = makeParagraphBlocks(30);
const TARGET_BLOCK_ID = `scrolltest2500`;

const createEditorWithData = async (
  page: Page,
  data: OutputData,
  options: { scrollToBlock?: { topOffset?: number } } = {}
): Promise<void> => {
  await page.evaluate(({ holder }) => {
    if (window.blokInstance) {
      window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const div = document.createElement('div');
    div.id = holder;
    document.body.appendChild(div);
  }, { holder: 'blok' });

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ data: initialData, opts }) => {
      const config: Record<string, unknown> = {
        holder: 'blok',
        data: initialData,
      };
      if (opts.scrollToBlock) {
        config.scrollToBlock = opts.scrollToBlock;
      }
      const blok = new window.Blok(config);
      window.blokInstance = blok;
      await blok.isReady;
    },
    { data, opts: options }
  );
};

/**
 * Wait for smooth scroll to fully complete.
 * Step 1: Wait for scroll to start (scrollY > 0).
 * Step 2: Wait for scroll to stabilize — poll every 50ms until scrollY hasn't
 *         changed for two consecutive polls (~100ms of no movement).
 */
const waitForScrollToComplete = async (page: Page): Promise<void> => {
  // Wait for scroll animation to begin
  await page.waitForFunction(() => window.scrollY > 0, { timeout: 5000 });

  // Wait for scroll animation to finish: scrollY must be stable for 2 consecutive 100ms polls
  await page.waitForFunction(
    () => {
      const key = '__scrollStableCheck';
      const win = window as unknown as { [key: string]: number | undefined };
      const prev = win[key];
      win[key] = window.scrollY;
      return prev !== undefined && prev === window.scrollY;
    },
    { timeout: 5000, polling: 100 }
  );
};

test.describe('scroll to block on hash', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('scrolls to the target block when URL contains a hash matching a block ID', async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.addStyleTag({ content: 'body { min-height: 3000px; }' });

    // Set the hash before creating the editor so it reads it during isReady
    await page.evaluate((hash) => {
      window.history.replaceState(null, '', '#' + hash);
    }, TARGET_BLOCK_ID);

    await createEditorWithData(page, { blocks: SCROLL_TEST_BLOCKS });

    // Wait for smooth scroll to fully complete
    await waitForScrollToComplete(page);

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    const isInViewport = await page.evaluate((blockId) => {
      const el = document.querySelector(`[data-blok-id="${blockId}"]`);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    }, TARGET_BLOCK_ID);

    expect(isInViewport).toBe(true);
  });

  test('does not scroll when hash is absent', async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    // No hash set, no min-height needed
    await createEditorWithData(page, { blocks: SCROLL_TEST_BLOCKS });

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
  });

  test('topOffset is respected: scroll position is offset by the configured amount', async ({ page }) => {
    // --- Run 1: topOffset = 0 ---
    await page.goto(TEST_PAGE_URL);
    await page.addStyleTag({ content: 'body { min-height: 3000px; }' });
    await page.evaluate((hash) => {
      window.history.replaceState(null, '', '#' + hash);
    }, TARGET_BLOCK_ID);

    await createEditorWithData(page, { blocks: SCROLL_TEST_BLOCKS }, { scrollToBlock: { topOffset: 0 } });

    await waitForScrollToComplete(page);
    const scrollYWithoutOffset = await page.evaluate(() => window.scrollY);

    // --- Run 2: topOffset = 80 ---
    await page.goto(TEST_PAGE_URL);
    await page.addStyleTag({ content: 'body { min-height: 3000px; }' });
    await page.evaluate((hash) => {
      window.history.replaceState(null, '', '#' + hash);
    }, TARGET_BLOCK_ID);

    await createEditorWithData(page, { blocks: SCROLL_TEST_BLOCKS }, { scrollToBlock: { topOffset: 80 } });

    await waitForScrollToComplete(page);
    const scrollYWithOffset = await page.evaluate(() => window.scrollY);

    // With topOffset=80, we scroll 80px less (block appears 80px lower in viewport)
    // So: scrollY_with_offset ≈ scrollY_without_offset - 80
    const diff = Math.abs((scrollYWithoutOffset - 80) - scrollYWithOffset);
    expect(diff).toBeLessThanOrEqual(10);
  });

  test('scrolls to the hash block when content is rendered via api.blocks.render() after isReady', async ({ page }) => {
    // Regression: reproduces the case where the editor is initialized with no
    // `data` (e.g. SPA that fetches article content), and the caller invokes
    // `api.blocks.render()` after isReady. The target block is not in the DOM
    // when the hash is read, so the scroll must be deferred and retried once
    // blocks.render() finishes.
    await page.goto(TEST_PAGE_URL);
    await page.addStyleTag({ content: 'body { min-height: 3000px; }' });

    await page.evaluate((hash) => {
      window.history.replaceState(null, '', '#' + hash);
    }, TARGET_BLOCK_ID);

    // Tear down any prior instance, create a new editor WITHOUT initial data
    await page.evaluate(() => {
      if (window.blokInstance) {
        window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }
      document.getElementById('blok')?.remove();
      const div = document.createElement('div');
      div.id = 'blok';
      document.body.appendChild(div);
    });

    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(async () => {
      const blok = new window.Blok({ holder: 'blok' });
      window.blokInstance = blok;
      await blok.isReady;
    });

    // At this point the target block is NOT in the DOM.
    const hasBlockBeforeRender = await page.evaluate((blockId) => {
      return !!document.querySelector(`[data-blok-id="${blockId}"]`);
    }, TARGET_BLOCK_ID);

    expect(hasBlockBeforeRender).toBe(false);

    // Now render the real content via the public API (SPA fetch-then-render path).
    await page.evaluate(async (blocks) => {
      await window.blokInstance!.blocks.render({ blocks });
    }, SCROLL_TEST_BLOCKS);

    // The deferred hash scroll must fire after render() completes.
    await waitForScrollToComplete(page);

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    const isInViewport = await page.evaluate((blockId) => {
      const el = document.querySelector(`[data-blok-id="${blockId}"]`);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    }, TARGET_BLOCK_ID);

    expect(isInViewport).toBe(true);
  });

  test('visually selects (highlights) the target block after scrolling', async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.addStyleTag({ content: 'body { min-height: 3000px; }' });

    await page.evaluate((hash) => {
      window.history.replaceState(null, '', '#' + hash);
    }, TARGET_BLOCK_ID);

    await createEditorWithData(page, { blocks: SCROLL_TEST_BLOCKS });

    await waitForScrollToComplete(page);

    // The block's holder (the element with data-blok-id) should have data-blok-selected="true"
    const isSelected = await page.evaluate((blockId) => {
      const el = document.querySelector(`[data-blok-id="${blockId}"]`);
      if (!el) return false;
      return el.getAttribute('data-blok-selected') === 'true';
    }, TARGET_BLOCK_ID);

    expect(isSelected).toBe(true);
  });
});
