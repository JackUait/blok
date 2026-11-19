import type { Locator, Page } from '@playwright/test';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok } from '../tools/columns-blocks/_helpers';

/** The link field's "Pages" section: the host's pages, linked as ordinary links. */

declare global {
  interface Window {
    defaultBlockTools: Record<string, { class: unknown }>;
    linkPagesHost: { queries: string[] };
  }
}

const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened="true"]';
const PAGE_ROW_SELECTOR = '[data-link-page-row]';

const createEditor = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    const pages = [
      { pageId: 'roadmap', title: 'Roadmap', path: ['Work', 'Team'], icon: { type: 'emoji' as const, value: '🗺️' } },
      { pageId: 'notes', title: 'Meeting notes', path: ['Work'] },
      { pageId: 'secret', title: 'Roadmap secrets', access: 'none' as const },
    ];
    const host: Window['linkPagesHost'] = { queries: [] };

    window.linkPagesHost = host;

    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          { id: 'intro', type: 'header', data: { text: 'Road ahead', level: 2 } },
          { id: 'target', type: 'paragraph', data: { text: 'see the plan' } },
        ],
      },
      tools: {
        page: {
          class: window.defaultBlockTools.page.class,
          config: {
            search: async (query: string) => {
              host.queries.push(query);

              return pages.filter((entry) => entry.title.toLowerCase().includes(query.toLowerCase()));
            },
            href: (pageId: string) => `https://app.example.test/p/${pageId}`,
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openLinkField = async (page: Page, text: string): Promise<Locator> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'see the plan' });

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

test.describe('link field: pages', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate(() => localStorage.removeItem('blok-recent-links'));
    await createEditor(page);
  });

  test('lists the host pages under "Pages", above the headings, with path and own icon', async ({ page }) => {
    await openLinkField(page, 'the plan');

    const section = page.getByRole('group', { name: 'Pages' });
    const rows = section.locator(PAGE_ROW_SELECTOR);

    await expect(section).toBeVisible();
    await expect(rows.locator('[data-link-page-title]')).toHaveText(['Roadmap', 'Meeting notes']);
    await expect(rows.nth(0).locator('[data-link-page-meta]')).toHaveText('Work / Team');
    await expect(rows.nth(0).locator('[data-link-page-icon]')).toHaveText('🗺️');
    // A page without an icon shows the page glyph, at the icon's size.
    // The laid-out width: the menu scales in, so a measured box is smaller for a moment.
    const glyphWidth = await rows.nth(1).locator('[data-link-page-icon]').evaluate((icon) => {
      const glyph = icon.querySelector('svg');

      return glyph ? getComputedStyle(glyph).width : null;
    });
    const [withIcon, plain] = await rows.locator('[data-link-page-title]').evaluateAll((titles) =>
      titles.map((title) => (title instanceof HTMLElement ? title.offsetLeft : null)));

    expect(glyphWidth).toBe('16px');
    expect(withIcon).not.toBeNull();
    expect(plain).toBe(withIcon);

    const [pagesBox, headingsBox] = [await section.boundingBox(), await page.getByRole('group', { name: 'On this page' }).boundingBox()];

    expect((pagesBox?.y ?? 0) + (pagesBox?.height ?? 0)).toBeLessThanOrEqual((headingsBox?.y ?? 0) + 0.5);
    expect(await page.evaluate(() => window.linkPagesHost.queries)).toEqual(['']);
  });

  test('searches pages by typing and links the selected words to the picked page, as an ordinary link', async ({ page }) => {
    const input = await openLinkField(page, 'the plan');
    const rows = page.locator(PAGE_ROW_SELECTOR);

    await input.pressSequentially('meet');

    await expect(rows.locator('[data-link-page-title]')).toHaveText(['Meeting notes']);
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'see the plan' });
    const link = paragraph.getByRole('link', { name: 'the plan' });

    await expect(link).toHaveAttribute('href', 'https://app.example.test/p/notes');
    await expect(link).not.toHaveAttribute('data-blok-page-id', /.*/);
    await expect(paragraph).toHaveText('see the plan');
    expect(await page.evaluate(() => localStorage.getItem('blok-recent-links'))).toBeNull();

    const saved = await page.evaluate(async () => JSON.stringify(await window.blokInstance?.save()));

    expect(saved).toContain('https://app.example.test/p/notes');
    expect(saved).toContain('the plan');
  });

  test('applies a page on click, and never lists a page the user may not see', async ({ page }) => {
    const input = await openLinkField(page, 'the plan');
    const rows = page.locator(PAGE_ROW_SELECTOR);

    await input.pressSequentially('road');

    // "Roadmap secrets" matches too, but the host marked it out of reach.
    await expect(rows.locator('[data-link-page-title]')).toHaveText(['Roadmap']);
    await rows.first().click();

    await expect(page.locator(PARAGRAPH_SELECTOR, { hasText: 'see the plan' }).getByRole('link', { name: 'the plan' }))
      .toHaveAttribute('href', 'https://app.example.test/p/roadmap');
  });

  test('keeps Enter on a typed web link', async ({ page }) => {
    const input = await openLinkField(page, 'the plan');

    await expect(page.locator(PAGE_ROW_SELECTOR)).toHaveCount(2);
    await input.fill('https://example.com/docs');

    await expect(page.locator(PAGE_ROW_SELECTOR)).toHaveCount(0);
    await input.press('Enter');

    await expect(page.locator(PARAGRAPH_SELECTOR, { hasText: 'see the plan' }).getByRole('link', { name: 'the plan' }))
      .toHaveAttribute('href', 'https://example.com/docs');
  });
});
