import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputData } from '../../../../types';

/**
 * Redo of a table insert must restore the table AND its cell paragraphs with
 * their ORIGINAL ids — no minted duplicates, no orphans.
 *
 * Y.UndoManager re-applies a redo's map inserts in REVERSE insertion order,
 * so the observer's batch-add listed the CELLS before the TABLE. yjs-sync's
 * two-pass batch restore activated them in that order: the cell paragraphs
 * mounted first (the generic hierarchy dropped them into the first
 * [data-blok-nested-blocks] container it found), so when the table's
 * rendered() → initializeCells ran, mountBlocksInCell saw blocks "already
 * mounted in a nested container", minted duplicates (its anti-steal path),
 * pointed the grid at the mints and dropped the restored originals.
 * Restoring DOCUMENT order (parents before children, pass 1 array positions
 * valid) is what the two-pass design always assumed.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: {
    insert: (type: string, data: unknown, config: unknown, index: number, needToFocus?: boolean) => unknown;
    getBlocksCount: () => number;
  };
  history: { undo: () => void; redo: () => void };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('table insert undo/redo id stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('redo of a table insert reuses the original table and cell ids', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hello' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    instance.blocks.insert(
      'table',
      { withHeadings: false, content: [['One', 'Two']] },
      {},
      instance.blocks.getBlocksCount(),
      true
    );
    // Past the capture window so the insert is one settled undo entry.
    await sleep(700);

    const withTable = await instance.save();
    const idsWithTable = withTable.blocks.map((b) => b.id);

    expect(withTable.blocks.filter((b) => b.type === 'table')).toHaveLength(1);
    expect(idsWithTable).toHaveLength(4);

    // Undo removes the table and both cell paragraphs entirely.
    instance.history.undo();
    await sleep(300);

    const afterUndo = await instance.save();

    expect(afterUndo.blocks.map((b) => b.id)).toEqual(['p1']);

    // Redo restores all three blocks with their ORIGINAL ids.
    instance.history.redo();
    await sleep(300);

    const afterRedo = await instance.save();
    const afterRedoIds = new Set(afterRedo.blocks.map((b) => b.id));

    // EVERY original id survives the redo — the regression replaced the cell
    // paragraphs with freshly minted ids (their batch-add arrived child-first,
    // so the generic hierarchy mounted them before the table's rendered()
    // could adopt them, and mountBlocksInCell's anti-steal path duplicated).
    for (const id of idsWithTable) {
      expect(afterRedoIds.has(id), `original block ${id ?? ''} must survive undo -> redo`).toBe(true);
    }

    // The restored table owns exactly its ORIGINAL cell paragraphs.
    const table = afterRedo.blocks.find((b) => b.type === 'table');
    const originalCellIds = withTable.blocks
      .filter((b) => b.parent === table?.id)
      .map((b) => b.id);
    const cellChildren = afterRedo.blocks.filter((b) => b.parent === table?.id).map((b) => b.id);

    expect([...cellChildren].sort()).toEqual([...originalCellIds].sort());
  });
});
