/**
 * Board, gallery and calendar in dark against Notion's measured dark values
 * (research/21 §1f, §1g, §1h). Reads getComputedStyle, never the stylesheet.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a1',
    config: {
      options: [
        { id: 'o-gray', label: 'Not started', color: 'gray', position: 'a0' },
        { id: 'o-blue', label: 'In progress', color: 'blue', position: 'a1' },
        { id: 'o-green', label: 'Done', color: 'green', position: 'a2' },
      ],
    },
  },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-stage': 'o-gray', 'p-due': '2026-10-09' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-stage': 'o-blue', 'p-due': '2026-10-13' } },
  { id: 'r3', properties: { 'p-title': 'Charlie', 'p-stage': 'o-green' } },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-title'], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: row.properties },
  })),
];

const mount = async (page: Page, input: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, input);
};

const style = (locator: Locator, props: string[]): Promise<Record<string, string>> => locator.evaluate((el, names) => {
  const cs = getComputedStyle(el);

  return Object.fromEntries(names.map((name) => [name, cs.getPropertyValue(name)]));
}, props);

const column = (page: Page, color: string): Locator => page.locator(`[data-blok-database-column][data-color="${color}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.emulateMedia({ colorScheme: 'dark' });
});

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
});

test('board: gray, blue and green columns tint their cards as Notion dark measured (research/21 §1f)', async ({ page }) => {
  await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));

  const cases = [
    // research/35 §1.1: a Gray column's dark card is 44,44,43; its count is the AA step of Notion's 142,139,134.
    { color: 'gray', tint: 'rgba(252, 252, 252, 0.03)', card: 'rgb(44, 44, 43)', ring: 'rgba(255, 255, 243, 0.082)', count: 'rgb(156, 153, 148)' },
    { color: 'blue', tint: 'rgba(41, 139, 253, 0.063)', card: 'rgb(33, 48, 65)', ring: 'rgba(71, 157, 255, 0.173)', count: 'rgb(62, 154, 245)' },
    { color: 'green', tint: 'rgba(83, 255, 140, 0.035)', card: 'rgb(36, 52, 43)', ring: 'rgba(119, 255, 179, 0.118)', count: 'rgb(77, 168, 120)' },
  ];

  for (const { color, tint, card, ring, count } of cases) {
    const col = column(page, color);
    const cardEl = col.locator('[data-blok-database-card]');

    await expect(cardEl).toHaveCount(1);
    expect((await style(col, ['background-color']))['background-color']).toBe(tint);
    const cardStyle = await style(cardEl, ['background-color', 'box-shadow']);

    expect(cardStyle['background-color']).toBe(card);
    expect(cardStyle['box-shadow']).toBe(`rgba(25, 25, 25, 0.08) 0px 2px 4px 0px, ${ring} 0px 0px 0px 1px`);
    expect((await style(col.getByTestId('database-column-count'), ['color'])).color).toBe(count);
  }
});

test('gallery: card, empty cover and cover line take Notion dark (research/21 §1g)', async ({ page }) => {
  await mount(page, blocks({ type: 'gallery' }));

  const card = page.locator('[data-blok-database-gallery-card][data-row-id="r1"]');

  await expect(card).toBeVisible();
  expect(await style(card, ['background-color', 'box-shadow'])).toEqual({
    'background-color': 'rgba(255, 255, 255, 0.055)',
    'box-shadow': 'rgba(25, 25, 25, 0.08) 0px 2px 4px 0px, rgba(255, 255, 243, 0.082) 0px 0px 0px 1px',
  });
  expect(await style(card.locator('[data-blok-database-gallery-preview]'), ['background-color', 'border-bottom-color'])).toEqual({
    'background-color': 'rgba(252, 252, 252, 0.03)',
    'border-bottom-color': 'rgba(0, 0, 0, 0)',
  });
});

test('calendar: grid, weekend, event card and Notion\'s black today digit in dark (research/21 §1h, research/33 §4.6)', async ({ page }) => {
  await mount(page, blocks({ type: 'calendar' }));

  const today = page.locator('[data-blok-database-calendar-day][data-day="2026-10-09"]');
  const saturday = page.locator('[data-blok-database-calendar-day][data-day="2026-10-10"]');
  const event = page.locator('[data-blok-database-calendar-event][data-row-id="r2"]');

  await expect(today).toHaveAttribute('data-today', '');
  expect((await style(saturday, ['background-color']))['background-color']).toBe('rgb(32, 32, 32)');
  expect((await style(today, ['border-bottom-color']))['border-bottom-color']).toBe('rgb(56, 56, 54)');
  expect(await style(event, ['background-color', 'box-shadow'])).toEqual({
    'background-color': 'rgb(47, 47, 47)',
    'box-shadow': 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 2px 4px 0px',
  });
  // Black is 6.3:1 on the red circle; white is 3.3:1.
  expect(await style(today.locator('[data-blok-database-calendar-day-number]'), ['background-color', 'color'])).toEqual({
    'background-color': 'rgb(229, 100, 88)',
    'color': 'rgb(0, 0, 0)',
  });
});
