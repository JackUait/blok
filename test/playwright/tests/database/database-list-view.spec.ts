/**
 * The Notion list view (research/03 §5, research/07 "List"): formatted
 * property values, the measured row look, in-place edit, Tab between
 * properties and Shift+Enter for a new item below. Also the board's
 * "Color columns" switch, read as the computed fill.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { expectNoA11yViolations } from '../helpers/a11y';
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
  { id: 'p-cost', name: 'Cost', type: 'number', position: 'a3', number: { format: 'dollar' } },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a4' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a5' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-stage': 'o-idea', 'p-due': '2026-10-12', 'p-cost': 1200, 'p-done': false, 'p-link': 'https://example.com' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-stage': 'o-ship', 'p-due': '2026-10-14', 'p-done': false } },
  { id: 'r3', properties: { 'p-title': 'Charlie', 'p-done': false } },
];

const blocks = (view: Record<string, unknown>, before: OutputBlockData[] = []): OutputBlockData[] => [
  ...before,
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-stage', 'p-due', 'p-cost', 'p-done', 'p-link'], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    data: { position: `a${i}`, properties: row.properties },
  })),
];

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

const savedRows = async (page: Page): Promise<Array<{ id: string; position: string; properties: Record<string, unknown> }>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? [])
    .filter((block) => block.type === 'database-row')
    .map((block) => ({ id: block.id ?? '', ...(block.data as { position: string; properties: Record<string, unknown> }) }));
});

const row = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-list-row][data-row-id="${rowId}"]`);
const slot = (page: Page, rowId: string, propertyId: string): Locator =>
  row(page, rowId).locator(`[data-blok-database-list-row-property][data-property-id="${propertyId}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(() => window.localStorage.clear());
});

test.describe('list view', () => {
  test('draws Notion\'s row look: 30px rows on a 32px pitch, a 500 title, formatted values', async ({ page }) => {
    await mount(page, blocks({ type: 'list', name: 'List' }));

    const first = await row(page, 'r1').boundingBox();
    const second = await row(page, 'r2').boundingBox();

    expect(first?.height).toBeCloseTo(30, 0);
    expect((second?.y ?? 0) - (first?.y ?? 0)).toBeCloseTo(32, 0);
    await expect(row(page, 'r1').locator('[data-blok-database-list-row-title]')).toHaveCSS('font-weight', '500');
    await expect(slot(page, 'r1', 'p-stage')).toHaveText('Idea');
    await expect(slot(page, 'r1', 'p-cost')).toHaveText('$1,200.00');
    await expect(slot(page, 'r1', 'p-due')).not.toHaveText('2026-10-12');
    expect((await slot(page, 'r1', 'p-stage').locator('[data-blok-database-option-pill]').boundingBox())?.height).toBeCloseTo(18, 0);
  });

  test('edits a property in place on click, and the page stays closed', async ({ page }) => {
    await mount(page, blocks({ type: 'list', name: 'List' }));

    await slot(page, 'r1', 'p-done').click();

    await expect.poll(async () => (await savedRows(page)).find((r) => r.id === 'r1')?.properties['p-done']).toBe(true);
    await expect(page.locator('[data-blok-database-drawer]')).toBeHidden();

    await slot(page, 'r1', 'p-stage').click();
    await expect(page.locator('[data-blok-database-select-editor]')).toBeVisible();
  });

  test('Tab walks a row\'s properties; Shift+Enter adds an item right below and edits its title', async ({ page }) => {
    await mount(page, blocks({ type: 'list', name: 'List' }));

    await row(page, 'r1').focus();
    await page.keyboard.press('Tab');
    await expect(slot(page, 'r1', 'p-stage')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(slot(page, 'r1', 'p-due')).toBeFocused();

    await page.keyboard.press('Shift+Enter');
    const input = page.locator('[data-blok-database-list-title-input]');

    await expect(input).toBeFocused();
    await page.keyboard.type('Inserted');
    await page.keyboard.press('Enter');

    await expect.poll(async () => page.locator('[data-blok-database-list-row]').evaluateAll((els) => els.map((el) => (el.textContent ?? '').includes('Inserted'))))
      .toEqual([false, true, false, false]);
    const saved = await savedRows(page);
    const inserted = saved.find((r) => r.properties['p-title'] === 'Inserted');
    const [a, b] = [saved.find((r) => r.id === 'r1')?.position ?? '', saved.find((r) => r.id === 'r2')?.position ?? ''];

    expect(inserted !== undefined && inserted.position > a && inserted.position < b).toBe(true);
  });
});

test.describe('list view accessibility and focus', () => {
  test('names each editable property by its value, and nests no control in a control', async ({ page }) => {
    await mount(page, blocks({ type: 'list', name: 'List' }));

    await expect(slot(page, 'r1', 'p-stage')).toHaveAccessibleName('Stage: Idea');
    await expectNoA11yViolations(page, { include: '[data-blok-database-list]', label: 'database list view' });
  });

  test('an editor closed by a click elsewhere leaves focus where the click put it', async ({ page }) => {
    await mount(page, blocks({ type: 'list', name: 'List' }, [{ id: 'p1', type: 'paragraph', data: { text: 'Outside' } }]));

    await slot(page, 'r1', 'p-stage').click();
    await expect(page.locator('[data-blok-database-select-editor]')).toBeVisible();
    const outside = page.locator('[data-blok-id="p1"] [contenteditable="true"]');

    await outside.click();
    await expect(page.locator('[data-blok-database-select-editor]')).toBeHidden();
    await expect(outside).toBeFocused();
  });
});

test.describe('conditional color on calendar and timeline (research/05 §6.2)', () => {
  const RULE = { colorRules: [{ id: 'c1', propertyId: 'p-stage', operator: 'equals', value: 'o-idea', color: 'green' }] };
  const fill = (locator: Locator): Promise<string> => locator.evaluate((el) => getComputedStyle(el).backgroundColor);

  test('paints a matching calendar event, and keeps it after month navigation', async ({ page }) => {
    await mount(page, blocks({ type: 'calendar', name: 'Calendar', calendarBy: 'p-due', ...RULE }));
    const painted = page.locator('[data-blok-database-calendar-event][data-row-id="r1"]');
    const plain = page.locator('[data-blok-database-calendar-event][data-row-id="r2"]');

    await expect(painted).toHaveAttribute('data-blok-database-color', 'green');
    expect(await fill(painted)).not.toBe(await fill(plain));

    await page.locator('[data-blok-database-calendar-next]').click();
    await page.locator('[data-blok-database-calendar-prev]').click();
    await expect(painted).toHaveAttribute('data-blok-database-color', 'green');
    expect(await fill(painted)).not.toBe(await fill(plain));
  });

  test('paints a matching timeline bar', async ({ page }) => {
    await mount(page, blocks({ type: 'timeline', name: 'Timeline', timelineBy: 'p-due', ...RULE }));
    const painted = page.locator('[data-blok-database-timeline-bar][data-row-id="r1"]');
    const plain = page.locator('[data-blok-database-timeline-bar][data-row-id="r2"]');

    await expect(painted).toHaveAttribute('data-blok-database-color', 'green');
    expect(await fill(painted)).not.toBe(await fill(plain));
  });
});

test.describe('board "Color columns"', () => {
  const columnFill = (page: Page, optionId: string): Promise<string> =>
    page.locator(`[data-blok-database-column][data-option-id="${optionId}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);

  test('turning it off drops the column tint', async ({ page }) => {
    await mount(page, blocks({ type: 'board', name: 'Board', groupBy: 'p-stage' }));
    const tinted = await columnFill(page, 'o-ship');

    await mount(page, blocks({ type: 'board', name: 'Board', groupBy: 'p-stage', groupSettings: { colorColumns: false } }));
    const plain = await columnFill(page, 'o-ship');
    const plainIdea = await columnFill(page, 'o-idea');

    expect(plain).not.toBe(tinted);
    expect(plain).toBe(plainIdea);
  });
});
