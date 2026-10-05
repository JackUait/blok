import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const mountEmptyEmbed = async (page: Page): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:80px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: [{ type: 'embed', data: {} }] } });
    await window.blokInstance.isReady;
  });
};

test.beforeAll(ensureBlokBundleBuilt);

test.describe('Embed empty state window', () => {
  test('names the provider of a typed link, then embeds it on Enter', async ({ page }) => {
    await page.route(/youtube\.com\/embed/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    await mountEmptyEmbed(page);

    const input = page.getByRole('textbox', { name: 'Paste a link to embed…' });
    const window = page.locator('[data-role="embed-window"]');

    await expect(window).toHaveAttribute('data-kind', 'idle');

    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    await expect(window).toHaveAttribute('data-kind', 'video');
    await expect(page.getByText('YouTube', { exact: true })).toBeVisible();

    await input.press('Enter');

    await expect(page.getByTestId('embed-frame')).toBeVisible();
    await expect(window).toHaveCount(0);
  });

  test('hides the window when the block is narrow', async ({ page }) => {
    await mountEmptyEmbed(page);
    await page.evaluate(() => {
      const holder = document.querySelector<HTMLElement>('[data-blok-tool="embed"]')?.closest<HTMLElement>('[data-blok-interface]')?.parentElement;

      if (holder) {
        holder.style.maxWidth = '320px';
      }
    });

    await expect(page.locator('[data-role="embed-window"]')).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Paste a link to embed…' })).toBeVisible();
  });
});
