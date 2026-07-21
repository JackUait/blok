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
 * Reveal a container block's OWN drag handle. Hovering a child of the container
 * would surface the child's handle, so we hover the container holder by its
 * data-blok-id (the top edge of its own holder, away from child content) and
 * then read the single visible settings toggler.
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
 * LIVE DOM placement, not merely the saved model. -1 == in DOM but at root,
 * -2 == not in the DOM at all.
 */
const domColumnIndexById = async (page: Page, ids: string[]): Promise<Record<string, number>> => {
  return await page.evaluate((blockIds: string[]) => {
    const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
    const out: Record<string, number> = {};

    for (const id of blockIds) {
      const holder = document.querySelector(`[data-blok-id="${id}"]`);

      if (!(holder instanceof HTMLElement)) {
        out[id] = -2;
        continue;
      }

      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]') ?? null;
      out[id] = ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    }

    return out;
  }, ids);
};

/**
 * Seed: a plain target paragraph at root plus a root Toggle block carrying a
 * child paragraph. The toggle is a container — its child is a real top-level
 * block (parent: 'toggle1') and the toggle carries content: ['tc1']. Data shape
 * copied from toggle-in-column.spec.ts; do NOT invent it.
 */
const seedTree = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    {
      id: 'toggle1',
      type: 'toggle',
      data: { text: 'Toggle title', isOpen: true },
      content: ['tc1'],
    },
    { id: 'tc1', type: 'paragraph', data: { text: 'Inside the toggle' }, parent: 'toggle1' },
  ],
});

/**
 * Drive the side-drop of the root toggle onto the RIGHT edge of "Target",
 * producing [Target | toggle] columns. Returns after the drag settles.
 */
const dropToggleBesideTarget = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabContainerHandle(page, 'toggle1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Toggle block — live drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
  });

  test('DROP: side-dropping the toggle wraps both blocks into columns and the toggle (with its child) lands in the 2nd column', async ({ page }) => {
    await createBlok(page, seedTree());
    await dropToggleBesideTarget(page);

    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);

    // A column_list with exactly two columns was created.
    expect(saved.blocks.find((b) => b.type === 'column_list')).toBeDefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // The toggle is now parented to the SECOND column (the dropped side).
    const toggleParent = findBlock(saved, 'toggle1')?.parent;
    expect(toggleParent).toBeDefined();
    expect(columnIds).toContain(toggleParent);

    const targetParent = findBlock(saved, 'target')?.parent;
    expect(columnIds).toContain(targetParent);
    expect(toggleParent).not.toBe(targetParent);
    expect(columnIds.indexOf(toggleParent ?? '')).toBe(1);
    expect(columnIds.indexOf(targetParent ?? '')).toBe(0);

    // The toggle carried its subtree along — child still nested under the toggle.
    expect(findBlock(saved, 'tc1')?.parent).toBe('toggle1');
    expect(childrenOf(saved, 'toggle1')).toEqual(['tc1']);

    // LIVE DOM: the toggle holder and its child both sit in column index 1.
    const placement = await domColumnIndexById(page, ['target', 'toggle1', 'tc1']);
    expect(placement['target']).toBe(0);
    expect(placement['toggle1']).toBe(1);
    expect(placement['tc1']).toBe(1);

    // LIVE DOM: the child is mounted inside the toggle's own children container,
    // not stranded directly under the column. Keyed by id, never textContent.
    const childInsideToggle = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="tc1"]');

      return (
        child instanceof HTMLElement &&
        child.closest('[data-blok-tool="toggle"]') !== null &&
        child.closest('[data-blok-toggle-children]') !== null
      );
    });
    expect(childInsideToggle).toBe(true);
  });

  test('SAVE: the saved model nests column_list -> column -> toggle -> child after the drop', async ({ page }) => {
    await createBlok(page, seedTree());
    await dropToggleBesideTarget(page);

    const saved = await saveBlok(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list?.type).toBe('column_list');
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(list?.content).toEqual(columnIds);
    expect(columnIds).toHaveLength(2);

    // column_list -> 2nd column -> toggle is the sole child of that column.
    const toggleParent = findBlock(saved, 'toggle1')?.parent ?? '';
    expect(findBlock(saved, toggleParent)?.parent).toBe(list?.id);
    expect(childrenOf(saved, toggleParent)).toEqual(['toggle1']);

    // The toggle's primary data fields round-trip through the drop.
    const toggleData = findBlock(saved, 'toggle1')?.data as { text?: string; isOpen?: boolean };
    expect(toggleData.text).toBe('Toggle title');
    expect(toggleData.isOpen).toBe(true);

    // toggle -> child nesting holds in the model.
    expect(findBlock(saved, 'toggle1')?.content).toEqual(['tc1']);
    expect(findBlock(saved, 'tc1')?.parent).toBe('toggle1');
    expect((findBlock(saved, 'tc1')?.data as { text?: string }).text).toBe('Inside the toggle');
  });

  test('RELOAD: after a save -> reload -> save round-trip the toggle stays in its column in model and live DOM', async ({ page }) => {
    await createBlok(page, seedTree());
    await dropToggleBesideTarget(page);

    const before = await saveBlok(page);
    const toggleParent = findBlock(before, 'toggle1')?.parent ?? '';

    const after = await reloadFromSave(page);

    // Model: still nested column_list -> column -> toggle -> child.
    expect(after.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(findBlock(after, 'toggle1')?.parent).toBe(toggleParent);
    expect(childrenOf(after, toggleParent)).toEqual(['toggle1']);
    expect(findBlock(after, 'tc1')?.parent).toBe('toggle1');
    expect(childrenOf(after, 'toggle1')).toEqual(['tc1']);

    // LIVE DOM: the toggle and its child are still in the 2nd column after reload.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    const placement = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(placement['toggle1']).toBe(1);
    expect(placement['tc1']).toBe(1);

    const childInsideToggle = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="tc1"]');

      return (
        child instanceof HTMLElement &&
        child.closest('[data-blok-toggle-children]') !== null &&
        child.closest('[data-blok-column]') !== null
      );
    });
    expect(childInsideToggle).toBe(true);
  });

  test('EDIT: editing the toggle title persists and the toggle stays in its column', async ({ page }) => {
    await createBlok(page, seedTree());
    await dropToggleBesideTarget(page);

    const before = await saveBlok(page);
    const toggleParent = findBlock(before, 'toggle1')?.parent ?? '';

    // The toggle title is a contenteditable ([data-blok-toggle-content]); fill()
    // does not work on contenteditable, so click to focus, select all, type.
    const title = page.locator('[data-blok-toggle-content]').first();
    await title.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('Edited toggle title');

    const saved = await saveBlok(page);

    // The edit persisted.
    expect((findBlock(saved, 'toggle1')?.data as { text?: string }).text).toBe('Edited toggle title');

    // Model: the toggle stayed in the same column and kept its child.
    expect(findBlock(saved, 'toggle1')?.parent).toBe(toggleParent);
    expect(childrenOf(saved, toggleParent)).toEqual(['toggle1']);
    expect(findBlock(saved, 'tc1')?.parent).toBe('toggle1');
    expect((findBlock(saved, 'tc1')?.data as { text?: string }).text).toBe('Inside the toggle');

    // LIVE DOM: still in the 2nd column.
    const placement = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(placement['toggle1']).toBe(1);
    expect(placement['tc1']).toBe(1);
  });

  test('REMOVE: deleting the toggle collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, seedTree());
    await dropToggleBesideTarget(page);

    // Delete the toggle by its flat index. The toggle is a container, so deleting
    // it removes its child subtree too — leaving its column empty, which is then
    // removed; the list drops to one column and unwraps.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('toggle1');
      await window.blokInstance.blocks.delete(index);
    });

    // The unwrap is fire-and-forget async.
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    const saved = await saveBlok(page);

    expect(findBlock(saved, 'toggle1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The pre-existing target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Target');

    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: no columns remain.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
