import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectBlokField } from '../helpers/field';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const TEXT = 'Entry fields share one look';
const LINK_BUTTON = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;

const mount = async (page: Page, blocks: OutputData['blocks'], theme: string): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async data => {
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:200px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, blocks);
  await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
};

const openLinkField = async (page: Page): Promise<Locator> => {
  await selectAllInEditable(page.getByText(TEXT, { exact: true }));
  await page.locator(LINK_BUTTON).click();

  return page.getByTestId('inline-tool-input');
};

const dangerBorder = async (field: Locator): Promise<{ danger: string; border: string }> =>
  field.evaluate(element => {
    const probe = document.createElement('span');

    probe.style.borderColor = 'var(--blok-color-danger)';
    element.parentElement?.append(probe);
    const danger = getComputedStyle(probe).borderTopColor;

    probe.remove();

    return { danger, border: getComputedStyle(element).borderTopColor };
  });

test.beforeAll(ensureBlokBundleBuilt);

for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]] as const) {
  test.describe(`${theme}, ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('link URL field is the shared text field', async ({ page }) => {
      await mount(page, [{ type: 'paragraph', data: { text: TEXT } }], theme);
      const input = await openLinkField(page);

      await expect(input).toBeVisible();
      await expectBlokField(input, input, 'text');
    });

    test('an invalid link URL paints the danger border', async ({ page }) => {
      await mount(page, [{ type: 'paragraph', data: { text: TEXT } }], theme);
      const input = await openLinkField(page);

      await input.fill('https://example .com');
      await input.press('Enter');
      await expect(input).toHaveAttribute('aria-invalid', 'true');

      const { danger, border } = await dangerBorder(input);

      expect(border).toBe(danger);
    });

    test('link text field (edit mode) is the shared text field', async ({ page }) => {
      await mount(page, [{ type: 'paragraph', data: { text: `<a href="https://example.com">${TEXT}</a>` } }], theme);
      await openLinkField(page);
      const title = page.getByTestId('inline-tool-title-input');

      await expect(title).toBeVisible();
      await expectBlokField(title, title, 'text');
    });

    test('embed URL bar is the shared text field', async ({ page }) => {
      await mount(page, [{ type: 'embed', data: {} }], theme);
      const bar = page.locator('[data-role="embed-url-bar"]');

      await expect(bar).toBeVisible();
      await expectBlokField(bar, bar.locator('[data-role="embed-url-input"]'), 'text');
    });

    test('focus on the embed submit button leaves the field at rest', async ({ page }) => {
      await mount(page, [{ type: 'embed', data: {} }], theme);
      const bar = page.locator('[data-role="embed-url-bar"]');
      const submit = bar.locator('[data-role="embed-url-submit"]');

      await expect(bar).toBeVisible();
      const rest = await bar.evaluate(element => getComputedStyle(element).backgroundColor);

      // Only the text input is the field's focus; a button inside it is not.
      await submit.focus();
      await expect(submit).toBeFocused();
      await expect(bar).toHaveCSS('background-color', rest);
    });

    test('an invalid embed URL paints the danger border', async ({ page }) => {
      await mount(page, [{ type: 'embed', data: {} }], theme);
      const bar = page.locator('[data-role="embed-url-bar"]');

      await bar.locator('[data-role="embed-url-input"]').fill('https://example.com/page');
      await bar.locator('[data-role="embed-url-submit"]').click();
      await expect(bar.locator('[data-role="embed-url-input"]')).toHaveAttribute('aria-invalid', 'true');

      const { danger, border } = await dangerBorder(bar);

      expect(border).toBe(danger);
    });

    test('image alt text is the shared text field, still multi-line', async ({ page }) => {
      await mount(page, [{
        type: 'image',
        data: { url: 'http://localhost:4444/test/playwright/fixtures/image/shot.png', naturalWidth: 800, naturalHeight: 600 },
      }], theme);
      await page.locator('[data-blok-tool="image"] img').hover();
      await page.locator('[data-blok-tool="image"] [data-action="alt-edit"]').click();
      const textarea = page.locator('[data-role="image-alt-popover"]').getByRole('textbox');

      await expect(textarea).toBeVisible();
      await expectBlokField(textarea, textarea, 'text', { multiline: true });
      await expect(textarea).toHaveAttribute('rows', '2');
    });

    test('media "paste a link" bar is the shared text field', async ({ page }) => {
      await mount(page, [{ type: 'image', data: {} }], theme);
      const block = page.locator('[data-blok-tool="image"]');

      await block.locator('[data-tab="embed"]').click();
      const input = block.getByRole('textbox');

      await expect(input).toBeVisible();
      // The bar around the URL input is the field.
      await expectBlokField(input.locator('xpath=..'), input, 'text');
    });
  });
}
