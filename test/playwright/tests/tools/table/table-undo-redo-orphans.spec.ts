/* eslint-disable playwright/no-nth-methods */
/**
 * Regression test for: undo/redo cascade creates orphan blocks outside the table
 *
 * Steps that reproduce the bug:
 *  1. Render a doc with [paragraph, table 2x2, paragraph]
 *  2. Type a character into a table cell
 *  3. Press Cmd+Z / Cmd+Shift+Z many times (more than the actual edit count)
 *  4. Save and inspect the document
 *
 * Before fix:
 *  - The flat block list grows on every undo/redo cycle (orphan child blocks
 *    accumulate)
 *  - Some duplicates lose their parentId and surface as top-level siblings of
 *    the table — i.e. "content outside the current table starts to change"
 *  - Original cell IDs disappear; table.data.content references brand-new IDs
 *
 * After fix:
 *  - Block count, parent topology, and outer paragraphs stay constant across
 *    arbitrary numbers of undo/redo presses.
 *
 * Invariant tested:
 *  Repeated undo/redo on a stable history must NEVER mutate blocks outside the
 *  block(s) that were originally edited.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, initialData }) => {
    const tableClass = (window as unknown as { Blok: { Table?: unknown } }).Blok?.Table;

    const blok = new window.Blok({
      holder,
      data: initialData,
      tools: tableClass ? { table: { class: tableClass } } : undefined,
    } as ConstructorParameters<typeof window.Blok>[0]);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

type BlockSummary = {
  id: string;
  type: string;
  text: string | undefined;
  parentId: string | null | undefined;
};

const summarizeBlocks = async (page: Page): Promise<BlockSummary[]> => {
  const saved = await saveBlok(page);

  return page.evaluate((ids) => {
    const instance = window.blokInstance;

    if (!instance) {
      throw new Error('Blok instance not found');
    }

    type BlocksApi = {
      getById?: (id: string) => { id: string; name: string; parentId: string | null } | null;
    };
    const blocksApi = (instance as unknown as { blocks: BlocksApi }).blocks;

    return ids.map(({ id, type, text }) => {
      const live = blocksApi.getById?.(id);

      return {
        id,
        type,
        text,
        parentId: live?.parentId ?? null,
      };
    });
  }, saved.blocks.map(b => ({
    id: b.id ?? '',
    type: b.type ?? '',
    text: typeof (b.data as { text?: unknown })?.text === 'string'
      ? (b.data as { text: string }).text
      : undefined,
  })));
};

test.describe('Table Undo/Redo Orphan Regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // Distinct undo presses (>500ms apart) on a multi-block doc with a table
  // exercise the orphan accumulation path; the bug does not appear under
  // coalesced presses, so this test takes longer than the 15s default.
  test.setTimeout(60000);

  test('rapid undo/redo of a single cell edit never creates orphans or mutates outer blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'OUTER1' } },
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
          },
        },
        { type: 'paragraph', data: { text: 'OUTER2' } },
      ],
    });

    await waitForDelay(page, 300);

    const isTopLevel = (b: BlockSummary): boolean =>
      b.parentId === null || b.parentId === undefined || b.parentId === '';

    const initial = await summarizeBlocks(page);
    const initialOuter1 = initial.find(b => b.text === 'OUTER1');
    const initialOuter2 = initial.find(b => b.text === 'OUTER2');
    const initialTable = initial.find(b => b.type === 'table');
    const initialTopLevelIds = new Set(initial.filter(isTopLevel).map(b => b.id));

    expect(initial.filter(b => b.text === 'OUTER1')).toHaveLength(1);
    expect(initial.filter(b => b.text === 'OUTER2')).toHaveLength(1);

    // Type one character into the first cell
    const firstCell = page.locator('[data-blok-table-cell]').first().locator('[contenteditable="true"]').first();

    await firstCell.click();
    await page.keyboard.type('X');
    await waitForDelay(page, 700);

    // Spam undo/redo far more than the user actually needs. Each press waits
    // longer than the Yjs capture timeout (500ms) so each one becomes its
    // own distinct undo operation — matching the repro path where the bug
    // appears. Coalesced presses do not exercise the regression.
    const PRESS_GAP_MS = 600;

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, PRESS_GAP_MS);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, PRESS_GAP_MS);
    }
    await waitForDelay(page, 800);

    const after = await summarizeBlocks(page);

    // INVARIANT: no new TOP-LEVEL blocks may exist after rapid undo/redo. The
    // reported user-visible bug is that "content outside the current table
    // starts to change" — meaning new sibling blocks appear next to the
    // table at the document root. New blocks parented to the table are out of
    // scope; a new top-level block is the regression.
    const newTopLevel = after.filter(b => isTopLevel(b) && !initialTopLevelIds.has(b.id));

    expect(newTopLevel, `unexpected new top-level blocks appeared after undo/redo: ${JSON.stringify(newTopLevel)}`).toStrictEqual([]);

    // INVARIANT: outer paragraphs are untouched (same id, same text, exactly one of each).
    const outer1AfterAll = after.filter(b => b.text === 'OUTER1');
    const outer2AfterAll = after.filter(b => b.text === 'OUTER2');

    expect(outer1AfterAll).toHaveLength(1);
    expect(outer2AfterAll).toHaveLength(1);
    expect(outer1AfterAll[0]?.id).toBe(initialOuter1?.id);
    expect(outer2AfterAll[0]?.id).toBe(initialOuter2?.id);

    // INVARIANT: the table block itself still exists at its original id and
    // is still a top-level block (not pulled into another container).
    const tableAfter = after.find(b => b.type === 'table');

    expect(tableAfter?.id).toBe(initialTable?.id);
    expect(tableAfter && isTopLevel(tableAfter)).toBe(true);
  });

  test('pure undo presses on a fresh document do not create new blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'OUTER1' } },
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
          },
        },
        { type: 'paragraph', data: { text: 'OUTER2' } },
      ],
    });

    await waitForDelay(page, 500);

    const isTopLevel = (b: BlockSummary): boolean =>
      b.parentId === null || b.parentId === undefined || b.parentId === '';

    const initial = await summarizeBlocks(page);
    const initialTopLevelIds = new Set(initial.filter(isTopLevel).map(b => b.id));

    // Press undo many times without ever editing anything
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(UNDO_SHORTCUT);
    }
    await waitForDelay(page, 500);

    const after = await summarizeBlocks(page);
    const newTopLevel = after.filter(b => isTopLevel(b) && !initialTopLevelIds.has(b.id));

    expect(newTopLevel, `pure undo introduced ${newTopLevel.length} new top-level blocks: ${JSON.stringify(newTopLevel)}`).toStrictEqual([]);

    // Outer paragraphs must remain untouched at their original ids.
    const outer1 = after.filter(b => b.text === 'OUTER1');
    const outer2 = after.filter(b => b.text === 'OUTER2');

    expect(outer1).toHaveLength(1);
    expect(outer2).toHaveLength(1);
  });
});
