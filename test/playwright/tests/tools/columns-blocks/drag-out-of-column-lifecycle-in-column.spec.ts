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

/**
 * Reveal a container block's OWN drag handle. Hovering a child of the container
 * would surface the child's handle, so we hover the container holder by its
 * data-blok-id (the top edge of its own holder, above child content) and then
 * read the single visible settings toggler. Copied verbatim from
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
 * Reveal a LEAF block's own drag handle: hover its holder by data-blok-id so the
 * hover controller surfaces the settings toggler, then return that single visible
 * toggler. Keyed by data-blok-id (never textContent) so a container's aggregated
 * text can't mismatch. Copied verbatim from header-drop-lifecycle-in-column.spec.ts.
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
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model. Copied verbatim from
 * container-drag-in-column.spec.ts.
 *
 *   -2  => the holder is not in the DOM at all
 *   -1  => the holder is in the DOM but NOT inside any column (i.e. at root)
 *   >=0 => the column index the holder lives in
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
 * Proves a block holder physically sits in the ROOT working area: it is in the
 * DOM, is NOT inside any [data-blok-column], and its nearest [data-blok-element]
 * ancestor in the redactor zone is a DIRECT child of [data-blok-redactor]. Keyed
 * by data-blok-id, never textContent.
 */
const isHolderAtRedactorRoot = async (page: Page, blockId: string): Promise<boolean> => {
  return await page.evaluate((id: string) => {
    const holder = document.querySelector(`[data-blok-id="${id}"]`);

    if (!(holder instanceof HTMLElement)) {
      return false;
    }

    // Must not be inside any column.
    if (holder.closest('[data-blok-column]') !== null) {
      return false;
    }

    // The holder's own [data-blok-element] wrapper must be a DIRECT child of the
    // redactor zone — i.e. it is a top-level (root) block, not nested anywhere.
    const redactor = document.querySelector('[data-blok-redactor]');

    if (!(redactor instanceof HTMLElement)) {
      return false;
    }

    return Array.from(redactor.children).includes(holder);
  }, blockId);
};

/**
 * Fixture: a 2-column layout. The FIRST column (c1) holds the subject block PLUS
 * a plain "c1keeper" paragraph; the SECOND column (c2) holds its own keeper. The
 * c1 keeper matters: an emptied column now deletes itself (collapsing the layout),
 * so the keeper ensures dragging the subject OUT leaves c1 alive — keeping these
 * tests focused on the subject's journey to root rather than the column's demise
 * (the dedicated delete-on-empty case is covered separately below). A leading
 * root paragraph ("Top root") is the drop target whose bottom reorder edge ejects
 * the subject back out to root.
 *
 * The leaf variant puts a plain Header in c1; its data shape is `{ text, level }`
 * (matches header-in-column.spec.ts) — a plain header is a leaf, no content/children.
 */
const headerInColumnFixture = (): OutputData => ({
  blocks: [
    { id: 'top', type: 'paragraph', data: { text: 'Top root' } },
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['header1', 'c1keeper'] },
    { id: 'header1', type: 'header', data: { text: 'Features', level: 3 }, parent: 'c1' },
    { id: 'c1keeper', type: 'paragraph', data: { text: 'Left keeper' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['keeper'] },
    { id: 'keeper', type: 'paragraph', data: { text: 'Right keeper' }, parent: 'c2' },
  ],
});

/**
 * The container variant: a Toggle (toggle1) WITH a child paragraph (tc1) in the
 * first column, alongside a plain "c1keeper" paragraph (see headerInColumnFixture
 * for why the keeper is needed). The toggle data shape is `{ text, isOpen }` with
 * `content: ['tc1']` and the child carries `parent: 'toggle1'` (matches
 * toggle-in-column.spec.ts).
 */
const toggleInColumnFixture = (): OutputData => ({
  blocks: [
    { id: 'top', type: 'paragraph', data: { text: 'Top root' } },
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['toggle1', 'c1keeper'] },
    {
      id: 'toggle1',
      type: 'toggle',
      data: { text: 'Toggle title', isOpen: true },
      parent: 'c1',
      content: ['tc1'],
    },
    { id: 'tc1', type: 'paragraph', data: { text: 'Inside the toggle' }, parent: 'toggle1' },
    { id: 'c1keeper', type: 'paragraph', data: { text: 'Left keeper' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['keeper'] },
    { id: 'keeper', type: 'paragraph', data: { text: 'Right keeper' }, parent: 'c2' },
  ],
});

/**
 * Drive the real drag-OUT: pick up `sourceHandle` and drop it onto the bottom
 * reorder edge of the root "Top root" paragraph. That lands the block at root,
 * between "Top root" and the column_list, leaving the column it left.
 */
const dragOutToRoot = async (page: Page, sourceHandle: Locator): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await page
    .getByTestId('block-wrapper')
    .filter({ hasText: 'Top root' })
    .boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for drag-out-to-root');
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
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Dragging a block OUT of a column back to root', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('LEAF DRAG-OUT: a header dragged out of its column lands at root in model and live DOM', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Precondition: the header sits in the FIRST column.
    const before = await domColumnIndexById(page, ['header1']);
    expect(before['header1']).toBe(0);

    const handle = await grabLeafHandle(page, 'header1');
    await dragOutToRoot(page, handle);

    const saved = await saveBlok(page);

    // MODEL: the header is now at root — no parent, out of every column.
    expect(findBlock(saved, 'header1')?.parent).toBeUndefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    columnIds.forEach((columnId) => {
      expect(childrenOf(saved, columnId ?? '')).not.toContain('header1');
    });

    // A plain header is a leaf — it carries no content/children out of the column.
    expect(findBlock(saved, 'header1')?.content).toBeUndefined();
    expect(childrenOf(saved, 'header1')).toEqual([]);

    // The keeper paragraph stays put in its column.
    expect(columnIds).toContain(findBlock(saved, 'keeper')?.parent ?? '');

    // LIVE DOM: the header holder has LEFT every column and now sits as a direct
    // child of the redactor root working area.
    const after = await domColumnIndexById(page, ['header1']);
    expect(after['header1']).toBe(-1);
    expect(await isHolderAtRedactorRoot(page, 'header1')).toBe(true);

    // The header still renders as a real heading.
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible();
  });

  // Moving the LAST block out of a column empties it. A column is pure layout and
  // never legitimately empty, so an emptied column DELETES itself rather than
  // lingering as a dead, uninteractable box. Here that leaves the column_list with
  // a single survivor, which collapses the list entirely: every block ends up at
  // root and no column / column_list remains.
  test('LEAF DRAG-OUT deletes the emptied column, collapsing a 2-column list to plain blocks', async ({ page }) => {
    // Dedicated sole-child fixture: c1 holds ONLY the header, so dragging it out
    // genuinely empties c1 (unlike the shared fixture, which keeps c1 alive).
    await createBlok(page, {
      blocks: [
        { id: 'top', type: 'paragraph', data: { text: 'Top root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['header1'] },
        { id: 'header1', type: 'header', data: { text: 'Features', level: 3 }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['keeper'] },
        { id: 'keeper', type: 'paragraph', data: { text: 'Right keeper' }, parent: 'c2' },
      ],
    } as OutputData);

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Drag the column's SOLE child out to root, emptying column c1.
    const handle = await grabLeafHandle(page, 'header1');
    await dragOutToRoot(page, handle);

    // The emptied column deleted itself; the lone survivor collapsed the list, so
    // no column / column_list remains in the live DOM.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
    await expect(page.locator('[data-blok-columns]')).toHaveCount(0);

    const saved = await saveBlok(page);

    // The header left for root, and the keeper was promoted to root by the
    // collapse — both are now plain top-level blocks with no column ancestry.
    expect(findBlock(saved, 'header1')?.parent).toBeUndefined();
    expect(findBlock(saved, 'keeper')?.parent ?? null).toBeNull();
    expect(saved.blocks.filter((b) => b.type === 'column' || b.type === 'column_list')).toHaveLength(0);

    // No orphans dangle from the now-deleted column / column_list.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE: both blocks sit at the redactor root and the keeper is interactive.
    expect(await isHolderAtRedactorRoot(page, 'header1')).toBe(true);
    expect(await isHolderAtRedactorRoot(page, 'keeper')).toBe(true);
  });

  test('LEAF RELOAD: the ejected header round-trips at root through save -> reload -> save', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    const handle = await grabLeafHandle(page, 'header1');
    await dragOutToRoot(page, handle);

    // Confirm it actually left the column before round-tripping.
    expect((await domColumnIndexById(page, ['header1']))['header1']).toBe(-1);

    const after = await reloadFromSave(page);

    // MODEL: still at root after the rebuild, still a leaf with intact data.
    expect(findBlock(after, 'header1')?.parent).toBeUndefined();
    expect(childrenOf(after, 'header1')).toEqual([]);
    const headerData = findBlock(after, 'header1')?.data as { text?: string; level?: number };
    expect(headerData.text).toBe('Features');
    expect(headerData.level).toBe(3);

    // LIVE DOM: after the rebuild the header is still out of every column, at the
    // redactor root.
    expect((await domColumnIndexById(page, ['header1']))['header1']).toBe(-1);
    expect(await isHolderAtRedactorRoot(page, 'header1')).toBe(true);
  });

  test('LEAF EDIT+REMOVE: the ejected header edits at root, then deletes cleanly', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    const handle = await grabLeafHandle(page, 'header1');
    await dragOutToRoot(page, handle);

    // EDIT: retype the header now that it is at root; the edit must persist and not
    // pull it back into a column.
    await editParagraphLikeText(page, 'Features', 'Roadmap');
    await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible();

    const edited = await saveBlok(page);
    expect((findBlock(edited, 'header1')?.data as { text?: string }).text).toBe('Roadmap');
    expect(findBlock(edited, 'header1')?.parent).toBeUndefined();
    expect(await isHolderAtRedactorRoot(page, 'header1')).toBe(true);

    // REMOVE: delete the header by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('header1');

      await window.blokInstance.blocks.delete(index);
    });

    await page.waitForFunction(
      () =>
        window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('header1') === undefined
    );

    const saved = await saveBlok(page);

    // The header is gone, the column_list survives with both columns and the keeper.
    expect(findBlock(saved, 'header1')).toBeUndefined();
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect((findBlock(saved, 'keeper')?.data as { text?: string }).text).toBe('Right keeper');

    // No orphans remain.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: the header holder is gone from the DOM entirely.
    expect((await domColumnIndexById(page, ['header1']))['header1']).toBe(-2);
  });

  test('CONTAINER DRAG-OUT: a toggle dragged out of its column lands at root and keeps its nested child', async ({ page }) => {
    await createBlok(page, toggleInColumnFixture());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Precondition: the toggle AND its child both sit in the first column, with the
    // child nested inside the toggle's own children container.
    const before = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(before['toggle1']).toBe(0);
    expect(before['tc1']).toBe(0);

    const handle = await grabContainerHandle(page, 'toggle1');
    await dragOutToRoot(page, handle);

    const saved = await saveBlok(page);

    // MODEL: the toggle is now at root (no parent), out of every column.
    expect(findBlock(saved, 'toggle1')?.parent).toBeUndefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    columnIds.forEach((columnId) => {
      expect(childrenOf(saved, columnId ?? '')).not.toContain('toggle1');
    });

    // CRITICAL: the toggle carried its subtree OUT with it — the child is still
    // parented to the toggle, listed under its content, not stranded or orphaned.
    expect(findBlock(saved, 'tc1')?.parent).toBe('toggle1');
    expect(findBlock(saved, 'toggle1')?.content).toEqual(['tc1']);
    expect(childrenOf(saved, 'toggle1')).toEqual(['tc1']);

    // The keeper paragraph stays put in its column.
    expect(columnIds).toContain(findBlock(saved, 'keeper')?.parent ?? '');

    // LIVE DOM: the toggle holder has LEFT every column and sits at the redactor
    // root; its child rode along and is still inside the column-free toggle.
    const after = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(after['toggle1']).toBe(-1);
    expect(after['tc1']).toBe(-1);
    expect(await isHolderAtRedactorRoot(page, 'toggle1')).toBe(true);

    const childStillNested = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="tc1"]');

      if (!(child instanceof HTMLElement)) {
        return false;
      }

      // The child is inside the toggle's own children container, and that container
      // is NOT inside any column anymore.
      const container = child.closest('[data-blok-toggle-children]');

      return container !== null && container.closest('[data-blok-column]') === null;
    });
    expect(childStillNested).toBe(true);

    // The toggle's title and child text are both visible at root.
    await expect(page.getByText('Toggle title')).toBeVisible();
    await expect(page.getByText('Inside the toggle')).toBeVisible();
  });

  test('CONTAINER RELOAD: the ejected toggle round-trips at root with its child still nested', async ({ page }) => {
    await createBlok(page, toggleInColumnFixture());

    const handle = await grabContainerHandle(page, 'toggle1');
    await dragOutToRoot(page, handle);

    // Confirm it actually left the column before round-tripping.
    expect((await domColumnIndexById(page, ['toggle1']))['toggle1']).toBe(-1);

    const after = await reloadFromSave(page);

    // MODEL: the toggle is still at root and still owns its child after the rebuild.
    expect(findBlock(after, 'toggle1')?.parent).toBeUndefined();
    expect(findBlock(after, 'tc1')?.parent).toBe('toggle1');
    expect(findBlock(after, 'toggle1')?.content).toEqual(['tc1']);
    expect(childrenOf(after, 'toggle1')).toEqual(['tc1']);

    // LIVE DOM: after the rebuild the toggle is out of every column at the redactor
    // root, and its child is still nested inside it.
    const placement = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(placement['toggle1']).toBe(-1);
    expect(placement['tc1']).toBe(-1);
    expect(await isHolderAtRedactorRoot(page, 'toggle1')).toBe(true);

    const childStillNested = await page.evaluate(() => {
      const child = document.querySelector('[data-blok-id="tc1"]');

      return (
        child instanceof HTMLElement &&
        child.closest('[data-blok-toggle-children]') !== null &&
        child.closest('[data-blok-column]') === null
      );
    });
    expect(childStillNested).toBe(true);
  });

  // Regression: deleting a container in-place (toggle/callout/toggleable-header) used to leak its
  // promoted child's DOM holder — operations.ts promoteChildrenToRoot() set parentId = null in the
  // model only, so removeBlock -> blocks.ts remove() destroyed the child holder still nested inside
  // the container (model said "at root", live holder was gone). Fixed by routing promotion through
  // hierarchy.setBlockParent(child, null), which relocates the holder out before removal.
  test('CONTAINER EDIT+REMOVE: the ejected toggle edits at root, then deletes promoting its child to root', async ({ page }) => {
    await createBlok(page, toggleInColumnFixture());

    const handle = await grabContainerHandle(page, 'toggle1');
    await dragOutToRoot(page, handle);

    // EDIT: retype the toggle title at root; it must persist and stay out of columns.
    const title = page.locator('[data-blok-toggle-content]').first();
    await title.click();

    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Edited at root');

    const edited = await saveBlok(page);
    expect((findBlock(edited, 'toggle1')?.data as { text?: string }).text).toBe('Edited at root');
    expect(findBlock(edited, 'toggle1')?.parent).toBeUndefined();
    expect(findBlock(edited, 'tc1')?.parent).toBe('toggle1');
    expect(await isHolderAtRedactorRoot(page, 'toggle1')).toBe(true);

    // REMOVE: delete the toggle by its flat index. Deleting a container promotes its
    // child to root (not cascade-delete), so tc1 survives at the top level.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('toggle1');

      await window.blokInstance.blocks.delete(index);
    });

    await page.waitForFunction(
      () =>
        window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('toggle1') === undefined
    );

    const saved = await saveBlok(page);

    // The toggle is gone; its child is promoted to root with no parent (no orphan).
    expect(findBlock(saved, 'toggle1')).toBeUndefined();
    const promoted = findBlock(saved, 'tc1');
    expect(promoted).toBeDefined();
    expect(promoted?.parent).toBeUndefined();

    // The column_list survives with both columns and the keeper.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect((findBlock(saved, 'keeper')?.data as { text?: string }).text).toBe('Right keeper');

    // No orphaned children remain parented to the removed toggle.
    expect(childrenOf(saved, 'toggle1')).toEqual([]);
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: the toggle holder is gone; the promoted child is in the DOM and not
    // inside any column.
    const placement = await domColumnIndexById(page, ['toggle1', 'tc1']);
    expect(placement['toggle1']).toBe(-2);
    expect(placement['tc1']).toBe(-1);
  });
});
