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
  test(`${key} on a pill renames the group, and Escape gives focus back to the pill`, async ({ page }) => {
    const pill = page.locator('[data-blok-database-column-pill]', { hasText: 'Not started' });
    const before = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.map((b) => b.id));
    const scrollY = await page.evaluate(() => window.scrollY);

    await pill.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press(key);

    await expect(page.locator('[data-blok-database-column-title-input]')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-blok-database-column-title-input]')).toHaveCount(0);
    await expect(pill).toBeFocused();
    expect(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.map((b) => b.id))).toEqual(before);
  });
}

test('a click on a pill shows no ring', async ({ page }) => {
  const pill = page.locator('[data-blok-database-column-pill]', { hasText: 'Not started' });

  // The pill's edge, not its title: a click on the title renames.
  await pill.click({ position: { x: 3, y: 3 } });

  await expect(pill).toBeFocused();
  expect(await pill.evaluate((el) => el.matches(':focus-visible'))).toBe(false);
  await expect(pill).toHaveCSS('outline-style', 'none');
});
