/**
 * Table cell chrome against Notion's measured values (notion-spec-2 §18.1, §20.1, §20.11).
 * The table wraps (the default), unlike database-look-parity.spec.ts.
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

const FILE_URL = 'https://example.com/a.pdf';

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-file', name: 'Files', type: 'files', position: 'a1' },
  {
    id: 'p-status',
    name: 'Status',
    type: 'status',
    position: 'a2',
    config: { options: [{ id: 'o-ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' }] },
  },
  { id: 'p-person', name: 'Person', type: 'person', position: 'a3' },
  { id: 'p-cb', name: 'Created by', type: 'createdBy', position: 'a4' },
  { id: 'p-lb', name: 'Last edited by', type: 'lastEditedBy', position: 'a5' },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a6' },
];

const META = { createdAt: Date.UTC(2026, 9, 28, 7, 39), createdBy: 'u-ada', lastEditedAt: Date.UTC(2026, 9, 28, 7, 39), lastEditedBy: 'u-ada' };

const ROWS: Array<{ id: string; properties: Record<string, unknown> }> = [
  {
    id: 'r1',
    properties: {
      'p-title': 'A',
      'p-file': [{ id: 'f1', name: FILE_URL, url: FILE_URL }],
      'p-status': 'o-ip',
      'p-person': ['u-ada'],
      'p-done': true,
    },
  },
  { id: 'r2', properties: { 'p-title': 'B' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ROWS.map((r) => r.id),
  },
  ...ROWS.map((r, i) => ({
    id: r.id,
    type: 'database-row',
    parent: 'db-1',
    ...META,
    data: { position: `a${i}`, properties: r.properties },
  })),
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1400px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, blocks());
  await expect(page.getByRole('grid')).toBeVisible();
};

const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

const style = (locator: Locator, props: string[]): Promise<Record<string, string>> => locator.evaluate((el, names) => {
  const cs = getComputedStyle(el);

  return Object.fromEntries(names.map((name) => [name, cs.getPropertyValue(name)]));
}, props);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.emulateMedia({ colorScheme: 'light' });
  await mount(page);
});

test('a file name in a wrapping table stays on one line in its 24px chip, cut with "…" (§18.1)', async ({ page }) => {
  const link = cell(page, 'r1', 'p-file').locator('[data-blok-database-cell-link]');

  expect((await link.boundingBox())?.height).toBe(24);
  expect(await style(link, ['white-space', 'text-overflow'])).toEqual({ 'white-space': 'nowrap', 'text-overflow': 'ellipsis' });
  expect(await link.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('the link hover card uses Blok\'s sans font on a page that sets none', async ({ page }) => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'see <a href="https://example.com/">this link</a> now' } }] },
    });
    await window.blokInstance.isReady;
  });
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).not.toMatch(/sans/);

  await page.getByText('this link').hover();
  const card = page.getByTestId('link-hover-card');

  await expect(card).toBeVisible();
  expect((await style(card, ['font-family']))['font-family']).toMatch(/^ui-sans-serif/);
});

test('hovering a file chip shows its full link in a hint, not the link card (§20.11, files-hover.png)', async ({ page }) => {
  const link = cell(page, 'r1', 'p-file').locator('[data-blok-database-cell-link]');

  await link.hover();
  await expect(page.getByRole('tooltip')).toHaveText(FILE_URL);
  await expect(page.getByTestId('link-hover-card')).toHaveCount(0);
});

test('a plain click on a file chip opens the files box and no new page; Cmd/Ctrl-click opens the file', async ({ page }) => {
  const link = cell(page, 'r1', 'p-file').locator('[data-blok-database-cell-link]');
  const opened: string[] = [];

  page.context().on('page', (p) => opened.push(p.url()));
  await link.click();
  await expect(page.locator('[data-blok-database-files-editor]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(opened).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-blok-database-files-editor]')).toHaveCount(0);

  const popup = page.context().waitForEvent('page');

  await link.click({ modifiers: ['ControlOrMeta'] });
  expect((await popup).url()).toContain('example.com/a.pdf');
});

test('rows stay 37px with Status, Person, Created by and Last edited by columns, filled or empty (§18, recon §0)', async ({ page }) => {
  for (const rowId of ['r1', 'r2']) {
    expect((await page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`).boundingBox())?.height).toBe(37);
  }
});

test('Status, Created by and Last edited by cells pad 8px on every side (§18.1, §20.1)', async ({ page }) => {
  for (const propertyId of ['p-status', 'p-cb', 'p-lb']) {
    expect(await style(cell(page, 'r1', propertyId), ['padding'])).toEqual({ padding: '8px' });
  }
});

test('a checked box is a 16px blue square with no border (§18.1)', async ({ page }) => {
  const box = cell(page, 'r1', 'p-done').locator('[data-blok-database-checkbox]');

  expect(await style(box, ['border-top-width', 'background-color', 'width', 'height'])).toEqual({
    'border-top-width': '0px',
    'background-color': 'rgb(39, 131, 222)',
    'width': '16px',
    'height': '16px',
  });
  const glyph = await box.locator('svg').boundingBox();
  const outer = await box.boundingBox();

  expect((glyph?.x ?? 0) - (outer?.x ?? 0)).toBe(1);
});
