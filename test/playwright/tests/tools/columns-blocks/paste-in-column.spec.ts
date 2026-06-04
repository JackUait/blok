import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { createBlok, saveBlok, reloadFromSave, findBlock, childrenOf, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

/**
 * TDD bug-hunt: pasting multi-block content into a paragraph that lives inside a
 * column. The pasted blocks must become siblings parented to that column (in
 * order), the OTHER column must be untouched, and no nested column_list may be
 * synthesized inside the column.
 *
 * Paste flows through html-handler.ts -> base.ts insertPasteData, which inserts
 * new blocks via BlockManager at the current index. The nested parentId of the
 * paste target may not propagate, dumping pasted blocks at root — that is the
 * suspected break.
 */

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Dispatch a synthetic paste event carrying typed clipboard data onto the given
 * element. Mirrors the helper used by container-paste-patterns.spec.ts.
 */
const paste = async (locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);
};

/**
 * Poll the saved blocks until at least `count` blocks have the given parent.
 */
const waitForChildCount = async (page: Page, parentId: string, count: number): Promise<void> => {
  await expect.poll(
    async () => {
      const saved = await saveBlok(page);

      return saved.blocks.filter((b) => b.parent === parentId).length;
    },
    {
      message: `waiting for column ${parentId} to own ${count} children`,
      timeout: 5000,
    }
  ).toBeGreaterThanOrEqual(count);
};

const TWO_COLUMN_LAYOUT = {
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
    { id: 'p1', type: 'paragraph', data: { text: 'Left target' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right sibling' }, parent: 'c2' },
  ],
};

test.describe('Pasting multi-block content into a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('multi-block paste nests every pasted block in the target column, in order', async ({ page }) => {
    await createBlok(page, TWO_COLUMN_LAYOUT);

    const target = page.locator('[data-blok-id="p1"] [contenteditable="true"]').first();

    await expect(target).toBeVisible();
    await target.click();

    // Three distinct blocks in one HTML payload (header + paragraph + list).
    await paste(target, {
      'text/html': '<h2>Pasted header</h2><p>Pasted paragraph</p><ul><li>Pasted item</li></ul>',
    });

    // The header is the new sentinel; wait for the column to grow.
    await waitForChildCount(page, 'c1', 2);

    const saved = await saveBlok(page);

    // Every pasted sentinel resolves to a block parented to column c1.
    const parentsBySentinel = ['Pasted header', 'Pasted paragraph', 'Pasted item'].map((sentinel) => {
      const block = saved.blocks.find(
        (b) =>
          b.data &&
          Object.values(b.data as Record<string, unknown>).some(
            (v) => typeof v === 'string' && v.includes(sentinel)
          )
      );

      return { sentinel, parent: block?.parent };
    });

    for (const { sentinel, parent } of parentsBySentinel) {
      expect(parent, `"${sentinel}" must be parented to the target column c1, not ejected to root`).toBe('c1');
    }

    // Original left content survives and the column owns its children in order:
    // the pasted blocks land after the existing paragraph (the caret block).
    const c1Children = childrenOf(saved, 'c1');

    expect(c1Children[0]).toBe('p1');
    expect(c1Children.length).toBeGreaterThanOrEqual(4);
  });

  test('multi-block paste leaves the sibling column and the column_list intact', async ({ page }) => {
    await createBlok(page, TWO_COLUMN_LAYOUT);

    const target = page.locator('[data-blok-id="p1"] [contenteditable="true"]').first();

    await expect(target).toBeVisible();
    await target.click();

    await paste(target, {
      'text/html': '<p>Alpha line</p><p>Beta line</p><p>Gamma line</p>',
    });

    await waitForChildCount(page, 'c1', 2);

    const saved = await saveBlok(page);

    // The sibling column c2 is untouched: still exactly its one original child.
    const c2Children = childrenOf(saved, 'c2');

    expect(c2Children).toEqual(['p2']);
    expect(findBlock(saved, 'p2')?.parent).toBe('c2');

    // No pasted content leaked into the sibling column.
    for (const sentinel of ['Alpha line', 'Beta line', 'Gamma line']) {
      const block = saved.blocks.find(
        (b) =>
          b.data &&
          Object.values(b.data as Record<string, unknown>).some(
            (v) => typeof v === 'string' && v.includes(sentinel)
          )
      );

      expect(block?.parent, `"${sentinel}" must not leak into the sibling column c2`).not.toBe('c2');
      expect(block?.parent, `"${sentinel}" must stay inside the target column c1`).toBe('c1');
    }

    // The column_list still owns exactly its two columns — no split, no extra.
    const columnListChildren = childrenOf(saved, 'cl1');

    expect(columnListChildren).toEqual(['c1', 'c2']);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
  });

  test('pasting list/columns-shaped HTML into a column never synthesizes a nested column_list', async ({ page }) => {
    await createBlok(page, TWO_COLUMN_LAYOUT);

    const target = page.locator('[data-blok-id="p1"] [contenteditable="true"]').first();

    await expect(target).toBeVisible();
    await target.click();

    // HTML that visually looks like a multi-column / multi-block structure. It
    // must normalize to allowed blocks INSIDE the column, never produce a nested
    // column_list (the unsupported case the isInsideColumn guard forbids).
    await paste(target, {
      'text/html': [
        '<div style="display:flex">',
        '<div><p>Col-shaped one</p></div>',
        '<div><p>Col-shaped two</p></div>',
        '</div>',
      ].join(''),
    });

    await waitForChildCount(page, 'c1', 2);

    const saved = await saveBlok(page);

    // There is still exactly ONE column_list and exactly TWO columns in the whole
    // document — no nested column_list was synthesized inside c1.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // Every column's parent is the single top-level column_list — none is nested
    // under another column.
    const columnParents = saved.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.parent);

    for (const parent of columnParents) {
      expect(parent, 'every column must be a child of the top-level column_list').toBe('cl1');
    }

    // The reload round-trip preserves a legal (non-nested) structure.
    const reloaded = await reloadFromSave(page);

    expect(reloaded.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(reloaded.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
  });
});
