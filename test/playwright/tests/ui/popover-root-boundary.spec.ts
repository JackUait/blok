import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const BOOKMARK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="bookmark"]`;
const SETTINGS_TRIGGER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const MENU_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const SCROLL_HOST_ID = 'root-boundary-scroll-host';

type BoundingBox = { x: number; y: number; width: number; height: number };

const requireBoundingBox = async (locator: Locator, label: string): Promise<BoundingBox> => {
  const box = await locator.boundingBox();

  expect(box, `${label} has no bounding box`).not.toBeNull();

  return box as BoundingBox;
};

const createBookmarkFixture = async (
  page: Page,
  options: { rootCss?: string; nestedScroll?: boolean } = {}
): Promise<void> => {
  const { rootCss = '', nestedScroll = false } = options;

  await page.addStyleTag({
    content: nestedScroll
      ? `
        html, body { margin: 0 }
        #${SCROLL_HOST_ID} { height: 520px; margin: 80px 40px; overflow: auto; border: 1px solid transparent }
        #blok { padding-top: 1400px; padding-bottom: 1000px }
      `
      : `
        html, body { margin: 0 }
        ${rootCss}
        #blok { padding-top: 2200px; padding-bottom: 1200px }
      `,
  });

  await page.evaluate(async ({ hostId, useNestedScroll }) => {
    const holder = document.createElement('div');

    holder.id = 'blok';

    if (useNestedScroll) {
      const scrollHost = document.createElement('div');

      scrollHost.id = hostId;
      scrollHost.appendChild(holder);
      document.body.appendChild(scrollHost);
    } else {
      document.body.appendChild(holder);
    }

    const blok = new window.Blok({
      holder: 'blok',
      readOnly: true,
      data: {
        blocks: [
          {
            id: 'recipes-heading',
            type: 'header',
            data: { text: 'Рецепты прямоугольной пиццы кусочками', level: 2 },
          },
          {
            id: 'deep-bookmark',
            type: 'bookmark',
            data: {
              url: 'https://drive.google.com/file/d/example/preview',
              title: 'drive.google.com',
            },
            lastEditedAt: Date.UTC(2026, 5, 30, 12, 4),
          },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { hostId: SCROLL_HOST_ID, useNestedScroll: nestedScroll });
};

const openBookmarkMenu = async (
  page: Page,
  nestedScroll = false
): Promise<{ bookmark: Locator; menu: Locator; triggerBox: BoundingBox; menuBox: BoundingBox }> => {
  const bookmark = page.locator(BOOKMARK_SELECTOR);

  await bookmark.scrollIntoViewIfNeeded();

  if (nestedScroll) {
    await page.evaluate((hostId) => {
      const host = document.getElementById(hostId);

      host?.scrollBy(0, -120);
    }, SCROLL_HOST_ID);
  } else {
    await page.evaluate(() => window.scrollBy(0, -120));
  }

  await bookmark.hover();

  const trigger = page.locator(SETTINGS_TRIGGER_SELECTOR);

  await expect(trigger).toBeVisible();
  const triggerBox = await requireBoundingBox(trigger, 'Settings trigger');

  // The toolbar is body-mounted. Inside an overflow fixture its visual button
  // can be occluded by the host's clipping layer even though the toolbar is the
  // real event owner; invoke its mousedown→document mouseup click/drag contract
  // directly for this fixture.
  if (nestedScroll) {
    await trigger.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      };

      element.dispatchEvent(new MouseEvent('mousedown', eventInit));
      document.dispatchEvent(new MouseEvent('mouseup', eventInit));
    });
  } else {
    await trigger.click();
  }

  const menu = page.locator(MENU_SELECTOR);

  await expect(menu).toBeVisible();
  // The container opens from scale(0.98) over 120ms. Bounding boxes during
  // that transition differ by a few pixels across engines.
  await expect(menu).toHaveCSS('transform', 'none');
  const menuBox = await requireBoundingBox(menu, 'Block settings menu');

  return { bookmark, menu, triggerBox, menuBox };
};

const expectMenuBesideTrigger = (menuBox: BoundingBox, triggerBox: BoundingBox): void => {
  const triggerCenterY = triggerBox.y + triggerBox.height / 2;
  const menuCenterY = menuBox.y + menuBox.height / 2;

  expect(Math.abs(menuCenterY - triggerCenterY)).toBeLessThanOrEqual(2);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(720);
};

const rootCssCases = [
  { name: 'body', css: 'body { height: 100vh }' },
  { name: 'html', css: 'html { height: 100vh }' },
  { name: 'html and body', css: 'html, body { height: 100vh }' },
] as const;

test.describe('root popover boundary', () => {
  // Loading the large test bundle in three engines concurrently can consume a
  // meaningful part of the global 15s default before geometry assertions run.
  test.setTimeout(30_000);

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  rootCssCases.forEach(({ name, css }) => {
    test(`keeps the published bookmark menu beside its deep block when ${name} is only 100vh tall`, async ({ page }) => {
      await createBookmarkFixture(page, { rootCss: css });

      const { triggerBox, menuBox } = await openBookmarkMenu(page);

      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
      expectMenuBesideTrigger(menuBox, triggerBox);
    });
  });

  test('keeps a snapshot anchor attached when the window scrolls after opening', async ({ page }) => {
    await createBookmarkFixture(page, { rootCss: 'body { height: 100vh }' });

    const { bookmark, menu, menuBox } = await openBookmarkMenu(page);
    const bookmarkBox = await requireBoundingBox(bookmark, 'Bookmark before window scroll');

    await page.evaluate(() => window.scrollBy(0, 80));

    await expect.poll(async () => {
      const movedMenu = await requireBoundingBox(menu, 'Menu after window scroll');
      const movedBookmark = await requireBoundingBox(bookmark, 'Bookmark after window scroll');
      const menuDelta = movedMenu.y - menuBox.y;
      const bookmarkDelta = movedBookmark.y - bookmarkBox.y;

      return Math.abs(menuDelta - bookmarkDelta);
    }).toBeLessThanOrEqual(2);
  });

  test('keeps the menu attached when a nested scroll container moves its anchor after opening', async ({ page }) => {
    await createBookmarkFixture(page, { nestedScroll: true });

    const { bookmark, menu, menuBox } = await openBookmarkMenu(page, true);
    const bookmarkBox = await requireBoundingBox(bookmark, 'Bookmark before nested scroll');

    expect(await page.evaluate((hostId) => document.getElementById(hostId)?.scrollTop ?? 0, SCROLL_HOST_ID))
      .toBeGreaterThan(1000);

    await page.evaluate((hostId) => document.getElementById(hostId)?.scrollBy(0, 80), SCROLL_HOST_ID);

    await expect.poll(async () => {
      const movedMenu = await requireBoundingBox(menu, 'Menu after nested scroll');
      const movedBookmark = await requireBoundingBox(bookmark, 'Bookmark after nested scroll');
      const menuDelta = movedMenu.y - menuBox.y;
      const bookmarkDelta = movedBookmark.y - bookmarkBox.y;

      return Math.abs(menuDelta - bookmarkDelta);
    }).toBeLessThanOrEqual(2);
  });

  test('keeps a virtual context-menu anchor attached during nested scrolling', async ({ page }) => {
    await createBookmarkFixture(page, { nestedScroll: true });

    const bookmark = page.locator(BOOKMARK_SELECTOR);

    await bookmark.scrollIntoViewIfNeeded();
    // Keep the virtual point comfortably away from the viewport edge so this
    // test isolates anchor tracking instead of intentionally crossing the
    // collision engine's above/below flip threshold during the 80px scroll.
    await page.evaluate((hostId) => document.getElementById(hostId)?.scrollBy(0, 240), SCROLL_HOST_ID);

    // Use a plain child so the native right-click path is not intentionally
    // excluded as an interactive link/media context menu.
    await bookmark.evaluate((element) => {
      const target = document.createElement('span');

      target.dataset.virtualAnchorTarget = 'true';
      target.textContent = 'Open block context menu';
      target.style.display = 'block';
      element.appendChild(target);
    });

    await bookmark.locator('[data-virtual-anchor-target]').click({ button: 'right' });

    const menu = page.locator(MENU_SELECTOR);

    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('transform', 'none');

    const menuBox = await requireBoundingBox(menu, 'Virtual-anchor menu before nested scroll');
    const bookmarkBox = await requireBoundingBox(bookmark, 'Bookmark before virtual-anchor nested scroll');

    await page.evaluate((hostId) => document.getElementById(hostId)?.scrollBy(0, 80), SCROLL_HOST_ID);

    await expect.poll(async () => {
      const movedMenu = await requireBoundingBox(menu, 'Virtual-anchor menu after nested scroll');
      const movedBookmark = await requireBoundingBox(bookmark, 'Bookmark after virtual-anchor nested scroll');
      const menuDelta = movedMenu.y - menuBox.y;
      const bookmarkDelta = movedBookmark.y - bookmarkBox.y;

      return Math.abs(menuDelta - bookmarkDelta);
    }).toBeLessThanOrEqual(2);
  });
});
