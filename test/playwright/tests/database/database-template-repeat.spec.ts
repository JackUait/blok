/**
 * A repeating template's schedule: frequency, "Every N <unit>", start date
 * and time (research/05 §7, Notion help "database templates"). Checks the
 * saved JSON, not only the DOM.
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

const blocks = (repeat?: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['tpl'],
  },
  { id: 'tpl', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Standup' }, template: true, ...(repeat === undefined ? {} : { repeat }) } },
];

const mount = async (page: Page, repeat?: Record<string, unknown>): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: { database: { class: (window as unknown as Record<string, unknown>).BlokDatabase } },
    });
    await window.blokInstance.isReady;
  }, blocks(repeat));
};

const repeatOf = async (page: Page): Promise<Record<string, unknown> | undefined> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  return (saved?.blocks.find((block) => block.id === 'tpl')?.data as { repeat?: Record<string, unknown> }).repeat;
});

const openRepeat = async (page: Page): Promise<void> => {
  await page.getByTestId('database-toolbar-new-menu').click();
  await page.getByRole('menuitem', { name: 'Standup' }).click();
  await page.getByRole('menuitem', { name: 'Repeat' }).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a new weekly repeat keeps the viewer\'s zone and closes the whole menu', async ({ page }) => {
  await mount(page);
  await openRepeat(page);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('menuitemcheckbox', { name: 'Weekly' }).click();

  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  await expect.poll(() => repeatOf(page)).toMatchObject({ frequency: 'weekly', timeZone: zone });
  await expect(page.getByRole('menuitem', { name: 'Standup' })).toBeHidden();
});

// The page is shared between tests, so its time zone is not ours to set: the
// schedule carries its own zone, and the fields read and write in that zone.
test('sets the interval and the start date and time of a schedule', async ({ page }) => {
  await mount(page, { frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openRepeat(page);
  const every = page.getByRole('spinbutton');

  await expect(every).toHaveValue('1');
  await expect(every).toHaveAccessibleName(/^Every.*weeks$/);
  await expect(page.getByLabel('Time')).toHaveValue('09:30');
  await every.fill('2');
  await expect.poll(() => repeatOf(page)).toMatchObject({ frequency: 'weekly', interval: 2 });

  await page.getByLabel('Start date').fill('2026-11-02');
  await page.getByLabel('Time').fill('18:00');

  // Berlin is on CET (UTC+1) on Nov 2.
  await expect.poll(() => repeatOf(page)).toEqual({ frequency: 'weekly', interval: 2, start: '2026-11-02T17:00:00.000Z', timeZone: 'Europe/Berlin' });
});
