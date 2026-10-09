/**
 * The page drawer slides in with translateX. The "Add property" button moves
 * with it, so a type menu opened mid-slide must follow the button.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'opt-a', label: 'A', color: 'gray', position: 'a0' }] },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', data: { position: 'a0', properties: { 'prop-title': 'Fix the bug', 'prop-status': 'opt-a' } } },
];

const createBlok = async (page: Page, direction: 'ltr' | 'rtl'): Promise<void> => {
  await page.evaluate(async ({ dir, data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, i18n: { direction: dir }, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { dir: direction, data: BLOCKS });
};

/**
 * Opens the drawer and holds its slide-in at the halfway point.
 */
const openDrawerHeldMidSlide = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-database-card]').first().click();
  // The slide-in starts one frame after the drawer mounts.
  await page.waitForFunction(() => {
    const transition = document.querySelector('[data-blok-database-drawer]')?.getAnimations()
      .find((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'transform');

    if (transition === undefined) {
      return false;
    }
    transition.pause();
    transition.currentTime = 100;

    return true;
  });
};

const finishDrawerSlide = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    document.querySelector('[data-blok-database-drawer]')?.getAnimations().forEach((animation) => animation.finish());
    // The menu re-places from a ResizeObserver, which reports after the next layout.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

for (const direction of ['ltr', 'rtl'] as const) {
  test(`a type menu opened while the drawer slides in ends under the button (${direction})`, async ({ page }) => {
    await createBlok(page, direction);
    await openDrawerHeldMidSlide(page);

    const button = page.locator('[data-blok-database-drawer-add-prop]');
    const menu = page.locator('[data-blok-database-property-type-popover]');

    await button.click();
    await expect(menu).toBeVisible();
    await finishDrawerSlide(page);

    // The menu opens at the button's inline start.
    const inlineStart = (target: typeof button): Promise<number> => target.evaluate((element, dir) => {
      const rect = element.getBoundingClientRect();

      return Math.round(dir === 'ltr' ? rect.left : rect.right);
    }, direction);

    expect(await inlineStart(menu)).toBe(await inlineStart(button));
  });
}
