/**
 * Undo of a cell merge puts the caret back where it was before the merge.
 * The merge moves cell blocks inside one transact, so no move entry records
 * the caret: the step's own caret entry must.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { LegacyCellContent, TableConfig, TableData } from '../../../../src/tools/table/types';
import type { BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../types';

const TABLE_ID = 'tbl';

interface Range { minRow: number; maxRow: number; minCol: number; maxCol: number }

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void };
}

const tables = new Map<string, Table>();

class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

let holder: HTMLDivElement;
let blok: TestEditor | null = null;

const sleep = (ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

/** Past the history capture window. */
const CAPTURE = 700;

/** The callback the cell-selection menu's Merge item calls. */
const merge = (range: Range): void => {
  const table = tables.get(TABLE_ID);
  const selection = (table as unknown as { subsystems: { cellSelectionSubsystem: { onMergeCells?: (r: Range) => void } | null } } | undefined)
    ?.subsystems.cellSelectionSubsystem;

  if (selection?.onMergeCells === undefined) {
    throw new Error('no merge callback');
  }
  selection.onMergeCells(range);
};

const boot = async (): Promise<TestEditor> => {
  const content: LegacyCellContent[][] = [
    [{ blocks: ['a'] }, { blocks: ['b'] }],
    [{ blocks: ['c'] }, { blocks: ['d'] }],
  ];
  const cells: OutputBlockData[] = ['a', 'b', 'c', 'd'].map(id => ({
    id, type: 'paragraph', data: { text: id.toUpperCase() }, parent: TABLE_ID,
  }));
  const data: OutputData = {
    blocks: [{ id: TABLE_ID, type: 'table', data: { withHeadings: false, withHeadingColumn: false, content } }, ...cells],
  };
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: TrackedTable }, data }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await sleep(CAPTURE);

  return instance;
};

const putCaret = (blockId: string, offset: number): void => {
  const editable = holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-element-content] > *`);
  const text = editable?.firstChild ?? null;

  if (editable === null || text === null) {
    throw new Error(`no text in ${blockId}`);
  }
  editable.setAttribute('contenteditable', 'true');
  editable.focus();
  const range = document.createRange();

  range.setStart(text, offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

/** The block holding the caret. */
const caretBlock = (): string | null => {
  const node = window.getSelection()?.anchorNode ?? null;
  const element = node instanceof Element ? node : node?.parentElement ?? null;

  return element?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null;
};

/** `text@offset` of the caret, when it sits in a text node. */
const caretText = (): string => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;

  return node instanceof Text ? `${node.data}@${selection?.anchorOffset ?? -1}` : `${node?.nodeName ?? 'none'}@${selection?.anchorOffset ?? -1}`;
};

describe('undo of a cell merge restores the caret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it.each(['b', 'd'])('caret in %s before the merge is back in %s after undo', async (id) => {
    const editor = await boot();

    putCaret(id, 1);
    await sleep(50);
    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);

    editor.history.undo();

    expect(caretBlock()).toBe(id);
    expect(document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id')).toBe(id);
  }, 90_000);

  // The caret lands at the start of the block, not the offset. Same on HEAD
  // before the merge moved blocks inside the step.
  it.fails('undo of a merge restores the caret offset', async () => {
    const editor = await boot();

    putCaret('b', 1);
    await sleep(50);
    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);

    editor.history.undo();

    expect(caretText()).toBe('B@1');
  }, 90_000);
});
