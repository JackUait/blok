import { expect, test } from '@playwright/test';
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

      test('separates heading controls and conversion sections with full-width lines', async ({ page }) => {
        const settings = page.getByTestId('block-tunes-popover');
        const color = settings.getByRole('menuitem', { name: 'Color', exact: true });

        await expect.poll(() => color.evaluate(element => element.previousElementSibling?.getAttribute('role'))).toBe('separator');
        await expect(settings.getByRole('separator')).toHaveCount(4);
        await settings.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
        const conversion = page.getByTestId('popover-container').filter({
          has: page.locator('[data-blok-convert-group="toggle-heading"]'),
        }).last();

        await expect(conversion).toHaveCSS('transform', 'none');
        const dividers = conversion.getByRole('separator');

        await expect(dividers).toHaveCount(2);
        const sections = await dividers.evaluateAll(elements => elements.map(element => {
          const section = element.parentElement;

          if (section === null) {
            throw new Error('separator is not mounted in the menu');
          }

          return {
            before: element.previousElementSibling?.getAttribute('data-blok-convert-group'),
            after: element.nextElementSibling?.getAttribute('data-blok-item-name'),
            width: element.getBoundingClientRect().width,
            sectionWidth: section.getBoundingClientRect().width,
          };
        }));

        expect(sections.map(({ before, after }) => ({ before, after }))).toEqual([
          { before: 'heading', after: 'convert-toggle-heading-label' },
          { before: 'toggle-heading', after: 'paragraph' },
        ]);
        for (const section of sections) {
          expect(section.width).toBeCloseTo(section.sectionWidth, 1);
        }
        const lines = conversion.locator('[data-blok-popover-item-separator-line]');

        for (const line of await lines.all()) {
          await expect(line).toHaveCSS('height', '1px');
          await expect(line).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        }
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
            has: page.locator('[data-blok-convert-group="toggle-heading"]'),
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
              has: page.locator('[data-blok-convert-group="toggle-heading"]'),
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

        test('hides conversion separators during search and restores them when cleared', async ({ page }) => {
          const settings = page.getByTestId('block-tunes-popover');

          await settings.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
          const conversion = page.getByTestId('popover-container').filter({
            has: page.locator('[data-blok-convert-group="toggle-heading"]'),
          }).last();
          const dividers = conversion.getByRole('separator');
          const search = conversion.getByRole('combobox');

          await expect(dividers).toHaveCount(2);
          await search.fill('Heading');
          await expect(conversion.locator('[role="separator"]:not([data-blok-hidden])')).toHaveCount(0);
          await search.fill('');
          await expect(dividers).toHaveCount(2);
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
          has: page.locator('[data-blok-convert-group="toggle-heading"]'),
        }).last();

        await expect(conversion).toBeVisible();
        const labels = conversion.locator('[data-blok-convert-item]:not([data-blok-convert-group]) [data-blok-popover-item-title]');
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
        const result = conversion.getByRole('menuitem', { name: 'Heading 3', exact: true });

        const keyboardTarget = width < 650
          ? conversion.getByRole('menu', { name: 'Convert to', exact: true })
          : conversion.getByRole('combobox');

        if (width >= 650) {
          await keyboardTarget.fill('Heading 3');
        }
        const visibleLabel = width < 650
          ? conversion.getByRole('menuitem', { name: 'Text', exact: true }).getByTestId('popover-item-title')
          : result.getByTestId('popover-item-title');

        await expect(result).toBeVisible();
        await expect(visibleLabel).toHaveCSS('clip-path', 'none');
        if (width < 650) {
          await keyboardTarget.press('ArrowDown');
        }
        await keyboardTarget.press('Enter');
        await expect(page.getByRole('heading', { name: 'A better way to work', level: 3 })).toBeVisible();
      });
    });
  }
}
