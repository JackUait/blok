import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectBlokField } from '../helpers/field';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const IS_MAC = process.platform === 'darwin';
const REPLACE_KEY = IS_MAC ? 'Meta+Alt+f' : 'Control+h';
const TEXT = 'foo one foo two';

const openReplace = async (page: Page, theme: 'light' | 'dark'): Promise<void> => {
  await page.evaluate(async text => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder: 'blok',
      data: { blocks: [{ type: 'paragraph', data: { text } }] },
    });
    await window.blokInstance.isReady;
  }, TEXT);
  // After the editor is ready: its theme manager rewrites this attribute on boot.
  await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
  const paragraph = page.getByText(TEXT, { exact: true });

  await paragraph.click();
  await page.keyboard.press(REPLACE_KEY);
  await expect(page.getByTestId('find-replace-row')).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'));
};

test.beforeAll(ensureBlokBundleBuilt);

for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]] as const) {
  test.describe(`${theme}, ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      // The shared page ignores test.use({ viewport }).
      await page.setViewportSize({ width, height: 800 });
      await gotoTestPage(page);
    });

    test('find input is the shared text field, no search glyph', async ({ page }) => {
      await openReplace(page, theme);
      await expect(page.getByTestId('find-field')).toBeVisible();
      await expectBlokField(page.getByTestId('find-field'), page.getByTestId('find-input'), 'text');
    });

    test('replace input is the shared text field', async ({ page }) => {
      await openReplace(page, theme);
      await expect(page.getByTestId('find-replace-field')).toBeVisible();
      await expectBlokField(page.getByTestId('find-replace-field'), page.getByTestId('find-replace-input'), 'text');
    });

    test('the find field is 140px wide, with the replace field under it', async ({ page }) => {
      await openReplace(page, theme);

      const [find, replace] = await Promise.all([
        page.getByTestId('find-field').boundingBox(),
        page.getByTestId('find-replace-field').boundingBox(),
      ]);

      expect(find?.width).toBe(140);
      expect(replace?.width).toBe(140);
    });

    test('the counter sits inside the find field', async ({ page }) => {
      await openReplace(page, theme);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      const [field, counter] = await Promise.all([
        page.getByTestId('find-field').boundingBox(),
        page.getByTestId('find-counter').boundingBox(),
      ]);

      if (field === null || counter === null) {
        throw new Error('The field or its counter has no box');
      }
      expect(field.height).toBe(width < 651 ? 36 : 28);
      expect(counter.x + counter.width).toBeLessThanOrEqual(field.x + field.width);
      expect(counter.y).toBeGreaterThanOrEqual(field.y);
      expect(counter.y + counter.height).toBeLessThanOrEqual(field.y + field.height);
    });
  });
}
