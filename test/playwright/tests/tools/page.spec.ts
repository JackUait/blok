import { test as isolatedTest, type Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok, saveBlok } from './columns-blocks/_helpers';

type PageInfo = { title?: string; icon?: { type: 'emoji'; value: string }; access?: 'none' } | null;

interface PageCalls {
  open: { pageId: string; hasEvent: boolean }[];
  create: { pageId: string }[];
  resolve: string[];
  href: string[];
}

declare global {
  interface Window {
    __pageCalls?: PageCalls;
    __pageSearchQueries?: string[];
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
  href?: string;
}

/** Builds an editor whose page tool records every host call on `window.__pageCalls`. */
const createPageEditor = async (page: Page, { data, readOnly = false, pages, href }: EditorOptions): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(
    async ({ holder, initialData, ro, known, pageHref }) => {
      const calls: PageCalls = { open: [], create: [], resolve: [], href: [] };

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
              ...(pageHref === undefined
                ? {}
                : {
                  href: (pageId: string) => {
                    calls.href.push(pageId);

                    return pageHref;
                  },
                }),
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
    { holder: HOLDER_ID, initialData: data, ro: readOnly, known: pages ?? null, pageHref: href }
  );
};

const calls = async (page: Page): Promise<PageCalls> =>
  await page.evaluate(() => window.__pageCalls ?? { open: [], create: [], resolve: [], href: [] });

const pageBlock = (pageId: string, cache?: { title?: string; icon?: { type: 'emoji'; value: string } }): OutputData => ({
  blocks: [
    { id: 'intro', type: 'paragraph', data: { text: 'Above the page.' } },
    { id: 'link', type: 'page', data: { pageId, ...(cache !== undefined && { cache }) } },
  ],
});

const enterPageFromNavigation = async (page: Page): Promise<void> => {
  await page.getByText('Above the page.', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('block-wrapper').filter({ has: page.getByTestId('page-link') }))
    .toHaveAttribute('data-blok-navigation-focused', 'true');
  await page.keyboard.press('Enter');
};

test.describe('Page block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders the host-resolved title and icon instead of legacy cached metadata', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Old name', icon: { type: 'emoji', value: '🔒' } }),
      pages: { roadmap: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } } },
    });

    const link = page.getByTestId('page-link');

    await expect(link.getByTestId('page-title')).toHaveText('Roadmap');
    await expect(link.getByTestId('page-icon')).toHaveText('🗺️');
    await expect(link).not.toContainText('Old name');
    await expect(link).not.toContainText('🔒');
    await expect(link).toHaveAttribute('data-blok-page-state', 'normal');
  });

  test('resolve refreshes a stale cached title without saving host metadata', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Old name' }),
      pages: { roadmap: { title: 'Q4 roadmap', icon: { type: 'emoji', value: '🚀' } } },
    });

    await expect(page.getByTestId('page-title')).toHaveText('Q4 roadmap');
    await expect(page.getByTestId('page-icon')).toHaveText('🚀');

    const saved = await saveBlok(page);

    expect(saved.blocks.find((block) => block.type === 'page')?.data).toEqual({ pageId: 'roadmap' });
  });

  test('a plain click calls open with the page id', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Old name' }),
      pages: { roadmap: { title: 'Roadmap' } },
    });

    await expect(page.getByTestId('page-link')).toHaveAttribute('data-blok-page-state', 'normal');
    await page.getByTestId('page-link').click();

    await expect.poll(async () => (await calls(page)).open).toEqual([{ pageId: 'roadmap', hasEvent: true }]);
  });

  test('a modifier click leaves the page to the browser and does not call open', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Old name' }),
      pages: { roadmap: { title: 'Roadmap' } },
      href: '/pages/roadmap',
    });

    await expect(page.getByTestId('page-link')).toHaveAttribute('data-blok-page-state', 'normal');
    await expect(page.getByTestId('page-link')).toHaveAttribute('href', '/pages/roadmap');
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
      href: '/pages/gone',
    });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'missing');
    await expect(link.getByTestId('page-title')).toHaveText('Page not found');
    await expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(await link.getAttribute('href')).toBeNull();

    await link.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await enterPageFromNavigation(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await calls(page)).open).toEqual([]);
    expect((await calls(page)).href).toEqual([]);
  });

  test('unresolved legacy page metadata stays neutral and opens no denial dialog', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('unknown', { title: 'Stale private title', icon: { type: 'emoji', value: '🔒' } }),
      href: '/pages/unknown',
    });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'unresolved');
    await expect(link.getByTestId('page-title')).toHaveText('Page');
    await expect(link).not.toContainText('Stale private title');
    await expect(link).not.toContainText('🔒');
    expect(await link.getAttribute('href')).toBeNull();

    await link.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await enterPageFromNavigation(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await calls(page)).open).toEqual([]);
    expect((await calls(page)).href).toEqual([]);
  });

  test('resolve answering access none shows "No access" and hides the cached title', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('secret', { title: 'Salaries' }),
      pages: { secret: { access: 'none' } },
      href: '/pages/secret',
    });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'no-access');
    await expect(link.getByTestId('page-title')).toHaveText('No access');
    expect(await link.getByTestId('page-icon').evaluate(icon => icon.getElementsByTagName('rect').length)).toBe(1);
    expect(await link.getAttribute('href')).toBeNull();
    await expect(link).toHaveAttribute('role', 'button');
    await expect(link).toHaveAttribute('aria-haspopup', 'dialog');
    expect(await link.getAttribute('aria-disabled')).toBeNull();
    await expect(page.getByText('Salaries')).toHaveCount(0);
    expect((await calls(page)).href).toEqual([]);
  });

  test('denied click opens one accessible dialog and restores focus after Escape or Close', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('secret', { title: 'Salaries' }),
      pages: { secret: { access: 'none' } },
      href: '/pages/secret',
    });

    const intro = page.getByText('Above the page.', { exact: true });
    const link = page.getByTestId('page-link');
    const dialog = page.getByRole('dialog', { name: 'You can’t open this page' });

    await intro.focus();
    await expect(intro).toBeFocused();
    await link.click();

    await expect(dialog).toHaveCount(1);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('You don’t have access to this page. Ask the page owner for access.');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    expect((await calls(page)).open).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(intro).toBeFocused();

    await link.click();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(intro).toBeFocused();
    expect((await calls(page)).open).toEqual([]);
    expect((await calls(page)).href).toEqual([]);
  });

  test('denied navigation Enter opens the explanation without opening the page', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('secret'),
      pages: { secret: { access: 'none' } },
      href: '/pages/secret',
    });

    await enterPageFromNavigation(page);

    const dialog = page.getByRole('dialog', { name: 'You can’t open this page' });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    expect((await calls(page)).open).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect((await calls(page)).open).toEqual([]);
    expect((await calls(page)).href).toEqual([]);
  });

  test('a resolved page without a title shows the New page placeholder', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('blank'),
      pages: { blank: {} },
    });

    const link = page.getByTestId('page-link');

    await expect(link).toHaveAttribute('data-blok-page-state', 'untitled');
    await expect(link.getByTestId('page-title')).toHaveText('New page');
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

  test('read-only renders the host-resolved page and a click still opens it', async ({ page }) => {
    await createPageEditor(page, {
      data: pageBlock('roadmap', { title: 'Old name' }),
      pages: { roadmap: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } } },
      readOnly: true,
    });

    const link = page.getByTestId('page-link');

    await expect(link.getByTestId('page-title')).toHaveText('Roadmap');
    await link.click();

    await expect.poll(async () => (await calls(page)).open).toEqual([{ pageId: 'roadmap', hasEvent: true }]);
  });
});

isolatedTest('inline page reference follows a two-tab rename and denial without leaking to clipboard', async ({ page, context }) => {
  isolatedTest.setTimeout(60_000);
  const registryKey = 'test-page:roadmap';
  const changeEvent = 'test-page-change';
  const other = await context.newPage();
  const createSharedEditor = async (tab: Page, data: OutputData): Promise<void> => {
    await resetBlok(tab);
    await tab.evaluate(async ({ holder, initialData, key, eventName }) => {
      const read = (): PageInfo => {
        const value = localStorage.getItem(key);

        return value === null ? null : JSON.parse(value) as PageInfo;
      };
      const tracked: PageCalls = { open: [], create: [], resolve: [], href: [] };

      window.__pageCalls = tracked;
      window.__pageSearchQueries = [];
      const blok = new window.Blok({
        holder,
        data: initialData,
        tools: {
          page: {
            class: window.defaultBlockTools.page.class,
            config: {
              open: (pageId: string, ctx: { event?: Event }) => tracked.open.push({ pageId, hasEvent: ctx.event !== undefined }),
              href: (pageId: string) => `/pages/${pageId}`,
              resolve: (pageId: string) => {
                tracked.resolve.push(pageId);

                return pageId === 'roadmap' ? read() : null;
              },
              search: async (query: string) => {
                window.__pageSearchQueries?.push(query);
                const info = read();

                return info !== null && info.access !== 'none' && info.title?.toLowerCase().includes(query.toLowerCase())
                  ? [{ pageId: 'roadmap', title: info.title, icon: info.icon }]
                  : [];
              },
              subscribe: (pageId: string, notify: () => void) => {
                const onStorage = (event: StorageEvent): void => {
                  if (pageId === 'roadmap' && event.key === key) {
                    notify();
                  }
                };
                const onLocal = (): void => {
                  if (pageId === 'roadmap') {
                    notify();
                  }
                };

                window.addEventListener('storage', onStorage);
                window.addEventListener(eventName, onLocal);

                return () => {
                  window.removeEventListener('storage', onStorage);
                  window.removeEventListener(eventName, onLocal);
                };
              },
            },
          },
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, { holder: HOLDER_ID, initialData: data, key: registryKey, eventName: changeEvent });
  };

  try {
    await gotoTestPage(page);
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } }));
    }, registryKey);
    await createSharedEditor(page, {
      blocks: [
        { id: 'intro', type: 'paragraph', data: { text: 'See' } },
        { id: 'link', type: 'page', data: { pageId: 'roadmap' } },
      ],
    });

    const paragraph = page.getByTestId('block-wrapper').first();

    await paragraph.evaluate((block) => {
      const editable = block.querySelector('[contenteditable="true"]');

      if (!(editable instanceof HTMLElement)) {
        throw new Error('Editable paragraph not found');
      }
      editable.focus();
      const range = document.createRange();

      range.selectNodeContents(editable);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await page.keyboard.type(' [[road');
    await expect.poll(async () => page.evaluate(() => window.__pageSearchQueries ?? [])).toContain('road');
    await page.getByRole('option', { name: 'Roadmap' }).click();
    await expect(paragraph.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('data-blok-page-id', 'roadmap');

    const beforeRename = await saveBlok(page);
    const savedText = beforeRename.blocks.find((block) => block.id === 'intro')?.data.text;

    expect(savedText).toContainEqual({ embed: { page: { id: 'roadmap' } } });
    expect(JSON.stringify(savedText)).not.toContain('Roadmap');
    expect(beforeRename.blocks.find((block) => block.id === 'link')?.data).toEqual({ pageId: 'roadmap' });

    await gotoTestPage(other);
    await createSharedEditor(other, beforeRename);
    const otherParagraph = other.getByTestId('block-wrapper').first();

    await expect(otherParagraph.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('data-blok-page-id', 'roadmap');
    await expect(other.getByTestId('page-title')).toHaveText('Roadmap');

    await other.evaluate(({ key, eventName }) => {
      localStorage.setItem(key, JSON.stringify({ title: 'Q4 Roadmap', icon: { type: 'emoji', value: '🚀' } }));
      window.dispatchEvent(new Event(eventName));
    }, { key: registryKey, eventName: changeEvent });

    for (const tab of [page, other]) {
      await expect(tab.getByTestId('block-wrapper').first().getByRole('link', { name: 'Q4 Roadmap' }))
        .toHaveAttribute('data-blok-page-id', 'roadmap');
      await expect(tab.getByTestId('page-title')).toHaveText('Q4 Roadmap');
      await expect(tab.getByTestId('page-icon')).toHaveText('🚀');
      const saved = await saveBlok(tab);

      expect(saved.blocks.find((block) => block.id === 'intro')?.data.text).toEqual(savedText);
      expect(saved.blocks.find((block) => block.id === 'link')?.data).toEqual({ pageId: 'roadmap' });
    }

    await other.evaluate(({ key, eventName }) => {
      localStorage.setItem(key, JSON.stringify({ access: 'none' }));
      window.dispatchEvent(new Event(eventName));
    }, { key: registryKey, eventName: changeEvent });

    for (const tab of [page, other]) {
      await expect(tab.getByTestId('block-wrapper').first()).toContainText('No access');
      await expect(tab.getByTestId('page-title')).toHaveText('No access');
      await expect(tab.getByTestId('block-wrapper').first()).not.toContainText('Roadmap');
      await expect(tab.getByTestId('block-wrapper').first()).not.toContainText('🚀');
      await expect(tab.getByTestId('page-link')).not.toContainText('Roadmap');
      await expect(tab.getByTestId('page-link')).not.toContainText('🚀');
    }

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await paragraph.evaluate((block) => {
      const editable = block.querySelector('[contenteditable="true"]');

      if (!(editable instanceof HTMLElement)) {
        throw new Error('Editable paragraph not found');
      }
      editable.focus();
      const range = document.createRange();

      range.selectNodeContents(editable);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+C');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());

    expect(clipboard).toContain('No access');
    expect(clipboard).not.toContain('Roadmap');
    expect(clipboard).not.toContain('🚀');

    await paragraph.evaluate((element) => {
      const reference = element.querySelector('[data-blok-page-id="roadmap"]');

      if (!(reference instanceof HTMLElement)) {
        throw new Error('Inline page reference not found');
      }
      reference.focus();
    });
    await page.keyboard.press('Enter');
    expect((await calls(page)).open).toEqual([]);
    await expect(page).toHaveURL(/fixtures\/test\.html/);
  } finally {
    await other.close();
  }
});
