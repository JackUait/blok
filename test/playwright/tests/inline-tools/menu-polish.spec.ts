import { expect, test, type Locator } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`block menu polish at ${width}px in ${theme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        await gotoTestPage(page);
        await page.evaluate(async () => {
          const holder = document.createElement('div');

          holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
          document.body.append(holder);
          window.blokInstance = new window.Blok({
            holder,
            data: { blocks: [
              { type: 'header', data: { text: 'A better way to work', level: 2, anchor: 'keep-anchor' } },
              { type: 'paragraph', data: { text: 'Less noise. More room for ideas.' } },
            ] },
          });
          await window.blokInstance.isReady;
        });
        await page.getByRole('heading', { name: 'A better way to work' }).click();
        await page.getByTestId('settings-toggler').click();
      });

      test('selected heading stays neutral while actions retain full hit areas', async ({ page }) => {
        const menu = page.getByTestId('block-tunes-popover');
        const selected = menu.getByRole('menuitemradio', { name: 'Heading 2', exact: true });
        const colorAction = menu.getByRole('menuitem', { name: 'Color', exact: true });

        await expect(menu.locator('[data-blok-item-name="block-identity"]')).toHaveCount(0);
        await expect(selected).toHaveAttribute('aria-checked', 'true');
        const actionColor = await colorAction.evaluate(element => getComputedStyle(element).color);

        await expect(selected).toHaveCSS('color', actionColor);
        await expect(menu.getByTestId('popover-container').first()).toHaveCSS('transform', 'none');
        const actions = menu.getByRole('menuitem');
        const sizes = await actions.evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect();
          const title = element.querySelector('[data-blok-popover-item-title]')?.getBoundingClientRect();

          return { height: rect.height, titleHeight: title?.height ?? 0 };
        }));

        expect(sizes.length).toBeGreaterThanOrEqual(4);
        for (const size of sizes) {
          expect(size.height).toBeGreaterThanOrEqual(width < 650 ? 40 : 32);
          expect(size.height).toBeGreaterThanOrEqual(size.titleHeight + 12);
        }
        await selected.click();
        await expect(page.getByRole('heading', { name: 'A better way to work', level: 2 })).toHaveAttribute('id', 'keep-anchor');
      });

      test('keeps the conversion list plain: no dividers, no tabs, one left edge', async ({ page }) => {
        const settings = page.getByTestId('block-tunes-popover');
        const color = settings.getByRole('menuitem', { name: 'Color', exact: true });

        await expect.poll(() => color.evaluate(element => element.previousElementSibling?.getAttribute('role'))).toBe('separator');
        await expect(settings.getByRole('separator')).toHaveCount(4);
        await settings.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
        const conversion = page.getByTestId('popover-container').filter({
          has: page.locator('[data-blok-convert-item]'),
        }).last();

        await expect(conversion).toHaveCSS('transform', 'none');
        await expect(conversion.getByRole('separator', { includeHidden: true })).toHaveCount(0);
        await expect(conversion.getByRole('tab', { includeHidden: true })).toHaveCount(0);
        await expect(conversion.getByRole('tablist', { includeHidden: true })).toHaveCount(0);
        // Layout boxes, not getBoundingClientRect: rows near the scroll edge
        // carry the reel tilt transform, which shifts their painted box.
        const rows = await conversion.locator('[data-blok-convert-item]:visible').evaluateAll(elements => elements.map(element => {
          if (!(element instanceof HTMLElement)) {
            throw new Error('conversion row is not an HTML element');
          }

          return { left: element.offsetLeft, top: element.offsetTop, bottom: element.offsetTop + element.offsetHeight };
        }));

        expect(rows.length).toBeGreaterThan(6);
        rows.forEach(row => expect(row.left).toBe(rows[0].left));
        rows.slice(1).forEach((row, index) => expect(row.top).toBeGreaterThanOrEqual(rows[index].bottom));
      });

      if (width === 390) {
        test('keeps heading and conversion touch targets at least 44px high', async ({ page }) => {
          const settings = page.getByTestId('block-tunes-popover');

          await expect(settings.getByTestId('popover-container').first()).toHaveCSS('transform', 'none');
          const headings = await settings.getByRole('menuitemradio').evaluateAll(elements =>
            elements.map(element => element.getBoundingClientRect().height)
          );

          expect(headings).toHaveLength(6);
          expect(Math.min(...headings)).toBeGreaterThanOrEqual(44);
          await settings.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
          const conversion = page.getByTestId('popover-container').filter({
            has: page.locator('[data-blok-convert-item]'),
          }).last();

          await expect(conversion).toHaveCSS('transform', 'none');
          const choices = await conversion.getByRole('menuitem').evaluateAll(elements =>
            elements.map(element => element.getBoundingClientRect().height)
          );

          expect(choices.length).toBeGreaterThan(6);
          expect(Math.min(...choices)).toBeGreaterThanOrEqual(44);
        });
      }

      test('text block menus start with Color without a current-block label', async ({ page }) => {
        await page.keyboard.press('Escape');
        await page.getByText('Less noise. More room for ideas.', { exact: true }).click();
        await page.getByTestId('settings-toggler').click();

        const menu = page.getByTestId('block-tunes-popover');
        const container = menu.getByTestId('popover-container').first();

        await expect(menu.getByRole('menuitem', { name: 'Color', exact: true })).toBeVisible();
        await expect(menu.locator('[data-blok-item-name="block-identity"]')).toHaveCount(0);
        await expect(menu.getByText('Text', { exact: true })).toHaveCount(0);
        await expect.poll(() => container.getByTestId('popover-items').first().evaluate(items =>
          items.firstElementChild?.getAttribute('data-blok-item-name')
        )).toBe('block-color');
        await expect(container).toHaveCSS('padding-left', '8px');
      });

      if (width === 1280) {
        for (const viewportWidth of [900, 1000, 1280]) {
          test(`keeps conversion choices on-screen near the right edge at ${viewportWidth}px`, async ({ page }) => {
            await page.keyboard.press('Escape');
            await page.setViewportSize({ width: viewportWidth, height: 844 });
            const heading = page.getByRole('heading', { name: 'A better way to work' });
            const headingBox = await heading.boundingBox();

            if (!headingBox) {
              throw new Error('Heading is missing');
            }
            await heading.click({ button: 'right', position: { x: headingBox.width - 30, y: 10 } });
            await page.getByTestId('block-tunes-popover').getByRole('menuitem', { name: 'Convert to', exact: true }).click();
            const conversion = page.getByTestId('popover-container').filter({
              has: page.locator('[data-blok-convert-item]'),
            }).last();

            await expect(conversion).toHaveCSS('transform', 'none');
            await expect(conversion).toBeInViewport({ ratio: 1 });
            const box = await conversion.boundingBox();

            expect(box).not.toBeNull();
            expect(box?.x).toBeGreaterThanOrEqual(0);
            expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);
            await conversion.getByRole('menuitem', { name: 'Code', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'A better way to work' })).toHaveCount(0);
          });
        }

        test('search narrows the conversion list without adding dividers and clearing restores it', async ({ page }) => {
          const settings = page.getByTestId('block-tunes-popover');

          await settings.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
          const conversion = page.getByTestId('popover-container').filter({
            has: page.locator('[data-blok-convert-item]'),
          }).last();
          const rows = conversion.locator('[data-blok-convert-item]:visible');
          const search = conversion.getByRole('combobox');

          await expect(conversion.getByRole('menuitem', { name: 'Code', exact: true })).toBeVisible();
          const total = await rows.count();

          await search.fill('Heading');
          await expect(conversion.getByRole('menuitem', { name: 'Code', exact: true })).toBeHidden();
          await expect(conversion.getByRole('menuitem', { name: 'Toggle heading 6', exact: true })).toBeVisible();
          await expect(conversion.locator('[role="separator"]:not([data-blok-hidden])')).toHaveCount(0);
          expect(await rows.count()).toBeLessThan(total);
          await search.fill('');
          await expect(rows).toHaveCount(total);
          await expect(conversion.getByRole('separator', { includeHidden: true })).toHaveCount(0);
        });

        test('keeps the menu within a short viewport', async ({ page }) => {
          await page.keyboard.press('Escape');
          await page.setViewportSize({ width, height: 360 });
          await page.getByRole('heading', { name: 'A better way to work' }).click();
          await page.getByTestId('settings-toggler').click();

          const menu = page.getByTestId('block-tunes-popover').getByTestId('popover-container').first();

          await expect(menu).toBeInViewport({ ratio: 1 });
        });
      }

      test('metadata remains readable without scrolling past the actions', async ({ page }) => {
        const metadata = page.getByTestId('block-tunes-popover').locator('[data-blok-item-name="edit-metadata"]');

        await expect(metadata).toBeInViewport({ ratio: 1 });
        await expect(metadata).toHaveCSS('transform', 'none');
      });

      test('conversion labels fit and choices stay keyboard actionable', async ({ page }) => {
        const settings = page.getByTestId('block-tunes-popover');

        await settings.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
        const conversion = page.getByTestId('popover-container').filter({
          has: page.locator('[data-blok-convert-item]'),
        }).last();

        await expect(conversion).toBeVisible();
        const labels = conversion.locator('[data-blok-convert-item]:visible [data-blok-popover-item-title]');
        const fits = await labels.evaluateAll(elements => elements.map(element => {
          const label = element.getBoundingClientRect();
          const item = element.parentElement?.getBoundingClientRect();

          return item !== undefined && label.right <= item.right - 6;
        }));

        expect(fits.length).toBeGreaterThanOrEqual(6);
        expect(fits.every(Boolean)).toBe(true);
        const rect = await conversion.boundingBox();

        expect(rect).not.toBeNull();
        expect(rect?.x).toBeGreaterThanOrEqual(0);
        expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(width);
        const keyboardTarget = width < 650
          ? conversion.getByRole('menu', { name: 'Convert to', exact: true })
          : conversion.getByRole('combobox');
        const order = ['Text', 'Heading 1', 'Heading 2', 'Heading 3'];

        await expect(conversion.getByRole('menuitem', { name: 'Text', exact: true }).getByTestId('popover-item-title')).toHaveCSS('clip-path', 'none');
        // ArrowDown walks the rows top to bottom, one row per press.
        const row = (name: string): Locator => conversion.locator('[data-blok-convert-item]').filter({
          has: page.getByTestId('popover-item-title').and(page.getByText(name, { exact: true })),
        });

        await expect(row('Heading 2')).toHaveAttribute('aria-checked', 'true');
        await expect(row('Heading 2').getByTestId('popover-item-trailing-icon')).toBeVisible();
        for (const name of order) {
          await keyboardTarget.press('ArrowDown');
          await expect(row(name)).toHaveAttribute('data-blok-focused', 'true');
        }
        await keyboardTarget.press('Enter');
        await expect(page.getByRole('heading', { name: 'A better way to work', level: 3 })).toBeVisible();
      });
    });
  }
}
