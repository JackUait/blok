import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, TOOLTIP_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const HOLDER_ID = 'blok';
const SAMPLE_IMAGE_URL = 'https://placehold.co/600x400.png';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const ALIGN_TRIGGER_SELECTOR = `${IMAGE_BLOCK_SELECTOR} [data-action="align-trigger"]`;

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.describe('Tooltip stays anchored to its trigger on a scrolled page', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  /**
   * Regression: on a scrolled page, the image inline-toolbar tooltip (e.g.
   * "Alignment") rendered well above its trigger, sometimes overlapping
   * earlier icons. Root cause: the tooltip wrapper used `position: absolute`,
   * so even after being promoted to the CSS Top Layer its containing block
   * stayed the document (not the viewport). Inline `style.top` is computed
   * from `getBoundingClientRect()` (viewport-relative), which meant the
   * tooltip was offset upward by `window.scrollY` on any scrolled page.
   *
   * The fix is architectural: the wrapper is `position: fixed`, so it
   * anchors to the viewport regardless of top-layer state, scroll position,
   * or ancestor transforms. This test pins the invariant by scrolling the
   * page a meaningful amount before hovering — without the fix the tooltip
   * ends up ~scrollY pixels above the trigger; with the fix it stays below.
   */
  test('image alignment tooltip remains below its trigger after the page is scrolled', async ({ page }) => {
    /**
     * Prepend a tall spacer so the image sits far enough down the document
     * that a 300px scroll is possible. The image itself would fit in a
     * single viewport otherwise.
     */
    await page.addStyleTag({ content: 'body { margin: 0 } #blok { padding-top: 1200px; padding-bottom: 800px; }' });

    await createBlok(page, {
      blocks: [{ type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } }],
    });

    const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

    await expect(imageBlock).toBeVisible();

    // Scroll so the image toolbar lives in the middle of the viewport with a
    // non-zero scrollY. Any nonzero scroll exposes the bug in its full form.
    await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('[data-blok-tool="image"]');

      if (block === null) {
        return;
      }
      const rect = block.getBoundingClientRect();

      window.scrollTo({ top: window.scrollY + rect.top - 120, behavior: 'instant' });
    });

    const scrollY = await page.evaluate(() => window.scrollY);

    expect(scrollY).toBeGreaterThan(200);

    const trigger = page.locator(ALIGN_TRIGGER_SELECTOR);

    await expect(trigger).toBeVisible();

    const triggerBox = await trigger.boundingBox();

    if (triggerBox === null) {
      throw new Error('Alignment trigger has no bounding box');
    }

    await page.mouse.move(
      triggerBox.x + triggerBox.width / 2,
      triggerBox.y + triggerBox.height / 2
    );

    const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('Alignment');

    const tooltipBox = await tooltip.boundingBox();

    if (tooltipBox === null) {
      throw new Error('Tooltip has no bounding box');
    }

    // Tooltip should sit BELOW the trigger (placement: bottom), horizontally
    // centered on it. Before the fix, on a scrolled page the tooltip landed
    // at viewport-Y = triggerBottom + 10 - scrollY — far above the trigger.
    expect(tooltipBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    expect(tooltipBox.y).toBeLessThanOrEqual(triggerBox.y + triggerBox.height + 30);

    const tooltipCenterX = tooltipBox.x + tooltipBox.width / 2;
    const triggerCenterX = triggerBox.x + triggerBox.width / 2;

    expect(Math.abs(tooltipCenterX - triggerCenterX)).toBeLessThanOrEqual(2);
  });
});
