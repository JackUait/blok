import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  childrenOf,
  createBlok,
  ensureBlokBundleBuilt,
  findBlock,
  reloadFromSave,
  saveBlok,
  TEST_PAGE_URL,
} from './_helpers';

/**
 * Slash / toolbox insertion INSIDE a column. The existing exhaustive suite only
 * loads pre-built fixtures; it never drives the live slash menu while the caret
 * sits in a column child. These tests open the toolbox from an empty paragraph
 * that is a child of a column and assert the inserted block is parented to that
 * SAME column (not stranded at root), that container blocks seed their own
 * children one level deeper, that a non-text Divider keeps the flow sane, and
 * that a Columns (column_list) preset is rejected — never producing the nested
 * column_list the model cannot safely remove.
 *
 * A failing assertion here is a real bug to surface (TDD). Do not weaken it.
 */

const TOOLBOX_POPOVER = '[data-blok-testid="toolbox-popover"]';
const TOOLBOX_CONTAINER = `${TOOLBOX_POPOVER} [data-blok-testid="popover-container"]`;
const toolboxItem = (name: string): string =>
  `${TOOLBOX_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`;

/**
 * Builds a 2-column layout: the LEFT column holds a single empty paragraph
 * (caret target for slash insertion); the RIGHT column holds an anchor
 * paragraph so we can prove the right column stays untouched.
 */
const buildTwoColumns = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['empty'] },
    { id: 'empty', type: 'paragraph', data: { text: '' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['right'] },
    { id: 'right', type: 'paragraph', data: { text: 'Right side' }, parent: 'c2' },
  ],
});

/**
 * Focuses the empty paragraph inside the left column (block id "empty") and
 * opens the toolbox by typing "/". Returns once the toolbox popover is visible.
 */
const openToolboxInLeftColumn = async (page: Page): Promise<void> => {
  const emptyContent = page
    .locator('[data-blok-element][data-blok-id="empty"]')
    .locator('[data-blok-element-content]')
    .first();

  await emptyContent.click();
  await page.keyboard.type('/');

  await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();
};

/**
 * Resolves, for the block id, which column (by document index across ALL
 * [data-blok-column] holders) its holder is mounted inside in the LIVE DOM.
 * Returns -1 if the holder is not inside any column.
 */
const liveColumnIndexOf = async (page: Page, blockId: string): Promise<number> => {
  return await page.evaluate(({ id }) => {
    const allColumns = Array.from(document.querySelectorAll('[data-blok-column]'));
    const holder = document.querySelector(`[data-blok-element][data-blok-id="${id}"]`);

    if (!(holder instanceof HTMLElement)) {
      return -1;
    }

    const ownColumn = holder.closest('[data-blok-column]');

    if (!(ownColumn instanceof HTMLElement)) {
      return -1;
    }

    return allColumns.indexOf(ownColumn);
  }, { id: blockId });
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Toolbox insertion inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('inserting a Header from the slash menu lands it in the SAME column, right column untouched', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    await openToolboxInLeftColumn(page);

    // Choose "Heading 2" from the toolbox. Header toolbox entries are named
    // header-1..header-6; H2 is a representative text block.
    await page.locator(toolboxItem('header-2')).click();

    // A header now exists, parented to the left column (c1) — NOT at root.
    const saved = await saveBlok(page);
    const header = saved.blocks.find((block) => block.type === 'header');

    expect(header).toBeDefined();
    expect(header?.parent).toBe('c1');

    // The left column owns the header (the empty paragraph was replaced/converted
    // in place, or the header was added beside it — either way it is in c1).
    expect(childrenOf(saved, 'c1')).toContain(header?.id);

    // The right column is completely untouched.
    expect(childrenOf(saved, 'c2')).toEqual(['right']);
    expect(findBlock(saved, 'right')?.parent).toBe('c2');

    // LIVE DOM: the header holder is mounted inside the first column (index 0),
    // the right-side paragraph inside the second column (index 1).
    expect(header?.id).toBeDefined();
    expect(await liveColumnIndexOf(page, header?.id ?? '')).toBe(0);
    expect(await liveColumnIndexOf(page, 'right')).toBe(1);

    // Still exactly two columns — no stray column spawned.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  });

  test('inserting a Callout container from the slash menu nests it in the column with its own seeded child', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    await openToolboxInLeftColumn(page);

    await page.locator(toolboxItem('callout')).click();

    const saved = await saveBlok(page);
    const callout = saved.blocks.find((block) => block.type === 'callout');

    expect(callout).toBeDefined();
    // The container is parented to the left column.
    expect(callout?.parent).toBe('c1');
    expect(callout?.id).toBeDefined();

    // The callout seeds at least one child block, and that child's parent chain
    // is column > callout > child — the child must NOT land at root.
    const seededChildren = childrenOf(saved, callout?.id ?? '');

    expect(seededChildren.length).toBeGreaterThan(0);
    for (const childId of seededChildren) {
      expect(findBlock(saved, childId)?.parent).toBe(callout?.id);
    }

    // No seeded child is orphaned at root (parent === undefined) while logically
    // belonging to the callout.
    const orphanedSeeds = saved.blocks.filter(
      (block) => block.parent === undefined && block.id !== 'cl1' && block.type !== 'column_list'
    );

    // Only the column_list may be parent-less at root; nothing else should be.
    expect(orphanedSeeds.map((block) => block.id)).toEqual([]);

    // LIVE DOM: the callout holder is inside the first column.
    expect(await liveColumnIndexOf(page, callout?.id ?? '')).toBe(0);

    // Round-trips: the column > callout > child chain survives save/reload.
    const after = await reloadFromSave(page);
    const reloadedCallout = after.blocks.find((block) => block.type === 'callout');

    expect(reloadedCallout?.parent).toBe('c1');
    expect(childrenOf(after, reloadedCallout?.id ?? '').length).toBeGreaterThan(0);
  });

  test('the Columns (column_list) preset is rejected inside a column — no nested column_list is created', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    await openToolboxInLeftColumn(page);

    // isInsideColumn() forbids a column_list inside a column. The toolbox must
    // either hide/disable the Columns entry or refuse the insert. Either way the
    // user must not be able to create a nested column_list from live UI.
    // The ColumnList tool registers several presets (column_list, column_list-2
    // … column_list-5); ALL of them must be unreachable inside a column, so
    // match every entry whose name starts with "column_list" — not just the
    // bare "column_list", which alone would let the count presets slip through.
    const columnsPresets = `${TOOLBOX_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name^="column_list"]`;
    const allColumnsPresets = page.locator(columnsPresets);
    const visibleColumnsPresets = page.locator(`${columnsPresets}:not([data-blok-hidden="true"])`);

    // The presets are registered in the menu...
    expect(await allColumnsPresets.count()).toBeGreaterThan(0);
    // ...but every one of them is hidden while the caret is inside a column.
    await expect(visibleColumnsPresets).toHaveCount(0);

    // Even if one tried to click it, no second column_list may appear: exactly
    // one column_list, exactly two columns, no column_list nested in a column.
    const saved = await saveBlok(page);

    expect(saved.blocks.filter((block) => block.type === 'column_list')).toHaveLength(1);
    expect(saved.blocks.filter((block) => block.type === 'column')).toHaveLength(2);

    const nestedColumnList = saved.blocks.find(
      (block) => block.type === 'column_list' && block.parent !== undefined
    );

    expect(nestedColumnList).toBeUndefined();
  });

  test('inserting a Divider from the slash menu places it in the column and keeps the flow sane', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    await openToolboxInLeftColumn(page);

    await page.locator(toolboxItem('divider')).click();

    const saved = await saveBlok(page);
    const divider = saved.blocks.find((block) => block.type === 'divider');

    expect(divider).toBeDefined();
    // The divider is a child of the left column, not stranded at root.
    expect(divider?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toContain(divider?.id);

    // The right column is untouched.
    expect(childrenOf(saved, 'c2')).toEqual(['right']);

    // Caret/flow stays inside the column: every text block created alongside the
    // divider (the leading or following editable paragraph) must also be a child
    // of the left column — none may be flung to root.
    const leftChildren = childrenOf(saved, 'c1');
    const strayTextAtRoot = saved.blocks.filter(
      (block) =>
        block.type === 'paragraph' &&
        block.parent === undefined
    );

    expect(strayTextAtRoot.map((block) => block.id)).toEqual([]);
    // The divider sits among the left column's children.
    expect(leftChildren).toContain(divider?.id);

    // LIVE DOM: the divider holder is mounted inside the first column.
    expect(divider?.id).toBeDefined();
    expect(await liveColumnIndexOf(page, divider?.id ?? '')).toBe(0);

    // Still exactly two columns.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  });
});
