import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
  saveBlok,
} from './_helpers';

/**
 * A flat `blocks.move` (public API / block-settings move up/down) is a REORDER.
 * It must never let its cross-container auto-heal adopt a block into or out of a
 * tool-owned columns structure: a root block landing beside a column's child
 * used to be swallowed into that column (content jumps columns), and landing
 * beside a `column` used to become a direct child of the `column_list` — a rogue
 * non-column child the list renders as a PHANTOM extra column. Both are the
 * "columns silently multiplied / content shifted after editing elsewhere" bug.
 */
const fixture = (): OutputData => ({
  blocks: [
    { id: 'intro', type: 'paragraph', data: { text: 'Intro line' } },
    { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'm1'] },
    { id: 'h1', type: 'header', data: { text: 'Left heading', level: 3 }, parent: 'c1' },
    { id: 'm1', type: 'paragraph', data: { text: 'Left media' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['h2', 'm2'] },
    { id: 'h2', type: 'header', data: { text: 'Right heading', level: 3 }, parent: 'c2' },
    { id: 'm2', type: 'paragraph', data: { text: 'Right media' }, parent: 'c2' },
    { id: 'b1', type: 'paragraph', data: { text: 'Below one' } },
    { id: 'b2', type: 'paragraph', data: { text: 'Below two' } },
  ],
});

const indexOf = async (page: Page, id: string): Promise<number> =>
  page.evaluate((bid) => (window.blokInstance as unknown as {
    blocks: { getBlockIndex: (i: string) => number | undefined };
  }).blocks.getBlockIndex(bid) ?? -1, id);

const apiMove = async (page: Page, toIndex: number, id: string): Promise<void> => {
  const from = await indexOf(page, id);
  await page.evaluate(({ to, f }) => (window.blokInstance as unknown as {
    blocks: { move: (t: number, ff: number) => void };
  }).blocks.move(to, f), { to: toIndex, f: from });
};

const modelParent = async (page: Page, id: string): Promise<string | null> =>
  page.evaluate((bid) => (window.blokInstance as unknown as {
    blocks: { getById?: (i: string) => { parentId: string | null } | null };
  }).blocks.getById?.(bid)?.parentId ?? null, id);

const columnTypeCount = async (page: Page): Promise<number> => {
  const saved = await saveBlok(page);
  return saved.blocks.filter((b) => b.type === 'column').length;
};

/** Direct children of the columns row that are neither a column wrapper nor a resizer. */
const foreignRowChildren = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const row = document.querySelector('[data-blok-columns]');

    if (!row) {
      return ['<no row>'];
    }

    return Array.from(row.children)
      .filter((c) => !(c as HTMLElement).matches('[data-blok-column-resizer]'))
      .filter((c) => (c as HTMLElement).querySelector('[data-blok-column]') === null)
      .map((c) => (c as HTMLElement).getAttribute('data-blok-id') ?? '<anon>');
  });

const contentOf = async (page: Page, id: string): Promise<string[]> => {
  const saved = await saveBlok(page);
  return ((saved.blocks.find((b) => b.id === id) as { content?: string[] } | undefined)?.content) ?? [];
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('flat move never crosses a columns boundary', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('root block moved beside a column CHILD is not adopted into the column', async ({ page }) => {
    await createBlok(page, fixture());
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    await apiMove(page, await indexOf(page, 'h1'), 'b1');

    expect(await modelParent(page, 'b1'), 'b1 stays root').toBeNull();
    expect(await columnTypeCount(page), 'still 2 columns').toBe(2);
    expect(await contentOf(page, 'c1'), 'c1 untouched').toEqual(['h1', 'm1']);
    expect(await foreignRowChildren(page), 'nothing stranded in the row').toEqual([]);
  });

  test('root block moved beside a COLUMN does not become a phantom column', async ({ page }) => {
    await createBlok(page, fixture());
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    await apiMove(page, await indexOf(page, 'c2'), 'b1');

    expect(await modelParent(page, 'b1'), 'b1 must not become a child of the column_list').not.toBe('cl1');
    expect(await modelParent(page, 'b1'), 'b1 stays root').toBeNull();
    expect(await columnTypeCount(page), 'still 2 columns').toBe(2);
    expect(await foreignRowChildren(page), 'no phantom column holder in the row').toEqual([]);
    // The columns row holds exactly the two column holders (plus resizers).
    const rowColumnHolders = await page.evaluate(() => {
      const row = document.querySelector('[data-blok-columns]');

      if (!row) {
        return -1;
      }

      return Array.from(row.children).filter(
        (c) => (c as HTMLElement).querySelector('[data-blok-column]') !== null
      ).length;
    });
    expect(rowColumnHolders, 'exactly two column holders in the row').toBe(2);
  });

  test('a column child is not ejected into the adjacent column by a flat move', async ({ page }) => {
    await createBlok(page, fixture());

    // m1 (last child of c1) flat-moved to h2's slot (first child of c2).
    await apiMove(page, await indexOf(page, 'h2'), 'm1');

    expect(await modelParent(page, 'm1'), 'm1 stays in c1').toBe('c1');
    expect(await contentOf(page, 'c1')).toEqual(['h1', 'm1']);
    expect(await contentOf(page, 'c2')).toEqual(['h2', 'm2']);
  });

  test('within-column reorder still works (not over-clamped)', async ({ page }) => {
    await createBlok(page, fixture());

    // Reorder m1 before h1 inside the SAME column c1.
    await apiMove(page, await indexOf(page, 'h1'), 'm1');

    expect(await modelParent(page, 'm1'), 'm1 stays in c1').toBe('c1');
    expect(await contentOf(page, 'c1'), 'order flipped within c1').toEqual(['m1', 'h1']);

    // The LIVE DOM reorders too: the positional store move skips nested
    // holders, so the move pipeline must re-mount the holder at its new
    // flat position — otherwise the user sees no change while the saved
    // order flips (the WYSIWYG divergence the saver's DOM-order guard rejects).
    const domOrder = await page.evaluate(() => {
      const column = document.querySelector('[data-blok-column]');

      return column === null
        ? []
        : Array.from(column.querySelectorAll('[data-blok-element][data-blok-id]'))
          .map((el) => el.getAttribute('data-blok-id'));
    });

    expect(domOrder, 'DOM order matches the saved order').toEqual(['m1', 'h1']);
  });

  test('plain root reorder still works (not over-clamped)', async ({ page }) => {
    await createBlok(page, fixture());

    // Move b2 above intro — both root, no columns crossing.
    await apiMove(page, await indexOf(page, 'intro'), 'b2');

    expect(await modelParent(page, 'b2')).toBeNull();
    const saved = await saveBlok(page);
    const rootOrder = saved.blocks
      .filter((b) => b.parent === undefined || b.parent === null)
      .map((b) => b.id);
    expect(rootOrder).toEqual(['b2', 'intro', 'cl1', 'b1']);
  });
});
