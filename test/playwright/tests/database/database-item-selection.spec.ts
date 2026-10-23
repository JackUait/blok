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

  // research/30 B11: one Escape cleared the picks; a second changed nothing.
  test('one Escape clears a drag box made inside the calendar grid; a second Escape changes nothing', async ({ page }) => {
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() === today.getDate();
    const [first, second] = await isoDays(page, lastDay ? [-1, 0] : [0, 1]);

    await mount(page, blocks({ type: 'calendar' }, [first, second]));
    const events = page.locator('[data-blok-database-calendar-event]');

    await expect(events).toHaveCount(2);
    const a = await events.nth(0).boundingBox();
    const b = await events.nth(1).boundingBox();
    const cell = await page.locator(`[data-blok-database-calendar-day][data-day="${first}"]`).boundingBox();

    if (a === null || b === null || cell === null) {
      throw new Error('no boxes');
    }

    await lasso(
      page,
      { x: cell.x + 8, y: cell.y + cell.height - 6 },
      { x: Math.max(a.x + a.width, b.x + b.width) - 4, y: Math.min(a.y, b.y) + 4 }
    );
    expect(await picked(page)).toEqual(['r1', 'r2']);

    await page.keyboard.press('Escape');
    expect(await picked(page)).toEqual([]);

    await page.keyboard.press('Escape');
    expect(await picked(page)).toEqual([]);
    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(events).toHaveCount(2);
    await expect(page.locator('[data-blok-database-drawer]')).toHaveCount(0);
  });

  test('started on empty space inside the calendar grid, picks every event it touches, creates none, selects no text (research/23 §2c)', async ({ page }) => {
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() === today.getDate();
    const [first, second] = await isoDays(page, lastDay ? [-1, 0] : [0, 1]);

    await mount(page, blocks({ type: 'calendar' }, [first, second]));
    const events = page.locator('[data-blok-database-calendar-event]');

    await expect(events).toHaveCount(2);
    const a = await events.nth(0).boundingBox();
    const b = await events.nth(1).boundingBox();
    const cell = await page.locator(`[data-blok-database-calendar-day][data-day="${first}"]`).boundingBox();

    if (a === null || b === null || cell === null) {
      throw new Error('no boxes');
    }

    await lasso(
      page,
      { x: cell.x + 8, y: cell.y + cell.height - 6 },
      { x: Math.max(a.x + a.width, b.x + b.width) - 4, y: Math.min(a.y, b.y) + 4 }
    );

    expect(await picked(page)).toEqual(['r1', 'r2']);
    await expect(events).toHaveCount(2);
    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-calendar-lasso]')).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await expect.poll(async () => page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return output?.blocks.filter((block) => block.type === 'database-row').length ?? 0;
    })).toBe(3);

    await page.keyboard.press('Escape');
    expect(await picked(page)).toEqual([]);
  });

  // research/31 §6: with events selected, one click on an empty day cleared them; a double-click cleared them and made a page.
  for (const [name, clicks] of [['a single click', 1], ['a double-click', 2]] as const) {
    test(`${name} on an empty day clears a drag box selection${clicks === 2 ? ' and adds a row there' : ', adds nothing'}`, async ({ page }) => {
      const today = new Date();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() === today.getDate();
      const [first, second] = await isoDays(page, lastDay ? [-1, 0] : [0, 1]);

      await mount(page, blocks({ type: 'calendar' }, [first, second]));
      const events = page.locator('[data-blok-database-calendar-event]');

      await expect(events).toHaveCount(2);
      const a = await events.nth(0).boundingBox();
      const b = await events.nth(1).boundingBox();
      const cell = await page.locator(`[data-blok-database-calendar-day][data-day="${first}"]`).boundingBox();
      const emptyDay = page.locator('[data-blok-database-calendar-day]').filter({ hasNot: page.locator('[data-blok-database-calendar-event]') }).last();
      const empty = await emptyDay.boundingBox();
      const emptyIso = await emptyDay.getAttribute('data-day');

      if (a === null || b === null || cell === null || empty === null) {
        throw new Error('no boxes');
      }

      await lasso(
        page,
        { x: cell.x + 8, y: cell.y + cell.height - 6 },
        { x: Math.max(a.x + a.width, b.x + b.width) - 4, y: Math.min(a.y, b.y) + 4 }
      );
      expect(await picked(page)).toEqual(['r1', 'r2']);

      const at = { x: empty.x + empty.width / 2, y: empty.y + empty.height - 8 };

      await (clicks === 2 ? page.mouse.dblclick(at.x, at.y) : page.mouse.click(at.x, at.y));

      expect(await picked(page)).toEqual([]);
      await expect.poll(async () => page.evaluate(async () => {
        const output = await window.blokInstance?.save();

        return output?.blocks.filter((block) => block.type === 'database-row').map((block) => {
          const due = (block.data as { properties: Record<string, unknown> }).properties['p-due'];

          return typeof due === 'string' ? due : '';
        }).sort() ?? [];
      })).toEqual((clicks === 2 ? [first, second, '', emptyIso ?? 'none'] : [first, second, '']).sort());
    });
  }

  // research/35:237-238: a drag box picks board cards and list rows, never the database block.
  test('across a board picks every card it touches, and not the block', async ({ page }) => {
    await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));
    const cardBox = await item(page, '[data-blok-database-card]', 'r1').boundingBox();
    const holder = await page.locator('[data-blok-editor]').boundingBox();

    if (cardBox === null || holder === null) {
      throw new Error('no boxes');
    }

    await lasso(page, { x: holder.x - 20, y: cardBox.y - 4 }, { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 });

    expect(await picked(page)).toEqual(['r1']);
    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('from the right margin across a list picks every row it touches, and not the block', async ({ page }) => {
    await mount(page, blocks({ type: 'list' }));
    const first = await item(page, '[data-blok-database-list-row]', 'r1').boundingBox();
    const second = await item(page, '[data-blok-database-list-row]', 'r2').boundingBox();
    const holder = await page.locator('[data-blok-editor]').boundingBox();

    if (first === null || second === null || holder === null) {
      throw new Error('no boxes');
    }

    await lasso(page, { x: holder.x + holder.width + 20, y: first.y + 4 }, { x: first.x + first.width - 40, y: second.y + second.height / 2 });

    expect(await picked(page)).toEqual(['r1', 'r2']);
    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('started on empty board space, picks every card it touches and selects no text', async ({ page }) => {
    await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));
    const first = await item(page, '[data-blok-database-card]', 'r1').boundingBox();
    const ship = await page.locator('[data-blok-database-column][data-option-id="o-ship"]').boundingBox();

    if (first === null || ship === null) {
      throw new Error('no boxes');
    }

    // From the empty board space under the shorter Ship column, up and left into the Idea column.
    await lasso(page, { x: ship.x + 20, y: ship.y + ship.height + 10 }, { x: first.x + 20, y: first.y + first.height / 2 });

    expect(await picked(page)).toEqual(['r1', 'r2', 'r3']);
    await expect(database(page)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(page.locator('[data-blok-database-board-lasso]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-drawer]')).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

    await page.keyboard.press('Escape');
    expect(await picked(page)).toEqual([]);
  });
});

test.describe('gallery: closing a peek (research/23 §8)', () => {
  const card = (page: Page, rowId: string): Locator => item(page, '[data-blok-database-gallery-card]', rowId);
  const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');

  test('a peek opened from a selection gives the selection and the keys back when it closes', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery' }));

    await card(page, 'r2').click({ modifiers: ['Shift'] });
    await page.keyboard.press('Enter');
    await expect(peek(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveCount(0);

    expect(await picked(page)).toEqual(['r2']);
    // The first ArrowDown moves on; Notion loses it to a page scroll.
    await page.keyboard.press('ArrowDown');
    expect(await picked(page)).toEqual(['r3']);
  });

  test('a peek opened by a plain click leaves nothing selected when it closes', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery' }));

    await card(page, 'r2').click();
    await expect(peek(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveCount(0);

    expect(await picked(page)).toEqual([]);
  });
});
