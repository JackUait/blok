import { expect, test } from '@playwright/test';
import type { OutputBlockData, OutputData } from '@/types';
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
 * Code block fixture nested inside the first column of a 2-column layout.
 * The Code block is a leaf (no child blocks): it stores `code`/`language`/
 * `lineNumbers` in its own `data`. `javascript` keeps the editable code body visible
 * (previewable langs like mermaid/latex would hide `code-content`).
 */
const CODE_SNIPPET = "const greet = (name) => `hi ${name}`;\nconsole.log(greet('blok'));";

const buildFixture = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['code1'] },
    {
      id: 'code1',
      type: 'code',
      data: { code: CODE_SNIPPET, language: 'javascript', lineNumbers: true },
      parent: 'c1',
    },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right column paragraph' }, parent: 'c2' },
  ],
});

interface CodeData {
  code?: string;
  language?: string;
  lineNumbers?: boolean;
}

const codeData = (block: OutputBlockData | undefined): CodeData => (block?.data ?? {}) as CodeData;

/**
 * The meaningful, non-volatile subset of a block used for deep round-trip
 * comparison: structural links (id/type/parent/content) plus, for code blocks,
 * the primary `code`/`language`/`lineNumbers` data fields.
 */
const structuralShape = (block: OutputBlockData): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    id: block.id,
    type: block.type,
    parent: block.parent,
    content: block.content,
  };

  if (block.type === 'code') {
    const data = codeData(block);

    base.code = data.code;
    base.language = data.language;
    base.lineNumbers = data.lineNumbers;
  }

  if (block.type === 'paragraph') {
    base.text = (block.data as { text?: string }).text;
  }

  return base;
};

const structuralShapes = (saved: OutputData): Array<Record<string, unknown>> =>
  saved.blocks.map(structuralShape);

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Code inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, buildFixture());

    const columns = page.locator('[data-blok-column]');

    await expect(columns).toHaveCount(2);

    // The editable code body is rendered and shows the snippet. With javascript,
    // Prism wraps tokens in spans, so assert on textContent, not exact innerHTML.
    const codeContent = page.getByTestId('code-content');

    await expect(codeContent).toBeVisible();
    await expect(codeContent).toContainText("greet('blok')");
    await expect(codeContent).toContainText('console.log');

    // It lives inside the FIRST column (index 0), not the second.
    const codeColumnIndex = await page.evaluate(() => {
      const columnHolders = Array.from(
        document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
      );
      const codeEl = document.querySelector('[data-blok-testid="code-content"]');
      const ownColumn = codeEl?.closest('[data-blok-column]')?.closest('[data-blok-element]');

      if (!(ownColumn instanceof HTMLElement)) {
        return -1;
      }

      return columnHolders.indexOf(ownColumn);
    });

    expect(codeColumnIndex).toBe(0);

    // The companion column still renders its paragraph.
    await expect(page.getByText('Right column paragraph')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, buildFixture());

    const saved = await saveBlok(page);
    const types = saved.blocks.map((b) => b.type);

    expect(types.includes('column_list')).toBe(true);
    expect(types.filter((t) => t === 'column')).toHaveLength(2);

    // The code block is parented to the first column and listed in its content.
    const codeBlock = findBlock(saved, 'code1');

    expect(codeBlock).toBeDefined();
    expect(codeBlock?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toContain('code1');

    const c1 = findBlock(saved, 'c1');

    expect(c1?.content).toContain('code1');

    // The other column keeps its paragraph child.
    expect(childrenOf(saved, 'c2')).toEqual(['p2']);

    // The code block's own data round-trips: primary fields preserved.
    const data = codeData(codeBlock);

    expect(data.code).toBe(CODE_SNIPPET);
    expect(data.language).toBe('javascript');
    expect(data.lineNumbers).toBe(true);
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, buildFixture());

    const first = await saveBlok(page);
    const second = await reloadFromSave(page);

    // Deep-match the meaningful subset: ids, types, parent links, column
    // membership (content) and the code block's primary data fields. This is the
    // core check that catches re-render/serialization breakage when nested in a
    // column.
    expect(structuralShapes(second)).toEqual(structuralShapes(first));

    // Spot-check the code block specifically survived intact.
    const codeBlock = findBlock(second, 'code1');

    expect(codeBlock?.parent).toBe('c1');
    expect(codeData(codeBlock).code).toBe(CODE_SNIPPET);
    expect(codeData(codeBlock).language).toBe('javascript');

    // The column_list + both columns are still present after the round-trip.
    expect(second.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(findBlock(second, 'cl1')?.type).toBe('column_list');
  });

  test("edits to the block's content persist through save", async ({ page }) => {
    await createBlok(page, buildFixture());

    const codeContent = page.getByTestId('code-content');

    await expect(codeContent).toBeVisible();

    // The Code block owns Enter/Tab and uses a single contenteditable surface.
    // Select all existing text and type a replacement line. (editParagraphLikeText
    // targets [data-blok-element-content]; the code body is the dedicated
    // [data-blok-testid="code-content"] element, so edit it directly.)
    await codeContent.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('const edited = 42;');

    // Highlighting/detection settle asynchronously; auto-wait on visible text.
    await expect(codeContent).toContainText('const edited = 42;');

    const saved = await saveBlok(page);
    const codeBlock = findBlock(saved, 'code1');

    // The edited value round-trips through data.code, and the block is still
    // parented to the first column.
    expect(codeData(codeBlock).code).toContain('const edited = 42;');
    expect(codeData(codeBlock).code).not.toContain("greet('blok')");
    expect(codeBlock?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toContain('code1');
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, buildFixture());

    // Delete the code block by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('code1');

      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the code block (the sole child of column c1) empties c1, so the
    // column is removed; the list drops to one column and unwraps. The unwrap is
    // fire-and-forget async — wait for the whole scaffold to dissolve.
    await page.waitForFunction(
      () =>
        window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);

    // The code block is gone.
    expect(findBlock(saved, 'code1')).toBeUndefined();

    // The columns scaffold dissolves: no column_list, no column survives.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The sibling column's paragraph is promoted to ROOT, content intact.
    const survivor = saved.blocks.find(
      (b) => (b.data as { text?: string }).text === 'Right column paragraph'
    );

    expect(survivor).toBeDefined();
    expect(survivor?.parent ?? null).toBeNull();

    // No orphaned children: every block carrying a `parent` points at a block
    // that still exists in the saved tree.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !ids.has(b.parent));

    expect(orphans).toHaveLength(0);
  });
});
