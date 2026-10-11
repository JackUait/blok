/**
 * Tier 3 (D6) database levers, end to end: the form view, the map view's
 * empty state and host map, the permissions gate and the comments lever.
 * Notion behaviour: https://www.notion.com/help/forms (questions map to
 * properties, answers land as pages) and https://www.notion.com/help/guides/using-maps-in-notion
 * (a map needs a Place property). Blok builds no service: each lever is the host's.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    tier3Log?: unknown[];
  }
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-email', name: 'Email', type: 'email', position: 'a1' },
  { id: 'p-where', name: 'Where', type: 'place', position: 'a2' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'HQ', 'p-email': 'hq@example.com', 'p-where': { name: 'Head office', lat: 51.5, lon: -0.12 } } },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    // A valid fractional key: a new row's position is worked out after it.
    data: { position: `a${i}`, properties: row.properties },
  })),
];

type Lever = 'none' | 'forms' | 'map' | 'readOnlyGate' | 'comments';

/** Levers are functions, so they are built inside the page. */
const mount = async (page: Page, data: OutputBlockData[], lever: Lever): Promise<void> => {
  await page.evaluate(async ({ input, which }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    const log: unknown[] = [];

    window.tier3Log = log;
    const config: Record<string, unknown> = {};

    if (which === 'forms') {
      config.forms = { onSubmit: (submission: unknown) => log.push(submission) };
    }
    if (which === 'map') {
      config.map = {
        render: (container: HTMLElement, items: Array<{ rowId: string; title: string }>, ctx: { open(rowId: string): void }) => {
          items.forEach((item) => {
            const pin = document.createElement('button');

            pin.type = 'button';
            pin.textContent = `Pin ${item.title}`;
            pin.addEventListener('click', () => ctx.open(item.rowId));
            container.appendChild(pin);
          });
        },
      };
    }
    if (which === 'readOnlyGate') {
      config.permissions = { can: (action: string) => action === 'comment' };
    }
    if (which === 'comments') {
      config.comments = { open: (target: unknown) => log.push(target) };
    }
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: { class: window.BlokDatabase, config },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: data, which: lever });
  await expect(page.locator('[data-blok-database-wrapper]')).toBeVisible();
};

const savedRows = async (page: Page): Promise<Array<{ id: string; properties: Record<string, unknown> }>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? [])
    .filter((block) => block.type === 'database-row')
    .map((block) => ({ id: block.id ?? '', properties: (block.data as { properties: Record<string, unknown> }).properties }));
});

const question = (page: Page, propertyId: string): Locator => page.locator(`[data-blok-database-form-question="${propertyId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('form view', () => {
  test('a submit adds the answers as a page and hands them to the host', async ({ page }) => {
    await mount(page, blocks({ type: 'form' }), 'forms');

    await question(page, 'p-title').getByRole('textbox').fill('Ada');
    await question(page, 'p-email').getByRole('textbox').fill('ada@example.com');
    await question(page, 'p-where').getByRole('textbox').fill('1 Main St');
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.locator('[data-blok-database-form-confirmation]')).toBeVisible();
    const rows = await savedRows(page);
    const added = rows.find((row) => row.properties['p-title'] === 'Ada');

    expect(added?.properties).toMatchObject({ 'p-email': 'ada@example.com', 'p-where': { address: '1 Main St' } });
    expect(await page.evaluate(() => window.tier3Log)).toEqual([
      { databaseId: 'db-1', viewId: 'v1', values: { 'p-title': 'Ada', 'p-email': 'ada@example.com', 'p-where': { address: '1 Main St' } }, rowId: added?.id },
    ]);
  });

  test('a required question left empty blocks the submit', async ({ page }) => {
    await mount(page, blocks({ type: 'form', properties: [{ id: 'p-email', visible: true, required: true }] }), 'forms');

    await question(page, 'p-title').getByRole('textbox').fill('Ada');
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(question(page, 'p-email')).toHaveAttribute('data-invalid', '');
    await expect(question(page, 'p-email').getByRole('textbox')).toBeFocused();
    expect(await savedRows(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.tier3Log)).toEqual([]);
  });
});

test.describe('map view', () => {
  test('without a map lever it says so instead of drawing a fake map', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }), 'none');

    await expect(page.locator('[data-blok-database-map-empty="no-provider"]')).toBeVisible();
  });

  test('the host draws the pins, and a pin opens its page', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }), 'map');

    await page.getByRole('button', { name: 'Pin HQ' }).click();

    await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
  });
});

test.describe('permissions', () => {
  test('without editContent nothing in the table writes: no add row, typing and Delete change nothing', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'readOnlyGate');

    await expect(page.locator('[data-blok-database-table-add-row]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-add-view]')).toHaveCount(0);
    await cell(page, 'r1', 'p-email').click();
    await page.keyboard.type('changed');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Delete');

    expect((await savedRows(page))[0].properties['p-email']).toBe('hq@example.com');
  });
});

test.describe('comments', () => {
  test('a right-click on a cell opens the host\'s comments for it', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'comments');

    await cell(page, 'r1', 'p-email').click({ button: 'right' });

    expect(await page.evaluate(() => window.tier3Log)).toEqual([{ databaseId: 'db-1', rowId: 'r1', propertyId: 'p-email' }]);
  });
});
