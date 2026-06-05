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
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * Drag the block whose drag handle is `sourceHandle` onto the left/right edge of
 * `targetBlock` (its vertical mid-band) to trigger a column (side) drop. Mirrors
 * performSideDrop in columns.spec.ts — copied locally so this spec is standalone.
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
};

/**
 * Reveal a container block's OWN drag handle. Hovering a child of the container
 * would surface the child's handle, so we hover the container holder by its
 * data-blok-id (the top-left of its own holder, away from child content) and
 * then read the single visible settings toggler.
 */
const grabContainerHandle = async (page: Page, containerId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${containerId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for container ${containerId}`);
  }

  // Hover the container holder's own top edge (above/clear of nested child
  // content) so the hover controller resolves the container itself, not a child.
  await page.mouse.move(box.x + box.width / 2, box.y + 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model.
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

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Dragging a container block into / between / out of columns', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('side-dropping a root callout (with a child) beside a block wraps both into columns and the callout keeps its child', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Left para' } },
        {
          id: 'callout1',
          type: 'callout',
          data: { emoji: '💡', textColor: null, backgroundColor: null },
          content: ['callout1-child'],
        },
        { id: 'callout1-child', type: 'paragraph', data: { text: 'Inside the callout' }, parent: 'callout1' },
      ],
    } as OutputData);

    // No columns yet.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);

    // Drag the root callout onto the RIGHT edge of "Left para" -> [p1 | callout].
    const handle = await grabContainerHandle(page, 'callout1');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Left para' }).first();
    await performSideDrop(page, handle, target, 'right');

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);

    // A column_list with exactly two columns was created.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // The callout is now a column child (parented to one of the two columns).
    const calloutParent = findBlock(saved, 'callout1')?.parent;
    expect(columnIds).toContain(calloutParent);

    // CRITICAL: the callout carries its subtree along — its child paragraph still
    // belongs to the callout, not stranded at root or orphaned.
    expect(findBlock(saved, 'callout1-child')?.parent).toBe('callout1');
    expect(childrenOf(saved, 'callout1')).toEqual(['callout1-child']);

    // Parent chain column > callout > child holds in the LIVE DOM, same column.
    const placement = await domColumnIndexById(page, ['callout1', 'callout1-child']);
    expect(placement['callout1']).toBeGreaterThanOrEqual(0);
    expect(placement['callout1-child']).toBe(placement['callout1']);

    const childInsideCallout = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="callout1-child"]');

      return child instanceof HTMLElement && child.closest('[data-blok-component="callout"]') !== null;
    });
    expect(childInsideCallout).toBe(true);

    // Round-trips: the same nested chain survives a save -> reload -> save.
    const after = await reloadFromSave(page);
    const calloutParentAfter = findBlock(after, 'callout1')?.parent;
    const columnsAfter = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnsAfter).toContain(calloutParentAfter);
    expect(findBlock(after, 'callout1-child')?.parent).toBe('callout1');
    expect(childrenOf(after, 'callout1')).toEqual(['callout1-child']);
  });

  test('moving a toggle (with a child) from the left column to the right column carries its subtree', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        // The left column also holds a keeper paragraph: moving the toggle OUT of
        // it must not empty it, since an emptied column now deletes itself and
        // would collapse the layout — defeating this test's focus on the
        // column-to-column move landing in the destination column.
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1keeper', 'toggle1'] },
        { id: 'c1keeper', type: 'paragraph', data: { text: 'Left keeper' }, parent: 'c1' },
        {
          id: 'toggle1',
          type: 'toggle',
          data: { text: 'Toggle title', isOpen: true },
          parent: 'c1',
          content: ['tc1'],
        },
        { id: 'tc1', type: 'paragraph', data: { text: 'Inside the toggle' }, parent: 'toggle1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['anchor'] },
        { id: 'anchor', type: 'paragraph', data: { text: 'Right anchor' }, parent: 'c2' },
      ],
    } as OutputData);

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Precondition: the toggle (and its child) live in the FIRST column.
    const before = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(before['toggle1']).toBe(0);
    expect(before['tc1']).toBe(0);

    // Drag the toggle onto the body center of the right column's "Right anchor"
    // paragraph so it stacks INTO the right column (column-to-column move).
    const handle = await grabContainerHandle(page, 'toggle1');
    const sourceBox = await handle.boundingBox();
    const anchorContent = await page
      .getByTestId('block-wrapper')
      .filter({ hasText: 'Right anchor' })
      .last()
      .locator('[data-blok-element-content]')
      .first()
      .boundingBox();

    if (!sourceBox || !anchorContent) {
      throw new Error('missing bounding box for column-to-column move');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      anchorContent.x + anchorContent.width / 2,
      anchorContent.y + anchorContent.height / 2,
      { steps: 18 }
    );
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
      { timeout: 2000 }
    );

    const saved = await saveBlok(page);

    // Still exactly two columns; the layout is intact.
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // The toggle left the left column for the right column (c2), and its child
    // rides along — still parented to the toggle, no orphan, no stranding.
    expect(findBlock(saved, 'toggle1')?.parent).toBe('c2');
    expect(findBlock(saved, 'tc1')?.parent).toBe('toggle1');
    expect(childrenOf(saved, 'toggle1')).toEqual(['tc1']);

    // The left column no longer contains the toggle; the right column does.
    expect(childrenOf(saved, 'c1')).not.toContain('toggle1');
    expect(childrenOf(saved, 'c2')).toContain('toggle1');

    // LIVE DOM: toggle + its child now both sit in the second column (index 1).
    const after = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(after['toggle1']).toBe(1);
    expect(after['tc1']).toBe(1);

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

  test('dragging a table out of a 2-column layout to root preserves all of its cell blocks', async ({ page }) => {
    const cellIds = ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'];

    await createBlok(page, {
      blocks: [
        { id: 'top', type: 'paragraph', data: { text: 'Top root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['table1'] },
        {
          id: 'table1',
          type: 'table',
          parent: 'c1',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [{ blocks: ['tp-r0c0'] }, { blocks: ['tp-r0c1'] }],
              [{ blocks: ['tp-r1c0'] }, { blocks: ['tp-r1c1'] }],
            ],
          },
          content: cellIds,
        },
        { id: 'tp-r0c0', type: 'paragraph', data: { text: 'Cell A1' }, parent: 'table1' },
        { id: 'tp-r0c1', type: 'paragraph', data: { text: 'Cell B1' }, parent: 'table1' },
        { id: 'tp-r1c0', type: 'paragraph', data: { text: 'Cell A2' }, parent: 'table1' },
        { id: 'tp-r1c1', type: 'paragraph', data: { text: 'Cell B2' }, parent: 'table1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2p1'] },
        { id: 'c2p1', type: 'paragraph', data: { text: 'Right keeper' }, parent: 'c2' },
      ],
    } as OutputData);

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Precondition: table + cells are in the first column.
    const before = await domColumnIndexById(page, ['table1', ...cellIds]);
    expect(before['table1']).toBe(0);
    for (const id of cellIds) {
      expect(before[id]).toBe(0);
    }

    // Drag the table OUT of the column to the bottom edge of the root "Top root"
    // paragraph (a root vertical drop) — this empties the left column so the
    // list collapses to one column and must unwrap.
    const handle = await grabContainerHandle(page, 'table1');
    const sourceBox = await handle.boundingBox();
    const targetBox = await page
      .getByTestId('block-wrapper')
      .filter({ hasText: 'Top root' })
      .boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('missing bounding box for drag-out');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 1, { steps: 18 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
      { timeout: 2000 }
    );

    const saved = await saveBlok(page);

    // The table is now at root (no parent), out of every column.
    expect(findBlock(saved, 'table1')?.parent).toBeUndefined();

    // CRITICAL: every cell paragraph still belongs to the table — none stranded,
    // none orphaned, content order preserved.
    expect(childrenOf(saved, 'table1')).toEqual(cellIds);
    for (const id of cellIds) {
      expect(findBlock(saved, id)?.parent).toBe('table1');
    }

    // The table's cell grid still references the same child ids.
    const grid = (findBlock(saved, 'table1')?.data as {
      content?: Array<Array<{ blocks: string[] }>>;
    }).content?.map((row) => row.map((cell) => cell.blocks));
    expect(grid).toEqual([
      [['tp-r0c0'], ['tp-r0c1']],
      [['tp-r1c0'], ['tp-r1c1']],
    ]);

    // LIVE DOM: the table is no longer inside any column, and all of its cell
    // paragraphs are still mounted inside the table.
    const after = await domColumnIndexById(page, ['table1', ...cellIds]);
    expect(after['table1']).toBe(-1);

    const cellsInsideTable = await page.evaluate((ids: string[]) => {
      return ids.every((id) => {
        const cell = document.querySelector(`[data-blok-id="${id}"]`);

        return cell instanceof HTMLElement && cell.closest('[data-blok-tool="table"]') !== null;
      });
    }, cellIds);
    expect(cellsInsideTable).toBe(true);

    // The table content is intact in the DOM.
    for (const text of ['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2']) {
      await expect(page.getByText(text)).toBeVisible();
    }
  });
});
