import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok, saveBlok } from './columns-blocks/_helpers';

type PageInfo = { title?: string; icon?: { type: 'emoji'; value: string }; access?: 'none' } | null;

interface PageCalls {
  open: { pageId: string; hasEvent: boolean }[];
  create: { pageId: string }[];
  resolve: string[];
}

declare global {
  interface Window {
    __pageCalls?: PageCalls;
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

interface EditorOptions {
  data: OutputData;
  readOnly?: boolean;
  /** What `resolve` answers per page id. Ids not listed answer `undefined`. */
  pages?: Record<string, PageInfo>;
}

/** Builds an editor whose page tool records every host call on `window.__pageCalls`. */
const createPageEditor = async (page: Page, { data, readOnly = false, pages }: EditorOptions): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(
    async ({ holder, initialData, ro, known }) => {
      const calls: PageCalls = { open: [], create: [], resolve: [] };

      window.__pageCalls = calls;

      const blok = new window.Blok({
        holder,
        readOnly: ro,
        data: initialData,
        tools: {
          page: {
            class: window.defaultBlockTools.page.class,
            config: {
              open: (pageId: string, ctx: { event?: Event }) => {
                calls.open.push({ pageId, hasEvent: ctx.event !== undefined });
              },
              create: ({ pageId }: { pageId: string }) => {
                calls.create.push({ pageId });
              },
              ...(known === null
                ? {}
                : {
                  resolve: (pageId: string) => {
                    calls.resolve.push(pageId);

                    return pageId in known ? known[pageId] : undefined;
                  },
                }),
            },
          },
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data, ro: readOnly, known: pages ?? null }
  );
};

const calls = async (page: Page): Promise<PageCalls> =>
  await page.evaluate(() => window.__pageCalls ?? { open: [], create: [], resolve: [] });

const pageBlock = (pageId: string, cache?: { title?: string; icon?: { type: 'emoji'; value: string } }): OutputData => ({
  blocks: [
    { id: 'intro', type: 'paragraph', data: { text: 'Above the page.' } },
    { id: 'link', type: 'page', data: { pageId, ...(cache !== undefined && { cache }) } },
  ],
});

test.describe('Page block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders the cached title and emoji icon from saved data', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } }),
    });

    const link = page.getByTestId('page-link');

    await expect(link.getByTestId('page-title')).toHaveText('Roadmap');
    await expect(link.getByTestId('page-icon')).toHaveText('🗺️');
    await expect(link).toHaveAttribute('data-blok-page-state', 'normal');
  });

  test('resolve refreshes a stale cached title and the fresh copy is saved', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Old name' }),
      pages: { roadmap: { title: 'Q4 roadmap', icon: { type: 'emoji', value: '🚀' } } },
    });

    await expect(page.getByTestId('page-title')).toHaveText('Q4 roadmap');
    await expect(page.getByTestId('page-icon')).toHaveText('🚀');

    const saved = await saveBlok(page);

    expect(saved.blocks.find((block) => block.type === 'page')?.data).toEqual({
      pageId: 'roadmap',
      cache: { title: 'Q4 roadmap', icon: { type: 'emoji', value: '🚀' } },
    });
  });

  test('a plain click calls open with the page id', async ({ page }) => {
    await createPageEditor(page, { data: pageBlock('roadmap', { title: 'Roadmap' }) });

    await page.getByTestId('page-link').click();

    await expect.poll(async () => (await calls(page)).open).toEqual([{ pageId: 'roadmap', hasEvent: true }]);
  });

  test('a modifier click leaves the page to the browser and does not call open', async ({ page }) => {
    await createPageEditor(page, { data: pageBlock('roadmap', { title: 'Roadmap' }) });

    await page.getByTestId('page-link').click({ modifiers: ['ControlOrMeta'] });
    await page.getByTestId('page-link').click({ modifiers: ['Shift'] });

    // Give a wrongly wired handler the chance to fire before asserting nothing did.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect((await calls(page)).open).toEqual([]);
  });

  test('resolve answering null shows "Page not found" and the link no longer opens', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('gone', { title: 'Deleted page' }),
      pages: { gone: null },
    });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'missing');
    await expect(link.getByTestId('page-title')).toHaveText('Page not found');
    await expect(link).toHaveAttribute('aria-disabled', 'true');

    await link.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect((await calls(page)).open).toEqual([]);
  });

  test('resolve answering access none shows "No access" and hides the cached title', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('secret', { title: 'Salaries' }),
      pages: { secret: { access: 'none' } },
    });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'no-access');
    await expect(link.getByTestId('page-title')).toHaveText('No access');
    await expect(page.getByText('Salaries')).toHaveCount(0);
  });

  test('a page without a title shows the Untitled placeholder', async ({ page }) => {
    await createPageEditor(page, { data: pageBlock('blank') });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'untitled');
    await expect(link.getByTestId('page-title')).toHaveText('Untitled');
  });

  test('inserting from the toolbox mints a page id, creates the page once and opens it once', async ({ page }) => {
    await createPageEditor(page, {
      data: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }] },
    });

    await page.locator('[data-blok-interface=blok] [contenteditable]').first().focus();
    await page.keyboard.type('/page');

    const popover = page.getByTestId('toolbox-popover');

    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
    await popover.locator('[data-blok-item-name="page"]').click();

    await expect(page.getByTestId('page-link')).toHaveCount(1);
    await expect.poll(async () => (await calls(page)).open.length).toBe(1);

    const { create, open } = await calls(page);

    expect(open).toHaveLength(1);
    expect(create).toHaveLength(1);
    expect(create[0].pageId).toMatch(/\S/);
    expect(open[0].pageId).toBe(create[0].pageId);

    const saved = await saveBlok(page);
    const pages = saved.blocks.filter((block) => block.type === 'page');

    expect(pages).toHaveLength(1);
    expect(pages[0].data.pageId).toBe(create[0].pageId);
    expect(pages[0].data).not.toHaveProperty('title');
  });

  test('loading saved page blocks never calls create or open', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Roadmap' }),
      pages: { roadmap: { title: 'Roadmap' } },
    });

    await expect.poll(async () => (await calls(page)).resolve).toEqual(['roadmap']);

    const { create, open } = await calls(page);

    expect(create).toEqual([]);
    expect(open).toEqual([]);
  });

  test('read-only renders the page and a click still opens it', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } }),
      readOnly: true,
    });

    const link = page.getByTestId('page-link');

    await expect(link.getByTestId('page-title')).toHaveText('Roadmap');
    await link.click();

    await expect.poll(async () => (await calls(page)).open).toEqual([{ pageId: 'roadmap', hasEvent: true }]);
  });
});
