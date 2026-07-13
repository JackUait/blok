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
 * DEFENSE-IN-DEPTH (path-independent guarantee).
 *
 * The "2 columns silently became 4 with content scrambled" corruption is,
 * structurally, a `column_list` that holds a NON-`column` direct child: the
 * list renders every child as a column, so a rogue child materialises as a
 * phantom extra column and shoves the real ones sideways.
 *
 * Three mutation-layer root causes were closed (seedColumns re-fire,
 * setBlockParent Yjs-write skip, flat move() adoption). But `setBlockParent`
 * itself is called raw by ~30 sites (paste, drag, table, database, keyboard)
 * and NONE validate the child type, and — critically — a document may ALREADY
 * be corrupted on disk by the bug BEFORE this fix shipped. So the last line of
 * defense lives where the corruption becomes visible: `ColumnList.rendered()`
 * must render only its `column` children as columns and eject any rogue child
 * back to a sane location, self-healing on load. This makes the phantom column
 * unreachable regardless of HOW a rogue child got into the model.
 */

const columnTypeCount = async (page: Page): Promise<number> => {
  const saved = await saveBlok(page);
  return saved.blocks.filter((b) => b.type === 'column').length;
};

const modelParent = async (page: Page, id: string): Promise<string | null> =>
  page.evaluate((bid) => (window.blokInstance as unknown as {
    blocks: { getById?: (i: string) => { parentId: string | null } | null };
  }).blocks.getById?.(bid)?.parentId ?? null, id);

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

const textPresent = async (page: Page, text: string): Promise<boolean> => {
  const saved = await saveBlok(page);
  return saved.blocks.some(
    (b) => (b.data as { text?: string } | undefined)?.text === text
  );
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('column_list never renders a non-column child as a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('a corrupt document with a rogue trailing child self-heals on load', async ({ page }) => {
    // This is exactly the shape a document corrupted by the shipped bug carries
    // on disk: a paragraph sitting as a direct child of the column_list.
    const corrupt: OutputData = {
      blocks: [
        { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'c2', 'rogue'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        { id: 'h1', type: 'header', data: { text: 'Left heading', level: 3 }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        { id: 'm2', type: 'paragraph', data: { text: 'Right media' }, parent: 'c2' },
        { id: 'rogue', type: 'paragraph', data: { text: 'Rogue content' }, parent: 'cl1' },
      ],
    };

    await createBlok(page, corrupt);

    // Exactly two columns render — the rogue is NOT a phantom third column.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    expect(await columnTypeCount(page), 'model holds exactly two columns').toBe(2);
    expect(await foreignRowChildren(page), 'no rogue holder stranded in the columns row').toEqual([]);

    // The rogue content is preserved (never destroyed) and ejected to root.
    // The model heal is deferred to after the render settles, so poll for it.
    expect(await textPresent(page, 'Rogue content'), 'rogue content preserved').toBe(true);
    await expect
      .poll(() => modelParent(page, 'rogue'), { message: 'rogue ejected to root' })
      .toBeNull();
  });

  test('a corrupt document with a rogue child INTERLEAVED between columns self-heals', async ({ page }) => {
    const corrupt: OutputData = {
      blocks: [
        { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'rogue', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        { id: 'h1', type: 'header', data: { text: 'Left heading', level: 3 }, parent: 'c1' },
        { id: 'rogue', type: 'paragraph', data: { text: 'Interleaved rogue' }, parent: 'cl1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        { id: 'm2', type: 'paragraph', data: { text: 'Right media' }, parent: 'c2' },
      ],
    };

    await createBlok(page, corrupt);

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    expect(await columnTypeCount(page), 'model holds exactly two columns').toBe(2);
    expect(await foreignRowChildren(page), 'no rogue holder in the columns row').toEqual([]);
    expect(await textPresent(page, 'Interleaved rogue'), 'rogue content preserved').toBe(true);
    await expect
      .poll(() => modelParent(page, 'rogue'), { message: 'rogue ejected to root' })
      .toBeNull();
  });

  test('a rogue child injected at runtime via raw setBlockParent cannot become a phantom column', async ({ page }) => {
    // setBlockParent is unguarded (only move() is clamped). Prove the render-side
    // invariant catches a rogue child no matter which mutation path created it.
    await createBlok(page, {
      blocks: [
        { id: 'top', type: 'paragraph', data: { text: 'Top' } },
        { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1'] },
        { id: 'h1', type: 'header', data: { text: 'Left', level: 3 }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['m2'] },
        { id: 'm2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Force the corruption directly: reparent a root block under the column_list.
    await page.evaluate(() => {
      const inst = window.blokInstance as unknown as {
        blocks: {
          getById?: (id: string) => unknown;
          setBlockParent?: (id: string, parentId: string | null) => void;
        };
      };
      inst.blocks.setBlockParent?.('top', 'cl1');
    });

    // Trigger a re-render of the column_list the way the user did (editing
    // elsewhere / re-render churn): a save + reload is the deterministic proxy.
    const mid = await saveBlok(page);
    await createBlok(page, mid);

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    expect(await columnTypeCount(page), 'still two columns').toBe(2);
    expect(await foreignRowChildren(page), 'no phantom column holder').toEqual([]);
    expect(await textPresent(page, 'Top'), 'injected content preserved').toBe(true);
    await expect
      .poll(() => modelParent(page, 'top'), { message: 'injected block ejected to root' })
      .toBeNull();
  });
});
