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

    test('conversion lists every heading as a stacked row and keeps search actionable', async ({ page }) => {
      const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Choose a new shape.' })
        .locator('[contenteditable="true"]');

      await selectAllInEditable(paragraph);
      await page.locator('[data-blok-interface="inline-toolbar"] [data-blok-item-name="convert-to"]').click();
      const menu = page.getByTestId('popover-container').filter({ has: page.getByRole('combobox') });

      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('transform', 'none');
      const names = [1, 2, 3, 4, 5, 6].flatMap(level => [`Heading ${level}`, `Toggle heading ${level}`]);

      for (const name of names) {
        await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
      }
      await expect(menu.getByRole('tab', { includeHidden: true })).toHaveCount(0);
      // Layout boxes, not getBoundingClientRect: rows near the scroll edge
      // carry the reel tilt transform, which shifts their painted box.
      const rows = await menu.locator('[data-blok-convert-item]').evaluateAll(elements => elements.map(element => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('conversion row is not an HTML element');
        }

        return { left: element.offsetLeft, top: element.offsetTop, bottom: element.offsetTop + element.offsetHeight };
      }));

      expect(rows.length).toBeGreaterThanOrEqual(names.length);
      rows.forEach(row => expect(row.left).toBe(rows[0].left));
      rows.slice(1).forEach((row, index) => expect(row.top).toBeGreaterThanOrEqual(rows[index].bottom));
      const box = await menu.boundingBox();

      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? width + 1)).toBeLessThanOrEqual(width);
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
