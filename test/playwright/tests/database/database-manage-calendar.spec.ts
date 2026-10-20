/**
 * "Manage in Calendar" (research/26 §3d, §4d; research/27 §3): a host lever.
 * Notion's opens Notion Calendar; Blok hands the database and view to the host.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    calendarCalls?: Array<{ databaseId: string; viewId: string }>;
  }
}

const blocks = (type: string): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'View', type, position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-due': '2026-10-12' } } },
];

const mount = async (page: Page, type: string, lever: boolean): Promise<void> => {
  await page.evaluate(async ({ input, withLever }) => {
    await window.blokInstance?.destroy?.();
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.calendarCalls = [];
    const calendar = { manage: (context: { databaseId: string; viewId: string }) => window.calendarCalls?.push(context) };

    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: { class: window.BlokDatabase, config: withLever ? { calendar } : {} },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: blocks(type), withLever: lever });
};

const byTestId = (page: Page, id: string): Locator => page.locator(`[data-blok-testid="${id}"]`);
const timelineButton = (page: Page): Locator => page.getByRole('button', { name: 'Manage in Calendar' });

const css = (locator: Locator, props: string[]): Promise<Record<string, string>> => locator.evaluate((el, names) => {
  const style = getComputedStyle(el);

  return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
}, props);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
});

test.describe('Manage in Calendar', () => {
  test('shows nothing without the host lever', async ({ page }) => {
    await mount(page, 'timeline', false);
    await expect(page.locator('[data-blok-database-timeline-toolbar]')).toBeVisible();
    await expect(timelineButton(page)).toHaveCount(0);

    await byTestId(page, 'database-toolbar-settings').click();
    await expect(byTestId(page, 'database-settings-lock')).toBeVisible();
    await expect(byTestId(page, 'database-settings-manage-calendar')).toHaveCount(0);
  });

  test('View settings: a row after the lock, with a light "leaves this app" arrow, that calls the host', async ({ page }) => {
    await mount(page, 'table', true);
    await byTestId(page, 'database-toolbar-settings').click();
    const row = byTestId(page, 'database-settings-manage-calendar');

    await expect(row).toBeVisible();
    await expect(row).toHaveText('Manage in Calendar');
    expect(await row.evaluate((el) => el.previousElementSibling?.getAttribute('data-blok-testid'))).toBe('database-settings-lock');
    // offsetHeight: the panel may still be scaling in, which skews boundingBox.
    expect(await row.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(28);
    const arrow = row.locator('[data-blok-database-panel-external] svg');

    await expect(arrow).toBeVisible();
    expect(await css(row.locator('[data-blok-database-panel-external]'), ['color'])).toEqual({ color: 'rgb(173, 169, 163)' });
    expect(await css(arrow, ['width', 'height'])).toEqual({ width: '16px', height: '16px' });

    await row.click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => window.calendarCalls)).toEqual([{ databaseId: 'db-1', viewId: 'v1' }]);
  });

  test('timeline toolbar: a bordered button before the zoom, as measured, that calls the host', async ({ page }) => {
    await mount(page, 'timeline', true);
    const button = timelineButton(page);

    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => el.nextElementSibling?.hasAttribute('data-blok-database-timeline-zoom'))).toBe(true);
    expect(await css(button, [
      'border-top-width', 'border-top-style', 'border-top-color', 'border-top-left-radius',
      'padding-left', 'padding-right', 'column-gap', 'font-weight', 'font-size', 'background-color', 'color',
    ])).toEqual({
      'border-top-width': '1px',
      'border-top-style': 'solid',
      'border-top-color': 'rgba(28, 19, 1, 0.11)',
      'border-top-left-radius': '6px',
      'padding-left': '6px',
      'padding-right': '6px',
      'column-gap': '6px',
      'font-weight': '500',
      'font-size': '14px',
      'background-color': 'rgba(0, 0, 0, 0)',
      color: 'rgb(44, 44, 43)',
    });
    expect(await button.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(24);
    expect(await button.evaluate((el) => {
      const icon = el.querySelector('svg');

      return icon === null ? null : [getComputedStyle(icon).width, getComputedStyle(icon).height];
    })).toEqual(['16px', '16px']);

    await button.hover();
    await expect.poll(async () => (await css(button, ['background-color']))['background-color']).toBe('rgba(33, 27, 23, 0.05)');

    await button.click();
    expect(await page.evaluate(() => window.calendarCalls)).toEqual([{ databaseId: 'db-1', viewId: 'v1' }]);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await css(button, ['border-top-color']))['border-top-color']).toBe('rgba(255, 255, 235, 0.1)');
  });
});
