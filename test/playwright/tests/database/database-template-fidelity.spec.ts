/**
 * Status 32 list A items 6 and 7: the board's add button names the default
 * template, a status default option, a view's own group order, the Customize
 * preview, and a board's Card layout.
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

interface Option { id: string; label: string; color?: string }
interface Property { id: string; name: string; type: string; config?: { options: Option[] }; status?: { defaultOptionId?: string } }
interface View { id: string; name: string; type: string; cardLayout?: string }
interface Database { schema: Property[]; views: View[] }

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

const insertDatabase = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/database');
  const item = page.getByTestId('toolbox-popover').locator('[data-blok-item-name="database"]:visible');

  await expect(item).toContainText('Database');
  await item.click();
  await expect(page.getByTestId('database-new-database-panel')).toBeVisible();
};

const read = async (page: Page): Promise<{ db: Database; rows: OutputBlockData[] }> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);
  const block = blocks.filter((b) => b.type === 'database').at(-1);
  const rows = blocks.filter((b) => b.type === 'database-row' && b.parent === block?.id && (b.data as { template?: boolean }).template !== true);

  return { db: block?.data as unknown as Database, rows };
};

const tasksTracker = async (page: Page): Promise<void> => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Tasks Tracker' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Tasks Tracker' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Improve website copy')).toBeVisible();
};

const openBoard = async (page: Page): Promise<void> => {
  await page.getByRole('tab', { name: 'By Status' }).click();
  await expect(page.locator('[data-blok-database-board]')).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('the By Status board reads "New task" under each column; a click there starts the row in that column', async ({ page }) => {
  await tasksTracker(page);
  await openBoard(page);
  const buttons = page.locator('[data-blok-database-add-card]');

  // Not started, In progress and Done. Every row has a status, so there is no "No Status" column (6bae8a6f).
  await expect(buttons).toHaveText(['New task', 'New task', 'New task']);
  await page.locator('[data-blok-database-column][data-option-id] [data-blok-database-add-card]').nth(1).click();
  await expect.poll(async () => (await read(page)).rows.length).toBe(4);
  const { db, rows } = await read(page);
  const status = db.schema.find((p) => p.type === 'status');
  const added = rows.find((r) => !['Improve website copy', 'Update help center & FAQ', 'Publish release notes'].includes((r.data as { title?: string }).title ?? ''));

  expect(status?.config?.options.find((o) => o.id === (added?.data as { properties: Record<string, unknown> }).properties[status.id])?.label).toBe('In progress');
});

test('Not started is the default status: no colour saved, a gray pill, and new rows start with it', async ({ page }) => {
  await tasksTracker(page);
  const before = await read(page);
  const status = before.db.schema.find((p) => p.type === 'status');
  const notStarted = status?.config?.options[0];

  expect(notStarted?.label).toBe('Not started');
  expect(notStarted?.color).toBeUndefined();
  expect(status?.status?.defaultOptionId).toBe(notStarted?.id);
  await expect(page.locator('[data-blok-database-option-pill]', { hasText: 'Not started' }).first()).toHaveAttribute('data-color', 'gray');

  await page.evaluate(() => {
    const db = window.blokInstance?.blocks.getById?.(
      document.querySelector('[data-blok-tool="database"]')?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? ''
    );

    db?.call('newRow');
  });
  await expect.poll(async () => (await read(page)).rows.length).toBe(4);
  const { rows } = await read(page);
  const added = rows.at(-1)?.data as { properties: Record<string, unknown> };

  expect(added.properties[status?.id ?? '']).toBe(notStarted?.id);
});

test('Goals Tracker\'s By Team preview lists Account Management, Business Development, Human Resources, Product Design', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'More templates' }).click();
  const gallery = page.getByRole('dialog', { name: 'More templates' });

  await gallery.getByRole('button', { name: 'More templates' }).click();
  await gallery.getByTestId('database-template-gallery-template-goals').click();
  const dialog = page.getByRole('dialog', { name: 'Customize Goals Tracker' });

  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'By Team' }).click();
  await expect(dialog.locator('[data-blok-database-starter-preview-group]')).toHaveText([
    'Account Management', 'Business Development', 'Human Resources', 'Product Design', 'No Team',
  ]);
});

test('Card layout: List by default; Compact sets a card\'s properties side by side', async ({ page }) => {
  await tasksTracker(page);
  await openBoard(page);
  const card = page.locator('[data-blok-database-card]', { hasText: 'Improve website copy' });
  const props = card.locator('[data-blok-database-card-property]');

  await expect(props).toHaveCount(2);
  const [a, b] = [await props.nth(0).boundingBox(), await props.nth(1).boundingBox()];

  expect((b?.y ?? 0) > (a?.y ?? 0)).toBe(true);

  await page.getByTestId('database-toolbar-settings').click();
  await page.getByTestId('database-settings-layout').click();
  const box = page.getByTestId('database-settings-card-layout');

  await expect(box).toContainText('Card layout');
  await expect(page.getByTestId('database-card-layout-list')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('database-card-layout-compact').click();
  await expect(page.getByTestId('database-card-layout-compact')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await read(page)).db.views.find((v) => v.type === 'board')?.cardLayout).toBe('compact');
  await expect.poll(async () => {
    const [x, y] = [await props.nth(0).boundingBox(), await props.nth(1).boundingBox()];

    return Math.round(x?.y ?? -1) === Math.round(y?.y ?? -2);
  }).toBe(true);
});
