/**
 * Board Tab order (notion-motion.md Round 97 §1 #1, r97-n-board-tab-order.raw):
 * every column header comes first, then column by column each card, its two
 * buttons and the column's "New page". Every card is a Tab stop.
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

const SCHEMA = [
  { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a1',
    config: {
      options: [
        { id: 'o-todo', label: 'Not started', color: 'gray', position: 'a0' },
        { id: 'o-doing', label: 'In progress', color: 'blue', position: 'a1' },
        { id: 'o-done', label: 'Done', color: 'green', position: 'a2' },
      ],
    },
  },
];

const ROWS = [
  { id: 'r1', properties: { 'p-name': 'Gamma', 'p-stage': 'o-todo' } },
  { id: 'r2', properties: { 'p-name': 'Alpha', 'p-stage': 'o-todo' } },
  { id: 'r3', properties: { 'p-name': 'Beta', 'p-stage': 'o-doing' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ROWS.map((r) => r.id),
  },
  ...ROWS.map((r, i) => ({ id: r.id, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: r.properties } })),
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
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, input);
};

/** The focused element, named the way the Notion raw lists its stops. */
const focused = (page: Page): Promise<string> => page.evaluate(() => {
  const el = document.activeElement;

  if (!(el instanceof HTMLElement) || el.closest('[data-blok-database-board]') === null) return 'outside';
  if (el.hasAttribute('data-blok-database-card')) return `card ${el.querySelector('[data-blok-database-card-title]')?.textContent ?? ''}`;
  if (el.hasAttribute('data-blok-database-column-pill')) return `pill ${el.textContent ?? ''}`;
  if (el.hasAttribute('data-blok-database-board-lane-label')) return `band ${el.textContent ?? ''}`;
  if (el.hasAttribute('data-blok-database-column-count')) return `count ${el.textContent ?? ''}`;
  if (el.hasAttribute('data-blok-database-column-actions') || el.closest('[data-blok-database-column-actions]') !== null) return `header ${el.getAttribute('aria-label') ?? ''}`;

  return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName;
});

const walk = async (page: Page, key: 'Tab' | 'Shift+Tab', steps: number): Promise<string[]> => {
  const stops: string[] = [];

  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(key);
    stops.push(await focused(page));
  }

  return stops;
};

const header = (pill: string | null, count: string): string[] =>
  [...(pill === null ? [] : [`pill ${pill}`]), `count ${count}`, 'header More group options', 'header New page'];
const card = (title: string): string[] => [`card ${title}`, 'Edit title', 'Card options'];

/** "No Stage" has no pill stop: its name is not renamed. */
const ORDER = [
  ...header('Not started', '2'), ...header('In progress', '1'), ...header('Done', '0'), ...header(null, '0'),
  ...card('Gamma'), ...card('Alpha'), 'New page',
  ...card('Beta'), 'New page',
  'New page',
  'New page',
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page, blocks());
  await expect(page.locator('[data-blok-database-card]')).toHaveCount(3);
});

test('Tab walks every header, then each column\'s cards, card buttons and New page', async ({ page }) => {
  const firstPill = page.locator('[data-blok-database-column-pill]').first();

  await firstPill.focus();
  const stops = [await focused(page), ...await walk(page, 'Tab', ORDER.length)];

  expect(stops.slice(0, ORDER.length)).toEqual(ORDER);
  // Past the last column's New page, Tab goes on to "New group".
  expect(stops[ORDER.length]).toBe('New group');

  // Back again: the exact reverse.
  const back = await walk(page, 'Shift+Tab', ORDER.length);

  expect(back).toEqual(ORDER.slice().reverse());
});

test('a card button reached by Tab shows its button group', async ({ page }) => {
  await page.locator('[data-blok-database-column-pill]', { hasText: 'Done' }).focus();
  // Done's and No Stage's headers, then Gamma, then its Edit title button.
  await walk(page, 'Tab', 8);

  const edit = page.locator('[data-blok-database-card][data-row-id="r1"] [data-blok-database-edit-card]');

  await expect(edit).toBeFocused();
  expect(await edit.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await expect.poll(() => edit.evaluate((el) => getComputedStyle(el.parentElement ?? el).opacity)).toBe('1');
});

test('a pill reached by Tab rings like the count beside it', async ({ page }) => {
  const pill = page.locator('[data-blok-database-column-pill]', { hasText: 'Not started' });
  const ring = (): Promise<string> => page.evaluate(() => {
    const style = getComputedStyle(document.activeElement ?? document.body);

    return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
  });

  await pill.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(pill).toBeFocused();
  const pillRing = await ring();

  await page.keyboard.press('Tab');
  expect(pillRing).toBe(await ring());
});

for (const key of ['Enter', 'Space']) {
  // notion-motion.md Round 98 §1 #1: a rename popup 4 below the pill, its left edge on the pill's, 240 wide.
  test(`${key} on a pill opens the rename popup under it, and Escape gives focus back to the pill`, async ({ page }) => {
    const pill = page.locator('[data-blok-database-column-pill]', { hasText: 'Not started' });
    const field = page.locator('[data-blok-database-group-name-field] input');
    const before = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.map((b) => b.id));
    const scrollY = await page.evaluate(() => window.scrollY);

    await pill.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press(key);

    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Not started');
    expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 11]);
    await expect(page.locator('[data-blok-database-column-title-input]')).toHaveCount(0);
    await expect(page.getByTestId('popover-item-html').getByRole('button', { name: 'Done' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    const pillBox = await pill.boundingBox();
    const popup = page.locator('[data-blok-popover]:has([data-blok-database-group-name-field]) [data-blok-popover-container]');
    const popupBox = await popup.boundingBox();

    expect(Math.round((popupBox?.x ?? 0) - (pillBox?.x ?? 0))).toBe(0);
    expect(Math.round((popupBox?.y ?? 0) - (pillBox?.y ?? 0) - (pillBox?.height ?? 0))).toBe(4);
    // The open motion scales the box, so the layout width is read, not the drawn one.
    expect(await popup.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(240);

    await page.keyboard.press('Escape');

    await expect(field).toHaveCount(0);
    await expect(pill).toBeFocused();
    expect(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.map((b) => b.id))).toEqual(before);
  });
}

test('Done in the rename popup renames the group and gives focus back to the pill', async ({ page }) => {
  const pill = page.locator('[data-blok-database-column-pill]', { hasText: 'Not started' });

  await pill.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Queued');
  await page.getByTestId('popover-item-html').getByRole('button', { name: 'Done' }).click();

  const renamed = page.locator('[data-blok-database-column-pill]', { hasText: 'Queued' });

  await expect(renamed).toBeFocused();
  await expect(page.locator('[data-blok-database-group-name-field]')).toHaveCount(0);
});

test('a click on a pill shows no ring', async ({ page }) => {
  const pill = page.locator('[data-blok-database-column-pill]', { hasText: 'Not started' });

  // The pill's edge, not its title: a click on the title renames.
  await pill.click({ position: { x: 3, y: 3 } });

  await expect(pill).toBeFocused();
  expect(await pill.evaluate((el) => el.matches(':focus-visible'))).toBe(false);
  await expect(pill).toHaveCSS('outline-style', 'none');
});

/**
 * A sub-grouped board (notion-motion.md Round 98 §1 #2, r98-n-subgroup-board-tab*.raw): the column
 * headers, then band by band its Close, its pill, ⋯ and +, then its cards column by column.
 * "New group" is the last stop, though it sits in the header row.
 */
test.describe('sub-grouped board', () => {
  const subGrouped = (): OutputBlockData[] => {
    const input = blocks();
    const db = input[0];
    const data = db.data as { schema: Array<Record<string, unknown>>; views: Array<Record<string, unknown>> };
    const tags: Record<string, string> = { r1: 'o-red', r2: 'o-red', r3: 'o-blue' };

    data.schema = [...data.schema, {
      id: 'p-tag',
      name: 'Tag',
      type: 'select',
      position: 'a2',
      config: { options: [{ id: 'o-red', label: 'Red', color: 'red', position: 'a0' }, { id: 'o-blue', label: 'Blue', color: 'blue', position: 'a1' }] },
    }];
    data.views = [{ ...data.views[0], subGroupBy: 'p-tag' }];

    return input.map((block) => block.type === 'database-row'
      ? { ...block, data: { ...block.data, properties: { ...(block.data as { properties: Record<string, unknown> }).properties, 'p-tag': tags[block.id ?? ''] } } }
      : block);
  };

  /** "No Tag" has no pill stop, as "No Stage" has none in the header row. */
  const band = (label: string | null): string[] => ['Close', ...(label === null ? [] : [`band ${label}`]), 'More group options', 'New page'];

  test.beforeEach(async ({ page }) => {
    await mount(page, subGrouped());
    await page.evaluate(() => {
      const after = document.createElement('button');

      after.textContent = 'after';
      document.getElementById('blok')?.after(after);
    });
    await expect(page.locator('[data-blok-database-board-lane]')).toHaveCount(3);
  });

  test('Tab walks the headers, then each band, and ends on New group', async ({ page }) => {
    const order = [
      ...header('Not started', '2'), ...header('In progress', '1'), ...header('Done', '0'), ...header(null, '0'),
      ...band('Red'), ...card('Gamma'), ...card('Alpha'), 'New page', 'New page', 'New page', 'New page',
      ...band('Blue'), 'New page', ...card('Beta'), 'New page', 'New page', 'New page',
      ...band(null), 'New page', 'New page', 'New page', 'New page',
      'New group',
    ];

    await page.locator('[data-blok-database-column-pill]').first().focus();
    const stops = [await focused(page), ...await walk(page, 'Tab', order.length - 1)];

    expect(stops).toEqual(order);
    // Past New group, Tab leaves the board, and Shift+Tab comes back to New group.
    expect(await walk(page, 'Tab', 1)).toEqual(['outside']);
    expect(await walk(page, 'Shift+Tab', order.length)).toEqual(order.slice().reverse());
  });

  test('a collapsed band\'s cards are skipped', async ({ page }) => {
    const toggle = page.getByRole('region', { name: 'Red' }).locator('[data-blok-database-board-lane-toggle]');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();

    expect(await walk(page, 'Tab', 4)).toEqual(['band Red', 'More group options', 'New page', 'Close']);
  });
});
