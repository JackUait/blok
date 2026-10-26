/**
 * A formula that does not compile shows a warning mark in its cell. Hovering
 * the cell shows the reason, only after the hint delay.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    hintTimes?: { enter?: number; shown?: number };
  }
}

const REASON = 'Unknown property "Missing"';

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-broken', name: 'Broken', type: 'formula', position: 'a1', formula: { expression: 'prop("Missing")' } },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, data);
  await expect(page.getByRole('grid')).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page, blocks());
});

test('hovering a broken formula cell shows the reason after the hint delay', async ({ page }) => {
  const mark = page.getByRole('img', { name: REASON });

  await expect(mark).toBeVisible();
  await expect(page.getByRole('tooltip')).toBeHidden();

  // Times are taken in the page, so a slow runner cannot make the hint look instant.
  await page.evaluate((reason) => {
    const times: { enter?: number; shown?: number } = {};

    window.hintTimes = times;
    document.addEventListener('pointerover', (event) => {
      if (event.target instanceof Element && event.target.closest(`[role="img"][aria-label='${reason}']`) !== null) times.enter ??= performance.now();
    }, { capture: true });
    new MutationObserver(() => {
      if (times.shown === undefined && document.querySelector('[role="tooltip"][aria-hidden="false"]') !== null) times.shown = performance.now();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-hidden'] });
  }, REASON);
  await mark.hover();

  await expect(page.getByRole('tooltip')).toHaveText(REASON);
  const waited = await page.evaluate(() => (window.hintTimes?.shown ?? 0) - (window.hintTimes?.enter ?? 0));

  expect(waited).toBeGreaterThanOrEqual(450);
  expect(await page.evaluate(() => window.hintTimes?.enter)).toBeDefined();
});
