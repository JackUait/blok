import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt,  createBlok, saveBlok, findBlock } from './_helpers';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

/**
 * FAMILY GUARD — a block dropped in the empty "below the columns" dead space must
 * ALWAYS land at page root below the column_list, never adopt into a column and
 * never strand its holder in the columns row as a phantom column. This locks the
 * WHOLE family (any column count, any column's dead space, the resize-separator
 * gap, mover above/below, multi-block, nested lists) so the reported "dropped
 * under the columns → stuck in the first column" bug can never recur under any of
 * these conditions. Dropping OVER real content still stacks in (negative control).
 */

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

const dragTo = async (page: Page, handle: Locator, x: number, y: number): Promise<void> => {
  const sb = await handle.boundingBox();

  if (!sb) {
    throw new Error('missing handle box');
  }

  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 20 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );

  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/**
 * DOM facts for a block id: whether its holder is nested in a column wrapper or
 * anywhere in a columns row, and the count of PHANTOM elements — direct
 * [data-blok-element] children of a columns row that do NOT wrap a real column
 * (a stranded content holder is exactly such an element).
 */
const domFacts = async (
  page: Page,
  id: string
): Promise<{ insideColumn: boolean; insideColumnsRow: boolean; phantom: number }> => {
  return await page.evaluate((blockId) => {
    const holder = document.querySelector(`[data-blok-id="${blockId}"]`);
    const insideColumn = holder?.closest('[data-blok-column]') != null;
    const insideColumnsRow = holder?.closest('[data-blok-columns]') != null;

    let phantom = 0;
    document.querySelectorAll('[data-blok-columns]').forEach((row) => {
      Array.from(row.children).forEach((child) => {
        if (child.matches('[data-blok-element]') && child.querySelector('[data-blok-column]') === null) {
          phantom += 1;
        }
      });
    });

    return { insideColumn, insideColumnsRow, phantom };
  }, id);
};

/**
 * Build an N-column layout with the given per-column line counts (so some columns
 * are short and leave a dead gap below their content). `moverPos` puts the plain
 * `mover` paragraph above or below the whole layout.
 */
const cols = (n: number, moverPos: 'above' | 'below', heights: number[]): OutputData => {
  const blocks: OutputData['blocks'] = [];

  if (moverPos === 'above') {
    blocks.push({ id: 'mover', type: 'paragraph', data: { text: 'Mover block' } });
  }

  const colIds = Array.from({ length: n }, (_, i) => `c${i}`);
  blocks.push({ id: 'cl1', type: 'column_list', data: {}, content: colIds });

  for (let i = 0; i < n; i++) {
    blocks.push({ id: `c${i}`, type: 'column', data: {}, parent: 'cl1', content: [`c${i}p`] });
    const text = Array.from({ length: heights[i] }, (_, k) => `col${i} line${k}`).join('<br>');
    blocks.push({ id: `c${i}p`, type: 'paragraph', data: { text }, parent: `c${i}` });
  }

  if (moverPos === 'below') {
    blocks.push({ id: 'mover', type: 'paragraph', data: { text: 'Mover block' } });
  }

  return { blocks };
};

/** Assert the mover landed at ROOT (parent-less), not adopted, not stranded. */
const expectRootDrop = async (page: Page, moverId = 'mover'): Promise<void> => {
  const saved = await saveBlok(page);
  const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
  const parent = findBlock(saved, moverId)?.parent ?? null;

  expect(parent, 'mover must be a root block').toBeNull();
  expect(columnIds).not.toContain(parent);

  const facts = await domFacts(page, moverId);
  expect(facts.insideColumn, 'holder must be out of every column wrapper').toBe(false);
  expect(facts.insideColumnsRow, 'holder must be out of the columns row').toBe(false);
  expect(facts.phantom, 'no phantom column may appear in the row').toBe(0);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Dropping in the dead space below columns always lands at root (family guard)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // Column-body dead space across counts and which column is short. Each drop
  // aims at the bottom strip of the row over the named (short) column.
  const bodyCases: Array<{ name: string; data: OutputData; xFrac: number }> = [
    { name: '2 columns, short first column', data: cols(2, 'below', [1, 6]), xFrac: 0.15 },
    { name: '3 columns, short last column', data: cols(3, 'below', [1, 6, 1]), xFrac: 0.85 },
    { name: '3 columns, short first column', data: cols(3, 'below', [1, 6, 3]), xFrac: 0.1 },
    { name: '4 columns, short middle column', data: cols(4, 'below', [1, 1, 6, 1]), xFrac: 0.35 },
    { name: 'mover starts ABOVE the columns', data: cols(2, 'above', [1, 6]), xFrac: 0.15 },
  ];

  for (const { name, data, xFrac } of bodyCases) {
    test(`root drop — ${name}`, async ({ page }) => {
      await createBlok(page, data);
      await expect(page.locator('[data-blok-columns]')).toHaveCount(1);

      const row = await page.locator('[data-blok-columns]').boundingBox();

      if (!row) {
        throw new Error('missing columns row box');
      }

      const handle = await grabLeafHandle(page, 'mover');
      await dragTo(page, handle, row.x + row.width * xFrac, row.y + row.height - 6);

      await expectRootDrop(page);
    });
  }

  test('root drop — on the resize separator in the dead gap below a short column', async ({ page }) => {
    await createBlok(page, cols(2, 'below', [1, 6]));
    await expect(page.locator('[data-blok-columns]')).toHaveCount(1);

    const resizer = await page.locator('[data-blok-column-resizer]').first().boundingBox();
    const row = await page.locator('[data-blok-columns]').boundingBox();

    if (!resizer || !row) {
      throw new Error('missing resizer/row box');
    }

    const handle = await grabLeafHandle(page, 'mover');
    await dragTo(page, handle, resizer.x + resizer.width / 2, row.y + row.height - 6);

    await expectRootDrop(page);
  });

  test('root drop — nested column_list: dropping below the INNER list lands in the OUTER column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ocl', type: 'column_list', data: {}, content: ['oc0', 'oc1'] },
        { id: 'oc0', type: 'column', data: {}, parent: 'ocl', content: ['icl'] },
        { id: 'icl', type: 'column_list', data: {}, parent: 'oc0', content: ['ic0', 'ic1'] },
        { id: 'ic0', type: 'column', data: {}, parent: 'icl', content: ['ic0p'] },
        { id: 'ic0p', type: 'paragraph', data: { text: 'inner a' }, parent: 'ic0' },
        { id: 'ic1', type: 'column', data: {}, parent: 'icl', content: ['ic1p'] },
        { id: 'ic1p', type: 'paragraph', data: { text: 'inner b<br>b2<br>b3<br>b4<br>b5' }, parent: 'ic1' },
        { id: 'oc1', type: 'column', data: {}, parent: 'ocl', content: ['oc1p'] },
        { id: 'oc1p', type: 'paragraph', data: { text: 'outer right' }, parent: 'oc1' },
        { id: 'mover', type: 'paragraph', data: { text: 'Mover block' } },
      ],
    });

    const innerRow = await page.locator('[data-blok-id="icl"] [data-blok-columns]').first().boundingBox();

    if (!innerRow) {
      throw new Error('missing inner row box');
    }

    const handle = await grabLeafHandle(page, 'mover');
    await dragTo(page, handle, innerRow.x + innerRow.width * 0.15, innerRow.y + innerRow.height - 4);

    // Below the inner list = root OF the outer column that owns the inner list —
    // never adopted into an inner column, never stranded.
    const saved = await saveBlok(page);
    expect(findBlock(saved, 'mover')?.parent).toBe('oc0');

    const facts = await domFacts(page, 'mover');
    expect(facts.phantom).toBe(0);
    // It is inside the OUTER column oc0, but NOT inside any inner column.
    const inInnerColumn = await page.evaluate(() => {
      const holder = document.querySelector('[data-blok-id="mover"]');
      const innerRowEl = document.querySelector('[data-blok-id="icl"] [data-blok-columns]');

      return innerRowEl?.contains(holder ?? null) ?? false;
    });
    expect(inInnerColumn).toBe(false);
  });

  test('root drop — a multi-block selection dropped in the dead space all lands at root', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c0', 'c1'] },
        { id: 'c0', type: 'column', data: {}, parent: 'cl1', content: ['c0p'] },
        { id: 'c0p', type: 'paragraph', data: { text: 'short' }, parent: 'c0' },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1p'] },
        { id: 'c1p', type: 'paragraph', data: { text: 'tall<br>t2<br>t3<br>t4<br>t5<br>t6' }, parent: 'c1' },
        { id: 'm1', type: 'paragraph', data: { text: 'Mover one' } },
        { id: 'm2', type: 'paragraph', data: { text: 'Mover two' } },
      ],
    });

    // Multi-select m1 + m2 with the proven caret + Shift+ArrowDown pattern.
    const m1Content = page.locator('[data-blok-id="m1"] [data-blok-element-content]').first();
    await m1Content.click();
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await expect(page.locator('[data-blok-id="m1"]').first()).toHaveAttribute('data-blok-selected', 'true');
    await expect(page.locator('[data-blok-id="m2"]').first()).toHaveAttribute('data-blok-selected', 'true');

    const row = await page.locator('[data-blok-columns]').boundingBox();

    if (!row) {
      throw new Error('missing columns row box');
    }

    const handle = await grabLeafHandle(page, 'm1');
    await dragTo(page, handle, row.x + row.width * 0.15, row.y + row.height - 6);

    const saved = await saveBlok(page);
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);

    for (const id of ['m1', 'm2']) {
      const parent = findBlock(saved, id)?.parent ?? null;
      expect(parent, `${id} must be root`).toBeNull();
      expect(columnIds).not.toContain(parent);
    }

    const facts = await domFacts(page, 'm1');
    expect(facts.insideColumnsRow).toBe(false);
    expect(facts.phantom).toBe(0);
  });

  test('NEGATIVE control — dropping OVER a column\'s real content still stacks INTO it', async ({ page }) => {
    await createBlok(page, cols(2, 'below', [1, 6]));

    const content = page.locator('[data-blok-id="c1p"] [data-blok-element-content]').first();
    const target = await content.boundingBox();

    if (!target) {
      throw new Error('missing content box');
    }

    const handle = await grabLeafHandle(page, 'mover');
    await dragTo(page, handle, target.x + target.width / 2, target.y + target.height - 4);

    const saved = await saveBlok(page);
    expect(findBlock(saved, 'mover')?.parent).toBe('c1');
    expect((await domFacts(page, 'mover')).insideColumn).toBe(true);
  });
});
