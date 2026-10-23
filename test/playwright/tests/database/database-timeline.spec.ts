/**
 * The Notion timeline layout (research/03 §7, research/07, research/08),
 * board card parity (research/03 §3) and the calendar "No date (N)" list.
 * Each write is checked in the saved JSON.
 */

import type { Locator, Page } from '@playwright/test';

import { generateKeyBetween } from 'fractional-indexing';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/** Valid fractional keys. `a000`-style keys are ones the library rejects. */
const rowKey = (i: number): string => Array.from({ length: i }).reduce<string>((key) => generateKeyBetween(key, null), 'a0');

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'p-end', name: 'End', type: 'date', position: 'a2' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a3' },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a4' },
  {
    id: 'p-status', name: 'Status', type: 'select', position: 'a5', config: { options: [
      { id: 'o-todo', label: 'Todo', color: 'gray', position: 'a0' },
      { id: 'o-done', label: 'Done', color: 'green', position: 'a1' },
    ] },
  },
];

interface RowSeed {
  id: string;
  properties: Record<string, unknown>;
  reminders?: Record<string, unknown>;
}

const ROWS: RowSeed[] = [
  { id: 'r1', properties: { 'p-title': 'Launch', 'p-due': '2026-10-09', 'p-status': 'o-todo', 'p-done': false, 'p-notes': 'Bring cake' } },
  { id: 'r2', properties: { 'p-title': 'Trip', 'p-due': '2026-10-12/2026-10-14', 'p-status': 'o-todo', 'p-done': true } },
  { id: 'r3', properties: { 'p-title': 'Someday', 'p-status': 'o-done' } },
];

const blocks = (view: Record<string, unknown>, rows: RowSeed[] = ROWS): OutputBlockData[] => [
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
  ...rows.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    data: { position: rowKey(i), properties: row.properties, ...(row.reminders !== undefined ? { reminders: row.reminders } : {}) },
  })),
];

const mount = async (page: Page, data: OutputBlockData[], readOnly = false): Promise<void> => {
  await page.evaluate(async ({ data: input, readOnly: ro }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, readOnly: ro });
    await window.blokInstance.isReady;
  }, { data, readOnly });
};

const savedRow = async (page: Page, rowId: string): Promise<Record<string, unknown>> => page.evaluate(async (id) => {
  const output = await window.blokInstance?.save();
  const row = (output?.blocks ?? []).find((block) => block.type === 'database-row' && block.id === id);

  return (row?.data as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
}, rowId);

const savedView = async (page: Page): Promise<Record<string, unknown>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = (output?.blocks ?? []).find((block) => block.type === 'database');

  return (db?.data as { views: Array<Record<string, unknown>> }).views[0];
});

const bar = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-timeline-bar][data-row-id="${rowId}"]`);
const boardCard = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-card][data-row-id="${rowId}"]`);
const drawer = (page: Page): Locator => page.locator('[data-blok-database-drawer]');

const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(() => window.localStorage.clear());
});

test.describe('timeline', () => {
  test('draws a 34px bar per dated row in 36px rows, sized by its days', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', name: 'Timeline' }));

    await expect(page.locator('[data-blok-database-timeline-row]')).toHaveCount(3);
    await expect(page.locator('[data-blok-database-timeline-bar]')).toHaveCount(2);

    const one = await bar(page, 'r1').boundingBox();
    const three = await bar(page, 'r2').boundingBox();

    expect(one?.height).toBeCloseTo(34, 0);
    expect(one?.width).toBeCloseTo(40, 0);
    expect(three?.width).toBeCloseTo(120, 0);
    await expect(bar(page, 'r1')).toHaveCSS('border-radius', '6px');
    expect((await page.locator('[data-blok-database-timeline-row]').first().boundingBox())?.height).toBeCloseTo(36, 0);
  });

  // 80-alarm-timeline.png: a one-day bar keeps its whole title and runs the shown properties after it, past the bar.
  test('a one-day bar draws its title whole and its properties after it', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', visibleProperties: ['p-due', 'p-notes'] }, [
      { id: 'r1', properties: { 'p-title': 'Launch party', 'p-due': '2026-10-09', 'p-notes': 'Bring cake' }, reminders: { 'p-due': { remind: '1_day_before' } } },
    ]));
    await page.emulateMedia({ colorScheme: 'light' });

    const layout = await bar(page, 'r1').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const title = el.querySelector('[data-blok-database-timeline-bar-title]');
      const props = [...el.querySelectorAll('[data-blok-database-timeline-bar-property]')].map((p) => p.getBoundingClientRect());
      const titleBox = title?.getBoundingClientRect();

      return {
        titleStart: (titleBox?.left ?? 0) - box.left,
        titleWhole: title !== null && title.scrollWidth <= title.clientWidth,
        titleEnd: titleBox?.right ?? 0,
        barEnd: box.right,
        propStarts: props.map((p) => p.left),
        firstPropEnd: props[0]?.right ?? 0,
        sameLine: props.every((p) => Math.abs(p.top + p.height / 2 - (box.top + box.height / 2)) < 4),
      };
    });

    expect(layout.titleStart).toBeCloseTo(6, 0);
    expect(layout.titleWhole).toBe(true);
    expect(layout.titleEnd).toBeGreaterThan(layout.barEnd);
    expect(layout.propStarts).toHaveLength(2);
    expect(layout.propStarts[0] - layout.titleEnd).toBeCloseTo(10, 0);
    expect(layout.propStarts[1] - layout.firstPropEnd).toBeCloseTo(6, 0);
    expect(layout.sameLine).toBe(true);
    await expect(bar(page, 'r1').locator('[data-blok-database-cell="date"]')).toHaveCSS('font-size', '12px');
    await expect(bar(page, 'r1').locator('[data-blok-database-timeline-bar-property]').last()).toHaveCSS('font-size', '13px');
    await expect(bar(page, 'r1').locator('[data-blok-database-cell="date"][data-reminder]')).toHaveCSS('color', 'rgb(35, 119, 211)');
  });

  test('shows today on screen with a dot and a line', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));

    await expect(page.locator('[data-blok-database-timeline-today-dot]')).toBeInViewport();
    await expect(page.locator('[data-blok-database-timeline-today-line]')).toHaveCSS('width', '1px');
  });

  test('dragging a bar moves its dates', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));
    const box = await bar(page, 'r1').boundingBox();

    if (box === null) throw new Error('no bar');
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 80, y: box.y + box.height / 2 });

    await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-11');
  });

  test('dragging the end edge makes a range', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));
    const box = await bar(page, 'r1').boundingBox();

    if (box === null) throw new Error('no bar');
    await drag(page, { x: box.x + box.width - 1, y: box.y + box.height / 2 }, { x: box.x + box.width - 1 + 80, y: box.y + box.height / 2 });

    await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09/2026-10-11');
  });

  test('a bar from separate start and end properties writes both when moved', async ({ page }) => {
    const rows = [{ id: 'r1', properties: { 'p-title': 'Build', 'p-due': '2026-10-08', 'p-end': '2026-10-10' } }];

    await mount(page, blocks({ type: 'timeline', timelineBy: 'p-due', timelineEndBy: 'p-end' }, rows));
    const box = await bar(page, 'r1').boundingBox();

    expect(box?.width).toBeCloseTo(120, 0);
    if (box === null) throw new Error('no bar');
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 - 40, y: box.y + box.height / 2 });

    await expect.poll(async () => savedRow(page, 'r1')).toMatchObject({ 'p-due': '2026-10-07', 'p-end': '2026-10-09' });
  });

  test.describe('hours zoom (research/22 §9)', () => {
    const timed = [{ id: 'r1', properties: { 'p-title': 'Call', 'p-due': '2026-10-09T03:00/2026-10-09T04:00' } }];
    const mountHours = async (page: Page): Promise<{ x: number; y: number; width: number }> => {
      await mount(page, blocks({ type: 'timeline', timelineZoom: 'hours' }, timed));
      await bar(page, 'r1').scrollIntoViewIfNeeded();
      const box = await bar(page, 'r1').boundingBox();

      if (box === null) throw new Error('no bar');

      return { x: box.x, y: box.y + box.height / 2, width: box.width };
    };

    test('a move follows the pointer as a ghost and rounds to the nearest 15 minutes on drop', async ({ page }) => {
      const box = await mountHours(page);

      // Hours zoom draws one pixel per minute.
      expect(box.width).toBeCloseTo(60, 0);
      await page.mouse.move(box.x + 30, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 40, box.y, { steps: 5 });
      expect((await bar(page, 'r1').boundingBox())?.x).toBeCloseTo(box.x + 10, 0);
      await expect(page.getByRole('tooltip')).toBeHidden();
      await page.mouse.up();

      await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09T03:15/2026-10-09T04:15');
    });

    test('a left-edge resize snaps live and reads the new start', async ({ page }) => {
      const box = await mountHours(page);

      // research/23 §3b: the handle reaches 6px outside the bar.
      await page.mouse.move(box.x - 4, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x - 14, box.y, { steps: 5 });
      await expect(page.getByRole('tooltip')).toHaveText('Oct 9, 2:45 AM');
      expect((await bar(page, 'r1').boundingBox())?.x).toBeCloseTo(box.x - 15, 0);
      await page.mouse.up();

      await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09T02:45/2026-10-09T04:00');
      await expect(page.getByRole('tooltip')).toBeHidden();
    });

    test('a right-edge resize snaps the same way and reads the new end', async ({ page }) => {
      const box = await mountHours(page);

      // research/23 §3b: the handle reaches 6px outside the bar.
      await page.mouse.move(box.x + box.width + 4, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width + 14, box.y, { steps: 5 });
      await expect(page.getByRole('tooltip')).toHaveText('Oct 9, 4:15 AM');
      // The readout sits to the right of the dragged end edge.
      const edge = await bar(page, 'r1').boundingBox();
      const readout = await page.getByRole('tooltip').boundingBox();

      expect(readout?.x ?? 0).toBeGreaterThanOrEqual((edge?.x ?? 0) + (edge?.width ?? 0));
      await page.mouse.up();

      await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09T03:00/2026-10-09T04:15');
    });
  });

  test('a bar\'s right-click menu has no Comment; a table panel row\'s does (research/22 §11)', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));

    await bar(page, 'r1').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /Copy link/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Comment/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: /Copy link/ })).toHaveCount(0);

    await page.locator('[data-blok-database-timeline-table-row][data-row-id="r1"]').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /Comment/ })).toBeVisible();
  });

  test('the zoom menu, + and - keys change the zoom', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));

    await page.locator('[data-blok-database-timeline-scroller]').focus();
    await page.keyboard.press('-');
    await expect(page.locator('[data-blok-database-timeline]')).toHaveAttribute('data-zoom', 'quarter');
    expect((await savedView(page)).timelineZoom).toBe('quarter');

    await page.locator('[data-blok-database-timeline-scroller]').focus();
    await page.keyboard.press('+');
    await expect(page.locator('[data-blok-database-timeline]')).toHaveAttribute('data-zoom', 'month');
  });

  test('arrow keys pan the timeline', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));
    const scroller = page.locator('[data-blok-database-timeline-scroller]');
    const before = await scroller.evaluate((el) => el.scrollLeft);

    await scroller.focus();
    await page.keyboard.press('ArrowRight');

    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  });

  test('an off-screen arrow jumps to its bar', async ({ page }) => {
    const rows = [
      { id: 'r1', properties: { 'p-title': 'Now', 'p-due': '2026-10-09' } },
      { id: 'r2', properties: { 'p-title': 'Later', 'p-due': '2026-12-20' } },
    ];

    await mount(page, blocks({ type: 'timeline' }, rows));
    const arrow = page.locator('[data-blok-database-timeline-row][data-row-id="r2"] [data-blok-database-timeline-offscreen="after"]');

    await expect(arrow).toBeVisible();
    await arrow.click();
    await expect(bar(page, 'r2')).toBeInViewport();
  });

  // research/26 §4d: a straight arrow about 8x7 px in the 14x12 icon box, not a chevron.
  test('an off-screen arrow draws a straight arrow at Notion\'s size', async ({ page }) => {
    const rows = [
      { id: 'r1', properties: { 'p-title': 'Now', 'p-due': '2026-10-09' } },
      { id: 'r2', properties: { 'p-title': 'Later', 'p-due': '2026-12-20' } },
    ];

    await mount(page, blocks({ type: 'timeline' }, rows));
    const arrow = page.locator('[data-blok-database-timeline-row][data-row-id="r2"] [data-blok-database-timeline-offscreen="after"]');

    await expect(arrow).toBeVisible();

    expect(await arrow.evaluate((el) => [...el.querySelectorAll('svg path')].map((path) => path.getAttribute('d'))))
      .toEqual(['M3.75 10L16.25 10', 'M10.75 4.5L16.25 10L10.75 15.5']);
    const box = await arrow.evaluate((el) => {
      const rects = [...el.querySelectorAll('svg path')].map((path) => path.getBoundingClientRect());

      return {
        width: Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)),
        height: Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)),
      };
    });

    expect(box.width).toBeCloseTo(7.5, 0);
    expect(box.height).toBeCloseTo(6.6, 0);
  });

  test('the table panel toggles and lists its own properties', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', tableProperties: [{ id: 'p-due', visible: true }] }));

    await page.locator('[data-blok-database-timeline-table-toggle]').click();

    const table = page.locator('[data-blok-database-timeline-table]');

    await expect(table).toBeVisible();
    await expect(table.locator('[data-blok-database-timeline-table-header] [data-property-id]')).toHaveCount(2);
    expect((await savedView(page)).showTimelineTable).toBe(true);
  });

  test('"Today" and clicking a bar open the row in a peek', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));

    await page.locator('[data-blok-database-timeline-today]').click();
    await bar(page, 'r1').click();

    await expect(drawer(page)).toBeVisible();
  });

  test('read-only shows bars without "+ New" or handles', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }), true);

    await expect(page.locator('[data-blok-database-timeline-bar]')).toHaveCount(2);
    await expect(page.locator('[data-blok-database-timeline-new]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-timeline-resize]')).toHaveCount(0);
  });
});

test.describe('board cards', () => {
  const boardView = { type: 'board', groupBy: 'p-status', properties: [{ id: 'p-done', visible: true }, { id: 'p-notes', visible: true }] };

  test('cards show their visible properties', async ({ page }) => {
    await mount(page, blocks(boardView));

    await expect(boardCard(page, 'r1').locator('[data-blok-database-card-property][data-property-id="p-notes"]')).toHaveText('Bring cake');
  });

  test('clicking a checkbox property flips it without opening the page', async ({ page }) => {
    await mount(page, blocks(boardView));

    await boardCard(page, 'r2').locator('[data-blok-database-card-property][data-property-id="p-done"]').click();

    await expect.poll(async () => (await savedRow(page, 'r2'))['p-done']).toBe(false);
    await expect(drawer(page)).toBeHidden();
  });

  test('large cards are wider than small ones', async ({ page }) => {
    await mount(page, blocks({ ...boardView, cardSize: 'small' }));
    const small = (await boardCard(page, 'r1').boundingBox())?.width ?? 0;

    await mount(page, blocks({ ...boardView, cardSize: 'large' }));
    const large = (await boardCard(page, 'r1').boundingBox())?.width ?? 0;

    expect(large).toBeGreaterThan(small);
  });

  test('arrow keys move between cards and Enter opens one', async ({ page }) => {
    await mount(page, blocks(boardView));

    await boardCard(page, 'r1').focus();
    await page.keyboard.press('ArrowDown');
    await expect(boardCard(page, 'r2')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(boardCard(page, 'r3')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
  });

  test('sub-groups draw one lane per value', async ({ page }) => {
    await mount(page, blocks({ ...boardView, subGroupBy: 'p-done' }));

    expect(await page.locator('[data-blok-database-board-lane]').count()).toBeGreaterThanOrEqual(2);
  });
});

test.describe('calendar "No date"', () => {
  test('lists the undated rows and drags one onto a day', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    // findings C04: in the database toolbar, a 28px button that opens a popover of the undated rows.
    const button = page.getByTestId('database-toolbar-no-date');

    await expect(button).toHaveText(/\(1\)/);
    expect((await button.boundingBox())?.height).toBeCloseTo(28, 0);
    await button.click();

    const item = page.locator('[data-blok-database-no-date-row][data-row-id="r3"]');
    const itemBox = await item.boundingBox();
    const dayBox = await page.locator('[data-blok-database-calendar-day][data-day="2026-10-20"]').boundingBox();

    if (itemBox === null || dayBox === null) throw new Error('no box');
    await drag(page, { x: itemBox.x + 10, y: itemBox.y + itemBox.height / 2 }, { x: dayBox.x + dayBox.width / 2, y: dayBox.y + dayBox.height / 2 });

    await expect.poll(async () => (await savedRow(page, 'r3'))['p-due']).toBe('2026-10-20');
  });
});
