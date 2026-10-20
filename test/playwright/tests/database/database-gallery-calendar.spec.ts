/**
 * The Notion gallery and calendar layouts (research/03 §4 and §6): cards,
 * previews, "+ New", drag reorder and load more; month and week grids,
 * multi-day bars, drag to move or span, "+" on a day, the day keyboard and
 * the per-person range. Each write is checked in the saved JSON.
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
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a2' },
  { id: 'p-image', name: 'Image', type: 'url', position: 'a3' },
];

interface RowSeed {
  id: string;
  properties: Record<string, unknown>;
  cover?: string;
  reminders?: Record<string, unknown>;
}

const ROWS: RowSeed[] = [
  { id: 'r1', properties: { 'p-title': 'Launch', 'p-due': '2026-10-09', 'p-notes': 'Bring cake' } },
  { id: 'r2', properties: { 'p-title': 'Trip', 'p-due': '2026-10-12/2026-10-14' } },
  { id: 'r3', properties: { 'p-title': 'Someday' } },
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
    data: {
      position: rowKey(i),
      properties: row.properties,
      ...(row.cover !== undefined ? { cover: row.cover } : {}),
      ...(row.reminders !== undefined ? { reminders: row.reminders } : {}),
    },
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

const savedRows = async (page: Page): Promise<Array<{ id: string; position: string; properties: Record<string, unknown> }>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? [])
    .filter((block) => block.type === 'database-row')
    .map((block) => ({ id: block.id ?? '', ...(block.data as { position: string; properties: Record<string, unknown> }) }));
});

const savedRow = async (page: Page, rowId: string): Promise<Record<string, unknown>> =>
  (await savedRows(page)).find((row) => row.id === rowId)?.properties ?? {};

const card = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-gallery-card][data-row-id="${rowId}"]`);
const day = (page: Page, iso: string): Locator => page.locator(`[data-blok-database-calendar-day][data-day="${iso}"]`);
const event = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-calendar-event][data-row-id="${rowId}"]`);
const drawer = (page: Page): Locator => page.locator('[data-blok-database-drawer]');

const dragBetween = async (page: Page, from: Locator, to: { x: number; y: number }, grab?: { x: number; y: number }): Promise<void> => {
  const box = await from.boundingBox();

  if (box === null) {
    throw new Error('no box to drag');
  }
  await page.mouse.move(box.x + (grab?.x ?? box.width / 2), box.y + (grab?.y ?? box.height / 2));
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
};

const center = async (locator: Locator, dx = 0): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error('no box');
  }

  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 };
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(() => window.localStorage.clear());
});

test.describe('gallery', () => {
  test('draws a card per row with the page-content preview and the measured look', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery', name: 'Gallery' }));

    await expect(page.locator('[data-blok-database-gallery-card]')).toHaveCount(3);
    await expect(card(page, 'r1').locator('[data-blok-database-gallery-title]')).toHaveText('Launch');
    expect((await card(page, 'r1').locator('[data-blok-database-gallery-preview]').boundingBox())?.height).toBeCloseTo(146, 0);
    await expect(page.locator('[data-blok-database-gallery-grid]')).toHaveCSS('gap', '16px');
  });

  test('shows a url property as the card image, and fits it on request', async ({ page }) => {
    const rows = [{ id: 'r1', properties: { 'p-title': 'Pic', 'p-image': 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } }];

    await mount(page, blocks({ type: 'gallery', cardPreview: 'property:p-image', fitImage: true }, rows));

    // alt="" makes the image decorative, so it has no img role.
    const image = card(page, 'r1').locator('[data-blok-database-gallery-image]');

    await expect(image).toHaveCount(1);
    await expect(image).toHaveCSS('object-fit', 'contain');
  });

  test('"Page cover" shows the row\'s own cover, and follows a cover set in the drawer', async ({ page }) => {
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const rows = [
      { id: 'r1', properties: { 'p-title': 'Covered' }, cover: pixel },
      { id: 'r2', properties: { 'p-title': 'Bare' } },
    ];

    await mount(page, blocks({ type: 'gallery', cardPreview: 'cover' }, rows));

    await expect(card(page, 'r1').locator('[data-blok-database-gallery-image]')).toHaveAttribute('src', pixel);
    await expect(card(page, 'r2').locator('[data-blok-database-gallery-image]')).toHaveCount(0);

    await card(page, 'r2').click();
    await drawer(page).locator('[data-blok-database-drawer-add-cover]').click();
    const picker = page.getByRole('dialog', { name: 'Set cover image' });

    await picker.getByRole('tab', { name: 'Link' }).click();
    await picker.getByRole('textbox', { name: 'Image URL' }).fill('https://example.com/new-cover.png');
    await picker.getByRole('button', { name: 'Insert' }).click();

    await expect(card(page, 'r2').locator('[data-blok-database-gallery-image]')).toHaveAttribute('src', 'https://example.com/new-cover.png');
  });

  test('large cards are wider than small ones', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery', cardSize: 'small' }));
    const small = (await card(page, 'r1').boundingBox())?.width ?? 0;

    await mount(page, blocks({ type: 'gallery', cardSize: 'large' }));
    const large = (await card(page, 'r1').boundingBox())?.width ?? 0;

    expect(large).toBeGreaterThan(small);
  });

  test('"+ New" in the trailing card adds a row', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery' }));

    await page.locator('[data-blok-database-gallery-new]').click();

    await expect(page.locator('[data-blok-database-gallery-card]')).toHaveCount(4);
    expect(await savedRows(page)).toHaveLength(4);
  });

  test.describe('hover buttons (research/12 §3)', () => {
    test('Edit and "•••" show at the card\'s top-right on hover only', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      const more = card(page, 'r1').getByRole('button', { name: 'Rename, delete, move to and more…' });
      const actions = card(page, 'r1').locator('[data-blok-database-card-actions]');

      await expect(actions).toHaveCSS('opacity', '0');
      await card(page, 'r1').hover();
      await expect(actions).toHaveCSS('opacity', '1');
      const cardBox = await card(page, 'r1').boundingBox();
      const moreBox = await more.boundingBox();

      if (cardBox === null || moreBox === null) throw new Error('no box');
      expect(cardBox.x + cardBox.width - (moreBox.x + moreBox.width)).toBeLessThan(16);
      expect(moreBox.y - cardBox.y).toBeLessThan(16);
    });

    test('"•••" opens the row menu, not the page', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await card(page, 'r1').hover();
      await card(page, 'r1').getByRole('button', { name: 'Rename, delete, move to and more…' }).click();

      await expect(page.locator('[data-blok-database-row-menu-heading]')).toBeVisible();
      await expect(drawer(page)).toBeHidden();
    });

    test('Edit renames the card in place', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await card(page, 'r1').hover();
      await card(page, 'r1').getByRole('button', { name: 'Edit' }).click();
      const input = card(page, 'r1').locator('[data-blok-database-gallery-title-input]');

      await expect(input).toBeFocused();
      await input.fill('Launch day');
      await input.press('Enter');

      await expect(drawer(page)).toBeHidden();
      expect((await savedRow(page, 'r1'))['p-title']).toBe('Launch day');
    });
  });

  test('clicking a card opens the row', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery' }));

    await card(page, 'r2').click();

    await expect(drawer(page)).toBeVisible();
  });

  test('dragging a card past its neighbour reorders the rows', async ({ page }) => {
    await mount(page, blocks({ type: 'gallery' }));

    await dragBetween(page, card(page, 'r1'), await center(card(page, 'r2'), 40));

    const order = (await savedRows(page)).sort((a, b) => (a.position < b.position ? -1 : 1)).map((row) => row.id);

    expect(order).toEqual(['r2', 'r1', 'r3']);
    await expect(drawer(page)).toHaveCount(0);
  });

  test.describe('keyboard (research/16 §3a)', () => {
    const selectedIds = async (page: Page): Promise<string[]> =>
      page.locator('[data-blok-database-gallery-card][aria-selected="true"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id') ?? ''));

    /** A click on empty gallery space, in the gap after the first card: what Notion's runs start from. */
    const clickBlank = async (page: Page): Promise<void> => {
      const box = await card(page, 'r1').boundingBox();

      if (box === null) throw new Error('no card');
      await page.mouse.click(box.x + box.width + 8, box.y + box.height / 2);
    };

    test('arrows select cards in reading order, Left/Right keep it, Shift+Up extends, Escape clears', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      expect(await selectedIds(page)).toEqual(['r1']);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      expect(await selectedIds(page)).toEqual(['r3']);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      expect(await selectedIds(page)).toEqual(['r3']);

      await page.keyboard.press('Shift+ArrowUp');
      expect(await selectedIds(page)).toEqual(['r2', 'r3']);
      await expect(page.locator('[data-blok-database-table-selection-bar]')).toBeVisible();

      await page.keyboard.press('Escape');
      expect(await selectedIds(page)).toEqual([]);
      await expect(page.locator('[data-blok-database-table-selection-bar]')).toHaveCount(0);
      await expect(drawer(page)).toHaveCount(0);
    });

    test('the selected card is gray, never blue, with the same ink as the others', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');

      const look = async (rowId: string): Promise<{ image: string; color: string; bg: string }> =>
        card(page, rowId).evaluate((el) => {
          const style = getComputedStyle(el);

          return { image: style.backgroundImage, color: style.color, bg: style.backgroundColor };
        });
      const picked = await look('r1');
      const other = await look('r2');
      const isBlue = (value: string): boolean => [...value.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)]
        .some(([, r, g, b]) => Number(b) > Number(r) + 40 && Number(b) > Number(g) + 20);

      expect(picked.image).not.toBe('none');
      expect(isBlue(picked.image)).toBe(false);
      expect(isBlue(picked.bg)).toBe(false);
      expect(picked.color).toBe(other.color);
    });

    test('Enter renames the selected card; Escape selects it again, a second Escape clears', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');

      const input = card(page, 'r2').getByRole('textbox');

      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('placeholder', 'Type a name…');
      expect(await selectedIds(page)).toEqual([]);
      await expect(drawer(page)).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(input).toHaveCount(0);
      expect(await selectedIds(page)).toEqual(['r2']);
      await page.keyboard.press('Escape');
      expect(await selectedIds(page)).toEqual([]);

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(input).toBeFocused();
      // The rename selects the old title, so typing replaces it.
      await page.keyboard.type('Road trip');
      await page.keyboard.press('Enter');

      await expect(card(page, 'r2').locator('[data-blok-database-gallery-title]')).toHaveText('Road trip');
      await expect.poll(async () => (await savedRow(page, 'r2'))['p-title']).toBe('Road trip');
      await expect.poll(() => selectedIds(page)).toEqual(['r2']);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => selectedIds(page)).toEqual(['r3']);
    });

    test('editor shortcuts still work while the gallery holds focus: undo a rename, open find', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Renamed');
      await page.keyboard.press('Enter');
      await expect(card(page, 'r1').locator('[data-blok-database-gallery-title]')).toHaveText('Renamed');
      await expect(page.locator('[data-blok-database-gallery]')).toBeFocused();

      await page.keyboard.press('ControlOrMeta+z');
      await expect(card(page, 'r1').locator('[data-blok-database-gallery-title]')).toHaveText('Launch');

      await page.keyboard.press('ControlOrMeta+f');
      await expect(page.getByTestId('find-bar')).toBeVisible();
    });

    test('Space on a selected card does nothing', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');

      expect(await selectedIds(page)).toEqual(['r1']);
      await expect(drawer(page)).toHaveCount(0);
      await expect(page.locator('[data-blok-database-gallery-card] input')).toHaveCount(0);
    });

    test('Tab goes card, Edit, "Rename, delete, move to and more…", next card; Enter opens the focused card', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);

      await page.keyboard.press('Tab');
      await expect(card(page, 'r1')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card(page, 'r1').getByRole('button', { name: 'Edit' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card(page, 'r1').getByRole('button', { name: 'Rename, delete, move to and more…' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card(page, 'r2')).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(drawer(page)).toBeVisible();
    });

    test('an arrow on a Tab-focused card selects that card, with no ring around the gallery', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      // Card r1, its Edit and "•••", then card r2.
      for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
      await expect(card(page, 'r2')).toBeFocused();

      await page.keyboard.press('ArrowDown');

      expect(await selectedIds(page)).toEqual(['r2']);
      await expect(page.locator('[data-blok-database-gallery]')).toBeFocused();
      await expect(page.locator('[data-blok-database-gallery]')).toHaveCSS('outline-style', 'none');
    });

    test('Cmd/Ctrl-click and Shift-click pick cards for the selection bar instead of opening them', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));

      await card(page, 'r1').click({ modifiers: ['ControlOrMeta'] });
      await card(page, 'r3').click({ modifiers: ['Shift'] });

      expect(await selectedIds(page)).toEqual(['r1', 'r2', 'r3']);
      await expect(page.locator('[data-blok-database-table-selection-bar]')).toBeVisible();
      await expect(drawer(page)).toHaveCount(0);
    });

    test('read-only: arrows select nothing', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }), true);
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');

      expect(await selectedIds(page)).toEqual([]);
    });
  });

  test('load more reveals the rest of the rows', async ({ page }) => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, properties: { 'p-title': `Card ${i}` } }));

    await mount(page, blocks({ type: 'gallery', loadLimit: 10 }, rows));
    await expect(page.locator('[data-blok-database-gallery-card]')).toHaveCount(10);

    await page.locator('[data-blok-database-gallery-load-more]').click();

    await expect(page.locator('[data-blok-database-gallery-card]')).toHaveCount(12);
  });
});

test.describe('calendar', () => {
  test('shows the month with today marked, ranges as bars and undated rows left out', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar', name: 'Calendar' }));

    await expect(day(page, '2026-10-09')).toHaveAttribute('data-today', '');
    await expect(event(page, 'r1')).toHaveCount(1);
    await expect(event(page, 'r3')).toHaveCount(0);
    expect((await event(page, 'r1').boundingBox())?.height).toBe(28);

    const trip = (await event(page, 'r2').boundingBox())?.width ?? 0;
    const oneDay = (await day(page, '2026-10-12').boundingBox())?.width ?? 0;

    expect(trip).toBeGreaterThan(oneDay * 2);
  });

  // 78-alarm-calendar.png: 28px card, +24px per shown property, each on its own line and cut at the edge.
  test('gives each shown property its own line and grows the card', async ({ page }) => {
    const longTitle = 'A title far too long for one day';

    await mount(page, blocks({ type: 'calendar', visibleProperties: ['p-due', 'p-notes'] }, [
      { id: 'r1', properties: { 'p-title': 'Launch', 'p-due': '2026-10-09', 'p-notes': 'Bring cake, candles and a card for the whole office' }, reminders: { 'p-due': { remind: '1_day_before' } } },
      { id: 'r2', properties: { 'p-title': longTitle, 'p-due': '2026-10-09' } },
      { id: 'r3', properties: { 'p-title': 'Quiet', 'p-due': '2026-10-21' } },
    ]));
    await page.emulateMedia({ colorScheme: 'light' });

    const card = (id: string): Locator => page.locator(`[data-blok-database-calendar-event][data-row-id="${id}"]`);
    const lines = await card('r1').evaluate((el) => [...el.querySelectorAll('[data-blok-database-calendar-event-property]')].map((line) => {
      const box = line.getBoundingClientRect();

      return { height: box.height, top: box.top - el.getBoundingClientRect().top, cut: line.scrollWidth > line.clientWidth };
    }));

    expect(lines).toEqual([{ height: 24, top: 26, cut: false }, { height: 24, top: 50, cut: true }]);
    expect((await card('r1').boundingBox())?.height).toBe(76);
    expect((await card('r2').boundingBox())?.height).toBe(52);
    expect((await card('r3').boundingBox())?.height).toBe(52);
    await expect(card('r1').locator('[data-blok-database-calendar-event-property]').last()).toHaveCSS('text-overflow', 'clip');
    await expect(card('r1').locator('[data-blok-database-cell="date"][data-reminder]')).toHaveCSS('color', 'rgb(39, 131, 222)');

    const [first, second] = await Promise.all([card('r1').boundingBox(), card('r2').boundingBox()]);

    expect((second?.y ?? 0) - (first?.y ?? 0)).toBeGreaterThanOrEqual(first?.height ?? Infinity);
  });

  test('hides weekends and shows one week on request', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar', showWeekends: false, calendarRange: 'week' }));

    await expect(page.locator('[data-blok-database-calendar-day]')).toHaveCount(5);
    await expect(page.getByRole('columnheader')).toHaveCount(5);
  });

  test('"+" on a hovered day adds a row on that date', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await day(page, '2026-10-20').hover();
    await day(page, '2026-10-20').locator('[data-blok-database-calendar-add]').click();

    const added = (await savedRows(page)).find((row) => !['r1', 'r2', 'r3'].includes(row.id));

    expect(added?.properties['p-due']).toBe('2026-10-20');
  });

  test('dragging an event to another day moves its date', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await dragBetween(page, event(page, 'r1'), await center(day(page, '2026-10-15')));

    expect((await savedRow(page, 'r1'))['p-due']).toBe('2026-10-15');
  });

  test('dragging the end edge spans more days', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));
    const box = await event(page, 'r1').boundingBox();

    await dragBetween(page, event(page, 'r1'), await center(day(page, '2026-10-10')), { x: (box?.width ?? 0) - 2, y: 14 });

    expect((await savedRow(page, 'r1'))['p-due']).toBe('2026-10-09/2026-10-10');
  });

  test('arrow keys move between days and Enter opens the first item', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await day(page, '2026-10-09').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(day(page, '2026-10-17')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(day(page, '2026-10-13')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(drawer(page)).toBeVisible();
  });

  test('next, previous and Today navigate, and the range survives a reload for this person', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await page.locator('[data-blok-database-calendar-next]').click();
    await expect(day(page, '2026-11-15')).toHaveCount(1);
    await expect(day(page, '2026-10-09')).toHaveCount(0);

    await mount(page, blocks({ type: 'calendar' }));
    await expect(day(page, '2026-11-15')).toHaveCount(1);

    await page.locator('[data-blok-database-calendar-today]').click();
    await expect(day(page, '2026-10-09')).toHaveAttribute('data-today', '');
  });

  test('read-only shows events but offers no "+" and no drag', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }), true);

    await expect(event(page, 'r1')).toHaveCount(1);
    await expect(page.locator('[data-blok-database-calendar-add]')).toHaveCount(0);
    await dragBetween(page, event(page, 'r1'), await center(day(page, '2026-10-15')));

    // A read-only editor cannot save, so the check is that the event stayed put.
    await expect(day(page, '2026-10-09').locator('[data-blok-database-calendar-event][data-row-id="r1"]')).toHaveCount(1);
    await expect(day(page, '2026-10-15').locator('[data-blok-database-calendar-event]')).toHaveCount(0);
  });
});
