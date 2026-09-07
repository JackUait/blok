import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

const openSettings = async (page: Page): Promise<void> => {
  await page.getByRole('heading', { name: 'A little more clarity', exact: true }).click();
  await page.getByTestId('settings-toggler').click();
  await expect(page.getByTestId('block-tunes-popover').getByTestId('popover-container').first()).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.id = 'menu-polish';
    holder.style.cssText = 'max-width:650px;margin:120px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: {
        blocks: [
          { type: 'header', data: { text: 'A little more clarity', level: 1 } },
          { type: 'paragraph', data: { text: 'Select these words to make them your own.' } },
        ],
      },
    });
    await window.blokInstance.isReady;
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`menu text remains readable in resting and selected states in ${theme} mode`, async ({ page }) => {
    await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
    await openSettings(page);

    const scan = async (): Promise<void> => {
      const result = await new AxeBuilder({ page })
        .include('[data-blok-testid="block-tunes-popover"]')
        .withRules(['color-contrast'])
        .analyze();

      expect(result.violations).toEqual([]);
    };

    await scan();
    const selected = page.getByRole('menuitemradio', { name: 'Heading 1', exact: true });

    await expect(selected).toBeVisible();
    await expect(selected).toHaveAttribute('aria-checked', 'true');
    await scan();
  });
}

for (const width of [1280, 390]) {
  test(`inline formatting controls have comfortable targets without clipping icons at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const paragraph = page.getByTestId('block-wrapper')
      .filter({ hasText: 'Select these words to make them your own.' })
      .locator('[contenteditable="true"]');

    await selectAllInEditable(paragraph);
    const bold = page.getByRole('menuitemcheckbox', { name: 'Bold', exact: true });

    await expect(bold).toBeVisible();
    const bounds = await bold.boundingBox();
    const iconBounds = await bold.getByRole('img', { includeHidden: true }).boundingBox();

    if (bounds === null || iconBounds === null) {
      throw new Error('Missing formatting control or icon');
    }

    expect(bounds.height).toBeGreaterThanOrEqual(32);
    expect(bounds.width).toBeGreaterThanOrEqual(32);
    expect(iconBounds.x).toBeGreaterThanOrEqual(bounds.x);
    expect(iconBounds.y).toBeGreaterThanOrEqual(bounds.y);
    expect(iconBounds.x + iconBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(iconBounds.y + iconBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    await bold.click();
    await expect.poll(() => paragraph.innerHTML()).toMatch(/^<(b|strong)>Select these words to make them your own\.<\/\1>$/);
  });
}

test('color swatches visibly track keyboard focus without motion when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings(page);
  await page.getByRole('menuitem', { name: 'Color', exact: true }).hover();
  const picker = page.getByTestId('block-color-picker');

  await expect(picker).toBeVisible();
  const swatch = picker.getByTestId('block-color-swatch-textColor-red');

  const restingRing = await swatch.evaluate(el => getComputedStyle(el).boxShadow);

  // Programmatic focus needs keyboard modality for :focus-visible.
  await page.keyboard.press('Shift');
  await swatch.focus();
  await expect(swatch).toBeFocused();
  const ring = await swatch.evaluate(el => getComputedStyle(el).boxShadow);

  expect(ring).not.toBe('none');
  expect(ring).not.toBe(restingRing);
  await expect(swatch).toHaveCSS('transition-property', 'none');
});

test('heading controls and color submenu stay usable near the viewport edge', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 620 });
  await openSettings(page);
  const heading = page.getByRole('menuitemradio', { name: 'Heading 6', exact: true });

  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeVisible();
  const bounds = await heading.boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(760);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(620);
  await heading.click();
  await expect(page.getByRole('heading', { name: 'A little more clarity', level: 6 })).toBeVisible();

  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Color', exact: true }).hover();
  const picker = page.getByTestId('block-color-picker');

  await expect(picker).toBeVisible();
  const pickerBounds = await picker.boundingBox();

  expect(pickerBounds).not.toBeNull();
  expect(pickerBounds?.x).toBeGreaterThanOrEqual(0);
  expect((pickerBounds?.x ?? 0) + (pickerBounds?.width ?? 0)).toBeLessThanOrEqual(760);
});
