/**
 * Page icons in the calendar, timeline and feed (research/16 §2): the icon
 * box and its gap to the title match Notion's measures, and the Layout
 * panel's "Show page icon" switch takes the icon away so the title moves
 * into its place.
 */

import type { Locator, Page } from '@playwright/test';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const rowKey = (i: number): string => Array.from({ length: i }).reduce<string>((key) => generateKeyBetween(key, null), 'a0');

/** Today in local time, so the calendar month and timeline window hold the rows. */
const today = (): string => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const blocks = (type: string): OutputBlockData[] => {
  const due = today();
  const rows = [
    { id: 'r1', icon: '🥌', properties: { 'p-title': 'Alpha', 'p-due': due } },
    { id: 'r2', properties: { 'p-title': 'Beta', 'p-due': due } },
  ];

  return [
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
      content: rows.map((row) => row.id),
    },
    ...rows.map((row, i) => ({
      id: row.id,
      type: 'database-row',
      data: { position: rowKey(i), properties: row.properties, ...(row.icon !== undefined ? { icon: row.icon } : {}) },
    })),
  ];
};

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data: input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    localStorage.clear();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { data });
};

const savedView = async (page: Page): Promise<Record<string, unknown>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');

  return (db?.data as { views: Array<Record<string, unknown>> }).views[0];
});

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();

  if (found === null) {
    throw new Error('no box');
  }

  return found;
};

const VIEWS = [
  { type: 'calendar', item: '[data-blok-database-calendar-event]', title: '[data-blok-database-calendar-event-title]', size: 14, gap: 3 },
  { type: 'timeline', item: '[data-blok-database-timeline-bar]', title: '[data-blok-database-timeline-bar-title]', size: 20, gap: 6 },
  { type: 'feed', item: '[data-blok-database-feed-card]', title: '[data-blok-database-feed-title]', size: 26, gap: 4 },
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

for (const { type, item, title, size, gap } of VIEWS) {
  test(`${type}: the page icon sits before the title at Notion's size and the switch removes it`, async ({ page }) => {
    await mount(page, blocks(type));

    const alpha = page.locator(`${item}[data-row-id="r1"]`);
    const icon = alpha.locator('[data-blok-database-page-icon]');
    const alphaTitle = alpha.locator(title);

    await expect(icon).toHaveText('🥌');
    await expect(page.locator(`${item}[data-row-id="r2"] [data-blok-database-page-icon]`)).toHaveCount(0);

    const iconBox = await box(icon);
    const titleBox = await box(alphaTitle);

    expect(iconBox.width).toBeCloseTo(size, 0);
    expect(iconBox.height).toBeCloseTo(size, 0);
    expect(titleBox.x - (iconBox.x + iconBox.width)).toBeCloseTo(gap, 0);

    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-layout').click();

    const toggle = page.getByTestId('database-settings-page-icon');

    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();

    await expect(page.locator(`${item}[data-row-id="r1"] [data-blok-database-page-icon]`)).toHaveCount(0);
    expect((await box(page.locator(`${item}[data-row-id="r1"] ${title}`))).x).toBeCloseTo(iconBox.x, 0);
    expect((await savedView(page)).showPageIcon).toBe(false);
  });
}

for (const { type, item, title } of VIEWS) {
  test(`${type}: an icon picked on the row page shows on the open view`, async ({ page }) => {
    await mount(page, blocks(type));
    await page.locator(`${item}[data-row-id="r2"] ${title}`).click();
    await page.getByRole('button', { name: 'Add icon' }).click();

    const emoji = page.locator('[data-blok-emoji-picker] [data-emoji-native]').first();

    await expect(emoji).toBeVisible();
    const native = await emoji.getAttribute('data-emoji-native');

    await emoji.click();

    await expect(page.locator(`${item}[data-row-id="r2"] [data-blok-database-page-icon]`)).toHaveText(native ?? '');
  });
}
