import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
  editParagraphLikeText,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;
const CALLOUT = `${BLOK} [data-blok-component="callout"]`;

type TextData = { text?: string };
type CalloutData = { emoji?: string; textColor?: string | null; backgroundColor?: string | null };

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
 * Reveal a container block's OWN drag handle. Hovering a child of the container
 * would surface the child's handle, so we hover the container holder by its
 * data-blok-id (the top edge of its own holder, away from child content) and
 * then read the single visible settings toggler. Copied verbatim from
 * container-drag-in-column.spec.ts.
 */
const grabContainerHandle = async (page: Page, containerId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${containerId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for container ${containerId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
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
 * Two root blocks: a plain target paragraph and a callout (with one child
 * paragraph). The callout's rich text lives in its child block via the
 * parent/content tree — `data` only carries { emoji, textColor, backgroundColor }.
 */
const buildRoots = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    {
      id: 'callout1',
      type: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      content: ['callout1-child'],
    },
    { id: 'callout1-child', type: 'paragraph', data: { text: 'Inside the callout' }, parent: 'callout1' },
  ],
});

/**
 * Drive the side-drop: callout (root) -> RIGHT edge of "Target". After this the
 * editor holds a column_list with two columns [Target | callout].
 */
const dropCalloutBesideTarget = async (page: Page): Promise<void> => {
  await createBlok(page, buildRoots());

  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabContainerHandle(page, 'callout1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();
  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Callout drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping the root callout beside a block wraps both into columns and the callout keeps its child', async ({ page }) => {
    await dropCalloutBesideTarget(page);

    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);

    // A column_list with exactly two columns was created.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // The dropped callout is parented to the SECOND column ([target | callout]).
    const calloutParent = findBlock(saved, 'callout1')?.parent;
    expect(calloutParent).toBe(columnIds[1]);

    // The target rode into the FIRST column.
    expect(findBlock(saved, 'target')?.parent).toBe(columnIds[0]);

    // CRITICAL: the callout carries its subtree — its child paragraph still
    // belongs to the callout, not stranded at root or orphaned.
    expect(findBlock(saved, 'callout1-child')?.parent).toBe('callout1');
    expect(childrenOf(saved, 'callout1')).toEqual(['callout1-child']);

    // LIVE DOM: the callout holder sits in the second column, and so does its
    // child paragraph (same column index).
    const placement = await domColumnIndexById(page, ['target', 'callout1', 'callout1-child']);
    expect(placement['callout1']).toBe(1);
    expect(placement['callout1-child']).toBe(1);
    expect(placement['target']).toBe(0);

    // The child paragraph is mounted INSIDE the callout component in the DOM.
    const childInsideCallout = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="callout1-child"]');

      return child instanceof HTMLElement && child.closest('[data-blok-component="callout"]') !== null;
    });
    expect(childInsideCallout).toBe(true);
  });

  test('SAVE: the saved model nests column_list -> column -> callout -> child', async ({ page }) => {
    await dropCalloutBesideTarget(page);

    const saved = await saveBlok(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = childrenOf(saved, list?.id ?? '');
    expect(columnIds).toHaveLength(2);

    // The second column owns the callout, the callout owns its child.
    const secondColumn = columnIds[1];
    expect(childrenOf(saved, secondColumn)).toEqual(['callout1']);
    expect(findBlock(saved, 'callout1')?.parent).toBe(secondColumn);
    expect(childrenOf(saved, 'callout1')).toEqual(['callout1-child']);
    expect(findBlock(saved, 'callout1-child')?.parent).toBe('callout1');

    // The callout's own data survived the drop.
    expect((findBlock(saved, 'callout1')?.data as CalloutData).emoji).toBe('💡');
    expect((findBlock(saved, 'callout1-child')?.data as TextData).text).toBe('Inside the callout');
  });

  test('RELOAD: the callout stays inside its column in model and live DOM after a round-trip', async ({ page }) => {
    await dropCalloutBesideTarget(page);

    const before = await saveBlok(page);
    const beforeColumns = before.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    const calloutColumnBefore = findBlock(before, 'callout1')?.parent;
    expect(calloutColumnBefore).toBe(beforeColumns[1]);

    const after = await reloadFromSave(page);

    // Model: callout still parented to its (second) column; child still nested.
    const afterColumns = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(afterColumns).toHaveLength(2);
    expect(findBlock(after, 'callout1')?.parent).toBe(afterColumns[1]);
    expect(findBlock(after, 'callout1-child')?.parent).toBe('callout1');
    expect(childrenOf(after, 'callout1')).toEqual(['callout1-child']);

    // LIVE DOM: after the re-render the callout + child are still in column 1.
    const placement = await domColumnIndexById(page, ['target', 'callout1', 'callout1-child']);
    expect(placement['callout1']).toBe(1);
    expect(placement['callout1-child']).toBe(1);
    expect(placement['target']).toBe(0);

    const childInsideCallout = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="callout1-child"]');

      return child instanceof HTMLElement && child.closest('[data-blok-component="callout"]') !== null;
    });
    expect(childInsideCallout).toBe(true);
  });

  test('EDIT: editing the callout child persists and the callout stays in its column', async ({ page }) => {
    await dropCalloutBesideTarget(page);

    // The callout itself has no contenteditable; its primary content is the child
    // paragraph. Edit that text in place inside the column.
    await editParagraphLikeText(page, 'Inside the callout', 'Inside the callout edited');

    await expect(page.locator(CALLOUT).getByText('Inside the callout edited')).toBeVisible();

    const saved = await saveBlok(page);

    // The edit landed in the child paragraph's data.text.
    expect((findBlock(saved, 'callout1-child')?.data as TextData).text).toBe('Inside the callout edited');

    // The callout (and its child) is still inside its column after editing.
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(findBlock(saved, 'callout1')?.parent).toBe(columnIds[1]);
    expect(findBlock(saved, 'callout1-child')?.parent).toBe('callout1');

    // LIVE DOM: still in the second column, child still nested in the callout.
    const placement = await domColumnIndexById(page, ['callout1', 'callout1-child']);
    expect(placement['callout1']).toBe(1);
    expect(placement['callout1-child']).toBe(1);
  });

  test('REMOVE: deleting the callout collapses the emptied column and unwraps the layout', async ({ page }) => {
    await dropCalloutBesideTarget(page);

    // Delete the callout by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const idx = window.blokInstance.blocks.getBlockIndex('callout1');

      if (idx !== undefined) {
        await window.blokInstance.blocks.delete(idx);
      }
    });

    // Deleting the callout (the sole child of its column) empties that column,
    // which is removed; the list drops to one column and unwraps. The unwrap is
    // fire-and-forget async — poll until the scaffold dissolves.
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    const saved = await saveBlok(page);

    // The callout block is gone.
    expect(findBlock(saved, 'callout1')).toBeUndefined();

    // The columns scaffold dissolves: no column_list, no column survives.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The neighbour column's target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Target');

    // No orphaned blocks.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: no columns remain.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
