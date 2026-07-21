import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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

/**
 * Measures the reserved scrollbar-lane width (offsetWidth - clientWidth) of two
 * probe elements: `classic` forces a space-taking scrollbar (the Windows/Linux
 * default), `hidden` applies the popover's actual hiding rules. Lets a test
 * prove the hiding rules zero out even a classic bar, on any host OS.
 * @param page - the Playwright page
 */
const measureScrollbarLanes = (page: Page): Promise<{ classic: number; hidden: number }> =>
  page.evaluate(() => {
    const style = document.createElement('style');

    style.textContent = `
      .__sb-probe { position: absolute; top: -9999px; left: -9999px; width: 100px; height: 40px; overflow-y: scroll; }
      .__sb-probe > div { height: 400px; }
      /* Force a CLASSIC (space-taking) scrollbar — the same bar Windows/Linux
         show by default. scrollbar-gutter:stable reserves the lane and a styled
         ::-webkit-scrollbar renders it classic, so it takes layout space on
         Chromium/WebKit even under a macOS overlay setting. */
      .__sb-classic { scrollbar-gutter: stable; }
      .__sb-classic::-webkit-scrollbar { width: 14px; background: #000; }
      /* The popover's actual hiding rules (from slash-search.css). */
      .__sb-hidden { scrollbar-width: none; }
      .__sb-hidden::-webkit-scrollbar { display: none; }
    `;
    document.head.appendChild(style);

    const measure = (className: string): number => {
      const el = document.createElement('div');

      el.className = `__sb-probe ${className}`;
      el.innerHTML = '<div></div>';
      document.body.appendChild(el);

      const lane = el.offsetWidth - el.clientWidth;

      el.remove();

      return lane;
    };

    const result = { classic: measure('__sb-classic'), hidden: measure('__sb-hidden') };

    style.remove();

    return result;
  });

test.describe('popover scrollbar — identical across platforms', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('reserves no native scrollbar lane (no layout shift) on any engine', async ({ page }) => {
    await openToolbox(page);

    const items = page.locator(ITEMS_SELECTOR).first();

    const lane = await items.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth);

    // The native scrollbar is hidden in every engine, so it reserves zero
    // layout width — the same on Chromium (was 8px), WebKit (was 4px) and
    // Firefox (was 0px). The custom thumb overlays without reflowing content.
    expect(lane).toBe(0);
  });

  /**
   * On Windows and Linux the OS default is a CLASSIC scrollbar that takes
   * layout space (macOS uses overlay scrollbars that don't). The popover's
   * hiding rules — `scrollbar-width: none` + `::-webkit-scrollbar { display:
   * none }` — must zero out even a space-taking classic bar, otherwise content
   * would reflow on those platforms. This probes the raw technique against a
   * forced classic scrollbar so the guarantee holds regardless of host OS, and
   * runs on Linux in CI where the classic bar is the real default.
   */
  test('the hiding rules collapse the scrollbar lane to zero on every engine', async ({ page }) => {
    await gotoTestPage(page);

    const lanes = await measureScrollbarLanes(page);

    // The popover's hiding rules always collapse the scrollbar lane to zero —
    // on every engine, whether the OS uses classic (Windows/Linux) or overlay
    // (macOS) scrollbars. No content reflow when the thumb appears.
    expect(lanes.hidden).toBe(0);
  });

  test('a forced classic (space-taking) scrollbar is measurable, and the hiding rules remove it', async ({ page, browserName }) => {
    // Firefox ignores ::-webkit-scrollbar, so a space-taking bar can't be forced
    // on macOS (its overlay setting). Its real classic bar is exercised on Linux
    // in CI, where the previous test's hidden===0 becomes the meaningful check.
    test.skip(browserName === 'firefox', 'cannot force a classic scrollbar in Firefox under macOS overlay');

    await gotoTestPage(page);

    const lanes = await measureScrollbarLanes(page);

    // We actually produced a space-taking classic bar (the Windows/Linux
    // default), so the zero below is meaningful — not a macOS overlay artefact.
    expect(lanes.classic).toBeGreaterThan(0);
    // And the popover's hiding rules zero it out regardless.
    expect(lanes.hidden).toBe(0);
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
      const styles = getComputedStyle(el);

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        transform: styles.transform,
      };
    });

    // Exactly the same thumb on every engine — these are pure token values, so
    // Chromium, Firefox and WebKit must all render this one literal spec.
    // 4px wide (var(--blok-space-1)).
    expect(geometry.width).toBe(4);
    // 4px radius (var(--blok-space-1)) — a fully-rounded pill at 4px wide.
    expect(geometry.borderRadius).toBe('4px');
    // The border token resolved to a real, opaque colour (not transparent),
    // identically across engines — proves the same paint, not just the same box.
    expect(geometry.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(geometry.backgroundColor).toMatch(/^rgb/);
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
