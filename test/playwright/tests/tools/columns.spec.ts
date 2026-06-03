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
});
