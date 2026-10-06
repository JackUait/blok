import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectBlokField } from '../helpers/field';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const IS_MAC = process.platform === 'darwin';
const REPLACE_KEY = IS_MAC ? 'Meta+Alt+f' : 'Control+h';
const TEXT = 'foo one foo two, and on this page you can find a long sentence';
const LONG_QUERY = 'and on this page you can find a long sentence';

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

    test('the find and replace fields share the expected width', async ({ page }) => {
      await openReplace(page, theme);

      const [find, replace] = await Promise.all([
        page.getByTestId('find-field').boundingBox(),
        page.getByTestId('find-replace-field').boundingBox(),
      ]);

      // Phones cap the bar at the viewport, so the field fills what is left.
      const expected = width < 651 ? 189 : 193;

      expect(Math.round(find?.width ?? 0)).toBe(expected);
      expect(replace?.width).toBe(find?.width);
    });

    test('a long query runs up to the counter digits', async ({ page }) => {
      await openReplace(page, theme);
      await page.getByTestId('find-input').fill(LONG_QUERY);
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');

      const { inputRight, digitsLeft } = await page.getByTestId('find-field').evaluate((field) => {
        const input = field.querySelector('input');
        const counter = field.querySelector('[data-blok-testid="find-counter"]');
        const range = document.createRange();

        if (input === null || counter === null) {
          throw new Error('The field has no input or counter');
        }
        range.selectNodeContents(counter);

        return { inputRight: input.getBoundingClientRect().right, digitsLeft: range.getBoundingClientRect().left };
      });

      expect(digitsLeft - inputRight).toBeLessThanOrEqual(4);
    });

    test('hazes the right edge only while text hides past it', async ({ page }) => {
      await openReplace(page, theme);
      const input = page.getByTestId('find-input');
      const mask = (): Promise<string> => input.evaluate(el => getComputedStyle(el).maskImage);

      await input.fill(LONG_QUERY);
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      await input.press('Home');
      await expect.poll(mask).not.toBe('none');

      await input.press('End');
      await expect.poll(mask).toBe('none');

      await input.fill('foo');
      await input.press('Home');
      await expect.poll(mask).toBe('none');
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
