import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
  editParagraphLikeText,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

type HeaderData = { text?: string; level?: number };

/**
 * Drag the block whose drag handle is `sourceHandle` onto the left/right edge of
 * `targetBlock` (its vertical mid-band) to trigger a column (side) drop. Copied
 * verbatim from container-drag-in-column.spec.ts so this spec is standalone.
 */
const performSideDrop = async (
  page: Page,
  sourceHandle: Locator,
  targetBlock: Locator,
  side: 'left' | 'right'
): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetBlock.locator('[data-blok-element-content]').first().boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for side drop');
  }

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = side === 'right' ? targetBox.x + targetBox.width - 4 : targetBox.x + 4;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 15 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );

  // The drop motion (ghost settle) finishes before assertions run.
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model. Copied verbatim from
 * container-drag-in-column.spec.ts.
 */
const domColumnIndexById = async (page: Page, ids: string[]): Promise<Record<string, number>> => {
  return await page.evaluate((blockIds: string[]) => {
    const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
    const out: Record<string, number> = {};

    for (const id of blockIds) {
      const holder = document.querySelector(`[data-blok-id="${id}"]`);

      if (!(holder instanceof HTMLElement)) {
        out[id] = -2; // not in DOM at all
        continue;
      }

      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]') ?? null;
      out[id] = ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    }

    return out;
  }, ids);
};

/**
 * Reveal a LEAF block's own drag handle: hover its holder by data-blok-id so the
 * hover controller surfaces the settings toggler, then return that single visible
 * toggler. Keyed by data-blok-id (never textContent) so a container's aggregated
 * text can't mismatch.
 */
const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for leaf block ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);

  await expect(handle).toBeVisible();

  return handle;
};

/**
 * Two root blocks: a plain target paragraph and a plain header. The header `data`
 * shape is exactly `{ text, level }` (a plain header is a leaf — no content, no
 * children), matching header-in-column.spec.ts.
 */
const dropFixture = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    { id: 'header1', type: 'header', data: { text: 'Features', level: 3 } },
  ],
});

/**
 * Drive the real side-drop: build the fixture, reveal the header's leaf handle,
 * and drop it onto the RIGHT edge of the target paragraph. Returns the id of the
 * second column (the one the header landed in).
 */
const dropHeaderRightOfTarget = async (page: Page): Promise<void> => {
  await createBlok(page, dropFixture());

  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabLeafHandle(page, 'header1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Header block drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
  });

  test('DROP: side-dropping a header beside a paragraph wraps both into columns with the header in the 2nd column', async ({ page }) => {
    await dropHeaderRightOfTarget(page);

    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);

    // A column_list with exactly two columns now exists.
    const list = saved.blocks.find((b) => b.type === 'column_list');

    expect(list).toBeDefined();
    const columnIds = saved.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.id)
      .filter((id): id is string => id !== undefined);

    expect(columnIds).toHaveLength(2);

    // MODEL: target rode into the first column, header into the second.
    expect(findBlock(saved, 'target')?.parent).toBe(columnIds[0]);
    expect(findBlock(saved, 'header1')?.parent).toBe(columnIds[1]);
    expect(childrenOf(saved, columnIds[1])).toEqual(['header1']);

    // A plain header is a leaf — it must carry no content/children along the drop.
    expect(findBlock(saved, 'header1')?.content).toBeUndefined();
    expect(childrenOf(saved, 'header1')).toEqual([]);

    // LIVE DOM: the header holder is physically inside the SECOND column (index 1),
    // not stranded in the columns row or in the target's column.
    const placement = await domColumnIndexById(page, ['target', 'header1']);

    expect(placement['target']).toBe(0);
    expect(placement['header1']).toBe(1);

    // The header still renders as a real heading inside a column.
    const headerInColumn = page.locator('[data-blok-column] [data-blok-tool="header"]');

    await expect(headerInColumn).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible();
  });

  test('SAVE: the dropped header serializes as column_list -> column -> header with intact data', async ({ page }) => {
    await dropHeaderRightOfTarget(page);

    const saved = await saveBlok(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');

    expect(list).toBeDefined();
    const columnIds = childrenOf(saved, list?.id ?? '');

    expect(columnIds).toHaveLength(2);

    // The full parent chain: column_list owns two columns, the second column owns
    // the header, and the header's primary data is preserved.
    const headerParent = findBlock(saved, 'header1')?.parent;

    expect(columnIds).toContain(headerParent);
    expect(childrenOf(saved, headerParent ?? '')).toEqual(['header1']);

    const headerData = findBlock(saved, 'header1')?.data as HeaderData;

    expect(headerData.text).toBe('Features');
    expect(headerData.level).toBe(3);

    // No orphans: every non-root block points at an existing parent.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !allIds.has(b.parent));

    expect(orphans).toEqual([]);
  });

  test('RELOAD: after a save -> reload -> save round-trip the header stays in its column in model and live DOM', async ({ page }) => {
    await dropHeaderRightOfTarget(page);

    const before = await saveBlok(page);
    const beforeColumns = before.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    const beforeHeaderParent = findBlock(before, 'header1')?.parent;

    const after = await reloadFromSave(page);

    // MODEL: the header is still parented to one of the two columns, and that
    // column is still the second one.
    const afterColumns = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);

    expect(afterColumns).toHaveLength(2);
    const afterHeaderParent = findBlock(after, 'header1')?.parent;

    expect(afterColumns).toContain(afterHeaderParent);
    expect(afterHeaderParent).toBe(beforeHeaderParent);
    expect(afterColumns.indexOf(afterHeaderParent ?? '')).toBe(beforeColumns.indexOf(beforeHeaderParent ?? ''));

    const headerData = findBlock(after, 'header1')?.data as HeaderData;

    expect(headerData.text).toBe('Features');
    expect(headerData.level).toBe(3);

    // LIVE DOM: after the rebuild the header holder is still in the 2nd column.
    const placement = await domColumnIndexById(page, ['target', 'header1']);

    expect(placement['target']).toBe(0);
    expect(placement['header1']).toBe(1);
  });

  test('EDIT: retyping the dropped header persists and the header stays in its column', async ({ page }) => {
    await dropHeaderRightOfTarget(page);

    // The <h3> is the editable surface; select all and retype its text.
    await editParagraphLikeText(page, 'Features', 'Roadmap');

    await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible();

    const saved = await saveBlok(page);
    const headerData = findBlock(saved, 'header1')?.data as HeaderData;

    // MODEL: the edit persisted and the header is still parented to a column.
    expect(headerData.text).toBe('Roadmap');
    expect(headerData.level).toBe(3);
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);

    expect(columnIds).toContain(findBlock(saved, 'header1')?.parent);

    // LIVE DOM: the edit did not eject the header from its column.
    const placement = await domColumnIndexById(page, ['header1']);

    expect(placement['header1']).toBe(1);
  });

  test('REMOVE: deleting the dropped header collapses the emptied column and unwraps the layout', async ({ page }) => {
    await dropHeaderRightOfTarget(page);

    // Delete the header by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('header1');

      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties its column, which is removed; the list drops
    // to one column and unwraps. The unwrap is fire-and-forget async, so poll the
    // saved output until no column_list remains (its id is auto-generated).
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    const saved = await saveBlok(page);

    // The header block is gone.
    expect(findBlock(saved, 'header1')).toBeUndefined();

    // The whole columns scaffold dissolved.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The pre-existing target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Target');

    // No orphaned blocks remain.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));

    expect(orphans).toEqual([]);

    // LIVE DOM: no columns remain.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
