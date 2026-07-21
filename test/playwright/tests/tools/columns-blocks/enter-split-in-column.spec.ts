import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  childrenOf,
  createBlok,
  ensureBlokBundleBuilt,
  findBlock,
  saveBlok,
} from './_helpers';

/**
 * Enter-key behaviour for a block that lives INSIDE a column.
 *
 * Pressing Enter (at end, in the middle, or on an empty sole block) must keep the
 * resulting block(s) parented to the SAME column, mounted in that column's DOM
 * subtree, in document order — and must never promote a block out to root or
 * collapse/unwrap the column_list.
 *
 * The flat-array split insert + createBlockOnEnter forceTopLevel heuristics
 * compute the new block's parent/anchor relative to the previous block. When the
 * previous block is a DOM-nested column child, a wrong branch can drop the new
 * block at root (splitting it out of the column) or anchor it in the wrong place.
 */

/**
 * A 2-column layout. The FIRST column holds a single leaf block (paragraph /
 * header / list) under test; the SECOND column holds a plain paragraph that must
 * stay untouched by any Enter in the first column.
 */
const treeWith = (block: OutputData['blocks'][number]): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: [block.id ?? 'inner'] },
    block,
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2p1'] },
    { id: 'c2p1', type: 'paragraph', data: { text: 'Second column.' }, parent: 'c2' },
  ],
});

/** Reads `data.text` off a saved block without resorting to `any`. */
const textOf = (block: { data: unknown } | undefined): string | undefined => {
  if (!block) {
    return undefined;
  }

  return (block.data as { text?: string }).text;
};

/**
 * Places a collapsed caret at the given character offset inside a block's first
 * contenteditable. Walks to the deepest text node so offset is character-precise.
 */
const placeCaret = async (page: Page, blockId: string, offset: number): Promise<void> => {
  await page.evaluate(
    ({ id, at }) => {
      const editable = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [contenteditable="true"]`);

      if (editable === null) {
        throw new Error(`editable for ${id} not found`);
      }
      editable.focus();

      const textNode = editable.firstChild ?? editable;
      const range = document.createRange();

      range.setStart(textNode, at);
      range.collapse(true);

      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
    },
    { id: blockId, at: offset }
  );
};

/**
 * For every block holder mounted inside a column, reports which column index it
 * lives in, keyed by the block's data-blok-id. Proves LIVE DOM placement, not
 * just the saved model — a block can be model-correct but DOM-stranded.
 */
const domColumnMembership = async (page: Page): Promise<Record<string, number>> => {
  return await page.evaluate(() => {
    const columnHolders = Array.from(
      document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
    );
    const membership: Record<string, number> = {};

    document.querySelectorAll('[data-blok-column] [data-blok-element][data-blok-id]').forEach((holder) => {
      if (!(holder instanceof HTMLElement)) {
        return;
      }
      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]');

      if (!(ownColumn instanceof HTMLElement)) {
        return;
      }
      const columnIndex = columnHolders.indexOf(ownColumn);
      const id = holder.dataset.blokId ?? '';

      if (id.length > 0 && columnIndex !== -1) {
        membership[id] = columnIndex;
      }
    });

    return membership;
  });
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Enter inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('Enter at the END of a paragraph in a column creates a new empty sibling parented to the SAME column, directly below', async ({ page }) => {
    await createBlok(page, treeWith({ id: 'p1', type: 'paragraph', data: { text: 'First line' }, parent: 'c1' }));

    // Caret at the end of "First line" (length 10), then Enter.
    await placeCaret(page, 'p1', 'First line'.length);
    await page.keyboard.press('Enter');

    const saved = await saveBlok(page);

    // The original paragraph keeps its text and stays in the first column.
    const original = findBlock(saved, 'p1');
    expect(textOf(original)).toBe('First line');
    expect(original?.parent).toBe('c1');

    // The brand-new block (not p1, not the seeded column paragraphs) is parented to
    // the SAME column c1 — NOT promoted to root.
    const newBlock = saved.blocks.find(
      (b) => b.id !== 'p1' && b.id !== 'c2p1' && b.type === 'paragraph' && b.parent !== undefined
    );

    expect(newBlock, 'a new sibling paragraph must exist').toBeDefined();
    expect(newBlock?.parent, 'new block must be parented to the same column').toBe('c1');

    // It is inserted immediately AFTER p1 within c1's content, in order.
    const c1Children = childrenOf(saved, 'c1');

    expect(c1Children[0]).toBe('p1');
    expect(c1Children[1]).toBe(newBlock?.id);
    expect(c1Children).toHaveLength(2);

    // The other column is untouched and the layout survives.
    expect(childrenOf(saved, 'c2')).toEqual(['c2p1']);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(findBlock(saved, 'cl1')?.content).toEqual(['c1', 'c2']);

    // LIVE DOM: the new holder is mounted inside the FIRST column (index 0).
    const membership = await domColumnMembership(page);

    expect(membership['p1']).toBe(0);
    expect(newBlock?.id && membership[newBlock.id]).toBe(0);
  });

  test('Enter in the MIDDLE of a header in a column splits the text into two blocks, both in the same column, in order', async ({ page }) => {
    await createBlok(page, treeWith({ id: 'h1', type: 'header', data: { text: 'HelloWorld', level: 2 }, parent: 'c1' }));

    // Caret between "Hello" and "World" (offset 5), then Enter splits the text.
    await placeCaret(page, 'h1', 'Hello'.length);
    await page.keyboard.press('Enter');

    const saved = await saveBlok(page);

    // Head keeps the text before the caret and stays in the first column.
    const head = findBlock(saved, 'h1');
    expect(textOf(head)).toBe('Hello');
    expect(head?.parent).toBe('c1');

    // The tail block holds the text after the caret and is parented to the SAME
    // column — not stranded at root or pushed into the second column.
    const tail = saved.blocks.find(
      (b) => b.id !== 'h1' && b.id !== 'c2p1' && textOf(b) === 'World'
    );

    expect(tail, 'a tail block holding "World" must exist').toBeDefined();
    expect(tail?.parent, 'tail block must be parented to the same column').toBe('c1');

    // Order preserved: head, then tail, inside c1.
    const c1Children = childrenOf(saved, 'c1');

    expect(c1Children).toEqual(['h1', tail?.id]);

    // Other column intact, layout intact.
    expect(childrenOf(saved, 'c2')).toEqual(['c2p1']);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // LIVE DOM: both halves sit in the first column (index 0).
    const membership = await domColumnMembership(page);

    expect(membership['h1']).toBe(0);
    expect(tail?.id && membership[tail.id]).toBe(0);
  });

  test('Enter in the MIDDLE of a list item in a column splits into two items, both in the same column, in order', async ({ page }) => {
    await createBlok(
      page,
      treeWith({
        id: 'list1',
        type: 'list',
        data: { text: 'FrontBack', style: 'unordered', checked: false, depth: 0 },
        parent: 'c1',
      })
    );

    // Caret between "Front" and "Back" (offset 5), then Enter splits the item.
    await placeCaret(page, 'list1', 'Front'.length);
    await page.keyboard.press('Enter');

    const saved = await saveBlok(page);

    // The original item keeps the head text and stays in the column.
    const head = findBlock(saved, 'list1');
    expect(textOf(head)).toBe('Front');
    expect(head?.parent).toBe('c1');

    // The new item holds the tail and is parented to the SAME column.
    const tail = saved.blocks.find(
      (b) => b.id !== 'list1' && b.id !== 'c2p1' && textOf(b) === 'Back'
    );

    expect(tail, 'a tail list item holding "Back" must exist').toBeDefined();
    expect(tail?.parent, 'tail item must be parented to the same column').toBe('c1');

    // Order preserved inside c1.
    const c1Children = childrenOf(saved, 'c1');

    expect(c1Children).toEqual(['list1', tail?.id]);

    // Other column + layout intact.
    expect(childrenOf(saved, 'c2')).toEqual(['c2p1']);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // LIVE DOM: both items live in the first column.
    const membership = await domColumnMembership(page);

    expect(membership['list1']).toBe(0);
    expect(tail?.id && membership[tail.id]).toBe(0);
  });

  test('Enter on the sole EMPTY paragraph of a column does not promote it to root or unwrap the column_list', async ({ page }) => {
    await createBlok(page, treeWith({ id: 'p1', type: 'paragraph', data: { text: '' }, parent: 'c1' }));

    // Caret in the empty sole block, then Enter.
    await placeCaret(page, 'p1', 0);
    await page.keyboard.press('Enter');

    const saved = await saveBlok(page);

    // The column_list and BOTH columns survive — no unwrap/collapse.
    const list = findBlock(saved, 'cl1');
    expect(list?.type).toBe('column_list');
    expect(list?.content).toEqual(['c1', 'c2']);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // The empty block is NOT promoted out: p1 stays parented to the first column.
    expect(findBlock(saved, 'p1')?.parent).toBe('c1');

    // Every block currently parented to c1 stays parented to c1 (none escaped to
    // root). Whether Enter added a sibling or was a no-op, all of c1's content
    // must remain inside c1 — there must be no root-level paragraph that came from
    // the empty column block.
    const c1Children = childrenOf(saved, 'c1');

    expect(c1Children).toContain('p1');
    expect(c1Children.length).toBeGreaterThanOrEqual(1);

    const rootParagraphs = saved.blocks.filter(
      (b) => b.type === 'paragraph' && b.parent === undefined
    );

    expect(rootParagraphs, 'no column paragraph may be promoted to root').toHaveLength(0);

    // Other column untouched.
    expect(childrenOf(saved, 'c2')).toEqual(['c2p1']);

    // LIVE DOM: p1 still lives in the first column; nothing leaked to root.
    const membership = await domColumnMembership(page);

    expect(membership['p1']).toBe(0);

    const strandedAtRoot = await page.evaluate(() => {
      const redactor = document.querySelector('[data-blok-redactor]');

      if (!(redactor instanceof HTMLElement)) {
        return -1;
      }

      // Direct workingArea children that are leaf blocks (not the column_list).
      return Array.from(redactor.children).filter(
        (el) =>
          el instanceof HTMLElement &&
          el.matches('[data-blok-element]') &&
          el.querySelector('[data-blok-columns]') === null
      ).length;
    });

    expect(strandedAtRoot, 'no leaf block should be mounted at the workingArea root').toBe(0);
  });
});
