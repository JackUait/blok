import { expect, test } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

for (const width of [1280, 390]) {
  test.describe(`menu grids at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await gotoTestPage(page);
      await page.evaluate(async () => {
        const holder = document.createElement('div');

        holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
        document.body.append(holder);
        window.blokInstance = new window.Blok({
          holder,
          data: { blocks: [
            { type: 'header', data: { text: 'Keep this anchor', level: 2, anchor: 'keep-anchor' } },
            { type: 'paragraph', data: { text: 'Choose a new shape.' } },
          ] },
        });
        await window.blokInstance.isReady;
      });
    });

    test('heading levels form one direct row and preserve the anchor', async ({ page }) => {
      await page.getByRole('heading', { name: 'Keep this anchor' }).click();
      await page.getByTestId('settings-toggler').click();
      const settings = page.getByTestId('block-tunes-popover');
      const levels = settings.getByRole('menuitemradio');

      await expect(levels).toHaveCount(6);
      await expect(settings.getByTestId('popover-container').first()).toHaveCSS('transform', 'none');
      const rects = await levels.evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();

        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }));

      for (const rect of rects) {
        expect(rect.y).toBeCloseTo(rects[0].y, 0);
        expect(rect.width).toBeGreaterThanOrEqual(40);
        expect(rect.height).toBeGreaterThanOrEqual(40);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      }
      await expect(levels.nth(1)).toHaveAttribute('aria-checked', 'true');
      await settings.getByRole('menuitemradio', { name: 'Heading 4', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Keep this anchor', level: 4 })).toHaveAttribute('id', 'keep-anchor');
    });

    test('conversion groups compact heading tiles and keeps search actionable', async ({ page }) => {
      const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Choose a new shape.' })
        .locator('[contenteditable="true"]');

      await selectAllInEditable(paragraph);
      await page.locator('[data-blok-interface="inline-toolbar"] [data-blok-item-name="convert-to"]').click();
      const menu = page.getByTestId('popover-container').filter({ has: page.getByRole('combobox') });

      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('transform', 'none');
      const headings = menu.locator('[data-blok-convert-group="heading"]');
      const toggles = menu.locator('[data-blok-convert-group="toggle-heading"]');

      await expect(headings).toHaveCount(6);
      await expect(toggles).toHaveCount(6);
      // Family tabs show one strip at a time, all six previews in one row.
      await expect(menu.locator('[data-blok-convert-group="toggle-heading"]:visible')).toHaveCount(0);
      // Tiles rise in on open and on tab switch; measure where they settle.
      const settle = (): Promise<void> => menu.evaluate(async element => {
        await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
      });

      await settle();
      const rects = await headings.evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();

        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }));

      rects.forEach(rect => {
        expect(Math.abs(rect.y - rects[0].y)).toBeLessThanOrEqual(1);
        expect(rect.height).toBeGreaterThanOrEqual(40);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      });
      rects.slice(1).forEach((rect, index) => {
        expect(rect.x).toBeGreaterThanOrEqual(rects[index].x + rects[index].width);
      });
      await menu.getByRole('tab', { name: 'Toggle heading', exact: true }).click();
      await expect(menu.locator('[data-blok-convert-group="toggle-heading"]:visible')).toHaveCount(6);
      await expect(menu.locator('[data-blok-convert-group="heading"]:visible')).toHaveCount(0);
      await settle();
      const toggleBounds = await toggles.first().boundingBox();

      // The other family takes over the same strip instead of stacking below it.
      expect(Math.abs((toggleBounds?.y ?? -1) - rects[0].y)).toBeLessThanOrEqual(1);
      await menu.getByRole('tab', { name: 'Heading', exact: true }).click();
      const search = menu.getByRole('combobox');

      await search.fill('no-matching-shape-xyz');
      await expect(menu.getByTestId('popover-nothing-found')).toBeVisible();
      await expect(menu.getByTestId('popover-nothing-found')).toHaveText('Nothing found');
      await expect(menu.locator('[data-blok-popover-item]:visible')).toHaveCount(0);
      await search.fill('Heading 3');
      const result = menu.getByRole('menuitem', { name: 'Heading 3', exact: true });

      await expect(result).toBeVisible();
      await expect(result.getByTestId('popover-item-title')).toHaveCSS('clip-path', 'none');
      await result.click();
      await expect(page.getByRole('heading', { name: 'Choose a new shape.', level: 3 })).toBeVisible();
    });
  });
}
