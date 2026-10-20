/**
 * The "New database" panel's AI prompt (research/26 §2, research/20 §1a), with a
 * stub `ai.setupDatabase` in place of the host's model.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    setupPrompts?: string[];
  }
}

const mount = async (page: Page, withLever: boolean): Promise<void> => {
  await page.evaluate(async (lever) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.setupPrompts = [];
    const ai = {
      autofill: () => Promise.resolve(undefined),
      setupDatabase: (request: { prompt: string }) => {
        window.setupPrompts?.push(request.prompt);

        return Promise.resolve({
          title: 'Trips',
          schema: [
            { id: 'h-title', name: 'Trip', type: 'title', position: 'a0' },
            { id: 'p-when', name: 'When', type: 'date', position: 'a1' },
          ],
        });
      },
    };

    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }] },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
          config: lever ? { ai } : {},
        },
        'database-row': { class: (window as unknown as Record<string, unknown>).BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, withLever);
};

const insertDatabase = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/database');
  const toolbox = page.getByTestId('toolbox-popover');

  const item = toolbox.locator('[data-blok-item-name="database"]:visible');

  await expect(item).toContainText('Database');
  await item.click();
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a new database opens "New database" with the prompt focused; the host answer builds it', async ({ page }) => {
  await mount(page, true);
  await insertDatabase(page);

  const panel = page.getByTestId('database-new-database-panel');
  const prompt = panel.getByRole('textbox', { name: 'Describe what you want to build' });
  const send = panel.getByRole('button', { name: 'Send' });

  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('width', '290px');
  await expect(panel.getByText('New database', { exact: true })).toBeVisible();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('placeholder', 'Describe what you want to build');
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await expect(panel.getByText('New empty data source')).toBeVisible();
  await expect(panel.getByText('Link to existing data source')).toBeVisible();

  const box = await panel.locator('[data-blok-database-ai-prompt]').evaluate((el) => {
    const style = getComputedStyle(el);

    // offset sizes: the opening animation scales the panel.
    return { width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight, radius: style.borderTopLeftRadius, border: style.borderTopWidth };
  });

  expect(box).toEqual({ width: 268, height: 56, radius: '12px', border: '1px' });
  expect(await send.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])).toEqual([20, 20]);

  await page.keyboard.type('Plan my trips');
  await expect(send).not.toHaveAttribute('aria-disabled');
  await page.keyboard.press('Enter');

  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => window.setupPrompts)).toEqual(['Plan my trips']);
  await expect(page.getByRole('columnheader', { name: 'When' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Trip' })).toBeVisible();

  const database = (await saved(page)).find((block) => block.type === 'database');
  const data = database?.data as { title?: string; schema?: Array<{ name: string; type: string }> } | undefined;

  expect(data?.title).toBe('Trips');
  expect(data?.schema?.map((p) => [p.name, p.type])).toEqual([['Trip', 'title'], ['When', 'date']]);

  // One undo takes the whole setup back, and the panel stays shut.
  await page.evaluate(() => window.blokInstance?.history.undo());
  await expect.poll(async () => {
    const back = (await saved(page)).find((block) => block.type === 'database')?.data as { title?: string; schema?: Array<{ name: string }> } | undefined;

    return [back?.title ?? '', back?.schema?.map((p) => p.name)];
  }).toEqual(['', ['Title', 'Status']]);
  await expect(page.getByTestId('database-new-database-panel')).toHaveCount(0);
});

// research/20 §1a: Notion always opens the panel. Its top without AI was never measured: Blok shows the rows with no box.
test('without the host lever a new database still opens "New database", with no prompt box and the first row focused', async ({ page }) => {
  await mount(page, false);
  await insertDatabase(page);

  const panel = page.getByTestId('database-new-database-panel');

  await expect(panel).toBeVisible();
  await expect(panel.getByText('New database', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-blok-database-ai-prompt]')).toHaveCount(0);
  await expect(panel.getByTestId('database-new-source-empty')).toBeFocused();
  await expect(panel.getByTestId('database-new-source-csv')).toHaveText('Import CSV');
  await expect(panel.getByTestId('database-new-database-starter-tasks')).toBeVisible();
  await expect(panel.getByText('Link to existing data source')).toBeVisible();

  // "New empty data source" only closes it; the empty database stays.
  await panel.getByTestId('database-new-source-empty').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('[data-blok-tool="database"]').first().getByRole('grid')).toBeVisible();
});

// research/27 §2: the data goes into the database the panel came from, and its title stays.
test('Import CSV from the panel opens the import dialog and fills the new database itself; one undo empties it', async ({ page }) => {
  await mount(page, false);
  await insertDatabase(page);

  const panel = page.getByTestId('database-new-database-panel');

  await panel.getByTestId('database-new-source-csv').click();
  const dialog = page.getByRole('dialog');
  const chooser = page.waitForEvent('filechooser');

  await dialog.getByTestId('database-csv-choose-file').click();
  await (await chooser).setFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Size\nAlpha,3\nBeta,5') });
  await dialog.getByTestId('database-csv-map').click();
  await dialog.getByTestId('database-csv-import').click();

  await expect(page.getByRole('columnheader', { name: 'Size' })).toBeVisible();
  await expect(page.getByText('Alpha')).toBeVisible();
  const blocks = await saved(page);
  const databases = blocks.filter((block) => block.type === 'database');
  const data = databases[0]?.data as { title?: string; schema?: Array<{ name: string }> } | undefined;

  expect(databases).toHaveLength(1);
  expect(data?.title ?? '').toBe('');
  expect(data?.schema?.map((p) => p.name)).toEqual(['Name', 'Size']);
  expect(blocks.filter((block) => block.type === 'database-row')).toHaveLength(2);

  await page.evaluate(() => window.blokInstance?.history.undo());
  await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database-row').length).toBe(0);
});

// research/26 §2: Notion's `/table view` starts a new database as a table; research/03 §1: a new database gets one Table view.
test('the "/" Database entry starts a table, not a board', async ({ page }) => {
  await mount(page, false);
  await insertDatabase(page);

  await expect(page.locator('[data-blok-tool="database"]').first().getByRole('grid')).toBeVisible();
  const database = (await saved(page)).find((block) => block.type === 'database');
  const views = (database?.data as { views?: Array<{ type: string }> } | undefined)?.views;

  expect(views?.map((view) => view.type)).toEqual(['table']);
});

// research/20 §1a: Notion opens the panel for a view-type entry too (`/map`), and keeps its layout.
test('the "/" Board entry opens "New database" too; New empty data source keeps the board', async ({ page }) => {
  await mount(page, false);
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/board');
  const item = page.getByTestId('toolbox-popover').locator('[data-blok-item-name="board"]:visible');

  await expect(item).toContainText('Board');
  await item.click();

  const panel = page.getByTestId('database-new-database-panel');

  await expect(panel).toBeVisible();
  await expect(panel.getByText('New database', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('database-new-source-empty')).toBeFocused();
  await panel.getByTestId('database-new-source-empty').click();
  await expect(panel).toBeHidden();

  const database = (await saved(page)).find((block) => block.type === 'database');
  const data = database?.data as { views?: Array<{ type: string }> } | undefined;

  expect(data?.views?.map((view) => view.type)).toEqual(['board']);
  expect(data).not.toHaveProperty('initialView');
});
