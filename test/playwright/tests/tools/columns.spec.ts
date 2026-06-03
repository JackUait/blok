import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';

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
});
