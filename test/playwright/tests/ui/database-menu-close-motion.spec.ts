/**
 * Database menus close the way Notion's do (research/08 Motion): the card
 * fades and scales back to .96 over 200ms `ease` before it leaves the top layer.
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

const MENU = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu']";
// The root is a zero-size host; the card is what shows.
const OPEN_CARD = `${MENU}[data-blok-popover-opened='true'] [data-blok-popover-container]`;

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, BLOCKS);
};

const openGroupMenu = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-database-column-header]').first().hover();
  await page.locator('[data-blok-database-column-menu]').first().click();
  await expect(page.locator(OPEN_CARD)).toBeVisible();
  // Let the open motion finish, so the close starts from opacity 1 / scale 1.
  await page.evaluate(async (menu) => {
    const container = document.querySelector(`${menu} [data-blok-popover-container]`);

    await Promise.all(container?.getAnimations().map((animation) => animation.finished) ?? []);
  }, MENU);
};

interface CloseSample {
  transitions: Array<{ property: string; duration: number; easing: string; from: string; to: string }>;
  inTopLayer: boolean;
  open: boolean;
  focusInMenu: boolean;
  pointerEvents: string;
}

declare global {
  interface Window {
    closeSample?: CloseSample;
  }
}

/**
 * Presses Escape and samples the menu in the same task as the key, before any
 * frame of the close can finish. A bubble listener on window runs after
 * Blok's own Escape handling.
 */
const escapeAndSample = async (page: Page): Promise<CloseSample> => {
  await page.evaluate((menu) => {
    window.closeSample = undefined;
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      const root = document.querySelector<HTMLElement>(menu);
      const container = root?.querySelector<HTMLElement>('[data-blok-popover-container]');
      const transitions = (container?.getAnimations() ?? [])
        .filter((animation): animation is CSSTransition => animation instanceof CSSTransition)
        .map((animation) => {
          const timing = animation.effect?.getTiming();
          const keyframes = animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [];
          const property = animation.transitionProperty;

          return {
            property,
            duration: Number(timing?.duration),
            easing: String(timing?.easing),
            from: String(keyframes[0]?.[property]),
            to: String(keyframes[keyframes.length - 1]?.[property]),
          };
        });

      window.closeSample = {
        transitions,
        inTopLayer: root?.hasAttribute('data-blok-top-layer') === true && root.isConnected,
        open: root?.matches(':popover-open') === true,
        focusInMenu: root?.contains(document.activeElement) === true,
        pointerEvents: container === null || container === undefined ? '' : getComputedStyle(container).pointerEvents,
      };
    }, { once: true });
  }, MENU);
  await page.keyboard.press('Escape');

  const sample = await page.evaluate(() => window.closeSample);

  if (sample === undefined) {
    throw new Error('Escape never reached window');
  }

  return sample;
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a database menu fades and scales out over 200ms ease on Escape', async ({ page }) => {
  await createBlok(page);
  await openGroupMenu(page);

  const sample = await escapeAndSample(page);
  const opacity = sample.transitions.find((t) => t.property === 'opacity');
  const transform = sample.transitions.find((t) => t.property === 'transform');

  expect(opacity).toEqual({ property: 'opacity', duration: 200, easing: 'ease', from: '1', to: '0' });
  expect(transform?.duration).toBe(200);
  expect(transform?.easing).toBe('ease');
  expect(transform?.to).toBe('scale(0.96)');
  // Still painted in the top layer while it fades, but no longer open or hit-testable.
  expect(sample.inTopLayer).toBe(true);
  expect(sample.open).toBe(false);
  expect(sample.pointerEvents).toBe('none');
  expect(sample.focusInMenu).toBe(false);

  // Once the fade ends, the menu leaves the top layer and the DOM.
  await expect(page.locator(MENU)).toHaveCount(0);
});

test('reopening during the close cancels it and the new menu stays open', async ({ page }) => {
  await createBlok(page);
  await openGroupMenu(page);
  await escapeAndSample(page);
  await page.locator('[data-blok-database-column-header]').first().hover();
  await page.locator('[data-blok-database-column-menu]').first().click();

  const opened = page.locator(OPEN_CARD);

  await expect(opened).toBeVisible();
  // Outlive the old close: once the old card is gone, the new one is still open.
  await expect(page.locator(MENU)).toHaveCount(1);
  await expect(opened).toBeVisible();
  expect(await opened.evaluate((el) => el.closest('[data-blok-popover]')?.matches(':popover-open'))).toBe(true);
  await expect(page.locator(MENU)).toHaveCount(1);
});

test('with reduced motion the menu closes at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createBlok(page);
  await openGroupMenu(page);

  const sample = await escapeAndSample(page);

  expect(sample.transitions).toEqual([]);
  expect(sample.inTopLayer).toBe(false);
});
