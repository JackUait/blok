/**
 * The Notion timeline layout (research/03 §7, research/07, research/08),
 * board card parity (research/03 §3) and the calendar "No date (N)" list.
 * Each write is checked in the saved JSON.
 */

import type { Locator, Page } from '@playwright/test';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { POINTER_MENU_WINDOW, expectPointerMenu, placeAt } from '../helpers/pointer-menu';

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

    // findings C03: with the table hidden, the undated row has no lane.
    await expect(page.locator('[data-blok-database-timeline-row]')).toHaveCount(2);
    await expect(page.locator('[data-blok-database-timeline-bar]')).toHaveCount(2);

    const one = await bar(page, 'r1').boundingBox();
    const three = await bar(page, 'r2').boundingBox();

    expect(one?.height).toBeCloseTo(34, 0);
    // notion-motion.md Round 71 §3: 2px in from the first day's start, 1px short of the last day's end.
    expect(one?.width).toBeCloseTo(37, 0);
    expect(three?.width).toBeCloseTo(117, 0);
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
    // notion-spec-2 §21.9: every value after the bar is 12/18.
    await expect(bar(page, 'r1').locator('[data-blok-database-timeline-bar-property]').last()).toHaveCSS('font-size', '12px');
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

    expect(box?.width).toBeCloseTo(117, 0);
    if (box === null) throw new Error('no bar');
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 - 40, y: box.y + box.height / 2 });

    await expect.poll(async () => savedRow(page, 'r1')).toMatchObject({ 'p-due': '2026-10-07', 'p-end': '2026-10-09' });
  });

  test.describe('hours zoom (research/22 §9)', () => {
    const timed = [{ id: 'r1', properties: { 'p-title': 'Call', 'p-due': '2026-10-09T03:00/2026-10-09T04:00' } }];
    /** notion-motion.md Round 34 §5: 7000 px per day. */
    const PER_MINUTE = 7000 / 1440;
    const readout = (page: Page, edge: 'start' | 'end'): Locator =>
      bar(page, 'r1').locator(`[data-blok-database-timeline-edge-readout="${edge}"]`);
    const mountHours = async (page: Page): Promise<{ x: number; y: number; width: number }> => {
      await mount(page, blocks({ type: 'timeline', timelineZoom: 'hours' }, timed));
      await bar(page, 'r1').scrollIntoViewIfNeeded();
      const box = await bar(page, 'r1').boundingBox();

      if (box === null) throw new Error('no bar');

      return { x: box.x, y: box.y + box.height / 2, width: box.width };
    };

    test('a move follows the pointer as a ghost and rounds to the nearest 15 minutes on drop', async ({ page }) => {
      const box = await mountHours(page);

      // notion-motion.md Round 51 §4: Notion's 1-hour bar is 288.7, 3 short of 60 minutes.
      expect(box.width).toBeCloseTo(288.7, 0);
      await page.mouse.move(box.x + 30, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 30 + 10 * PER_MINUTE, box.y, { steps: 5 });
      expect((await bar(page, 'r1').boundingBox())?.x).toBeCloseTo(box.x + 10 * PER_MINUTE, 0);
      await expect(page.locator('[data-blok-database-timeline-edge-readout]')).toHaveCount(0);
      await page.mouse.up();

      await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09T03:15/2026-10-09T04:15');
    });

    test('a left-edge resize snaps live and reads the new start', async ({ page }) => {
      const box = await mountHours(page);

      // research/23 §3b: the handle reaches 6px outside the bar.
      await page.mouse.move(box.x - 4, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x - 4 - 14 * PER_MINUTE, box.y, { steps: 5 });
      // notion-motion.md Round 51 §4: the edge reads in the light box beside it, not a tooltip.
      await expect(readout(page, 'start')).toHaveText('Oct 9, 2:45 AM');
      expect((await bar(page, 'r1').boundingBox())?.x).toBeCloseTo(box.x - 15 * PER_MINUTE, 0);
      await page.mouse.up();

      await expect.poll(async () => (await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09T02:45/2026-10-09T04:00');
      await expect(page.locator('[data-blok-database-timeline-edge-readout]')).toHaveCount(0);
    });

    test('a right-edge resize snaps the same way and reads the new end', async ({ page }) => {
      const box = await mountHours(page);

      // research/23 §3b: the handle reaches 6px outside the bar.
      await page.mouse.move(box.x + box.width + 4, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width + 4 + 14 * PER_MINUTE, box.y, { steps: 5 });
      await expect(readout(page, 'end')).toHaveText('Oct 9, 4:15 AM');
      // notion-motion.md Round 51 §4: the box starts 10 right of the dragged end edge.
      const edge = await bar(page, 'r1').boundingBox();
      const readoutBox = await readout(page, 'end').boundingBox();

      if (edge === null || readoutBox === null) throw new Error('no layout');
      expect(readoutBox.x - (edge.x + edge.width)).toBeCloseTo(10, 0);
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

  // notion-motion.md Round 56 §9: the bar menu opens at the pointer (x 895 on a bar from 870).
  test('a bar\'s right-click menu opens at the pointer', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));

    const box = await bar(page, 'r2').boundingBox();

    if (box === null) throw new Error('no bar');
    const x = Math.round(box.x + box.width - 10);

    await page.mouse.click(x, box.y + box.height / 2, { button: 'right' });
    await expect(page.getByRole('menuitem', { name: /Copy link/ })).toBeVisible();
    const menu = await page.locator('[data-blok-popover][data-blok-popover-opened="true"] [data-blok-popover-container]').boundingBox();

    if (menu === null) throw new Error('no menu');
    expect(menu.x).toBeCloseTo(x, 0);
  });

  // notion-motion.md Round 56 §9: a panel title click, or Cmd+click, edits the title in place; no peek.
  test('a click on a panel title edits it in place and opens no peek', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));

    const row = page.locator('[data-blok-database-timeline-table-row][data-row-id="r1"]');
    const rowBox = await row.boundingBox();

    if (rowBox === null) throw new Error('no row');
    await row.locator('[data-blok-database-timeline-table-title-text]').click({ modifiers: ['ControlOrMeta'] });
    const input = page.locator('[data-blok-database-cell-input="title"]');

    await expect(input).toBeFocused();
    await expect(drawer(page)).not.toBeVisible();
    const editor = await input.boundingBox();

    if (editor === null) throw new Error('no editor');
    expect(editor.x - rowBox.x).toBeCloseTo(-1, 0);
    await input.fill('Lift-off');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await savedRow(page, 'r1'))['p-title']).toBe('Lift-off');
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

  test('Left and Right leave the timeline where it is: panning is Shift+wheel and drag (findings K10)', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));
    const scroller = page.locator('[data-blok-database-timeline-scroller]');
    const before = await scroller.evaluate((el) => el.scrollLeft);

    await scroller.focus();
    await page.keyboard.press('ArrowRight');

    expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(before);
  });

  test('arrows select bars, Shift extends, Escape clears, with the gray halo and no ring (findings K10)', async ({ page }) => {
    const rows = [
      { id: 'r1', properties: { 'p-title': 'One', 'p-due': '2026-10-09' } },
      { id: 'r2', properties: { 'p-title': 'Two', 'p-due': '2026-10-10' } },
      { id: 'r3', properties: { 'p-title': 'Three', 'p-due': '2026-10-11' } },
    ];

    await mount(page, blocks({ type: 'timeline' }, rows));
    const line = (id: string): Locator => page.locator(`[data-blok-database-timeline-row][data-row-id="${id}"]`);
    const bar = (id: string): Locator => page.locator(`[data-blok-database-timeline-bar][data-row-id="${id}"]`);

    await bar('r1').focus();
    await page.keyboard.press('ArrowDown');
    await expect(line('r2')).toHaveAttribute('data-blok-database-row-selected', '');
    await expect(line('r1')).not.toHaveAttribute('data-blok-database-row-selected', '');
    expect(await bar('r2').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');

    await page.keyboard.press('Shift+ArrowDown');
    await expect(line('r2')).toHaveAttribute('data-blok-database-row-selected', '');
    await expect(line('r3')).toHaveAttribute('data-blok-database-row-selected', '');

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-database-timeline-row][data-blok-database-row-selected]')).toHaveCount(0);
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
      .toEqual(['M3.75 10h12.5M10.75 4.5 16.25 10l-5.5 5.5']);
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

  // notion-motion.md Round 6: the panel is 376 wide and its Name column starts 96 in, at both 1512 and 1100.
  // Round 48 A7: its first 6px sit under Notion's sidebar, so 370 and 90 of it show.
  test('the table panel is 370 wide with its Name column 90 in, whatever the window width', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));

    for (const width of [1512, 1100]) {
      await page.setViewportSize({ width, height: 717 });
      const panel = await page.locator('[data-blok-database-timeline-table]').boundingBox();
      const name = await page.locator('[data-blok-database-timeline-table-header]').boundingBox();

      if (panel === null || name === null) throw new Error('no layout');
      expect(panel.width).toBeCloseTo(370, 0);
      expect(name.x - panel.x).toBeCloseTo(90, 0);
    }
  });

  // notion-motion.md Round 51 §3: with Name and two more columns Notion's panel row is 679 wide and the Name
  // editor from "+ New" is 280 at x 359 (1 left of the row). 200 per extra column is a fit to the 679 total.
  test('the table panel keeps Name 279 wide and grows with more columns, the Name editor 280', async ({ page }) => {
    await mount(page, blocks({
      type: 'timeline',
      showTimelineTable: true,
      tableProperties: [{ id: 'p-due', visible: true }, { id: 'p-notes', visible: true }],
    }));

    const panel = page.locator('[data-blok-database-timeline-table]');
    const row = panel.locator('[data-blok-database-timeline-table-row]').first();
    const widths = await row.evaluate((el) => [...el.children].map((cell) => cell.getBoundingClientRect().width));
    const rowBox = await row.boundingBox();
    const panelBox = await panel.boundingBox();

    if (rowBox === null || panelBox === null) throw new Error('no layout');
    expect(rowBox.width).toBeCloseTo(679, 0);
    expect(widths.slice(1)).toEqual([200, 200]);
    // Round 53 §3: the panel grows with the row (Notion 280 + 200 per column), and the chart starts past it.
    expect(panelBox.width).toBeCloseTo(370 + 2 * 200, 0);
    const chart = await page.locator('[data-blok-database-timeline-scroller]').boundingBox();

    if (chart === null) throw new Error('no chart');
    expect(chart.x).toBeCloseTo(panelBox.x + panelBox.width, 0);

    await panel.locator('[data-blok-database-timeline-table-new]').click();
    const editor = await page.locator('[data-blok-database-cell-input="title"]').boundingBox();

    if (editor === null) throw new Error('no editor');
    expect(editor.width).toBeCloseTo(280, 0);
    expect(editor.x - rowBox.x).toBeCloseTo(-1, 0);
  });

  // Notion: the card starts 4 under the view top (motion-r6-timelinepanel.json panel 309 in a 305 view; Round 47 A4
  // content at 309.2 under a 305.2 scroller). The open « ink is at 321.2 (Round 50 item 6), 12 into the card.
  test('the table panel is a white card from above « to the chart\'s bottom', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));

    for (const width of [1512, 1100]) {
      await page.setViewportSize({ width, height: 717 });
      const panelLocator = page.locator('[data-blok-database-timeline-table]');
      const panel = await panelLocator.boundingBox();
      const view = await page.locator('[data-blok-database-timeline]').boundingBox();
      const toggle = await page.locator('[data-blok-database-timeline-table-toggle]').boundingBox();
      const ink = await page.locator('[data-blok-database-timeline-table-toggle] svg').boundingBox();
      const scroller = await page.locator('[data-blok-database-timeline-scroller]').boundingBox();
      const canvas = await page.locator('[data-blok-database-timeline-canvas]').boundingBox();

      if (panel === null || view === null || toggle === null || ink === null || scroller === null || canvas === null) throw new Error('no layout');
      expect(panel.y - view.y).toBeCloseTo(4, 0);
      expect(ink.y - panel.y).toBeCloseTo(12, 0);
      expect(panel.y + panel.height).toBeCloseTo(scroller.y + scroller.height, 0);
      // The weekend stripes and today line run to the bottom too.
      expect(canvas.y + canvas.height).toBeCloseTo(scroller.y + scroller.height - 1, 0);
      expect(await panelLocator.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow])).toEqual([
        'rgb(255, 255, 255)',
        'rgba(25, 25, 25, 0.027) 0px 4px 12px 0px, rgba(25, 25, 25, 0.02) 0px 1px 2px 0px',
      ]);
      // « stays on top of the card it sits in.
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-blok-database-timeline-table-toggle]') !== null, { x: toggle.x + toggle.width / 2, y: toggle.y + toggle.height / 2 })).toBe(true);
    }
  });

  // timeline.png (Alpha row): the "←" chip's 16px box (white edge, 14px grey fill) starts 8px into the chart.
  for (const readOnly of [false, true]) {
    test(`an off-screen "←" chip sits 8px into the chart${readOnly ? ' in a read-only view' : ''}`, async ({ page }) => {
      const rows = [
        { id: 'r1', properties: { 'p-title': 'Now', 'p-due': '2026-10-09' } },
        { id: 'r2', properties: { 'p-title': 'Long ago', 'p-due': '2025-01-05' } },
      ];

      await mount(page, blocks({ type: 'timeline', showTimelineTable: true }, rows), readOnly);
      const arrow = page.locator('[data-blok-database-timeline-row][data-row-id="r2"] [data-blok-database-timeline-offscreen="before"]');

      await expect(arrow).toBeVisible();
      const box = await arrow.boundingBox();
      const scroller = await page.locator('[data-blok-database-timeline-scroller]').boundingBox();

      if (box === null || scroller === null) throw new Error('no layout');
      expect(box.x - scroller.x).toBeCloseTo(8, 0);
      expect([box.width, box.height]).toEqual([16, 16]);
    });
  }

  // notion-motion.md Round 50 item 6: the panel ends at 640 (the month box), the open « ink is at 609, the month ink at 656.
  test('with the table shown, « sits at the panel\'s end and the month 16px into the chart, in a view wider than the text column', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));

    const panel = await page.locator('[data-blok-database-timeline-table]').boundingBox();
    const chevron = await page.locator('[data-blok-database-timeline-table-toggle]').evaluate((el) => el.querySelector('svg')?.getBoundingClientRect().toJSON() as { x: number } | undefined ?? null);
    const month = await page.locator('[data-blok-database-timeline-month]').boundingBox();

    if (panel === null || chevron === null || month === null) throw new Error('no layout');
    const panelEnd = panel.x + panel.width;

    expect(chevron.x - panelEnd).toBeCloseTo(-31, 0);
    expect(month.x - panelEnd).toBeCloseTo(16, 0);
  });

  // timeline.png and tlcollapse.png: hiding the table leaves every day at the same x (day 13 at 648, day 10 at 528).
  test('hiding and showing the table leaves the bars where they are', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));
    const x = async (): Promise<number> => (await bar(page, 'r2').boundingBox())?.x ?? Number.NaN;
    const shown = await x();

    await page.locator('[data-blok-database-timeline-table-toggle]').click();
    await expect(page.locator('[data-blok-database-timeline-table]')).toHaveCount(0);
    expect(await x()).toBeCloseTo(shown, 0);

    await page.locator('[data-blok-database-timeline-table-toggle]').click();
    await expect(page.locator('[data-blok-database-timeline-table]')).toBeVisible();
    expect(await x()).toBeCloseTo(shown, 0);
  });

  test('"Today" and clicking a bar open the row in a peek', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));

    await page.locator('[data-blok-database-timeline-today]').click();
    await bar(page, 'r1').click();

    await expect(drawer(page)).toBeVisible();
  });

  // notion-motion.md Round 25 §4: the ghost click makes a 5-day bar on the hovered day, named in place, no peek.
  // Round 46 B "Initial scroll" and Round 47 A1: Month opens with now in the middle, so only a few days either side show.
  test('a click on the "+ New" lane ghost adds a 5-day bar on the hovered day and names it in place', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline' }));

    const first = await bar(page, 'r1').boundingBox();
    const lane = await page.locator('[data-blok-database-timeline-new-lane]').boundingBox();
    const scroller = await page.locator('[data-blok-database-timeline-scroller]').boundingBox();

    if (first === null || lane === null || scroller === null) throw new Error('no layout');
    // r1 is on Oct 9; a month-zoom day is 40px wide. Oct 14 is 5 days later.
    const x = first.x - 2 + 5 * 40 + 20;

    expect(x).toBeLessThan(scroller.x + scroller.width);
    await page.mouse.move(x, lane.y + lane.height / 2);
    await expect(page.locator('[data-blok-database-timeline-new-ghost]')).toHaveAttribute('data-day', '2026-10-14');
    await page.mouse.click(x, lane.y + lane.height / 2);

    const input = page.getByPlaceholder('Type a name…');

    await expect(input).toBeFocused();
    await expect(drawer(page)).not.toBeVisible();
    await input.fill('Zed');
    await input.press('Enter');

    const due = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();
      const row = (output?.blocks ?? []).find((block) => block.type === 'database-row'
        && (block.data as { properties: Record<string, unknown> }).properties['p-title'] === 'Zed');

      return (row?.data as { properties: Record<string, unknown> } | undefined)?.properties['p-due'];
    });

    expect(due).toBe('2026-10-14/2026-10-18');
    await expect(drawer(page)).not.toBeVisible();
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

// notion-motion.md Round 59 §4: bars and panel rows open their row menu at the pointer, with the flip.
test.describe('right-click menu at the pointer', () => {
  for (const [name, target] of [
    ['a bar', (page: Page) => bar(page, 'r1')],
    ['a panel row', (page: Page) => page.locator('[data-blok-database-timeline-table-row][data-row-id="r1"]')],
  ] as const) {
    test(`${name}'s menu opens under the pointer near the top and above it near the bottom`, async ({ page }) => {
      await page.setViewportSize(POINTER_MENU_WINDOW);
      await mount(page, blocks({ type: 'timeline', showTimelineTable: true }));
      await placeAt(page, target(page), 192);
      const near = await expectPointerMenu(page, target(page));

      await placeAt(page, target(page), 592);
      const far = await expectPointerMenu(page, target(page));

      expect(near.top).toBeCloseTo(near.y + 1, 0);
      expect(far.top + far.height).toBeCloseTo(far.y, 0);
    });
  }
});
