import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectBlokField } from '../helpers/field';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const openCalloutPicker = async (page: Page, theme: 'light' | 'dark'): Promise<Locator> => {
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder: 'blok',
      data: { blocks: [{ type: 'callout', data: { emoji: '💡', color: 'default' } }] },
    });
    await window.blokInstance.isReady;
  });
  // After the editor is ready: its theme manager rewrites this attribute on boot.
  await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
  await page.getByTestId('callout-emoji-btn').click();
  const picker = page.getByRole('dialog', { name: 'Edit icon' });

  await expect(picker).toBeVisible();
  await picker.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));

  return picker;
};

test.beforeAll(ensureBlokBundleBuilt);

for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]] as const) {
  test.describe(`${theme}, ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      // The shared page ignores test.use({ viewport }).
      await page.setViewportSize({ width, height: 800 });
      await gotoTestPage(page);
    });

    test('emoji filter is the shared search field', async ({ page }) => {
      const picker = await openCalloutPicker(page, theme);
      const input = picker.getByRole('searchbox', { name: 'Search emojis…' });
      const field = picker.locator('[data-emoji-picker-search]');

      await expectBlokField(field, input, 'search');
      // The glyph comes from the field, so no icon element of its own.
      expect(await field.evaluate(element => [...element.querySelectorAll('svg')].filter(svg => svg.checkVisibility()).length)).toBe(0);
    });

    test('the clear button sits inside the field without growing it', async ({ page }) => {
      const picker = await openCalloutPicker(page, theme);
      const input = picker.getByRole('searchbox', { name: 'Search emojis…' });
      const field = picker.locator('[data-emoji-picker-search]');
      const clear = field.getByRole('button', { name: 'Clear search' });

      await input.fill('bulb');
      await expect(clear).toBeVisible();

      const [fieldBox, clearBox] = await Promise.all([field.boundingBox(), clear.boundingBox()]);

      if (fieldBox === null || clearBox === null) {
        throw new Error('The field or its clear button has no box');
      }
      expect(fieldBox.height).toBe(width < 651 ? 36 : 28);
      expect(clearBox.y).toBeGreaterThanOrEqual(fieldBox.y);
      expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height);
      expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width);
    });
  });
}
