import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened="true"]';

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const openLinkField = async (page: Page, paragraph: Locator, text: string): Promise<Locator> => {
  await paragraph.evaluate((element, target) => {
    const node = Array.from(element.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(target));

    if (!node) {
      throw new Error(`"${target}" not found`);
    }

    const start = node.textContent?.indexOf(target) ?? 0;
    const range = document.createRange();

    range.setStart(node, start);
    range.setEnd(node, start + target.length);
    (element as HTMLElement).focus();
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, text);
  await page.locator(LINK_BUTTON_SELECTOR).click();

  const input = page.locator(LINK_INPUT_SELECTOR);

  await expect(input).toBeVisible();

  return input;
};

test.describe('link field: headings and link kinds', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate(() => localStorage.removeItem('blok-recent-links'));
  });

  test('links a heading found by typing, and the link jumps to it in the same tab', async ({ page }) => {
    await createBlok(page, [
      { id: 'intro', type: 'header', data: { text: 'Introduction', level: 2 } },
      { type: 'paragraph', data: { text: 'see below' } },
      { id: 'setup', type: 'header', data: { text: 'Setup guide', level: 3 } },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'see below' });
    const input = await openLinkField(page, paragraph, 'below');
    const rows = page.getByRole('option');

    await expect(page.getByRole('group', { name: 'On this page' })).toBeVisible();
    await expect(rows).toHaveText(['Introduction', 'Setup guide']);

    await input.pressSequentially('setup');
    await expect(rows).toHaveText(['Setup guide']);
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');

    const link = paragraph.getByRole('link', { name: 'below' });

    await expect(link).toHaveAttribute('href', '#setup');
    await expect(link).toHaveAttribute('target', '_self');
  });

  test('offers the link kinds when there are no headings or recent links', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'mail me' } }]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'mail me' });
    const input = await openLinkField(page, paragraph, 'mail');
    const rows = page.getByRole('option');

    await expect(rows).toHaveCount(2);
    await rows.nth(1).click();

    await expect(input).toHaveValue('mailto:');
    await expect(input).toBeFocused();

    await input.pressSequentially('hi@example.com');
    await input.press('Enter');

    await expect(paragraph.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:hi@example.com');
  });
});
