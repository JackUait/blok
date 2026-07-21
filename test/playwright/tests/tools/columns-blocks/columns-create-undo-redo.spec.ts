import type { Page } from '@playwright/test';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
} from './_helpers';

/**
 * Creating a column layout via the slash menu persists a transient `columnCount`
 * seed AND establishes each column's parentId only through a post-insert
 * setBlockParent that runs inside the RENDERED-hook atomic wrapper. Two latent
 * bugs used to converge here on undo→redo of the creation:
 *   1. the re-added column_list re-fired seedColumns() while its columns were
 *      momentarily detached → phantom EXTRA columns (2 became 4);
 *   2. the columns' parentId was never persisted to Yjs (the setBlockParent
 *      write was skipped under isSyncingFromYjs) → they re-materialised orphaned
 *      at document root, escaping their list.
 * This asserts a create→undo→redo cycle round-trips to exactly 2 columns, both
 * parented to the (single) column_list.
 */
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE = 600;
const TOOLBOX_CONTAINER = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';
const toolboxItem = (name: string): string =>
  `[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`;

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => new Promise<void>((r) => window.setTimeout(r, t)), ms);
};

test.beforeAll(() => ensureBlokBundleBuilt());

test('create columns via toolbox, undo, redo — columns stay parented, never doubled', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await createBlok(page, { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }] });

  const p0 = page.locator('[data-blok-id="p0"] [contenteditable="true"]').first();
  await p0.click();
  await page.keyboard.type('/');
  await page.locator(TOOLBOX_CONTAINER).waitFor();
  await page.locator(toolboxItem('column_list-2')).click();
  await wait(page, CAPTURE);
  await expect(page.locator('[data-blok-column]')).toHaveCount(2);

  const colParas = page.locator('[data-blok-column] [contenteditable="true"]');
  await colParas.nth(0).click();
  await page.keyboard.type('Left');
  await wait(page, CAPTURE);
  await colParas.nth(1).click();
  await page.keyboard.type('Right');
  await wait(page, CAPTURE);

  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(UNDO);
    await wait(page, CAPTURE);
  }
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(REDO);
    await wait(page, CAPTURE);
  }

  const saved = await saveBlok(page);
  const dumpStr = saved.blocks
    .map((b) => `${b.id}:${b.type}<-${(b as { parent?: string }).parent ?? 'ROOT'}`)
    .join('  |  ');
  const cols = saved.blocks.filter((b) => b.type === 'column');
  const lists = saved.blocks.filter((b) => b.type === 'column_list');
  const orphanCols = cols.filter((c) => (c as { parent?: string }).parent !== lists[0]?.id);

  expect(cols.length, `exactly 2 columns after undo/redo — ${dumpStr}`).toBe(2);
  expect(lists.length, `exactly 1 column_list — ${dumpStr}`).toBe(1);
  expect(orphanCols.map((c) => c.id), `no column orphaned at root — ${dumpStr}`).toEqual([]);

  // Live DOM agrees: exactly two column wrappers, both inside the one row.
  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  const foreign = await page.evaluate(() => {
    const row = document.querySelector('[data-blok-columns]');
    if (!row) return ['<no row>'];
    return Array.from(row.children)
      .filter((c) => !(c as HTMLElement).matches('[data-blok-column-resizer]'))
      .filter((c) => (c as HTMLElement).querySelector('[data-blok-column]') === null)
      .map((c) => (c as HTMLElement).getAttribute('data-blok-id') ?? '<anon>');
  });
  expect(foreign, 'no foreign holder rendered as a phantom column').toEqual([]);
});
