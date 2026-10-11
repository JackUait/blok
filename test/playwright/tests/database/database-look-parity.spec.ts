/**
 * Computed look against Notion's measured values (research/07 and 08).
 * Reads getComputedStyle and boxes, never the stylesheet text.
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

const LONG_URL = 'https://example.com/a/very/long/path/that/would/wrap/onto/several/lines/if/the/cell/let/it/wrap';

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-tags',
    name: 'Tags',
    type: 'multiSelect',
    position: 'a1',
    config: { options: [{ id: 't-x', label: 'X', color: 'red', position: 'a0' }, { id: 't-y', label: 'Y', position: 'a1' }] },
  },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a2' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a3' },
  { id: 'p-mail', name: 'Mail', type: 'email', position: 'a4' },
  { id: 'p-tel', name: 'Tel', type: 'phone', position: 'a5' },
  { id: 'p-file', name: 'Attachment', type: 'files', position: 'a6' },
  { id: 'p-act', name: 'Act', type: 'button', position: 'a7', button: { label: 'Run', buttonActions: [] } },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a8',
    config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }] },
  },
];

const ROWS: Array<{ id: string; properties: Record<string, unknown> }> = [
  {
    id: 'r1',
    properties: {
      'p-title': 'Alpha',
      'p-tags': ['t-x', 't-y'],
      'p-link': LONG_URL,
      'p-mail': 'a@example.com',
      'p-tel': '+1 555 0100',
      'p-file': [{ id: 'f1', name: 'brief.pdf', url: 'https://example.com/brief.pdf' }],
      'p-stage': 'o-idea',
    },
  },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-done': true, 'p-stage': 'o-idea' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
        { id: 'v2', name: 'Board', type: 'board', position: 'a1', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: ['p-title'] },
      ],
      activeViewId: 'v1',
    },
    content: ROWS.map((r) => r.id),
  },
  ...ROWS.map((r, i) => ({
    id: r.id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: r.properties },
  })),
];

const mount = async (page: Page, documentId?: string): Promise<void> => {
  await page.evaluate(async ({ input, documentId: docId }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    // A documentId scopes api.viewState, so personal state survives a remount.
    window.blokInstance = new window.Blok({ holder, ...(docId === undefined ? {} : { documentId: docId }), data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input: blocks(), documentId });
  await expect(page.getByRole('grid')).toBeVisible();
};

const style = (locator: Locator, props: string[]): Promise<Record<string, string>> => locator.evaluate((el, names) => {
  const cs = getComputedStyle(el);

  return Object.fromEntries(names.map((name) => [name, cs.getPropertyValue(name)]));
}, props);

const tab = (page: Page, viewId: string): Locator => page.locator(`[data-blok-database-tab][data-view-id="${viewId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.emulateMedia({ colorScheme: 'light' });
  await mount(page);
});

test('view tabs: 32px pill, 6px 12px, label 14px 500, Notion ink (research/07:45-50)', async ({ page }) => {
  const active = tab(page, 'v1');
  const inactive = tab(page, 'v2');

  expect((await active.boundingBox())?.height).toBe(32);
  expect(await style(active, ['padding-top', 'padding-left', 'border-top-left-radius', 'font-size', 'font-weight', 'background-color', 'color'])).toEqual({
    'padding-top': '6px',
    'padding-left': '12px',
    // The pill role: on a 32px tab it draws the same round end as Notion's 20px.
    'border-top-left-radius': '9999px',
    'font-size': '14px',
    'font-weight': '500',
    'background-color': 'rgba(33, 27, 23, 0.05)',
    'color': 'rgb(44, 44, 43)',
  });
  expect((await style(inactive, ['color'])).color).toBe('rgb(125, 122, 117)');
  expect(await active.evaluate((el) => el.querySelector('svg')?.getBoundingClientRect().width)).toBe(20);
});

test('toolbar Filter and Sort are 28px icon buttons in Notion icon gray (research/07:53)', async ({ page }) => {
  for (const testId of ['database-toolbar-filter', 'database-toolbar-sort']) {
    const button = page.getByTestId(testId);
    const box = await button.boundingBox();

    expect([box?.width, box?.height]).toEqual([28, 28]);
    await expect(button).toHaveText('');
    expect(await button.evaluate((el) => el.querySelectorAll('svg').length)).toBe(1);
    expect((await style(button, ['color'])).color).toBe('rgb(142, 139, 134)');
  }
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
});

test('rows stay 37px with Files and Button columns and a long URL (research/07:70, 08:380)', async ({ page }) => {
  for (const rowId of ['r1', 'r2']) {
    expect((await page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`).boundingBox())?.height).toBe(37);
  }
});

test('URL, email and phone cells are ink with no underline (research/08:279)', async ({ page }) => {
  for (const propertyId of ['p-link', 'p-mail', 'p-tel']) {
    const link = cell(page, 'r1', propertyId).locator('[data-blok-database-cell-link]');

    expect(await style(link, ['color', 'text-decoration-line'])).toEqual({ 'color': 'rgb(44, 44, 43)', 'text-decoration-line': 'none' });
  }
});

test('cell deltas: multi-select gap 8, button 500 (research/07:98; 08:280)', async ({ page }) => {
  const pills = cell(page, 'r1', 'p-tags').locator('[data-blok-database-option-pill]');
  const first = await pills.nth(0).boundingBox();
  const second = await pills.nth(1).boundingBox();

  expect(Math.round((second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0)))).toBe(8);
  expect(await style(cell(page, 'r1', 'p-act').locator('[data-blok-database-button]'), ['font-weight', 'line-height'])).toEqual({ 'font-weight': '500', 'line-height': '16.8px' });
});

test('board card: 40px, ink title, white action pill with the menu shadow (research/07:135, 08:73,317)', async ({ page }) => {
  await tab(page, 'v2').click();
  const card = page.locator('[data-blok-database-card][data-row-id="r2"]');

  await expect(card).toBeVisible();
  expect((await card.boundingBox())?.height).toBe(40);
  expect((await card.boundingBox())?.width).toBe(260);
  expect((await style(card.locator('[data-blok-database-card-title]'), ['color'])).color).toBe('rgb(44, 44, 43)');

  await card.hover();
  const actions = card.locator('[data-blok-database-card-actions]');

  await expect(actions).toHaveCSS('opacity', '1');
  expect(await style(actions, ['background-color', 'box-shadow', 'transition-duration'])).toEqual({
    'background-color': 'rgb(255, 255, 255)',
    'box-shadow': 'rgba(25, 25, 25, 0.027) 0px 8px 12px 0px, rgba(25, 25, 25, 0.027) 0px 2px 6px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px',
    'transition-duration': '0.2s',
  });
  expect((await actions.boundingBox())?.height).toBe(24);
  expect((await style(card.locator('[data-blok-database-card-menu]'), ['color'])).color).toBe('rgb(125, 122, 117)');
});

test('side peek: labels in Notion secondary ink, 34px rows (research/08:329)', async ({ page }) => {
  await tab(page, 'v2').click();
  await page.locator('[data-blok-database-card][data-row-id="r2"] [data-blok-database-card-title]').click();
  const row = page.locator('[data-blok-database-drawer-prop-row]').first();

  await expect(row).toBeVisible();
  expect((await row.boundingBox())?.height).toBe(34);
  expect((await style(row.locator('[data-blok-database-drawer-prop-label]'), ['color'])).color).toBe('rgb(125, 122, 117)');
});

test('"Display as" Icon only hides tab names visually, keeps them named, and survives a remount (research/03 §1.2)', async ({ page }) => {
  const documentId = `look-parity-${Date.now()}`;

  await mount(page, documentId);
  await tab(page, 'v1').click({ button: 'right' });
  await page.getByText('Display as', { exact: true }).hover();
  await page.getByText('Icon only', { exact: true }).click();

  const name = tab(page, 'v2').locator('[data-blok-database-tab-name]');

  expect((await name.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();

  await mount(page, documentId);
  await expect(page.locator('[data-blok-database-tab-bar]')).toHaveAttribute('data-display', 'icon');
});
