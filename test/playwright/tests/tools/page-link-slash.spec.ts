import type { Page } from '@playwright/test';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok, saveRaw } from './columns-blocks/_helpers';

/** "/" Link to page: pick a page from a list with its own search field. */

declare global {
  interface Window {
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createEditor = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    // The fixture's default tools leave page-link out. A variable keeps tsc from resolving the built bundle.
    const toolsUrl = '/dist/tools.mjs?_v=1';
    const { PageLink } = await import(toolsUrl) as { PageLink: unknown };
    const pages = [
      { pageId: 'roadmap', title: 'Roadmap', path: ['Work', 'Team'], status: 'draft' as const },
      { pageId: 'notes', title: 'Meeting notes', path: ['Work'] },
    ];
    const config = {
      search: (query: string) => Promise.resolve(pages.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))),
      resolve: (pageId: string) => {
        const hit = pages.find((p) => p.pageId === pageId);

        return hit === undefined ? null : { title: hit.title, path: hit.path, status: hit.status };
      },
    };
    const blok = new window.Blok({
      holder,
      data: { blocks: [{ id: 'target', type: 'paragraph', data: { text: '' } }] },
      tools: {
        page: { class: window.defaultBlockTools.page.class, config },
        'page-link': { class: PageLink, config },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openLinkToPage = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-element-content] [contenteditable="true"]').first().click();
  await page.keyboard.type('/link');
  await expect(page.getByRole('option', { name: 'Link to page' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-picker-search-input')).toBeFocused();
};

test.describe('Link to page from the "/" menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createEditor(page);
  });

  test('searches pages and inserts a link to the picked one', async ({ page }) => {
    await openLinkToPage(page);

    const options = page.getByTestId('page-picker-option');

    await expect(options).toHaveCount(2);
    await expect(options.first().getByTestId('page-picker-option-path')).toHaveText(/Work.*Team/);
    await expect(options.first().getByTestId('page-draft-badge')).toBeVisible();

    await page.keyboard.type('meet');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Meeting notes');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('page-picker-search-input')).toHaveCount(0);
    await expect(page.getByTestId('page-link')).toContainText('Meeting notes');

    const saved = await saveRaw(page);

    expect(saved.blocks.map((block) => ({ type: block.type, data: block.data }))).toEqual([
      { type: 'page-link', data: { pageId: 'notes' } },
      // A block with no text input gets an empty line after it, as with any toolbox insert.
      { type: 'paragraph', data: { text: [] } },
    ]);
  });

  test('Escape inserts nothing and puts the caret back in the paragraph', async ({ page }) => {
    await openLinkToPage(page);
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('page-picker-search-input')).toHaveCount(0);
    await expect(page.getByTestId('page-link')).toHaveCount(0);

    const paragraph = page.locator('[data-blok-element-content] [contenteditable="true"]').first();

    await expect(paragraph).toBeFocused();
    await page.keyboard.type('x');
    await expect(paragraph).toHaveText('/linkx');

    const saved = await saveRaw(page);

    expect(saved.blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  test('a search with no match shows Nothing found', async ({ page }) => {
    await openLinkToPage(page);
    await page.keyboard.type('zzz');

    await expect(page.getByTestId('page-picker-option')).toHaveCount(0);
    // The closed slash menu keeps its own hidden empty state.
    await expect(page.getByTestId('popover-nothing-found').filter({ visible: true })).toHaveText('Nothing found');
  });
});
