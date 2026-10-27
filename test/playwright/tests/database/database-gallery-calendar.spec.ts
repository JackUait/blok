/**
 * The Notion gallery and calendar layouts (research/03 §4 and §6): cards,
 * previews, "+ New", drag reorder and load more; month and week grids,
 * multi-day bars, drag to move or span, "+" on a day, the day keyboard and
 * the per-person range. Each write is checked in the saved JSON.
 */

import type { Locator, Page } from '@playwright/test';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';

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
    // findings-listgallery L13: the preview is 16:9 of the card width at every card size.
    const width = (await card(page, 'r1').boundingBox())?.width ?? 0;

    expect((await card(page, 'r1').locator('[data-blok-database-gallery-preview]').boundingBox())?.height).toBeCloseTo(width * 9 / 16, 0);
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

  test('an empty preview property: a board card draws no preview area, a gallery card keeps its empty cover', async ({ page }) => {
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const rows = [
      { id: 'r1', properties: { 'p-title': 'Pic', 'p-image': pixel, 'p-stage': 'o-a' } },
      { id: 'r2', properties: { 'p-title': 'Bare', 'p-stage': 'o-a' } },
    ];
    const board = blocks({ type: 'board', groupBy: 'p-stage', cardPreview: 'property:p-image' }, rows);
    const stage = { id: 'p-stage', name: 'Stage', type: 'select', position: 'a4', config: { options: [{ id: 'o-a', label: 'A', position: 'a0' }] } };

    (board[0].data as { schema: unknown[] }).schema = [...SCHEMA, stage];
    await mount(page, board);

    const boardCard = (rowId: string): Locator => page.locator(`[data-blok-database-card][data-row-id="${rowId}"]`);

    // research/31 shot 51: no file, no preview area.
    await expect(boardCard('r2').locator('[data-blok-database-card-preview]')).toHaveCount(0);
    await expect(boardCard('r1').locator('[data-blok-database-card-preview]')).toBeVisible();

    await mount(page, blocks({ type: 'gallery', cardPreview: 'property:p-image' }, rows));

    // findings-listgallery L13: the empty cover keeps the 16:9 preview of the card width.
    const width = (await card(page, 'r2').boundingBox())?.width ?? 0;

    expect((await card(page, 'r2').locator('[data-blok-database-gallery-preview]').boundingBox())?.height).toBeCloseTo(width * 9 / 16, 0);
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

    for (const modifier of ['Shift', 'ControlOrMeta'] as const) {
      test(`after a ${modifier}-click from a caret in text, Down moves the pick in reading order, with no ring (research/22 §2)`, async ({ page }) => {
        await mount(page, [{ id: 'p1', type: 'paragraph', data: { text: 'Above' } }, ...blocks({ type: 'gallery' })]);
        await page.getByText('Above').click();

        await card(page, 'r1').click({ modifiers: [modifier] });
        expect(await selectedIds(page)).toEqual(['r1']);

        await page.keyboard.press('ArrowDown');
        expect(await selectedIds(page)).toEqual(['r2']);
        await page.keyboard.press('ArrowUp');
        expect(await selectedIds(page)).toEqual(['r1']);
        await expect(page.locator('[data-blok-database-gallery]')).toHaveCSS('outline-style', 'none');
        await expect(card(page, 'r1')).toHaveCSS('outline-style', 'none');
      });
    }

    for (const modifier of ['Shift', 'ControlOrMeta'] as const) {
      test(`Enter after a single ${modifier}-click opens that card in the peek and never renames it (research/23 §8)`, async ({ page }) => {
        await mount(page, blocks({ type: 'gallery' }));
        await card(page, 'r2').click({ modifiers: [modifier] });
        await page.keyboard.press('Enter');

        await expect(drawer(page)).toBeVisible();
        await expect(drawer(page).locator('[data-blok-database-drawer-title]')).toHaveValue('Trip');
        await expect(page.locator('[data-blok-database-gallery-card] input')).toHaveCount(0);
      });
    }

    test('Home, End, PageUp and PageDown leave the selection where it is (research/22 §2)', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');

      for (const key of ['End', 'Home', 'PageDown', 'PageUp']) {
        await page.keyboard.press(key);
        expect(await selectedIds(page)).toEqual(['r2']);
      }
    });

    for (const [first, last, title] of [['r3', 'r1', 'Launch'], ['r1', 'r3', 'Someday']]) {
      test(`Enter with several cards selected opens the last one clicked (${first} then ${last}); the selection is back when the peek closes`, async ({ page }) => {
        await mount(page, blocks({ type: 'gallery' }));
        await card(page, first).click({ modifiers: ['ControlOrMeta'] });
        await card(page, last).click({ modifiers: ['ControlOrMeta'] });
        await page.keyboard.press('Enter');

        await expect(drawer(page)).toBeVisible();
        await expect(drawer(page).locator('[data-blok-database-drawer-title]')).toHaveValue(title);
        await expect(page.locator('[data-blok-database-gallery-card] input')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(drawer(page)).toHaveCount(0);
        expect(await selectedIds(page)).toEqual(['r1', 'r3']);
      });
    }

    test('Backspace on one selected card trashes it at once with a "Moved to Trash" toast; Restore brings it back with its page', async ({ page }) => {
      const data = blocks({ type: 'gallery' });

      data[2] = { ...data[2], content: ['b2'] };
      data.push({ id: 'b2', type: 'paragraph', parent: 'r2', data: { text: 'Trip body' } });
      await mount(page, data);
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Backspace');

      await expect(card(page, 'r2')).toHaveCount(0);
      await expect(page.locator('[data-blok-announcer][aria-live="polite"]')).toHaveText('1 block deleted');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(async () => (await savedRows(page)).map((row) => row.id)).toEqual(['r1', 'r3']);

      const toast = page.getByTestId('notification').filter({ hasText: 'Moved to Trash' });

      await expect(toast).toBeVisible();
      await toast.getByRole('button', { name: 'Restore' }).click();

      await expect(card(page, 'r2')).toBeVisible();
      await expect.poll(async () => (await savedRows(page)).map((row) => row.id)).toEqual(['r1', 'r2', 'r3']);
      await expect.poll(async () => page.evaluate(async () => {
        const output = await window.blokInstance?.save();

        return output?.blocks.find((block) => block.id === 'b2')?.parent ?? null;
      })).toBe('r2');

      // The toast stays until closed; a second Restore must not undo anything else.
      await toast.getByRole('button', { name: 'Restore' }).click();
      await expect.poll(async () => (await savedRows(page)).map((row) => row.id)).toEqual(['r1', 'r2', 'r3']);
    });

    test('Restore after a later edit does nothing: the edit survives and the card stays in the trash', async ({ page }) => {
      await mount(page, [{ id: 'note', type: 'paragraph', data: { text: 'Note' } }, ...blocks({ type: 'gallery' })]);
      await clickBlank(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Backspace');
      await expect(card(page, 'r1')).toHaveCount(0);

      await page.getByText('Note', { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.type(' typed');
      await expect(page.getByText('Note typed')).toBeVisible();

      await page.getByTestId('notification').filter({ hasText: 'Moved to Trash' }).getByRole('button', { name: 'Restore' }).click();

      const saved = async (): Promise<{ note: string; rows: string[] }> => page.evaluate(async () => {
        const output = await window.blokInstance?.save();
        const blocks = output?.blocks ?? [];
        const note = blocks.find((block) => block.id === 'note')?.data as { text?: unknown } | undefined;

        return {
          note: JSON.stringify(note?.text ?? ''),
          rows: blocks.filter((block) => block.type === 'database-row').map((block) => block.id ?? ''),
        };
      });

      await expect.poll(async () => (await saved()).note).toContain('Note typed');
      expect((await saved()).rows).toEqual(['r2', 'r3']);
      await expect(card(page, 'r1')).toHaveCount(0);
    });

    test('Delete on several selected cards trashes them all at once with one "Moved to Trash" toast; one Restore brings them all back (research/23 §2b)', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery' }));
      await card(page, 'r1').click({ modifiers: ['ControlOrMeta'] });
      await card(page, 'r3').click({ modifiers: ['ControlOrMeta'] });
      await page.keyboard.press('Delete');

      const toast = page.getByTestId('notification').filter({ hasText: 'Moved to Trash' });

      // The toast is not a live region: screen readers hear the count, not the visible text.
      await expect(page.locator('[data-blok-announcer][aria-live="polite"]')).toHaveText('2 blocks deleted');
      await expect(toast).toHaveCount(1);
      await expect(toast).not.toHaveAttribute('role', 'status');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('[data-blok-database-gallery-card]')).toHaveCount(1);
      await expect.poll(async () => (await savedRows(page)).map((row) => row.id)).toEqual(['r2']);
      expect(await selectedIds(page)).toEqual([]);

      await toast.getByRole('button', { name: 'Restore' }).click();
      await expect.poll(async () => (await savedRows(page)).map((row) => row.id)).toEqual(['r1', 'r2', 'r3']);
      await expect(page.locator('[data-blok-database-gallery-card]')).toHaveCount(3);
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
    await expect(card('r1').locator('[data-blok-database-cell="date"][data-reminder]')).toHaveCSS('color', 'rgb(35, 119, 211)');

    const [first, second] = await Promise.all([card('r1').boundingBox(), card('r2').boundingBox()]);

    expect((second?.y ?? 0) - (first?.y ?? 0)).toBeGreaterThanOrEqual(first?.height ?? Infinity);
  });

  test('hides weekends and shows one week on request', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar', showWeekends: false, calendarRange: 'week' }));

    await expect(page.locator('[data-blok-database-calendar-day]')).toHaveCount(5);
    await expect(page.getByRole('columnheader')).toHaveCount(5);
  });

  // research/35 §6: "+" opens the new page in the view's open mode, a center peek by default.
  test('"+" on a hovered day adds a row on that date and opens it in a center peek', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await day(page, '2026-10-20').hover();
    await day(page, '2026-10-20').locator('[data-blok-database-calendar-add]').click();

    await expect(drawer(page)).toHaveAttribute('data-peek-mode', 'center');
    const added = (await savedRows(page)).filter((row) => !['r1', 'r2', 'r3'].includes(row.id));

    expect(added.map((row) => row.properties['p-due'])).toEqual(['2026-10-20']);
  });

  // research/35 §6: a Shift double-click acts as a plain one.
  test('a Shift double-click in an empty day adds one row and opens it in the view\'s side peek', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar', openPagesIn: 'side' }));

    const cell = await day(page, '2026-10-20').boundingBox();

    if (cell === null) throw new Error('no day');
    await page.keyboard.down('Shift');
    await page.mouse.dblclick(cell.x + cell.width / 2, cell.y + cell.height - 8);
    await page.keyboard.up('Shift');

    await expect(drawer(page)).toHaveAttribute('data-peek-mode', 'side');
    const added = (await savedRows(page)).filter((row) => !['r1', 'r2', 'r3'].includes(row.id));

    expect(added.map((row) => row.properties['p-due'])).toEqual(['2026-10-20']);
  });

  // research/31 §6: a single click did nothing; only a real double-click made a page dated that day and opened it.
  test('a single click in an empty day cell adds nothing', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    const cell = await day(page, '2026-10-20').boundingBox();

    if (cell === null) throw new Error('no day');
    await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height - 8);
    await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height - 8);

    await expect(drawer(page)).toHaveCount(0);
    expect((await savedRows(page)).map((row) => row.id).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  test('a double-click in an empty day cell adds a row on that date and opens it; Escape keeps the row', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    const cell = await day(page, '2026-10-20').boundingBox();

    if (cell === null) throw new Error('no day');
    await page.mouse.dblclick(cell.x + cell.width / 2, cell.y + cell.height - 8);

    await expect(drawer(page)).toBeVisible();
    const added = (await savedRows(page)).filter((row) => !['r1', 'r2', 'r3'].includes(row.id));

    expect(added).toHaveLength(1);
    expect(added[0].properties['p-due']).toBe('2026-10-20');

    // research/30 B11: Escape closed the peek and the empty row stayed.
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeHidden();
    expect((await savedRows(page)).map((row) => row.id)).toContain(added[0].id);
  });

  test('a double-click on the day number adds a row on that date', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await day(page, '2026-10-20').locator('[data-blok-database-calendar-day-number]').dblclick();

    await expect(drawer(page)).toBeVisible();
    const added = (await savedRows(page)).filter((row) => !['r1', 'r2', 'r3'].includes(row.id));

    expect(added.map((row) => row.properties['p-due'])).toEqual(['2026-10-20']);
  });

  test('a double-click on a day that closes View settings only closes it', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));
    await page.getByTestId('database-toolbar-settings').click();
    await expect(page.getByTestId('database-view-settings')).toBeVisible();

    const cell = await day(page, '2026-10-20').boundingBox();

    if (cell === null) throw new Error('no day');
    await page.mouse.dblclick(cell.x + cell.width / 2, cell.y + cell.height - 8);

    await expect(page.getByTestId('database-view-settings')).toBeHidden();
    await expect(drawer(page)).toHaveCount(0);
    expect((await savedRows(page)).map((row) => row.id).sort()).toEqual(['r1', 'r2', 'r3']);
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

  test.describe('selection (research/22 §1)', () => {
    const SAME_DAY: RowSeed[] = [
      ...ROWS,
      { id: 'r4', properties: { 'p-title': 'Review', 'p-due': '2026-10-09' } },
    ];
    const picked = async (page: Page): Promise<string[]> => page.evaluate(() =>
      [...document.querySelectorAll('[data-blok-database-calendar-event][data-blok-database-row-selected]')]
        .map((el) => el.getAttribute('data-row-id') ?? '').sort());

    test('Shift-click selects without opening: same day adds, another day replaces, Escape clears, no bulk bar', async ({ page }) => {
      await mount(page, blocks({ type: 'calendar' }, SAME_DAY));

      await event(page, 'r1').click({ modifiers: ['Shift'] });
      await event(page, 'r4').click({ modifiers: ['Shift'] });

      expect(await picked(page)).toEqual(['r1', 'r4']);
      // Core's Shift-click block range must not take the whole database block.
      await expect(page.locator('[data-blok-id="db-1"]')).not.toHaveAttribute('data-blok-selected', 'true');
      await expect(drawer(page)).toHaveCount(0);
      await expect(page.locator('[data-blok-database-table-selection-bar]')).toHaveCount(0);

      await event(page, 'r2').click({ modifiers: ['Shift'] });
      expect(await picked(page)).toEqual(['r2']);

      await page.keyboard.press('Escape');
      expect(await picked(page)).toEqual([]);
    });

    test('a picked event is gray over its own card, never blue, with the same ink', async ({ page }) => {
      await mount(page, blocks({ type: 'calendar' }, SAME_DAY));
      await event(page, 'r1').click({ modifiers: ['Shift'] });

      const look = async (rowId: string): Promise<{ halo: string; haloInset: string; color: string; bg: string; radius: string }> =>
        event(page, rowId).evaluate((el) => {
          const style = getComputedStyle(el);
          const after = getComputedStyle(el, '::after');

          return { halo: after.backgroundColor, haloInset: after.top, color: style.color, bg: style.backgroundColor, radius: style.borderRadius };
        });
      // Away from the cards, so neither is hovered; then let the hover fade finish.
      await page.mouse.move(5, 5);
      await expect.poll(async () => (await look('r1')).bg).toBe((await look('r4')).bg);
      const on = await look('r1');
      const off = await look('r4');
      const isBlue = (value: string): boolean => [...value.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)]
        .some(([, r, g, b]) => Number(b) > Number(r) + 40 && Number(b) > Number(g) + 20);

      // research/35 §1.4: the tint is a halo 1px inside the card, over the unchanged fill.
      expect(on.halo).not.toBe('rgba(0, 0, 0, 0)');
      expect(on.haloInset).toBe('1px');
      expect(isBlue(on.halo)).toBe(false);
      expect(on.bg).toBe(off.bg);
      expect(on.color).toBe(off.color);
      expect(on.radius).toBe('6px');
    });

    test('Cmd/Ctrl-click neither selects nor opens', async ({ page }) => {
      await mount(page, blocks({ type: 'calendar' }));

      await event(page, 'r1').click({ modifiers: ['ControlOrMeta'] });

      expect(await picked(page)).toEqual([]);
      await expect(drawer(page)).toHaveCount(0);
    });

    test('a plain click opens the row in a center peek', async ({ page }) => {
      await mount(page, blocks({ type: 'calendar' }));

      await event(page, 'r1').click();

      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page)).toHaveAttribute('data-peek-mode', 'center');
      expect(await picked(page)).toEqual([]);
    });
  });

  test('the event right-click menu has Comment ⌘⇧M, and a posted comment shows a badge on the event (research/22 §11)', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar' }));

    await event(page, 'r1').click({ button: 'right' });
    const item = page.getByRole('menuitem', { name: /Comment/ });

    await expect(item).toBeVisible();
    await expect(item).toContainText('⇧');
    await item.click();
    const composer = page.getByRole('textbox', { name: 'Add a comment…' });

    await expect(composer).toBeFocused();
    await composer.fill('Bring plates');
    await page.keyboard.press('Enter');

    await expect(event(page, 'r1').getByRole('button', { name: 'Open comments' })).toHaveText('1');
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
