import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import type { OutputData, OutputBlockData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * Code block data shape — copied verbatim from code-in-column.spec.ts. The Code
 * block is a leaf (no child blocks): `code`/`language`/`lineNumbers` live in its
 * own `data`. `code` MUST be non-empty or validate() drops it on save();
 * `javascript` keeps the editable code body visible.
 */
const CODE_SNIPPET = "const greet = (name) => `hi ${name}`;\nconsole.log(greet('blok'));";

interface CodeData {
  code?: string;
  language?: string;
  lineNumbers?: boolean;
}

const codeData = (block: OutputBlockData | undefined): CodeData => (block?.data ?? {}) as CodeData;

const list = (saved: OutputData): OutputBlockData | undefined =>
  saved.blocks.find((b) => b.type === 'column_list');

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
 * [data-blok-column], and if so, which column index (document order). Copied
 * verbatim from container-drag-in-column.spec.ts. Proves the LIVE DOM placement,
 * not merely the saved model. -1 root, -2 gone.
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
 * The leaf Code block surfaces its drag handle when you hover its wrapper. Hover
 * the holder and return the single visible settings toggler.
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

/**
 * Two roots: a plain target paragraph and the code block. After a RIGHT side-drop
 * of the code block onto the target, both become columns: [target | code].
 */
const buildTwoRoots = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    {
      id: 'code1',
      type: 'code',
      data: { code: CODE_SNIPPET, language: 'javascript', lineNumbers: true },
    },
  ],
});

/**
 * DROP the code block onto the RIGHT edge of the "Target" paragraph and wait for
 * the 2-column layout to settle. Returns once dragging has ended.
 */
const dropCodeBesideTarget = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabLeafHandle(page, 'code1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Code block drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping a root code block beside a paragraph wraps both into columns with code in the 2nd', async ({ page }) => {
    await createBlok(page, buildTwoRoots());

    await dropCodeBesideTarget(page);

    const saved = await saveBlok(page);

    // A column_list with exactly two columns now exists.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // MODEL: the code block is parented to the SECOND column (the dropped side).
    const codeParent = findBlock(saved, 'code1')?.parent;
    expect(codeParent).toBeDefined();
    expect(columnIds).toContain(codeParent);
    expect(codeParent).toBe(columnIds[1]);
    expect(childrenOf(saved, columnIds[1] ?? '')).toContain('code1');

    // The target paragraph rode into the FIRST column.
    expect(findBlock(saved, 'target')?.parent).toBe(columnIds[0]);

    // LIVE DOM: the code holder is actually mounted inside the 2nd column, not
    // stranded in the row or in the wrong column.
    const placement = await domColumnIndexById(page, ['target', 'code1']);
    expect(placement['target']).toBe(0);
    expect(placement['code1']).toBe(1);

    // The editable code body still shows the snippet and lives inside that column.
    const codeInsideSecondColumn = await page.evaluate(() => {
      const codeEl = document.querySelector('[data-blok-id="code1"]');
      const columnHolders = Array.from(
        document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
      );
      const ownColumn = codeEl?.closest('[data-blok-column]')?.closest('[data-blok-element]');

      if (!(ownColumn instanceof HTMLElement)) {
        return -1;
      }

      return columnHolders.indexOf(ownColumn);
    });
    expect(codeInsideSecondColumn).toBe(1);
    await expect(page.getByTestId('code-content')).toContainText("greet('blok')");
  });

  test('SAVE: the saved model nests column_list -> column -> code correctly', async ({ page }) => {
    await createBlok(page, buildTwoRoots());

    await dropCodeBesideTarget(page);

    const saved = await saveBlok(page);

    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // column_list -> 2nd column -> code chain in the model.
    const codeBlock = findBlock(saved, 'code1');
    const codeColumn = codeBlock?.parent;

    expect(codeColumn).toBe(columnIds[1]);
    expect(findBlock(saved, codeColumn ?? '')?.parent).toBe(list(saved)?.id);
    expect(childrenOf(saved, codeColumn ?? '')).toEqual(['code1']);

    // The code data round-trips through the drop.
    const data = codeData(codeBlock);
    expect(data.code).toBe(CODE_SNIPPET);
    expect(data.language).toBe('javascript');
    expect(data.lineNumbers).toBe(true);

    // No orphaned children after the drop.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !ids.has(b.parent));
    expect(orphans).toHaveLength(0);
  });

  test('RELOAD: the code block stays inside its column after a save -> reload round-trip', async ({ page }) => {
    await createBlok(page, buildTwoRoots());

    await dropCodeBesideTarget(page);

    const before = await saveBlok(page);
    const beforeColumn = findBlock(before, 'code1')?.parent;

    const after = await reloadFromSave(page);

    // MODEL: still nested column_list -> column -> code after the round-trip.
    const afterColumn = findBlock(after, 'code1')?.parent;
    const columnsAfter = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);

    expect(columnsAfter).toHaveLength(2);
    expect(columnsAfter).toContain(afterColumn);
    // It is still the SECOND column (dropped side), preserving order.
    expect(afterColumn).toBe(columnsAfter[1]);
    expect(childrenOf(after, afterColumn ?? '')).toEqual(['code1']);
    expect(codeData(findBlock(after, 'code1')).code).toBe(CODE_SNIPPET);

    // The column membership is consistent before/after (same ordinal position).
    expect(beforeColumn).toBeDefined();

    // LIVE DOM after reload: the code holder is mounted in the 2nd column, not the
    // columns row or root.
    const placement = await domColumnIndexById(page, ['target', 'code1']);
    expect(placement['target']).toBe(0);
    expect(placement['code1']).toBe(1);
  });

  test('EDIT: editing the code body persists and the block stays in its column', async ({ page }) => {
    await createBlok(page, buildTwoRoots());

    await dropCodeBesideTarget(page);

    const dropped = await saveBlok(page);
    const codeColumn = findBlock(dropped, 'code1')?.parent;
    expect(codeColumn).toBeDefined();

    // The Code block uses a single contenteditable surface at [data-blok-testid="code-content"].
    const codeContent = page.getByTestId('code-content');
    await expect(codeContent).toBeVisible();

    await codeContent.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('const edited = 42;');

    await expect(codeContent).toContainText('const edited = 42;');

    const saved = await saveBlok(page);
    const codeBlock = findBlock(saved, 'code1');

    // The edited value round-trips through data.code.
    expect(codeData(codeBlock).code).toContain('const edited = 42;');
    expect(codeData(codeBlock).code).not.toContain("greet('blok')");

    // MODEL: still parented to the same column.
    expect(codeBlock?.parent).toBe(codeColumn);
    expect(childrenOf(saved, codeColumn ?? '')).toContain('code1');

    // LIVE DOM: still mounted inside the 2nd column after the edit.
    const placement = await domColumnIndexById(page, ['code1']);
    expect(placement['code1']).toBe(1);
  });

  test('REMOVE: deleting the sole code child collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, buildTwoRoots());

    await dropCodeBesideTarget(page);

    // Delete the code block by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('code1');

      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the code block (the sole child of its column) empties that column,
    // which is removed; the list drops to one column and unwraps. The unwrap is
    // fire-and-forget async — poll until the scaffold dissolves.
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    const saved = await saveBlok(page);

    // The code block is gone.
    expect(findBlock(saved, 'code1')).toBeUndefined();

    // The columns scaffold dissolves: no column_list, no column survives.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The sibling target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();

    // No orphaned children.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !ids.has(b.parent));
    expect(orphans).toHaveLength(0);

    // LIVE DOM: no columns remain.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
