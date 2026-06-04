import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';

/**
 * Drag the block whose drag handle is `sourceHandle` onto the left/right edge
 * of `targetBlock`, in its vertical mid-band, to trigger a column (side) drop.
 */
const performSideDrop = async (
  page: Page,
  sourceHandle: ReturnType<Page['locator']>,
  targetBlock: ReturnType<Page['locator']>,
  side: 'left' | 'right'
): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  // Side detection measures the visible content box, not the full-width holder
  // (the holder spans the editor gutters). Target the content element's edge so
  // the cursor lands inside the side drop zone.
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

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }
    return await window.blokInstance.save();
  });
};

test.describe('Columns tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('@smoke inserts a 2-column layout and persists the nested tree', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });

    const list = page.getByTestId('column-list');
    await expect(list).toBeVisible();

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // Side by side: second column starts to the right of the first
    const [boxA, boxB] = await Promise.all([
      columns.nth(0).boundingBox(),
      columns.nth(1).boundingBox(),
    ]);

    expect(boxB?.x).toBeGreaterThan(boxA?.x ?? 0);

    const saved = await saveBlok(page);
    const types = saved.blocks.map(b => b.type);
    expect(types.includes('column_list')).toBe(true);
    expect(types.filter(t => t === 'column')).toHaveLength(2);
  });

  test('collapsing to one column auto-unwraps to root', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Keep me' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Remove me' }, parent: 'c2' },
      ],
    });

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      // delete() is index-based: resolve the column's flat index first
      const index = window.blokInstance.blocks.getBlockIndex('c2');
      await window.blokInstance.blocks.delete(index);
    });

    // The auto-unwrap inside removed() is fire-and-forget async. Wait until the
    // column_list wrapper block disappears from the flat block array.
    await page.waitForFunction(
      () => window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);
    const types = saved.blocks.map(b => b.type);
    expect(types.includes('column_list')).toBe(false);
    expect(types.includes('column')).toBe(false);
    expect(saved.blocks.find(b => (b.data as { text?: string }).text === 'Keep me')?.parent).toBeUndefined();
  });

  test('stacks vertically on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Top' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Bottom' }, parent: 'c2' },
      ],
    });

    const columns = page.locator('[data-blok-column]');
    const [boxA, boxB] = await Promise.all([
      columns.nth(0).boundingBox(),
      columns.nth(1).boundingBox(),
    ]);

    // Stacked: second column sits below the first
    expect(boxB?.y).toBeGreaterThan((boxA?.y ?? 0) + (boxA?.height ?? 0) - 1);
  });

  test('splits the available width evenly across equal columns', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2', 'c3'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Much longer content in the middle column' }, parent: 'c2' },
        { id: 'c3', type: 'column', data: {}, parent: 'cl1', content: ['p3'] },
        { id: 'p3', type: 'paragraph', data: { text: 'C' }, parent: 'c3' },
      ],
    });

    const columns = page.locator('[data-blok-column]');

    await expect(columns).toHaveCount(3);

    const boxes = await columns.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );

    // Equal columns share the row evenly regardless of content length.
    const [w1, w2, w3] = boxes;

    expect(Math.abs(w1 - w2)).toBeLessThan(2);
    expect(Math.abs(w2 - w3)).toBeLessThan(2);
  });

  test('renders a resize separator between each pair of columns', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2', 'c3'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'B' }, parent: 'c2' },
        { id: 'c3', type: 'column', data: {}, parent: 'cl1', content: ['p3'] },
        { id: 'p3', type: 'paragraph', data: { text: 'C' }, parent: 'c3' },
      ],
    });

    const resizers = page.getByTestId('column-resizer');

    // 3 columns -> 2 separators
    await expect(resizers).toHaveCount(2);
    await expect(resizers.first()).toHaveAttribute('role', 'separator');
    await expect(resizers.first()).toHaveAttribute('aria-orientation', 'vertical');
  });

  test('dragging a separator resizes the columns and persists across reload', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });

    const columns = page.locator('[data-blok-column]');
    const widthsBefore = await columns.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );

    // Equal to start
    expect(Math.abs(widthsBefore[0] - widthsBefore[1])).toBeLessThan(2);

    const resizer = page.getByTestId('column-resizer').first();
    const box = await resizer.boundingBox();

    if (!box) {
      throw new Error('resizer not found');
    }

    const centerY = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, centerY, { steps: 8 });
    await page.mouse.up();

    const widthsAfter = await columns.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );

    // Left column grew, right column shrank by roughly the drag distance
    expect(widthsAfter[0]).toBeGreaterThan(widthsBefore[0] + 80);
    expect(widthsAfter[1]).toBeLessThan(widthsBefore[1] - 80);

    // The resized ratio persists into the saved output
    const saved = await saveBlok(page);
    const leftColumn = saved.blocks.find(b => b.id === 'c1');
    expect((leftColumn?.data as { widthRatio?: number }).widthRatio).toBeGreaterThan(1);

    // Reloading the saved tree restores the uneven widths
    await createBlok(page, saved);

    const reloaded = page.locator('[data-blok-column]');
    const widthsReloaded = await reloaded.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );

    expect(widthsReloaded[0]).toBeGreaterThan(widthsReloaded[1] + 80);
  });

  test('drag-beside a top-level block creates a 2-column layout and persists', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Left para' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Right para' } },
      ],
    });

    // Drag "Right para" onto the right edge of "Left para" → [Left, Right] columns.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Right para' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Left para' });
    await performSideDrop(page, handle, target, 'right');

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);
    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);
    const list = saved.blocks.find(b => b.type === 'column_list');
    expect(list).toBeDefined();
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(2);
    // both paragraphs now live inside columns (have a parent)
    expect(saved.blocks.find(b => b.id === 'p1')?.parent).toBeDefined();
    expect(saved.blocks.find(b => b.id === 'p2')?.parent).toBeDefined();

    // Reload round-trips the layout
    await createBlok(page, saved);
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    await expect(page.getByText('Left para')).toBeVisible();
    await expect(page.getByText('Right para')).toBeVisible();
  });

  test('drag-beside a block already in a column adds a third column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Drag the root "Newcomer" onto the right edge of "Col B" (inside column c2).
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    // .last() = the innermost wrapper (the paragraph), since the column_list and
    // column wrappers also contain this text.
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Col B' }).last();
    await performSideDrop(page, handle, target, 'right');

    await expect(page.locator('[data-blok-column]')).toHaveCount(3);

    const saved = await saveBlok(page);
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(3);
    // Newcomer is now inside a column
    expect(saved.blocks.find(b => b.id === 'newcomer')?.parent).toBeDefined();
  });

  test('adding a column re-splits the row evenly even after a prior resize', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    // Make the two columns uneven by dragging the separator right.
    const resizer = page.getByTestId('column-resizer').first();
    const box = await resizer.boundingBox();

    if (!box) {
      throw new Error('resizer not found');
    }

    const centerY = box.y + box.height / 2;
    const startX = box.x + box.width / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(startX + 140, centerY, { steps: 8 });
    await page.mouse.up();

    const columns = page.locator('[data-blok-column]');
    const unevenWidths = await columns.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );

    // Precondition: the resize made them genuinely uneven.
    expect(Math.abs(unevenWidths[0] - unevenWidths[1])).toBeGreaterThan(80);

    // Now drag a root block beside Col B to add a third column.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Col B' }).last();
    await performSideDrop(page, handle, target, 'right');

    await expect(columns).toHaveCount(3);

    // All three columns are now even again.
    const evenWidths = await columns.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );
    const max = Math.max(...evenWidths);
    const min = Math.min(...evenWidths);

    expect(max - min).toBeLessThan(8);

    // The even split persists: no column keeps a custom widthRatio.
    const saved = await saveBlok(page);
    const withRatio = saved.blocks.filter(
      b => b.type === 'column' && (b.data as { widthRatio?: number }).widthRatio !== undefined
    );

    expect(withRatio).toHaveLength(0);
  });

  test('side-drop indicator spans the full column-row height, not one block', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        // Short column: a single line.
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['short'] },
        { id: 'short', type: 'paragraph', data: { text: 'Short' }, parent: 'c1' },
        // Tall column: several blocks, so the row is much taller than 'short'.
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['t1', 't2', 't3', 't4'] },
        { id: 't1', type: 'paragraph', data: { text: 'Tall line one' }, parent: 'c2' },
        { id: 't2', type: 'paragraph', data: { text: 'Tall line two' }, parent: 'c2' },
        { id: 't3', type: 'paragraph', data: { text: 'Tall line three' }, parent: 'c2' },
        { id: 't4', type: 'paragraph', data: { text: 'Tall line four' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    const rowHeight = await page.getByTestId('column-list').first().evaluate(
      el => el.getBoundingClientRect().height
    );
    const shortHolder = page.getByTestId('block-wrapper').filter({ hasText: 'Short' }).last();
    const shortBox = await shortHolder.boundingBox();
    const contentBox = await shortHolder.locator('[data-blok-element-content]').first().boundingBox();

    if (!shortBox || !contentBox) {
      throw new Error('missing bounding box');
    }

    // The row is meaningfully taller than the short block (precondition).
    expect(rowHeight).toBeGreaterThan(shortBox.height + 40);

    // Begin dragging the root "Newcomer" toward the LEFT edge of the short column,
    // then pause mid-drag to inspect the live indicator. The left edge of the
    // first column has no neighbor to collapse to, so the indicator stays on the
    // short block itself — exactly the case we want: a short block's side
    // indicator must still span the full row height.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    if (!sourceBox) {
      throw new Error('missing handle box');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(contentBox.x + 4, shortBox.y + shortBox.height / 2, { steps: 15 });

    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );

    // The short block's holder carries the left-side indicator, and its ::before
    // bar spans the full column-row height (within a few px), NOT just the short
    // block's own height.
    const indicator = await shortHolder.evaluate(el => {
      const before = getComputedStyle(el, '::before');

      return {
        edge: el.getAttribute('data-drop-indicator'),
        beforeHeight: parseFloat(before.height),
      };
    });

    await page.mouse.up();

    expect(indicator.edge).toBe('left');
    expect(Math.abs(indicator.beforeHeight - rowHeight)).toBeLessThan(8);
  });

  test('dropping a block on the inter-column gutter inserts a new column between the two columns', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // Drop "Newcomer" squarely on the resize separator dividing the two columns —
    // the natural "between columns" gesture.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    const resizer = page.getByTestId('column-resizer').first();
    const gutterBox = await resizer.boundingBox();

    if (!sourceBox || !gutterBox) {
      throw new Error('missing bounding box for gutter drop');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gutterBox.x + gutterBox.width / 2, gutterBox.y + gutterBox.height / 2, { steps: 15 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
      { timeout: 2000 }
    );

    await expect(columns).toHaveCount(3);

    // REGRESSION: the new column must be DOM-mounted as a sibling of c1/c2 inside
    // the column row — NOT physically nested inside the left column. The saved
    // model can read "between" while the holder is actually mounted inside c1
    // (the flat-index insert anchors on the nested predecessor and the reparent
    // re-mount is then skipped), which renders the block INSIDE the left column.
    // Assert the live DOM, not just save().
    const domColumnOrder = await page.evaluate(() => {
      const row = document.querySelector('[data-blok-columns]');

      if (!row) {
        return null;
      }

      // Direct-child column holders only (skip the resize separators).
      return Array.from(row.children)
        .filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-blok-element]'))
        .map((holder): string => {
          const text = holder.textContent ?? '';

          if (text.includes('Col A')) {
            return 'c1';
          }

          if (text.includes('Col B')) {
            return 'c2';
          }

          return text.includes('Newcomer') ? 'new' : '?';
        });
    });

    expect(domColumnOrder).toEqual(['c1', 'new', 'c2']);

    // The new column lands BETWEEN the originals in the saved model too: column
    // document order is [c1, <new>, c2], Newcomer the sole child of the middle.
    const saved = await saveBlok(page);
    const columnOrder = saved.blocks.filter(b => b.type === 'column').map(b => b.id);
    const newcomerParent = saved.blocks.find(b => b.id === 'newcomer')?.parent;

    expect(columnOrder).toHaveLength(3);
    expect(newcomerParent).toBe(columnOrder[1]);
    expect(columnOrder[0]).toBe('c1');
    expect(columnOrder[2]).toBe('c2');
  });

  test('dropping at a column inner side-zone inserts a column between, not inside the column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'desc', type: 'paragraph', data: { text: 'Description root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
      ],
    });

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Description root' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    // Right edge of Col A's content box — the side-zone that should create a
    // column between A and B (collapses to B's left edge).
    const aContent = await page.getByTestId('block-wrapper').filter({ hasText: 'Col A' }).last()
      .locator('[data-blok-element-content]').first().boundingBox();

    if (!sourceBox || !aContent) {
      throw new Error('missing bounding box');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(aContent.x + aContent.width - 4, aContent.y + aContent.height / 2, { steps: 18 });
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
    const columnOrder = saved.blocks.filter(b => b.type === 'column').map(b => b.id);
    const descParent = saved.blocks.find(b => b.id === 'desc')?.parent;

    // A NEW column was created between A and B; the source is its child — NOT a
    // second block dumped inside column A.
    expect(columnOrder).toHaveLength(3);
    expect(descParent).toBe(columnOrder[1]);
    expect(descParent).not.toBe('c1');
    expect(columnOrder[0]).toBe('c1');
    expect(columnOrder[2]).toBe('c2');
  });

  test('centers the between-columns drop indicator in the gutter (on the separator)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    const resizer = page.getByTestId('column-resizer').first();
    const gutterBox = await resizer.boundingBox();

    if (!sourceBox || !gutterBox) {
      throw new Error('missing bounding box');
    }

    const gutterCenter = gutterBox.x + gutterBox.width / 2;

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gutterCenter, gutterBox.y + gutterBox.height / 2, { steps: 15 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );

    // The indicator bar's horizontal center must sit on the gutter (separator)
    // center — between the columns — not at the right column's content edge.
    const barCenter = await page.evaluate(() => {
      const el = document.querySelector('[data-drop-indicator]');

      if (!(el instanceof HTMLElement)) {
        return null;
      }

      const before = getComputedStyle(el, '::before');
      const holderRect = el.getBoundingClientRect();
      // ::before is positioned by `left: var(--drop-indicator-side-left)`; resolve
      // its absolute center from the holder's left + that offset + half its width.
      const offset = parseFloat(before.left);
      const width = parseFloat(before.width);

      return holderRect.left + offset + width / 2;
    });

    await page.mouse.up();

    expect(barCenter).not.toBeNull();
    expect(Math.abs((barCenter ?? 0) - gutterCenter)).toBeLessThan(6);
  });

  test('the gutter drop indicator stays on ONE anchor as the cursor crosses the gutter (no flicker)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    const resizer = page.getByTestId('column-resizer').first();
    const gutterBox = await resizer.boundingBox();

    if (!sourceBox || !gutterBox) {
      throw new Error('missing bounding box');
    }

    const midY = gutterBox.y + gutterBox.height / 2;

    // Sample the single drop indicator: its count and the left edge of the holder
    // it sits on (so two different anchors would report different positions).
    const sampleIndicator = async (): Promise<{ count: number; left: number | null; edge: string | null }> =>
      page.evaluate(() => {
        const els = document.querySelectorAll('[data-drop-indicator]');
        const el = els[0] as HTMLElement | undefined;
        const rect = el?.getBoundingClientRect();

        return {
          count: els.length,
          left: rect ? Math.round(rect.left) : null,
          edge: el?.getAttribute('data-drop-indicator') ?? null,
        };
      });

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();

    // Just LEFT of the gutter (in the left column's right zone).
    await page.mouse.move(gutterBox.x - 6, midY, { steps: 10 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );
    const left = await sampleIndicator();

    // Just RIGHT of the gutter (in the right column's left zone).
    await page.mouse.move(gutterBox.x + gutterBox.width + 6, midY, { steps: 10 });
    const right = await sampleIndicator();

    await page.mouse.up();

    // One indicator on each side, and the SAME anchor (same edge, same position
    // within a px) — the blue line doesn't jump across the gutter.
    expect(left.count).toBe(1);
    expect(right.count).toBe(1);
    expect(left.edge).toBe(right.edge);
    expect(Math.abs((left.left ?? 0) - (right.left ?? 0))).toBeLessThan(2);
  });

  test('hides the resize handle during a block drag so only ONE indicator shows in the gutter', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
        { id: 'newcomer', type: 'paragraph', data: { text: 'Newcomer' } },
      ],
    });

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Newcomer' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    const resizer = page.getByTestId('column-resizer').first();
    const gutterBox = await resizer.boundingBox();

    if (!sourceBox || !gutterBox) {
      throw new Error('missing bounding box for gutter drag');
    }

    // Drag onto the gutter and pause mid-drag to inspect what's drawn there.
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gutterBox.x + gutterBox.width / 2, gutterBox.y + gutterBox.height / 2, { steps: 18 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );

    const drawn = await page.evaluate(() => {
      const indicators = document.querySelectorAll('[data-drop-indicator]').length;
      const handleOpacities = Array.from(document.querySelectorAll('[data-blok-column-resizer]'))
        .map(el => getComputedStyle(el, '::before').opacity);

      return { indicators, handleOpacities };
    });

    await page.mouse.up();

    // Exactly one drop indicator, and NO resize handle is revealed during the drag —
    // otherwise the gray handle bar reads as a second drop target beside the blue one.
    expect(drawn.indicators).toBe(1);
    expect(drawn.handleOpacities.every(o => o === '0')).toBe(true);
  });

  test('dragging a column child to a root position moves it out of the column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'top', type: 'paragraph', data: { text: 'Top root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a1', 'a2'] },
        { id: 'a1', type: 'paragraph', data: { text: 'A one' }, parent: 'c1' },
        { id: 'a2', type: 'paragraph', data: { text: 'A two' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b1'] },
        { id: 'b1', type: 'paragraph', data: { text: 'B one' }, parent: 'c2' },
      ],
    });

    // Drag "A two" (inside column c1) to the bottom edge of the root "Top root".
    // .last() = the innermost wrapper (the paragraph itself).
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'A two' }).last();
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    const sourceBox = await handle.boundingBox();
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Top root' });
    const targetBox = await target.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('missing bounding box');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    // Drop at the bottom edge (vertical drop) of the root block, horizontal center
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 1, { steps: 15 });
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
    // A two left the column → now at root (no parent), c1 keeps A one
    expect(saved.blocks.find(b => b.id === 'a2')?.parent).toBeUndefined();
    expect(saved.blocks.find(b => b.id === 'a1')?.parent).toBe('c1');

    // LIVE DOM: A two's holder must physically leave the column and sit at the
    // workingArea root — not stay stranded inside the column (model-vs-DOM
    // divergence). A one stays in the first column.
    const aTwoAtRoot = await page.evaluate(() => {
      const holders = Array.from(document.querySelectorAll('[data-blok-element]'));
      const aTwo = holders.find(h => (h.textContent ?? '').includes('A two'));

      if (!(aTwo instanceof HTMLElement)) {
        return false;
      }

      return aTwo.closest('[data-blok-column]') === null;
    });
    expect(aTwoAtRoot).toBe(true);
    expect(await domColumnMembership(page)).not.toHaveProperty('A two');
  });

  test('dragging a column child into a root gap between two root blocks lands it at root, in order', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'head', type: 'paragraph', data: { text: 'Heading root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a1'] },
        { id: 'a1', type: 'paragraph', data: { text: 'A one' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b1'] },
        { id: 'b1', type: 'paragraph', data: { text: 'Movable b' }, parent: 'c2' },
        { id: 'tail', type: 'paragraph', data: { text: 'Tail root' } },
      ],
    });

    // Drag "Movable b" (in column c2) to the bottom edge of "Heading root" — the
    // root gap between the heading and the column_list, exactly as in the report.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Movable b' }).last();
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Heading root' });
    const targetBox = await target.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('missing bounding box');
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
    // Model: Movable b left c2 for root; the columns survive (c1 keeps A one).
    expect(saved.blocks.find(b => b.id === 'b1')?.parent).toBeUndefined();
    expect(saved.blocks.find(b => b.id === 'a1')?.parent).toBe('c1');

    // LIVE DOM: the moved holder is a direct workingArea child — out of every
    // column — and sits between the heading and the column_list, matching the
    // flat-array order.
    const domRootOrder = await page.evaluate(() => {
      const workingArea = document.querySelector('[data-blok-redactor]');

      if (!(workingArea instanceof HTMLElement)) {
        return null;
      }

      return Array.from(workingArea.children)
        .filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-blok-element]'))
        .map((holder): string => {
          const text = (holder.textContent ?? '').trim();
          if (text.startsWith('Heading root')) { return 'head'; }
          if (text.startsWith('Movable b')) { return 'moved'; }
          if (text.startsWith('Tail root')) { return 'tail'; }

          return text.includes('A one') ? 'columns' : '?';
        });
    });

    expect(domRootOrder).not.toBeNull();
    expect(domRootOrder).toEqual(['head', 'moved', 'columns', 'tail']);
    expect(await domColumnMembership(page)).not.toHaveProperty('Movable b');
  });

  test('dropping over a column body center stacks the block inside that column (no new column)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'desc', type: 'paragraph', data: { text: 'Intro root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'Plan stuff here' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
        { id: 'b', type: 'paragraph', data: { text: 'Build stuff here' }, parent: 'c2' },
      ],
    });

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Intro root' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    // Dead center of Col A's content body — the user's "drop into this column"
    // gesture. Only the narrow left/right edges create a new column; the body
    // center must ADD the block into Col A, not spawn a new column.
    const aContent = await page.getByTestId('block-wrapper').filter({ hasText: 'Plan stuff here' }).last()
      .locator('[data-blok-element-content]').first().boundingBox();

    if (!sourceBox || !aContent) {
      throw new Error('missing bounding box');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    // Horizontal center, vertical middle — squarely in the body, away from the
    // edge side-zones, so the block stacks into the column it was dropped on.
    await page.mouse.move(aContent.x + aContent.width / 2, aContent.y + aContent.height / 2, { steps: 18 });
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
    const columnOrder = saved.blocks.filter(b => b.type === 'column').map(b => b.id);
    const descParent = saved.blocks.find(b => b.id === 'desc')?.parent;

    // No new column — still exactly two; the source joined column c1 (the column
    // it was dropped on), it did NOT spawn a third column between A and B.
    expect(columnOrder).toEqual(['c1', 'c2']);
    expect(descParent).toBe('c1');

    // LIVE DOM: "Intro root" is mounted inside the FIRST column (index 0), beside
    // "Plan stuff here".
    const membership = await domColumnMembership(page);
    expect(membership['Intro root']).toBe(0);
    expect(membership['Plan stuff here']).toBe(0);
  });

  /**
   * Reports, for every block holder mounted inside a [data-blok-column] wrapper,
   * which enclosing column holder it lives in — keyed by the block's text. Proves
   * the LIVE DOM placement, not just the saved model (the divergence that let a
   * "model-correct, DOM-wrong" column bug pass every prior test).
   */
  const domColumnMembership = async (page: Page): Promise<Record<string, number>> => {
    return await page.evaluate(() => {
      const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
      const membership: Record<string, number> = {};

      document.querySelectorAll('[data-blok-column] [data-blok-element]').forEach((holder) => {
        const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]');

        if (!(ownColumn instanceof HTMLElement)) {
          return;
        }
        const columnIndex = columnHolders.indexOf(ownColumn);
        const text = (holder.textContent ?? '').trim();

        if (text.length > 0 && columnIndex !== -1) {
          membership[text] = columnIndex;
        }
      });

      return membership;
    });
  };

  test('dropping a root block on a column block edge stacks it inside that column (into a column)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'top', type: 'paragraph', data: { text: 'Loner root' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a1'] },
        { id: 'a1', type: 'paragraph', data: { text: 'A one' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b1'] },
        { id: 'b1', type: 'paragraph', data: { text: 'B one' }, parent: 'c2' },
      ],
    });

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Loner root' });
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    // The bottom edge of "B one" (last block in column c2). The thin top/bottom
    // reorder margin of a column block is the "stack inside this column" zone.
    const bContent = await page.getByTestId('block-wrapper').filter({ hasText: 'B one' }).last()
      .locator('[data-blok-element-content]').first().boundingBox();

    if (!sourceBox || !bContent) {
      throw new Error('missing bounding box');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bContent.x + bContent.width / 2, bContent.y + bContent.height - 1, { steps: 18 });
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
    const columnOrder = saved.blocks.filter(b => b.type === 'column').map(b => b.id);

    // Still exactly two columns — the block joined c2, it did NOT create a third.
    expect(columnOrder).toEqual(['c1', 'c2']);
    expect(saved.blocks.find(b => b.id === 'top')?.parent).toBe('c2');
    expect(saved.blocks.find(b => b.id === 'b1')?.parent).toBe('c2');

    // LIVE DOM: "Loner root" is mounted inside the SECOND column (index 1), beside B one.
    const membership = await domColumnMembership(page);
    expect(membership['Loner root']).toBe(1);
    expect(membership['B one']).toBe(1);
  });

  test('dragging a block from one column into another moves it across columns (column to column)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a1', 'a2'] },
        { id: 'a1', type: 'paragraph', data: { text: 'A one' }, parent: 'c1' },
        { id: 'a2', type: 'paragraph', data: { text: 'A two' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b1'] },
        { id: 'b1', type: 'paragraph', data: { text: 'B one' }, parent: 'c2' },
      ],
    });

    // Drag "A two" (in column c1) onto the bottom edge of "B one" (in column c2).
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'A two' }).last();
    await source.hover();
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();
    const sourceBox = await handle.boundingBox();

    const bContent = await page.getByTestId('block-wrapper').filter({ hasText: 'B one' }).last()
      .locator('[data-blok-element-content]').first().boundingBox();

    if (!sourceBox || !bContent) {
      throw new Error('missing bounding box');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bContent.x + bContent.width / 2, bContent.y + bContent.height - 1, { steps: 18 });
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
    const columnOrder = saved.blocks.filter(b => b.type === 'column').map(b => b.id);

    // Still two columns; A two left c1 and joined c2; A one stays in c1.
    expect(columnOrder).toEqual(['c1', 'c2']);
    expect(saved.blocks.find(b => b.id === 'a2')?.parent).toBe('c2');
    expect(saved.blocks.find(b => b.id === 'a1')?.parent).toBe('c1');

    // LIVE DOM: A two is now mounted in the SECOND column (index 1), A one stays first.
    const membership = await domColumnMembership(page);
    expect(membership['A two']).toBe(1);
    expect(membership['A one']).toBe(0);
    expect(membership['B one']).toBe(1);
  });
});
