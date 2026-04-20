import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, TOOLTIP_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const POPOVER_ITEM_SELECTOR = '[data-blok-testid="popover-item"]';
const SECONDARY_TITLE_SELECTOR = '[data-blok-testid="popover-item-secondary-title"]';

/**
 * Reset the blok holder and destroy any existing instance.
 */
const resetBlok = async (page: Page): Promise<void> => {
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
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const openBlockSettings = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' });

  await block.hover();

  const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

  await expect(settingsToggler).toBeVisible();
  await settingsToggler.click();

  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toBeVisible();
};

test.describe('Tooltip on a popover item with a keyboard-shortcut glyph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  /**
   * Regression for the Top Layer placement bug. When the tooltip wrapper is
   * promoted to the CSS Top Layer (via `popover="manual"` + `showPopover()`),
   * the User-Agent stylesheet for `[popover]` applies modal-dialog defaults
   * (`position: fixed; inset: 0; margin: auto`) that pin the wrapper to the
   * bottom-right of the viewport. Our `main.css` reset must neutralize those
   * defaults for `[data-blok-interface=tooltip][popover]` so the inline
   * `top`/`left` placement wins. Without the reset, the tooltip would land
   * 1500+ px away from its trigger.
   */
  test('keyboard-shortcut tooltip stays anchored to the trigger when promoted to the CSS Top Layer', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openBlockSettings(page);

    /**
     * Find a popover item that has a non-empty secondary-title (keyboard
     * shortcut glyph) — that's the element wired up with a tooltip via the
     * onHover() call in popover-item-default.ts. The Delete tune always ships
     * with `secondaryLabel: 'Del'`, so it's a reliable target.
     */
    const itemWithShortcut = page
      .locator(POPOVER_ITEM_SELECTOR)
      .filter({ has: page.locator(SECONDARY_TITLE_SELECTOR) })
      .first();

    await expect(itemWithShortcut).toBeVisible();

    const secondaryTitle = itemWithShortcut.locator(SECONDARY_TITLE_SELECTOR);

    await expect(secondaryTitle).toBeVisible();

    /**
     * The tooltip is anchored to the inner glyph span (the visible shortcut
     * keys), not the padded outer container — see the onHover() call in
     * popover-item-default.ts. Hovering the inner span fires the mouseenter
     * handler that calls tooltip.show().
     */
    const triggerHandle = await secondaryTitle.evaluateHandle((el) => {
      return (el.firstElementChild ?? el) as HTMLElement;
    });
    const triggerElement = triggerHandle.asElement();

    if (triggerElement === null) {
      throw new Error('Could not resolve tooltip trigger element');
    }

    const triggerBox = await triggerElement.boundingBox();

    if (triggerBox === null) {
      throw new Error('Tooltip trigger element has no bounding box');
    }

    /**
     * Move the mouse to the trigger's center to fire `mouseenter` on the
     * exact element the tooltip is bound to. `Locator.hover()` would target
     * the secondary-title container instead.
     */
    await page.mouse.move(
      triggerBox.x + triggerBox.width / 2,
      triggerBox.y + triggerBox.height / 2
    );

    const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

    await expect(tooltip).toBeVisible();

    const tooltipBox = await tooltip.boundingBox();

    if (tooltipBox === null) {
      throw new Error('Tooltip has no bounding box');
    }

    const triggerCenterX = triggerBox.x + triggerBox.width / 2;
    const triggerCenterY = triggerBox.y + triggerBox.height / 2;
    const tooltipCenterX = tooltipBox.x + tooltipBox.width / 2;
    const tooltipCenterY = tooltipBox.y + tooltipBox.height / 2;

    /**
     * Generous bounds: the tooltip is placed `top` of the trigger with a 10px
     * offset, so it sits a few dozen px above. The bug placed it ~1500px away
     * (bottom-right corner of the viewport), so even ±150x/±100y bounds
     * comfortably catch the regression.
     */
    expect(Math.abs(tooltipCenterX - triggerCenterX)).toBeLessThanOrEqual(150);
    expect(Math.abs(tooltipCenterY - triggerCenterY)).toBeLessThanOrEqual(100);
  });

  /**
   * Regression for the transparent-background bug. The CSS reset that
   * neutralizes UA `[popover]` defaults must NOT include `background:
   * transparent` for the tooltip wrapper, since the tooltip paints its
   * pill background directly on the wrapper via tailwind's `bg-tooltip-bg`
   * (versus the popover wrapper, which paints background on its inner
   * container). Without this carve-out the tooltip text would appear to
   * float on transparent over whatever lies beneath.
   */
  test('keyboard-shortcut tooltip keeps an opaque background when promoted to the CSS Top Layer', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openBlockSettings(page);

    const itemWithShortcut = page
      .locator(POPOVER_ITEM_SELECTOR)
      .filter({ has: page.locator(SECONDARY_TITLE_SELECTOR) })
      .first();
    const secondaryTitle = itemWithShortcut.locator(SECONDARY_TITLE_SELECTOR);
    const triggerHandle = await secondaryTitle.evaluateHandle((el) => {
      return (el.firstElementChild ?? el) as HTMLElement;
    });
    const triggerElement = triggerHandle.asElement();

    if (triggerElement === null) {
      throw new Error('Could not resolve tooltip trigger element');
    }

    const triggerBox = await triggerElement.boundingBox();

    if (triggerBox === null) {
      throw new Error('Tooltip trigger element has no bounding box');
    }

    await page.mouse.move(
      triggerBox.x + triggerBox.width / 2,
      triggerBox.y + triggerBox.height / 2
    );

    const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

    await expect(tooltip).toBeVisible();

    const backgroundColor = await tooltip.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    /**
     * The exact color depends on the active theme, but it must be opaque
     * (alpha === 1) and non-empty. `rgba(0, 0, 0, 0)` and `transparent` are
     * the bug states this test guards against.
     */
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(backgroundColor).not.toBe('transparent');
    expect(backgroundColor).not.toBe('');

    const alphaMatch = backgroundColor.match(/rgba?\(([^)]+)\)/);
    const parts = alphaMatch !== null ? alphaMatch[1].split(',').map((s) => s.trim()) : [];
    const alpha = parts.length === 4 ? Number(parts[3]) : 1;

    expect(alpha).toBeGreaterThan(0);
  });
});
