import type { ElementHandle, Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, TOOLTIP_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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

type BoundingBox = { x: number; y: number; width: number; height: number };

const requireBoundingBox = async (
  target: Locator | ElementHandle<HTMLElement>,
  label: string
): Promise<BoundingBox> => {
  const box = await target.boundingBox();

  expect(box, `${label} has no bounding box`).not.toBeNull();

  return box as BoundingBox;
};

/**
 * Resolve the exact element the keyboard-shortcut tooltip is bound to: the inner
 * glyph span of the Delete tune's secondary-title (see the onHover() call in
 * popover-item-default.ts). The Delete tune always ships with a 'Del' shortcut,
 * so `[data-blok-item-name="delete"]` is a unique, position-free target.
 */
const resolveTooltipTrigger = async (page: Page): Promise<ElementHandle<HTMLElement>> => {
  const deleteItem = page.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="delete"]`);

  await expect(deleteItem).toBeVisible();

  const secondaryTitle = deleteItem.locator(SECONDARY_TITLE_SELECTOR);

  await expect(secondaryTitle).toBeVisible();

  const triggerHandle = await secondaryTitle.evaluateHandle((el) => {
    return (el.firstElementChild ?? el) as HTMLElement;
  });
  const triggerElement = triggerHandle.asElement();

  expect(triggerElement, 'Could not resolve tooltip trigger element').not.toBeNull();

  return triggerElement;
};

/**
 * Parse the alpha channel from a computed `background-color` string.
 * rgb(...) has no alpha (implicitly opaque → 1); rgba(...) carries it as the 4th part.
 */
const parseAlpha = (backgroundColor: string): number => {
  const match = backgroundColor.match(/rgba?\(([^)]+)\)/);

  if (match === null) {
    return 1;
  }

  const parts = match[1].split(',').map((s) => s.trim());

  return parts.length === 4 ? Number(parts[3]) : 1;
};

test.describe('Tooltip on a popover item with a keyboard-shortcut glyph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
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

    const triggerElement = await resolveTooltipTrigger(page);
    const triggerBox = await requireBoundingBox(triggerElement, 'Tooltip trigger element');

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

    const tooltipBox = await requireBoundingBox(tooltip, 'Tooltip');

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

    const triggerElement = await resolveTooltipTrigger(page);
    const triggerBox = await requireBoundingBox(triggerElement, 'Tooltip trigger element');

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

    const alpha = parseAlpha(backgroundColor);

    expect(alpha).toBeGreaterThan(0);
  });
});
