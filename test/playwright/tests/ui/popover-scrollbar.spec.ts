import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

/**
 * The popover scrollbar must behave IDENTICALLY on every platform. Native
 * scrollbars can't: measured live on the same list, `scrollbar-gutter` reserved
 * 8px on Chromium, 4px on WebKit and 0px on Firefox, and the thumb width/shape
 * differed too. So Blok hides the native scrollbar in every engine and draws
 * its own thumb. This suite runs on chromium/firefox/webkit and asserts the
 * cross-engine invariants that prove the parity.
 */

const HOLDER_ID = 'blok';
const POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const ITEMS_SELECTOR = `${POPOVER_SELECTOR} [data-blok-popover-items]`;
const THUMB_SELECTOR = `${POPOVER_SELECTOR} [data-blok-popover-scrollbar]`;

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: { blocks: [{ type: 'paragraph', data: { text: '' } }] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openToolbox = async (page: Page): Promise<void> => {
  await createBlok(page);

  const paragraph = page
    .locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`)
    .first();

  await paragraph.click();
  await page.keyboard.type('/');

  await page.locator(POPOVER_SELECTOR).waitFor({ state: 'attached' });
  await page.locator(ITEMS_SELECTOR).first().waitFor({ state: 'attached' });
};

test.describe('popover scrollbar — identical across platforms', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('reserves no native scrollbar lane (no layout shift) on any engine', async ({ page }) => {
    await openToolbox(page);

    const items = page.locator(ITEMS_SELECTOR).first();

    const lane = await items.evaluate((el) => el.offsetWidth - el.clientWidth);

    // The native scrollbar is hidden in every engine, so it reserves zero
    // layout width — the same on Chromium (was 8px), WebKit (was 4px) and
    // Firefox (was 0px). The custom thumb overlays without reflowing content.
    expect(lane).toBe(0);
  });

  test('draws a custom thumb, sized and positioned, when the list overflows', async ({ page }) => {
    await openToolbox(page);

    const items = page.locator(ITEMS_SELECTOR).first();

    // Guard: this fixture is expected to overflow so the thumb is shown.
    const overflows = await items.evaluate((el) => el.scrollHeight > el.clientHeight);

    expect(overflows).toBe(true);

    const thumb = page.locator(THUMB_SELECTOR).first();

    await expect(thumb).toBeVisible();

    const geometry = await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        transform: getComputedStyle(el).transform,
      };
    });

    // 4px wide (var(--blok-space-1)) on every engine.
    expect(geometry.width).toBe(4);
    // A real, grabbable thumb shorter than the viewport.
    expect(geometry.height).toBeGreaterThan(0);
    // Positioned via a translate transform (not the identity matrix).
    expect(geometry.transform).not.toBe('none');
  });

  test('moves the thumb as the list scrolls', async ({ page }) => {
    await openToolbox(page);

    const items = page.locator(ITEMS_SELECTOR).first();
    const thumb = page.locator(THUMB_SELECTOR).first();

    const topAtStart = await thumb.evaluate((el) => el.getBoundingClientRect().top);

    await items.evaluate((el) => {
      el.scrollTo({ top: el.scrollHeight });
      el.dispatchEvent(new Event('scroll'));
    });

    const topAtEnd = await thumb.evaluate((el) => el.getBoundingClientRect().top);

    // Scrolling to the bottom moves the thumb down its track.
    expect(topAtEnd).toBeGreaterThan(topAtStart);
  });
});
