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
