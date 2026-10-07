import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { expect, gotoTestPage, test } from './helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (list) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

const savedText = (page: Page): Promise<unknown> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return output?.blocks[0]?.data.text;
});

test.describe('rich text segments', () => {
  test('typing bold text saves segments', async ({ page }) => {
    await mount(page, [ { id: 'a', type: 'paragraph', data: { text: '' } } ]);

    // WebKit always reports a macOS user agent, so it wants Meta on every host.
    const isMac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));
    const paragraph = page.locator('[data-blok-id="a"] [contenteditable="true"]').first();

    await paragraph.click();
    await page.keyboard.type('plain ');
    await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+b`);
    await page.keyboard.type('bold');

    await expect.poll(() => savedText(page)).toEqual([
      { text: 'plain ' },
      { text: 'bold', marks: { bold: true } },
    ]);
  });

  test('segments loaded into the editor save back unchanged', async ({ page }) => {
    const text = [
      { text: 'a < b && "c" ' },
      { text: 'link', marks: { link: { href: 'https://example.com/', target: '_blank', rel: 'noopener noreferrer' } } },
    ];

    await mount(page, [ { id: 'a', type: 'paragraph', data: { text } } ]);

    await expect(page.getByTestId('blok').getByRole('link', { name: 'link' })).toBeVisible();
    expect(await savedText(page)).toEqual(text);
  });
});
