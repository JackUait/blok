import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const DOC: OutputData['blocks'] = [
  {
    id: 'db1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-notes'] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'old' } } },
  { id: 'r2', type: 'database-row', parent: 'db1', data: { position: 'a1', properties: { 'p-title': 'Beta', 'p-notes': 'beta note' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (blocks) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', data: { blocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, DOC);
};

const notesOf = (page: Page, rowId: string): Promise<unknown> => page.evaluate(async (id) => {
  const saved = await window.blokInstance?.save();
  const row = saved?.blocks.find((block) => block.id === id);

  return (row?.data as { properties?: Record<string, unknown> } | undefined)?.properties?.['p-notes'];
}, rowId);

const cell = (page: Page, rowId: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="p-notes"]`);

const field = (page: Page): ReturnType<Page['locator']> => page.locator('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

/** r2 Notes gets a committed " X", then a draft " DRAFT" typed and left open. */
const commitThenDraft = async (page: Page): Promise<void> => {
  await cell(page, 'r2').click();
  await expect(field(page)).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' X');
  await page.keyboard.press('Enter');
  await expect.poll(() => notesOf(page, 'r2')).toBe('beta note X');

  await cell(page, 'r2').click();
  await expect(field(page)).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' DRAFT');
  await expect(field(page)).toHaveValue('beta note X DRAFT');
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test.describe('undo from code with a database cell draft open', () => {
  test('history.undo() commits the draft as its own step and undoes it; redo brings it back', async ({ page }) => {
    await commitThenDraft(page);

    await page.evaluate(() => window.blokInstance?.history.undo());

    await expect.poll(() => notesOf(page, 'r2')).toBe('beta note X');
    await expect(field(page)).toHaveCount(0);

    await page.evaluate(() => window.blokInstance?.history.redo());

    await expect.poll(() => notesOf(page, 'r2')).toBe('beta note X DRAFT');
    await expect(cell(page, 'r2')).toContainText('beta note X DRAFT');
  });

  test('a second undo takes back the committed step before the draft', async ({ page }) => {
    await commitThenDraft(page);

    await page.evaluate(() => {
      window.blokInstance?.history.undo();
      window.blokInstance?.history.undo();
    });

    await expect.poll(() => notesOf(page, 'r2')).toBe('beta note');
    await expect.poll(() => page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
  });

  test('Cmd+Z in the field stays the field\'s own undo and leaves Blok history alone', async ({ page }) => {
    await commitThenDraft(page);

    await page.keyboard.press(UNDO);

    await expect(field(page)).not.toHaveValue('beta note X DRAFT');
    await expect(field(page)).toBeFocused();
    expect(await notesOf(page, 'r2')).toBe('beta note X');
    expect(await page.evaluate(() => window.blokInstance?.history.canRedo())).toBe(false);
  });
});
