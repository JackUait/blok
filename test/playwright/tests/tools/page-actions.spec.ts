import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok, saveBlok } from './columns-blocks/_helpers';

/**
 * The page block's menu matches Notion's: a "Page" section with Turn into,
 * Color, Edit icon and Rename, then the ways to open it, then Copy link,
 * Duplicate and Move to Trash.
 */

interface HostCalls {
  rename: Array<[string, string]>;
  icon: Array<[string, unknown]>;
  open: string[];
  newTab: string[];
  peek: string[];
}

declare global {
  interface Window {
    __hostCalls?: HostCalls;
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const DATA: OutputData = {
  blocks: [
    { id: 'intro', type: 'paragraph', data: { text: 'Above the page.' } },
    { id: 'link', type: 'page', data: { pageId: 'roadmap' } },
  ],
};

/** An editor whose host keeps titles in memory, like a real one, and records each call. */
const createEditor = async (page: Page, data: OutputData = DATA): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, data }) => {
    const calls: HostCalls = { rename: [], icon: [], open: [], newTab: [], peek: [] };
    const titles = new Map<string, string>([['roadmap', 'Roadmap']]);
    const icons = new Map<string, unknown>();

    window.open = (url?: string | URL) => {
      calls.newTab.push(String(url));

      return null;
    };
    const listeners = new Map<string, () => void>();

    window.__hostCalls = calls;

    const blok = new window.Blok({
      holder,
      data,
      tools: {
        page: {
          class: window.defaultBlockTools.page.class,
          config: {
            href: (pageId: string) => `https://workspace.test/pages/${pageId}`,
            resolve: (pageId: string) => titles.has(pageId) ? { title: titles.get(pageId), icon: icons.get(pageId) } : null,
            open: (pageId: string) => {
              calls.open.push(pageId);
            },
            subscribe: (pageId: string, onChange: () => void) => {
              listeners.set(pageId, onChange);
            },
            rename: (pageId: string, title: string) => {
              calls.rename.push([pageId, title]);
              titles.set(pageId, title);
            },
            setIcon: (pageId: string, icon: unknown) => {
              calls.icon.push([pageId, icon]);
              icons.set(pageId, icon ?? undefined);
            },
            peek: (pageId: string) => {
              calls.peek.push(pageId);
            },
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data });
};

const hostCalls = async (page: Page): Promise<HostCalls> =>
  await page.evaluate(() => window.__hostCalls ?? { rename: [], icon: [], open: [], newTab: [], peek: [] });

const openMenu = async (page: Page): Promise<void> => {
  await page.getByTestId('page-link').click({ button: 'right' });
  await expect(page.getByTestId('block-menu-title')).toBeVisible();
};

const menuItem = (page: Page, name: string): ReturnType<Page['getByRole']> =>
  page.getByRole('menuitem', { name, exact: false });

test.describe('Page block menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createEditor(page);
    await expect(page.getByTestId('page-title')).toHaveText('Roadmap');
  });

  test('lists the Notion page actions in order under a Page heading', async ({ page }) => {
    await openMenu(page);

    await expect(page.getByTestId('block-menu-title')).toHaveText('Page');

    const titles = await page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-item"]:visible')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-blok-item-name')));

    expect(titles).toEqual([
      'convert-to',
      'block-color',
      'page-edit-icon',
      'page-rename',
      'page-open-new-tab',
      'page-open-side-peek',
      'copy-link',
      'duplicate',
      'delete',
    ]);
    await expect(menuItem(page, 'Move to Trash')).toBeVisible();
    await expect(menuItem(page, 'Copy link')).toBeVisible();
  });

  test('renames the page in place', async ({ page }) => {
    await openMenu(page);
    await menuItem(page, 'Rename').click();

    const input = page.getByTestId('page-rename-input');

    await expect(input).toBeFocused();
    await input.fill('Plans');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('page-title')).toHaveText('Plans');
    expect((await hostCalls(page)).rename).toEqual([['roadmap', 'Plans']]);
  });

  test('paints the chosen text color over the link ink', async ({ page }) => {
    await openMenu(page);
    await menuItem(page, 'Color').hover();
    await page.getByTestId('block-color-picker').getByTestId('block-color-swatch-textColor-red').click();

    const red = await page.evaluate(() => {
      const probe = document.createElement('span');

      probe.style.color = 'var(--blok-color-red-text)';
      // Beside the link, where the color tokens are defined.
      document.querySelector('[data-blok-testid="page-link"]')?.parentElement?.append(probe);

      const color = getComputedStyle(probe).color;

      probe.remove();

      return color;
    });

    expect(red).not.toBe('rgb(0, 0, 0)');
    await expect(page.getByTestId('page-link')).toHaveCSS('color', red);
    expect((await saveBlok(page)).blocks[1]?.data).toEqual({ pageId: 'roadmap', textColor: 'red' });
  });

  test('paints a saved color after a reload and saves it back', async ({ page }) => {
    await createEditor(page, {
      blocks: [{ id: 'link', type: 'page', data: { pageId: 'roadmap', backgroundColor: 'green' } }],
    });
    await expect(page.getByTestId('page-title')).toHaveText('Roadmap');

    const green = await page.evaluate(() => {
      const probe = document.createElement('span');

      probe.style.backgroundColor = 'var(--blok-color-green-bg)';
      document.querySelector('[data-blok-testid="page-link"]')?.parentElement?.append(probe);

      const color = getComputedStyle(probe).backgroundColor;

      probe.remove();

      return color;
    });

    expect(green).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('page-link')).toHaveCSS('background-color', green);
    expect((await saveBlok(page)).blocks[0]?.data).toEqual({ pageId: 'roadmap', backgroundColor: 'green' });
  });

  test('sets the page icon from the emoji picker', async ({ page }) => {
    await openMenu(page);
    await menuItem(page, 'Edit icon').click();
    await expect(page.locator('[data-emoji-picker-body]')).toBeVisible();
    await page.locator('[data-blok-emoji-picker]')
      .evaluate((picker) => picker.getAnimations().forEach((animation) => animation.finish()));
    await page.locator('[data-emoji-native="👉"]').click();

    await expect(page.getByTestId('page-icon')).toHaveText('👉');
    expect((await hostCalls(page)).icon).toEqual([['roadmap', { type: 'emoji', value: '👉' }]]);
  });

  test('opens a new tab on Cmd/Ctrl+Shift+Enter even though the host opens pages itself', async ({ page }) => {
    await page.getByText('Above the page.', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('block-wrapper').filter({ has: page.getByTestId('page-link') }))
      .toHaveAttribute('data-blok-navigation-focused', 'true');
    await page.keyboard.press('ControlOrMeta+Shift+Enter');

    const calls = await hostCalls(page);

    expect(calls.newTab).toEqual(['https://workspace.test/pages/roadmap']);
    expect(calls.open).toEqual([]);
  });

  test('duplicates the block as another entry point to the same page', async ({ page }) => {
    await openMenu(page);
    await menuItem(page, 'Duplicate').click();

    await expect(page.getByTestId('page-title')).toHaveText(['Roadmap', 'Roadmap']);

    const saved = await saveBlok(page);

    expect(saved.blocks.map((block) => block.data.pageId)).toEqual([undefined, 'roadmap', 'roadmap']);
  });

  test('moves the page block to the trash', async ({ page }) => {
    await openMenu(page);
    await menuItem(page, 'Move to Trash').click();

    await expect(page.getByTestId('page-link')).toHaveCount(0);
  });

  test('renames with Cmd/Ctrl+Shift+R on the block chosen in navigation mode', async ({ page }) => {
    await page.getByText('Above the page.', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('block-wrapper').filter({ has: page.getByTestId('page-link') }))
      .toHaveAttribute('data-blok-navigation-focused', 'true');
    await page.keyboard.press('ControlOrMeta+Shift+KeyR');

    await expect(page.getByTestId('page-rename-input')).toBeFocused();
  });

  test('peeks on Alt+click', async ({ page }) => {
    await page.getByTestId('page-link').click({ modifiers: ['Alt'] });

    expect((await hostCalls(page)).peek).toEqual(['roadmap']);
  });
});
