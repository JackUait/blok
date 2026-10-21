/**
 * The "/" menu's Database section (research/28): Notion's entries, order,
 * labels, search suffix and what each one inserts.
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

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }] },
      tools: {
        database: { class: (window as unknown as Record<string, unknown>).BlokDatabase },
        'database-row': { class: (window as unknown as Record<string, unknown>).BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  });
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const typeInFirstParagraph = async (page: Page, text: string): Promise<void> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type(text);
};

const ENTRY_ORDER = [
  'tableView', 'board', 'galleryView', 'listView', 'feedView', 'calendarView', 'timelineView', 'mapView', 'databaseForm', 'database', 'linkedDatabase',
];

const LABELS = [
  'Table view', 'Board view', 'Gallery view', 'List view', 'Feed view', 'Calendar view', 'Timeline view', 'Map view', 'Form', 'Database - Inline',
  'Linked view of data source',
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
});

// research/28 §1a: one Database section after Media, before Advanced blocks, in Notion's order, with no suffix.
test('"/" shows the Database section in Notion\'s order, between Media and Advanced blocks, with no "· Database"', async ({ page }) => {
  await mount(page);
  await typeInFirstParagraph(page, '/');
  const toolbox = page.getByTestId('toolbox-popover');

  await expect(toolbox.locator('[data-blok-item-name="tableView"]')).toBeVisible();
  const order = await toolbox.locator('[data-blok-item-name]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-blok-item-name')));
  const section = order.slice(order.indexOf('toolbox-section-database') + 1, order.indexOf('toolbox-section-advanced'));

  expect(order.indexOf('toolbox-section-media')).toBeLessThan(order.indexOf('toolbox-section-database'));
  expect(section).toEqual(ENTRY_ORDER);
  for (const [index, name] of ENTRY_ORDER.entries()) {
    const row = toolbox.locator(`[data-blok-item-name="${name}"]`);

    await expect(row.getByTestId('popover-item-title')).toHaveText(LABELS[index]);
    await expect(row.locator('[data-blok-popover-item-search-suffix]')).toBeHidden();
  }
});

// research/28 §2: the highlighted row for each query, and "· Database" in search results.
const QUERIES = [
  ['/table view', 'tableView'],
  ['/board', 'board'],
  ['/gallery', 'galleryView'],
  ['/list', 'listView'],
  ['/feed', 'feedView'],
  ['/calendar', 'calendarView'],
  ['/timeline', 'timelineView'],
  ['/map', 'mapView'],
  ['/form', 'databaseForm'],
  ['/database', 'database'],
  ['/inline', 'database'],
  ['/linked', 'linkedDatabase'],
] as const;

for (const [query, name] of QUERIES) {
  test(`"${query}" puts ${name} first, with a grey "· Database"`, async ({ page }) => {
    await mount(page);
    await typeInFirstParagraph(page, query);
    const first = page.getByTestId('toolbox-popover').locator('[data-blok-item-name]:visible').first();

    await expect(first).toHaveAttribute('data-blok-item-name', name);
    const suffix = first.locator('[data-blok-popover-item-search-suffix]');

    await expect(suffix).toBeVisible();
    await expect(suffix).toHaveText('· Database');
    expect(await suffix.evaluate((node) => getComputedStyle(node).color)).not.toBe(await first.getByTestId('popover-item-title').evaluate((node) => getComputedStyle(node).color));
  });
}

test('"/text" shows no suffix on a Basic blocks row', async ({ page }) => {
  await mount(page);
  await typeInFirstParagraph(page, '/text');
  const row = page.getByTestId('toolbox-popover').locator('[data-blok-item-name="paragraph"]:visible');

  await expect(row).toBeVisible();
  await expect(row.locator('[data-blok-popover-item-search-suffix]')).toHaveCount(0);
});

// research/28 §3: what each entry inserts.
const INSERTS = [
  // research/30 B7a: alone on the page, so no panel. The next test inserts a second one.
  { query: '/table view', views: [['table', 'Table']], schema: [['Name', 'title']], panel: false, title: '' },
  { query: '/board', views: [['board', 'Board view']], schema: [['Name', 'title'], ['Assign', 'person'], ['Status', 'status']], panel: true, title: '' },
  { query: '/gallery', views: [['gallery', 'Gallery view']], schema: [['Name', 'title'], ['Created', 'createdTime'], ['Tags', 'multiSelect']], panel: true, title: '' },
  { query: '/list view', views: [['list', 'List view']], schema: [['Name', 'title'], ['Tags', 'multiSelect'], ['Created', 'createdTime']], panel: true, title: '' },
  { query: '/feed', views: [['feed', 'Feed view']], schema: [['Name', 'title']], panel: true, title: '' },
  { query: '/calendar', views: [['calendar', 'Calendar view']], schema: [['Name', 'title'], ['Date', 'date'], ['Tags', 'multiSelect']], panel: true, title: '' },
  { query: '/timeline', views: [['timeline', 'Timeline view']], schema: [['Name', 'title'], ['Assign', 'person'], ['Date', 'date'], ['Status', 'status']], panel: true, title: '' },
  { query: '/map', views: [['map', 'Map view']], schema: [['Name', 'title'], ['Place', 'place']], panel: true, title: '' },
  {
    query: '/form',
    views: [['form', 'Form builder'], ['table', 'Responses']],
    schema: [['Question 1', 'title'], ['Respondent', 'createdBy'], ['Question 2', 'multiSelect'], ['Submission time', 'createdTime']],
    panel: false,
    title: 'New form',
  },
  { query: '/database', views: [['table', 'Table']], schema: [['Name', 'title']], panel: true, title: '' },
] as const;

type Saved = {
  views?: Array<{ id: string; type: string; name: string }>;
  activeViewId?: string;
  schema?: Array<{ name: string; type: string }>;
  title?: string;
};

const savedDatabase = async (page: Page): Promise<Saved | undefined> =>
  (await saved(page)).find((block) => block.type === 'database')?.data;

const expectInserted = (data: Saved | undefined, entry: typeof INSERTS[number]): void => {
  expect(data?.views?.map((view) => [view.type, view.name])).toEqual(entry.views);
  expect(data?.views?.find((view) => view.id === data.activeViewId)?.type).toBe(entry.views[0][0]);
  expect(data?.schema?.map((p) => [p.name, p.type])).toEqual(entry.schema);
  expect(data?.title ?? '').toBe(entry.title);
  expect(data).not.toHaveProperty('initialView');
};

for (const entry of INSERTS.filter((candidate) => candidate.panel)) {
  test(`"${entry.query}" + Enter inserts ${entry.views[0][1]} with the measured properties and the "New database" panel`, async ({ page }) => {
    await mount(page);
    await typeInFirstParagraph(page, entry.query);
    await page.keyboard.press('Enter');

    const panel = page.getByTestId('database-new-database-panel');

    await expect(panel).toBeVisible();
    await panel.getByTestId('database-new-source-empty').click();
    await expect(panel).toBeHidden();
    expectInserted(await savedDatabase(page), entry);
  });
}

for (const entry of INSERTS.filter((candidate) => !candidate.panel)) {
  test(`"${entry.query}" + Enter inserts ${entry.views[0][1]} with the measured properties and no panel`, async ({ page }) => {
    await mount(page);
    await typeInFirstParagraph(page, entry.query);
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-blok-tool="database"]')).toBeVisible();
    await expect(page.getByTestId('database-new-database-panel')).toHaveCount(0);
    expectInserted(await savedDatabase(page), entry);
  });
}

// research/28 §3: three sample cards around today.
test('"/timeline" adds Card 1-3 as rows of the new database', async ({ page }) => {
  await mount(page);
  await typeInFirstParagraph(page, '/timeline');
  await page.keyboard.press('Enter');
  await page.getByTestId('database-new-source-empty').click();

  await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database-row')
    .map((block) => (block.data as { title?: string }).title)).toEqual(['Card 1', 'Card 2', 'Card 3']);
});

// research/30 B7a, research/28:123-124: the first Table view on a fresh page opens no panel; one more below it does.
test('"/table view" opens no panel as the page\'s only block, and the panel for a second one', async ({ page }) => {
  await mount(page);
  await typeInFirstParagraph(page, '/table view');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-blok-tool="database"]')).toBeVisible();
  // The panel opens a frame after the insert: wait past it.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByTestId('database-new-database-panel')).toHaveCount(0);
  expect((await saved(page)).filter((block) => block.parent === undefined || block.parent === null).map((block) => block.type)).toEqual(['database']);

  await page.evaluate(() => {
    const blocks = window.blokInstance?.blocks;

    blocks?.insert('paragraph', { text: '' }, {}, blocks.getBlocksCount(), true, false, 'p1');
  });
  await page.locator('[data-blok-id="p1"] [contenteditable]').focus();
  await page.keyboard.type('/table view');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('database-new-database-panel')).toBeVisible();
  expect((await saved(page)).filter((block) => block.type === 'database')).toHaveLength(2);
});

test('"/linked" opens the source picker, not the "New database" panel', async ({ page }) => {
  await mount(page);
  await typeInFirstParagraph(page, '/linked');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('database-linked-new-empty')).toBeVisible();
  await expect(page.getByTestId('database-new-database-panel')).toHaveCount(0);
});
