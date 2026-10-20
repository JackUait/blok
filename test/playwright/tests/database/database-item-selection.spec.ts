/**
 * Picking database items with the pointer (research/22 §1): a Shift-click on
 * a card, list row or calendar event picks that item and never turns into a
 * block range over the whole database, and a lasso drawn from the page
 * margin across the calendar picks the events it touches.
 *
 * No page.clock here on purpose: a frozen clock also freezes the lasso's
 * throttled mousemove, so the calendar is seeded around the real today.
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
    id: 'p-stage', name: 'Stage', type: 'select', position: 'a1',
    config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }, { id: 'o-ship', label: 'Ship', color: 'green', position: 'a1' }] },
  },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
];

const blocks = (view: Record<string, unknown>, due: string[] = []): OutputBlockData[] => {
  const rows = ['Alpha', 'Bravo', 'Charlie'].map((title, i) => ({
    id: `r${i + 1}`,
    properties: { 'p-title': title, 'p-stage': i === 1 ? 'o-ship' : 'o-idea', ...(due[i] === undefined ? {} : { 'p-due': due[i] }) },
  }));

  return [
    { id: 'p-1', type: 'paragraph', data: { text: 'Above the database' } },
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: SCHEMA,
        views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
        activeViewId: 'v1',
      },
      content: rows.map((row) => row.id),
    },
    ...rows.map((row, i) => ({ id: row.id, type: 'database-row', data: { position: `a${i}`, properties: row.properties } })),
  ];
};

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data: input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { data });
};

const picked = async (page: Page): Promise<string[]> => page.evaluate(() =>
  [...new Set([...document.querySelectorAll('[data-blok-database-row-selected]')].map((el) => el.getAttribute('data-row-id') ?? ''))].sort());

const database = (page: Page): Locator => page.locator('[data-blok-id="db-1"]');
const item = (page: Page, selector: string, rowId: string): Locator => page.locator(`${selector}[data-row-id="${rowId}"]`).first();

/** Puts the caret in the paragraph above, so core has an anchor for a block range. */
const caretAbove = async (page: Page): Promise<void> => {
  await page.getByText('Above the database').click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(() => window.localStorage.clear());
});

const VIEWS: Array<{ name: string; view: Record<string, unknown>; selector: string }> = [
  { name: 'board card', view: { type: 'board', groupBy: 'p-stage' }, selector: '[data-blok-database-card]' },
  { name: 'list row', view: { type: 'list' }, selector: '[data-blok-database-list-row]' },
  { name: 'gallery card', view: { type: 'gallery' }, selector: '[data-blok-database-gallery-card]' },
];

test.describe('Shift-click picks an item, never the database block', () => {
  for (const { name, view, selector } of VIEWS) {
    test(name, async ({ page }) => {
      await mount(page, blocks(view));
      await caretAbove(page);

      await item(page, selector, 'r1').click({ modifiers: ['Shift'] });

      await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
      expect(await picked(page)).toEqual(['r1']);
      expect(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true);
    });
  }

  test('Cmd/Ctrl+Shift-click on a gallery card does not toggle the database block either', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery' }));
    await caretAbove(page);

    await item(page, '[data-blok-database-gallery-card]', 'r1').click({ modifiers: ['Shift', 'ControlOrMeta'] });

    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
  });
});

test.describe('a lasso from the page margin', () => {
  /** Days around the real today, as the calendar reads them. */
  const isoDays = async (page: Page, offsets: number[]): Promise<string[]> => page.evaluate((list) => list.map((offset) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }), offsets);

  const lasso = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };

  test('across the calendar picks every event it touches, across days, and not the block', async ({ page }) => {
    // Today and the day after stay in today's month view only when today is not the month's last day.
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() === today.getDate();
    const [first, second] = await isoDays(page, lastDay ? [-1, 0] : [0, 1]);

    await mount(page, blocks({ type: 'calendar' }, [first, second]));
    const events = page.locator('[data-blok-database-calendar-event]');

    await expect(events).toHaveCount(2);
    const a = await events.nth(0).boundingBox();
    const b = await events.nth(1).boundingBox();
    const holder = await page.locator('[data-blok-editor]').boundingBox();

    if (a === null || b === null || holder === null) {
      throw new Error('no boxes');
    }

    await lasso(
      page,
      { x: holder.x - 20, y: Math.min(a.y, b.y) - 4 },
      { x: Math.max(a.x + a.width, b.x + b.width) - 4, y: Math.max(a.y + a.height, b.y + b.height) - 4 }
    );

    expect(await picked(page)).toEqual(['r1', 'r2']);
    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('across a board still selects the database block, as before', async ({ page }) => {
    await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));
    const cardBox = await item(page, '[data-blok-database-card]', 'r1').boundingBox();
    const holder = await page.locator('[data-blok-editor]').boundingBox();

    if (cardBox === null || holder === null) {
      throw new Error('no boxes');
    }

    await lasso(page, { x: holder.x - 20, y: cardBox.y - 4 }, { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 });

    await expect(database(page)).toHaveAttribute('data-blok-selected', 'true');
    expect(await picked(page)).toEqual([]);
  });
});
