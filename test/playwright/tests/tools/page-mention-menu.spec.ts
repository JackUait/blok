import type { Locator, Page } from '@playwright/test';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok, saveRaw } from './columns-blocks/_helpers';

/** The "@" menu: Link to page and New page sections, as in Notion. */

declare global {
  interface Window {
    defaultBlockTools: Record<string, { class: unknown }>;
    mentionHost: {
      hold: boolean;
      release: () => void;
      created: Array<{ pageId: string; title?: string; parentId?: string }>;
    };
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createEditor = async (page: Page, createFromMention: boolean): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, createFromMention: offerNewPage }) => {
    const pages = [
      { pageId: 'roadmap', title: 'Roadmap', path: ['Work', 'Team'], status: 'draft' as const, icon: { type: 'emoji' as const, value: '🗺️' } },
      { pageId: 'notes', title: 'Meeting notes', path: ['Work'] },
      ...Array.from({ length: 7 }, (_, index) => ({ pageId: `recent-${index}`, title: `Recent ${index}` })),
    ];
    const waiting: Array<() => void> = [];
    const host: Window['mentionHost'] = {
      hold: false,
      release: () => waiting.splice(0).forEach((resume) => resume()),
      created: [],
    };

    window.mentionHost = host;

    const search = async (query: string): Promise<typeof pages> => {
      if (host.hold) {
        await new Promise<void>((resume) => waiting.push(resume));
      }

      return pages.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
    };
    const blok = new window.Blok({
      holder,
      data: { blocks: [{ id: 'target', type: 'paragraph', data: { text: 'See' } }] },
      tools: {
        page: {
          class: window.defaultBlockTools.page.class,
          config: {
            search,
            createFromMention: offerNewPage,
            create: (init: { pageId: string; title?: string; parentId?: string }) => {
              host.created.push({ pageId: init.pageId, title: init.title, ...(init.parentId !== undefined && { parentId: init.parentId }) });

              return { pageId: `created-${host.created.length}` };
            },
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, createFromMention });
};

const paragraph = (page: Page): Locator => page.locator('[data-blok-element-content] [contenteditable="true"]').first();

const typeInParagraph = async (page: Page, text: string): Promise<void> => {
  await paragraph(page).click();
  await page.keyboard.press('End');
  // "@" opens the menu only after a space or at the start.
  await page.keyboard.type(` ${text}`);
};

const queryPainted = (page: Page): Promise<boolean> =>
  page.evaluate(() => CSS.highlights.has('blok-page-mention-query'));

test.describe('"@" page menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('opens on "@" with a loading state, then lists recent pages', async ({ page }) => {
    await createEditor(page, true);
    await page.evaluate(() => {
      window.mentionHost.hold = true;
    });
    await typeInParagraph(page, '@');

    await expect(page.getByTestId('page-picker-spinner')).toBeVisible();
    await expect(page.getByTestId('page-picker-skeleton')).toHaveCount(2);
    await expect(page.getByTestId('page-picker-new-sub-page')).toHaveText('Add new sub-page');
    await expect(page.getByTestId('page-picker-new-page-in')).toHaveText('Add new page in…');
    expect(await queryPainted(page)).toBe(true);

    await page.evaluate(() => window.mentionHost.release());

    await expect(page.getByTestId('page-picker-spinner')).toHaveCount(0);
    await expect(page.getByTestId('page-picker-option')).toHaveCount(6);
    await expect(page.getByTestId('page-picker-more')).toHaveText('3 more results');
    await expect(page.getByTestId('page-picker-option').first().getByTestId('page-picker-option-icon')).toHaveText('🗺️');
  });

  test('filters as the query grows and shows each page\'s path', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@meet');

    const options = page.getByTestId('page-picker-option');

    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Meeting notes');
    await expect(options.first().getByTestId('page-picker-option-path')).toHaveText('Work');
    await expect(page.getByTestId('page-picker-new-sub-page')).toHaveText('New “meet” sub-page');
    expect(await page.getByTestId('page-picker-new-sub-page').evaluate((item) => item.querySelector('strong')?.textContent)).toBe('meet');
  });

  test('"more results" expands the list', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@');
    await expect(page.getByTestId('page-picker-option')).toHaveCount(6);

    await page.getByTestId('page-picker-more').click();

    await expect(page.getByTestId('page-picker-option')).toHaveCount(9);
    await expect(page.getByTestId('page-picker-more')).toHaveCount(0);
  });

  test('New “query” sub-page creates a titled page through the host and mentions it', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@Launch');
    await expect(page.getByTestId('page-picker-new-sub-page')).toHaveText('New “Launch” sub-page');

    await page.keyboard.press('Enter');

    await expect(paragraph(page).locator('[data-blok-page-id="created-1"]')).toHaveCount(1);
    await expect(page.getByTestId('page-picker-new-sub-page')).toHaveCount(0);
    const created = await page.evaluate(() => window.mentionHost.created);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: 'Launch' });
    expect(created[0]).not.toHaveProperty('parentId');
    expect((await saveRaw(page)).blocks[0]?.data).toEqual({ text: [{ text: 'See ' }, { embed: { page: { id: 'created-1' } } }] });
  });

  test('New “query” page in… asks for a parent, then creates the page under it', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@Launch');
    await page.getByTestId('page-picker-new-page-in').click();

    const field = page.getByTestId('page-picker-search-input');

    await expect(field).toBeFocused();
    await page.keyboard.type('meet');
    await expect(page.getByTestId('page-picker-option')).toHaveCount(1);
    await page.keyboard.press('Enter');

    await expect(paragraph(page).locator('[data-blok-page-id="created-1"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.mentionHost.created)).toEqual([
      expect.objectContaining({ title: 'Launch', parentId: 'notes' }),
    ]);
    await expect(paragraph(page)).not.toContainText('@Launch');
  });

  test('Escape closes the menu and keeps "@query" as text', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@roa');
    await expect(page.getByTestId('page-picker-option')).toHaveCount(1);

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('page-picker-option')).toHaveCount(0);
    await expect(paragraph(page)).toHaveText('See @roa');
    expect(await queryPainted(page)).toBe(false);
    expect(await page.evaluate(() => window.mentionHost.created)).toEqual([]);
  });

  test('with no page match, only the New page section shows', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@zzqx');

    await expect(page.getByTestId('page-picker-new-sub-page')).toBeVisible();
    await expect(page.locator('[data-blok-page-picker-section="link"]')).toHaveCount(0);
    await expect(page.locator('[data-blok-page-picker-section="new"]')).toHaveText('New page');
    await expect(page.getByTestId('popover-nothing-found')).toBeHidden();
  });

  test('says Nothing found when New page is off and no page matches', async ({ page }) => {
    await createEditor(page, false);
    await typeInParagraph(page, '@zzqx');

    await expect(page.getByTestId('popover-nothing-found')).toBeVisible();
    await expect(page.getByTestId('page-picker-new-sub-page')).toHaveCount(0);
  });

  test('the "@query" pill never reaches the saved document', async ({ page }) => {
    await createEditor(page, true);
    await typeInParagraph(page, '@roa');
    await expect(page.getByTestId('page-picker-option')).toHaveCount(1);
    expect(await queryPainted(page)).toBe(true);

    // The last keystroke stamps lastEditedAt a moment later; wait until it holds still.
    const settled = (): Promise<string> => page.evaluate(async () => {
      const save = async (): Promise<string> => JSON.stringify((await window.blokInstance?.save())?.blocks);
      const pause = (): Promise<void> => new Promise((resume) => setTimeout(resume, 600));
      const loop = async (previous: string): Promise<string> => {
        await pause();
        const next = await save();

        return next === previous ? next : loop(next);
      };

      return loop(await save());
    });
    const open = await settled();

    expect(await queryPainted(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('page-picker-option')).toHaveCount(0);

    expect(await settled()).toBe(open);
  });
});
