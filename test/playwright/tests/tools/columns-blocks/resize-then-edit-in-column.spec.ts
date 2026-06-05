import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  childrenOf,
  createBlok,
  editParagraphLikeText,
  ensureBlokBundleBuilt,
  findBlock,
  saveBlok,
  TEST_PAGE_URL,
} from './_helpers';

/**
 * Resize a column separator, THEN exercise live block-internal interactions
 * (editing text, inserting a new block via the slash menu) inside the resized
 * column, and finally save/reload — asserting the custom widthRatio AND the
 * content edit both survive together.
 *
 * The existing exhaustive suite loads pre-built fixtures only; it never drives a
 * LIVE separator drag followed by an edit/insert. The risk: Column.save reads
 * flex-grow back as widthRatio, and a re-render triggered by the edit/insert can
 * silently reset flex-grow to even (resetColumnsToEvenWidth) — dropping the
 * resize. resetColumnsToEvenWidth is meant to fire only on column ADD, so an
 * insert (not a column add) must NOT re-even the widths.
 *
 * These are TDD failure-hunting tests. A failing assertion is a real columns bug
 * to surface. Do NOT weaken or skip it.
 */

const TOOLBOX_POPOVER = '[data-blok-testid="toolbox-popover"]';
const TOOLBOX_CONTAINER = `${TOOLBOX_POPOVER} [data-blok-testid="popover-container"]`;
const toolboxItem = (name: string): string =>
  `${TOOLBOX_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`;

/**
 * A 2-column layout. Left column holds a paragraph we will edit/insert into,
 * right column holds an anchor paragraph that must stay untouched.
 */
const buildTwoColumns = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
    { id: 'p1', type: 'paragraph', data: { text: 'Left content' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right content' }, parent: 'c2' },
  ],
});

const widthRatioOf = (saved: OutputData, columnId: string): number | undefined => {
  const column = findBlock(saved, columnId);

  return (column?.data as { widthRatio?: number } | undefined)?.widthRatio;
};

/**
 * Drag the first resize separator horizontally by `deltaX` px and wait for the
 * pointer interaction to settle. Returns the live column widths after the drag.
 */
const dragFirstResizer = async (page: Page, deltaX: number): Promise<number[]> => {
  const columns = page.locator('[data-blok-column]');
  const resizer = page.getByTestId('column-resizer').first();
  const box = await resizer.boundingBox();

  if (!box) {
    throw new Error('resizer not found');
  }

  const centerY = box.y + box.height / 2;
  const startX = box.x + box.width / 2;

  await page.mouse.move(startX, centerY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, centerY, { steps: 10 });
  await page.mouse.up();

  return columns.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
};

const liveColumnWidths = async (page: Page): Promise<number[]> => {
  return page.locator('[data-blok-column]').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().width)
  );
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Resize separators then edit/insert inside the resized column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('resize a separator, then edit a block in the resized column — widthRatio AND the edit both persist', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    // Make the left column wider than the right.
    const widthsAfterResize = await dragFirstResizer(page, 140);

    expect(widthsAfterResize[0]).toBeGreaterThan(widthsAfterResize[1] + 80);

    // The resize wrote a custom ratio onto the LEFT column (the one that grew).
    const savedAfterResize = await saveBlok(page);
    const leftRatioAfterResize = widthRatioOf(savedAfterResize, 'c1');

    expect(leftRatioAfterResize).toBeGreaterThan(1);

    // Now edit the paragraph that lives inside the (narrowed/widened) layout.
    await editParagraphLikeText(page, 'Left content', 'Edited left content');

    // After the edit the layout must NOT have snapped back to even — the left
    // column is still meaningfully wider than the right.
    const widthsAfterEdit = await liveColumnWidths(page);

    expect(widthsAfterEdit[0]).toBeGreaterThan(widthsAfterEdit[1] + 80);

    // Save: both the edited text AND the custom widthRatio are present together.
    const saved = await saveBlok(page);
    const editedParagraph = saved.blocks.find(
      (block) => (block.data as { text?: string }).text === 'Edited left content'
    );

    expect(editedParagraph).toBeDefined();
    expect(editedParagraph?.parent).toBe('c1');

    const leftRatio = widthRatioOf(saved, 'c1');

    expect(leftRatio).toBeGreaterThan(1);
    // The edit must not have rounded/drifted the ratio away from the resized one.
    expect(Math.abs((leftRatio ?? 0) - (leftRatioAfterResize ?? 0))).toBeLessThan(0.05);

    // Reload preserves both the edit and the uneven widths.
    await createBlok(page, saved);
    await expect(page.getByText('Edited left content')).toBeVisible();

    const widthsReloaded = await liveColumnWidths(page);

    expect(widthsReloaded[0]).toBeGreaterThan(widthsReloaded[1] + 80);
  });

  test('resize, then insert a new block into the resized column — the insert does NOT re-even the widths', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    const widthsAfterResize = await dragFirstResizer(page, 140);

    expect(widthsAfterResize[0]).toBeGreaterThan(widthsAfterResize[1] + 80);

    const savedAfterResize = await saveBlok(page);
    const leftRatioAfterResize = widthRatioOf(savedAfterResize, 'c1');

    expect(leftRatioAfterResize).toBeGreaterThan(1);

    // Open the slash menu from the left column's paragraph and insert a Header —
    // a plain block insert, NOT a column add. resetColumnsToEvenWidth must not fire.
    const leftContent = page
      .locator('[data-blok-element][data-blok-id="p1"]')
      .locator('[data-blok-element-content]')
      .first();

    await leftContent.click();
    await page.keyboard.press('End');
    // The slash menu only opens in an EMPTY block, so add a fresh empty line
    // first (Enter), then open the toolbox on it.
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();
    await page.locator(toolboxItem('header-2')).click();

    // The new header landed inside the left column.
    const saved = await saveBlok(page);
    const header = saved.blocks.find((block) => block.type === 'header');

    expect(header).toBeDefined();
    expect(header?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toContain(header?.id);

    // The insert must NOT have reset the columns to even — the custom ratio
    // survives on the left column.
    const leftRatio = widthRatioOf(saved, 'c1');

    expect(leftRatio).toBeGreaterThan(1);
    expect(Math.abs((leftRatio ?? 0) - (leftRatioAfterResize ?? 0))).toBeLessThan(0.05);

    // Live DOM: still uneven after the insert (no even re-split).
    const widthsAfterInsert = await liveColumnWidths(page);

    expect(widthsAfterInsert[0]).toBeGreaterThan(widthsAfterInsert[1] + 80);

    // Still exactly two columns — the insert spawned no stray column.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  });

  test('resize, save, reload, edit, save again — the widthRatio survives both round-trips without drift', async ({ page }) => {
    await createBlok(page, buildTwoColumns());

    const widthsAfterResize = await dragFirstResizer(page, 140);

    expect(widthsAfterResize[0]).toBeGreaterThan(widthsAfterResize[1] + 80);

    const firstSave = await saveBlok(page);
    const ratioFirstSave = widthRatioOf(firstSave, 'c1');

    expect(ratioFirstSave).toBeGreaterThan(1);

    // Reload from the first save (one re-render cycle).
    await createBlok(page, firstSave);

    const widthsAfterReload = await liveColumnWidths(page);

    expect(widthsAfterReload[0]).toBeGreaterThan(widthsAfterReload[1] + 80);

    // Edit a block in the resized column AFTER the reload (second re-render cycle).
    await editParagraphLikeText(page, 'Left content', 'Reloaded then edited');

    const widthsAfterEdit = await liveColumnWidths(page);

    expect(widthsAfterEdit[0]).toBeGreaterThan(widthsAfterEdit[1] + 80);

    // Save again: the ratio from the FIRST resize is intact across reload + edit,
    // with no drift, and the edit persisted too.
    const secondSave = await saveBlok(page);
    const ratioSecondSave = widthRatioOf(secondSave, 'c1');
    const editedParagraph = secondSave.blocks.find(
      (block) => (block.data as { text?: string }).text === 'Reloaded then edited'
    );

    expect(editedParagraph).toBeDefined();
    expect(editedParagraph?.parent).toBe('c1');

    expect(ratioSecondSave).toBeGreaterThan(1);
    expect(Math.abs((ratioSecondSave ?? 0) - (ratioFirstSave ?? 0))).toBeLessThan(0.05);
  });
});
