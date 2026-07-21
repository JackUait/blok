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
 * Reveal a LEAF block's drag handle: hover its block wrapper so the hover
 * controller surfaces the (single) visible settings toggler for that block.
 */
const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for leaf ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/** Reads `data.text` off a saved block without resorting to `any`. */
const quoteText = (block: { data: unknown } | undefined): string | undefined => {
  if (!block) {
    return undefined;
  }
  const data = block.data as { text?: string };

  return data.text;
};

/**
 * Build the starting fixture: two ROOT blocks — a plain target paragraph and a
 * root quote (leaf: text in data.text). No columns exist yet.
 */
const twoRootBlocks = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    { id: 'quote1', type: 'quote', data: { text: 'Everything is a block.', size: 'default' } },
  ],
});

/**
 * DROP the root quote onto the RIGHT edge of "Target", producing a 2-column
 * layout [Target | quote]. Returns the saved model after the drop settles.
 * Asserts BOTH the live DOM (domColumnIndexById == 1) and the saved model.
 */
const dropQuoteBesideTarget = async (page: Page): Promise<OutputData> => {
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabLeafHandle(page, 'quote1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);

  return await saveBlok(page);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Quote drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
  });

  test('side-dropping a root quote beside a block wraps both into columns with the quote in the second column', async ({ page }) => {
    await createBlok(page, twoRootBlocks());

    const saved = await dropQuoteBesideTarget(page);

    // A column_list with exactly two columns now exists.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();

    const columnIds = saved.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.id)
      .filter((id): id is string => id !== undefined);
    expect(columnIds).toHaveLength(2);

    // The column_list references both columns in order: [target column | quote column].
    expect(list?.content).toEqual(columnIds);

    // MODEL: the quote is parented to the SECOND column; the target to the first.
    const quoteParent = findBlock(saved, 'quote1')?.parent;
    const targetParent = findBlock(saved, 'target')?.parent;
    expect(columnIds).toContain(quoteParent);
    expect(columnIds).toContain(targetParent);
    expect(quoteParent).toBe(columnIds[1]);
    expect(targetParent).toBe(columnIds[0]);
    expect(childrenOf(saved, columnIds[1])).toEqual(['quote1']);

    // The quote stays a leaf — no children adopted in the parent/content tree.
    expect(childrenOf(saved, 'quote1')).toEqual([]);

    // LIVE DOM: the quote's holder is physically inside the 2nd column (index 1).
    const placement = await domColumnIndexById(page, ['target', 'quote1']);
    expect(placement['target']).toBe(0);
    expect(placement['quote1']).toBe(1);

    // The quote tool actually rendered in the DOM with its text intact.
    await expect(page.locator('[data-blok-tool="quote"]')).toContainText('Everything is a block.');
  });

  test('the dropped quote saves with correct column_list -> column -> quote nesting', async ({ page }) => {
    await createBlok(page, twoRootBlocks());

    await dropQuoteBesideTarget(page);

    const saved = await saveBlok(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list?.type).toBe('column_list');

    const columnIds = saved.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.id)
      .filter((id): id is string => id !== undefined);
    expect(columnIds).toHaveLength(2);

    // Every column is parented to the column_list.
    for (const id of columnIds) {
      expect(findBlock(saved, id)?.parent).toBe(list?.id);
    }

    // Full chain: column_list -> (2nd) column -> quote, with text preserved.
    const quote = findBlock(saved, 'quote1');
    expect(quote?.parent).toBe(columnIds[1]);
    expect(findBlock(saved, columnIds[1])?.parent).toBe(list?.id);
    expect(quoteText(quote)).toBe('Everything is a block.');
  });

  test('the dropped quote stays inside its column after a save -> reload -> save round-trip', async ({ page }) => {
    await createBlok(page, twoRootBlocks());

    await dropQuoteBesideTarget(page);

    const after = await reloadFromSave(page);

    // MODEL: two columns survive; the quote is still the sole child of a column.
    const columnIds = after.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.id)
      .filter((id): id is string => id !== undefined);
    expect(columnIds).toHaveLength(2);

    const quoteParent = findBlock(after, 'quote1')?.parent;
    expect(columnIds).toContain(quoteParent);
    expect(childrenOf(after, quoteParent ?? '')).toEqual(['quote1']);
    expect(quoteText(findBlock(after, 'quote1'))).toBe('Everything is a block.');

    // LIVE DOM after the round-trip: holder still mounted inside a column.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    const placement = await domColumnIndexById(page, ['quote1']);
    expect(placement['quote1']).toBeGreaterThanOrEqual(0);
    await expect(page.locator('[data-blok-tool="quote"]')).toContainText('Everything is a block.');
  });

  test('editing the dropped quote persists the new text and keeps it in its column', async ({ page }) => {
    await createBlok(page, twoRootBlocks());

    await dropQuoteBesideTarget(page);

    // Capture the live column index BEFORE the edit so we can prove it is unchanged.
    const before = await domColumnIndexById(page, ['quote1']);
    expect(before['quote1']).toBe(1);

    await editParagraphLikeText(page, 'Everything is a block.', 'A block is everything.');

    await expect(page.locator('[data-blok-tool="quote"]')).toContainText('A block is everything.');

    const saved = await saveBlok(page);
    const quote = findBlock(saved, 'quote1');

    // MODEL: the edit landed and the quote is still parented to its column.
    expect(quoteText(quote)).toBe('A block is everything.');
    const columnIds = saved.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.id)
      .filter((id): id is string => id !== undefined);
    expect(columnIds).toHaveLength(2);
    expect(quote?.parent).toBe(columnIds[1]);

    // LIVE DOM: the holder did not teleport out of the 2nd column during the edit.
    const after = await domColumnIndexById(page, ['quote1']);
    expect(after['quote1']).toBe(1);
  });

  test('removing the dropped quote collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, twoRootBlocks());

    await dropQuoteBesideTarget(page);

    // Delete the quote via the public block API (index-based).
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('quote1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties its column, which is removed; the list drops
    // to one column and unwraps. The unwrap is fire-and-forget async, so poll the
    // saved output until no column_list remains (its id is auto-generated).
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    const saved = await saveBlok(page);

    // The quote is gone from model and DOM.
    expect(findBlock(saved, 'quote1')).toBeUndefined();
    await expect(page.locator('[data-blok-tool="quote"]')).toHaveCount(0);

    // The whole columns scaffold dissolved.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The pre-existing target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();
    expect(quoteText(findBlock(saved, 'target'))).toBe('Target');

    // No orphan points back at a removed block.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: no columns remain.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
