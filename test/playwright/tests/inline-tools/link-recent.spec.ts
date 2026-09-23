import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened="true"]';
const RECENT_SELECTOR = '[data-link-recent]';
const RECENT_ROW_SELECTOR = '[data-link-recent-row]';
const LONG_TITLE = 'An extremely long page title that would stretch the link card far past its usual width if nothing held it';

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

    const blok = new window.Blok({
      holder,
      data: { blocks: blokBlocks },
      link: { unfurl: { endpoint: '/unfurl' } },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, target) => {
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
};

const openLinkField = async (page: Page, paragraph: Locator, text: string): Promise<Locator> => {
  await selectText(paragraph, text);
  await page.locator(LINK_BUTTON_SELECTOR).click();

  const input = page.locator(LINK_INPUT_SELECTOR);

  await expect(input).toBeVisible();

  return input;
};

test.describe('link field: recent links', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate(() => localStorage.removeItem('blok-recent-links'));
    await page.route('**/unfurl?url=*', async (route) => {
      const url = new URL(route.request().url()).searchParams.get('url') ?? '';
      const title = url.includes('long') ? LONG_TITLE : 'Example Domain';

      await route.fulfill({ json: { success: 1, meta: { title } } });
    });
  });

  test('shows an added link by its page title and applies it from the keyboard', async ({ page }) => {
    await createBlok(page, [
      { type: 'paragraph', data: { text: 'first' } },
      { type: 'paragraph', data: { text: 'second' } },
    ]);

    const first = page.locator(PARAGRAPH_SELECTOR, { hasText: 'first' });
    const second = page.locator(PARAGRAPH_SELECTOR, { hasText: 'second' });
    const input = await openLinkField(page, first, 'first');

    await input.fill('https://example.com/docs');
    await input.press('Enter');
    await expect(first.getByRole('link')).toHaveAttribute('href', 'https://example.com/docs');

    await expect.poll(() => page.evaluate(() => localStorage.getItem('blok-recent-links')))
      .toContain('Example Domain');

    const secondInput = await openLinkField(page, second, 'second');
    const recent = page.locator(RECENT_SELECTOR);
    const row = recent.locator(RECENT_ROW_SELECTOR);

    await expect(recent.getByText('Recent')).toBeVisible();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Example Domain');
    await expect(row).toContainText('example.com');

    await secondInput.press('ArrowDown');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(secondInput).toBeFocused();
    await secondInput.press('Enter');

    await expect(second.getByRole('link')).toHaveAttribute('href', 'https://example.com/docs');
  });

  test('walks rows with the arrows, hides the list while typing, and applies a row on click', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('blok-recent-links', JSON.stringify([
      { url: 'https://a.example.com/', title: 'Alpha page' },
      { url: 'https://b.example.com/', title: 'Beta page' },
    ])));
    await createBlok(page, [{ type: 'paragraph', data: { text: 'target' } }]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'target' });
    const input = await openLinkField(page, paragraph, 'target');
    const recent = page.locator(RECENT_SELECTOR);

    const rows = recent.locator(RECENT_ROW_SELECTOR);

    await expect(rows).toHaveText([/Alpha page/, /Beta page/]);

    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeFocused();

    await input.pressSequentially('x');
    await expect(recent).toBeHidden();
    await input.press('Backspace');
    await expect(recent).toBeVisible();

    await recent.locator(RECENT_ROW_SELECTOR, { hasText: 'Beta page' }).click();

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', 'https://b.example.com/');
  });

  test('truncates a long title instead of widening the card', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'target' } }]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'target' });
    const input = await openLinkField(page, paragraph, 'target');
    const widthWithoutHistory = await input.evaluate((el) => (el.closest('[data-blok-popover-container]') as HTMLElement).offsetWidth);

    await page.keyboard.press('Escape');
    await page.evaluate((title) => localStorage.setItem('blok-recent-links', JSON.stringify([
      { url: 'https://long.example.com/', title },
    ])), LONG_TITLE);

    const reopened = await openLinkField(page, paragraph, 'target');

    await expect(page.locator(RECENT_ROW_SELECTOR)).toBeVisible();

    const widthWithHistory = await reopened.evaluate((el) => (el.closest('[data-blok-popover-container]') as HTMLElement).offsetWidth);
    const titleIsClipped = await page.locator('[data-link-recent-title]').evaluate((el) => el.scrollWidth > el.clientWidth);

    expect(widthWithHistory).toBe(widthWithoutHistory);
    expect(titleIsClipped).toBe(true);
  });
});
