import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

const openHeadingMenu = async (page: Page, theme: 'light' | 'dark' | 'system-dark', tokens: Record<string, string> = {}): Promise<void> => {
  await page.evaluate(async ({ styleTokens, mode }) => {
    const holder = document.createElement('div');

    holder.id = 'menu-theme-tokens';
    holder.style.cssText = 'max-width:650px;margin:120px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      theme: mode === 'system-dark' ? 'auto' : mode,
      style: { tokens: styleTokens },
      data: {
        blocks: [{ type: 'header', data: { text: 'Theme token heading', level: 1 } }],
      },
    });
    await window.blokInstance.isReady;
  }, { styleTokens: tokens, mode: theme });
  await page.getByRole('heading', { name: 'Theme token heading', exact: true }).click();
  await page.getByTestId('settings-toggler').click();
  await expect(page.getByRole('menuitemradio', { name: 'Heading 1', exact: true })).toBeVisible();
};

for (const theme of ['light', 'dark', 'system-dark'] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
      await gotoTestPage(page);
    });

    test('public active color tokens stay paired at rest, on hover, and on keyboard focus', async ({ page }) => {
      await openHeadingMenu(page, theme, {
        '--blok-icon-active-bg': '#222',
        '--blok-icon-active-text': '#fff',
      });
      const selected = page.getByRole('menuitemradio', { name: 'Heading 1', exact: true });
      const other = page.getByRole('menuitemradio', { name: 'Heading 2', exact: true });

      await expect(selected).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(selected).toHaveCSS('background-color', 'rgb(34, 34, 34)');
      await expect(selected).toHaveAttribute('aria-checked', 'true');
      await expect(other).not.toHaveCSS('background-color', 'rgb(34, 34, 34)');

      await selected.hover();
      await expect(selected).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(selected).toHaveCSS('background-color', 'rgb(34, 34, 34)');

      await page.getByTestId('block-tunes-popover').getByRole('combobox').focus();
      await page.keyboard.press('ArrowDown');
      await expect(selected).toHaveAttribute('data-blok-focused', 'true');
      await expect(selected).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(selected).toHaveCSS('background-color', 'rgb(34, 34, 34)');
      await expect(selected).toHaveCSS('outline-style', 'solid');
      await expect(selected).toHaveCSS('outline-width', '2px');

      await page.keyboard.press('ArrowDown');
      await expect(other).toHaveAttribute('data-blok-focused', 'true');
      await expect(other).not.toHaveCSS('background-color', 'rgb(34, 34, 34)');
      await expect(selected).toHaveAttribute('aria-checked', 'true');
    });

    test('default selected heading labels keep AA contrast and their selected background', async ({ page }) => {
      await openHeadingMenu(page, theme);
      const selected = page.getByRole('menuitemradio', { name: 'Heading 1', exact: true });
      const background = await selected.evaluate(el => getComputedStyle(el).backgroundColor);
      const scan = async (): Promise<void> => {
        const result = await new AxeBuilder({ page })
          .include('[data-blok-testid="block-tunes-popover"]')
          .withRules(['color-contrast'])
          .analyze();

        expect(result.violations).toEqual([]);
        const contrast = await selected.evaluate(element => {
          const container = element.closest('[data-blok-popover-container]');

          if (!container) {
            throw new Error('Missing heading menu surface');
          }
          const rgb = (value: string): number[] => value.match(/[\d.]+/g)?.map(Number) ?? [];
          const style = getComputedStyle(element);
          const foreground = rgb(style.color);
          const background = rgb(style.backgroundColor);
          const surface = rgb(getComputedStyle(container).backgroundColor);
          const alpha = background[3] ?? 1;
          const painted = background.slice(0, 3).map((channel, index) =>
            channel * alpha + surface[index] * (1 - alpha)
          );
          const luminance = (channels: number[]): number => channels.reduce((sum, channel, index) => {
            const normalized = channel / 255;
            const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;

            return sum + linear * [0.2126, 0.7152, 0.0722][index];
          }, 0);
          const text = luminance(foreground.slice(0, 3));
          const ground = luminance(painted);

          return (Math.max(text, ground) + 0.05) / (Math.min(text, ground) + 0.05);
        });

        expect(contrast).toBeGreaterThanOrEqual(4.5);
      };

      await expect(selected).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await scan();

      await selected.hover();
      await expect(selected).toHaveCSS('background-color', background);
      await scan();

      await page.getByTestId('block-tunes-popover').getByRole('combobox').focus();
      await page.keyboard.press('ArrowDown');
      await expect(selected).toHaveAttribute('data-blok-focused', 'true');
      await expect(selected).toHaveCSS('background-color', background);
      await scan();
    });
  });
}
