/**
 * Audit: undo/redo of table cell merge and split, driven through a real Blok.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { CellContent, LegacyCellContent, TableData } from '../../../../src/tools/table/types';
import type { OutputBlockData, OutputData } from '../../../../types';
import { savedAsHtml } from '../../helpers/saved-as-html';

const TABLE_ID = 'tbl';

interface Range { minRow: number; maxRow: number; minCol: number; maxCol: number }

const cellAt = (row: number, col: number): HTMLTableCellElement => {
  const cell = Array.from(holder.querySelectorAll<HTMLTableCellElement>('[data-blok-table-cell]'))
    .find(td => {
      const r = Number(td.getAttribute('data-blok-table-cell-row'));
      const c = Number(td.getAttribute('data-blok-table-cell-col'));

      return row >= r && row < r + td.rowSpan && col >= c && col < c + td.colSpan;
    });

  if (cell === undefined) {
    throw new Error(`no cell at ${row},${col}`);
  }

  return cell;
};

const activateCellAction = (from: [number, number], to: [number, number], title: string): void => {
  const start = cellAt(...from);
  const end = cellAt(...to);

  start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  if (start !== end) {
    const priorElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    const restoreElementFromPoint = (): void => {
      if (priorElementFromPoint === undefined) {
        Reflect.deleteProperty(document, 'elementFromPoint');
      } else {
        Object.defineProperty(document, 'elementFromPoint', priorElementFromPoint);
      }
    };

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => end });
    try {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1 }));
    } finally {
      restoreElementFromPoint();
    }
  }
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

  const pill = holder.querySelector<HTMLElement>('[data-blok-table-selection-pill]');

  if (pill === null) {
    throw new Error('no selection menu');
  }
  pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .find(candidate => candidate.querySelector('[data-blok-popover-item-title]')?.textContent === title);

  if (item === undefined) {
    throw new Error(`no ${title} item`);
  }
  item.click();
};

const merge = (range: Range): void => {
  activateCellAction([range.minRow, range.minCol], [range.maxRow, range.maxCol], 'Merge cells');
};

const split = (row: number, col: number): void => {
  activateCellAction([row, col], [row, col], 'Split cell');
};

const addColumn = (): void => {
  const button = holder.querySelector<HTMLElement>('[data-blok-table-add-col]');

  if (button === null) {
    throw new Error('no add-column button');
  }
  button.setPointerCapture = vi.fn();
  button.releasePointerCapture = vi.fn();
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
};

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean };
  blocks: { getBlocksCount: () => number };
}

let holder: HTMLDivElement;
let blok: TestEditor | null = null;

const sleep = (ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

/** Past the history capture window so the prior step is its own entry. */
const CAPTURE = 700;

const buildDoc = (content: LegacyCellContent[][], texts: Record<string, string>, extra: Partial<Record<string, unknown>> = {}): OutputData => {
  const table: OutputBlockData = {
    id: TABLE_ID,
    type: 'table',
    data: { withHeadings: false, withHeadingColumn: false, content, ...extra },
  };
  const cells: OutputBlockData[] = Object.entries(texts).map(([id, text]) => ({
    id, type: 'paragraph', data: { text }, parent: TABLE_ID,
  }));

  return { blocks: [table, ...cells] };
};

const boot = async (data: OutputData): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: Table },
    data,
  }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await sleep(CAPTURE);

  return instance;
};

const contentOf = (output: OutputData): CellContent[][] => {
  const table = output.blocks.find(b => b.id === TABLE_ID);

  return (table?.data as TableData).content as CellContent[][];
};

const hasMerge = (output: OutputData): boolean =>
  contentOf(output).some(row => row.some(cell =>
    cell.mergedInto !== undefined || (cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1
  ));

const blockIdsSorted = (output: OutputData): string[] => output.blocks.map(b => b.id ?? '').sort();

/** DOM facts: rendered td count, spans present, holder ids per rendered cell. */
const domShape = (): { cells: number; spans: string[]; holders: Record<string, string[]> } => {
  const tableEl = holder.querySelector(`[data-blok-id="${TABLE_ID}"]`);
  const tds = Array.from(tableEl?.querySelectorAll<HTMLElement>('[data-blok-table-cell]') ?? []);
  const holders: Record<string, string[]> = {};
  const spans: string[] = [];

  tds.forEach(td => {
    const key = `${td.getAttribute('data-blok-table-cell-row') ?? '?'},${td.getAttribute('data-blok-table-cell-col') ?? '?'}`;

    holders[key] = Array.from(td.querySelectorAll<HTMLElement>('[data-blok-id]')).map(h => h.getAttribute('data-blok-id') ?? '');
    const cs = td.getAttribute('colspan');
    const rs = td.getAttribute('rowspan');

    if ((cs !== null && cs !== '1') || (rs !== null && rs !== '1')) {
      spans.push(`${key}:${cs ?? '1'}x${rs ?? '1'}`);
    }
  });

  return { cells: tds.length, spans, holders };
};

const FLAT_2X2: LegacyCellContent[][] = [
  [{ blocks: ['a'] }, { blocks: ['b'] }],
  [{ blocks: ['c'] }, { blocks: ['d'] }],
];
const TEXTS_2X2 = { a: 'A', b: 'B', c: 'C', d: 'D' };

describe('merge audit: undo/redo of merge and split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('merge of a 2x2 is one undo step that restores every block to its original cell', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());

    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);

    const merged = savedAsHtml(await editor.save());

    expect(contentOf(merged)[0][0]).toMatchObject({ blocks: ['a', 'b', 'c', 'd'], colspan: 2, rowspan: 2 });

    editor.history.undo();
    await sleep(300);

    const undone = savedAsHtml(await editor.save());

    expect(contentOf(undone)).toEqual(contentOf(before));
    expect(blockIdsSorted(undone)).toEqual(blockIdsSorted(before));
    expect(domShape()).toEqual({ cells: 4, spans: [], holders: { '0,0': ['a'], '0,1': ['b'], '1,0': ['c'], '1,1': ['d'] } });
    expect(hasMerge(undone)).toBe(false);
    // Exactly one entry: nothing left to undo after it.
    expect(editor.history.canUndo()).toBe(false);
    editor.history.undo();
    await sleep(300);
    expect((savedAsHtml(await editor.save())).blocks).toEqual(undone.blocks);
  }, 90_000);

  const typeInto = async (blockId: string, text: string): Promise<void> => {
    const editable = holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-element-content] > *`);

    if (editable === null) {
      throw new Error(`no editable for ${blockId}`);
    }
    editable.setAttribute('contenteditable', 'true');
    editable.focus();
    editable.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
    editable.textContent = text;
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    await sleep(50);
  };

  const textOf = (output: OutputData, id: string): string => {
    const block = output.blocks.find(b => b.id === id);

    return (block?.data as { text?: string } | undefined)?.text ?? '<missing>';
  };

  it('redo of a merge re-applies it with the same block ids, no duplicates, DOM matching data', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());

    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    const merged = savedAsHtml(await editor.save());
    const mergedDom = domShape();

    editor.history.undo();
    await sleep(300);
    editor.history.redo();
    await sleep(300);

    const redone = savedAsHtml(await editor.save());

    expect(contentOf(redone)).toEqual(contentOf(merged));
    expect(blockIdsSorted(redone)).toEqual(blockIdsSorted(before));
    expect(domShape()).toEqual(mergedDom);
    expect(mergedDom.spans).toEqual(['0,0:2x2']);
    expect(hasMerge(redone)).toBe(true);
  }, 90_000);

  it('undo of a merge restores scrubbed color / textColor / placement of absorbed cells and origin placement', async () => {
    const styled: LegacyCellContent[][] = [
      [{ blocks: ['a'], placement: 'middle-center', color: '#ff0000' }, { blocks: ['b'], color: '#0000ff', textColor: '#00ff00' }],
      [{ blocks: ['c'], placement: 'bottom-right' }, { blocks: ['d'], textColor: '#ffa500' }],
    ];
    const editor = await boot(buildDoc(styled, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());
    const paint = (): string[] => Array.from(holder.querySelectorAll<HTMLElement>('[data-blok-table-cell]'))
      .map(el => `${el.getAttribute('data-blok-table-cell-row') ?? ''},${el.getAttribute('data-blok-table-cell-col') ?? ''}:${el.style.backgroundColor}|${el.style.color}|${el.querySelector('[data-blok-cell-placement]')?.getAttribute('data-blok-cell-placement') ?? ''}`);
    const paintBefore = paint();

    expect(contentOf(before)[0][1].color).toBe('#0000ff');

    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    const merged = contentOf(savedAsHtml(await editor.save()));

    expect(merged[0][1].color).toBeUndefined();
    expect(merged[0][0].placement).toBeUndefined();

    editor.history.undo();
    await sleep(300);

    expect(contentOf(savedAsHtml(await editor.save()))).toEqual(contentOf(before));
    const td = (r: number, c: number): HTMLElement | null => holder.querySelector<HTMLElement>(
      `[data-blok-table-cell-row="${r}"][data-blok-table-cell-col="${c}"]`
    );

    expect(td(0, 1)).not.toBeNull();
    expect(paint()).toEqual(paintBefore);
  }, 90_000);

  const MERGED_ROW0: LegacyCellContent[][] = [
    [{ blocks: ['a', 'b'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
    [{ blocks: ['c'] }, { blocks: ['d'] }],
  ];

  it('split then undo: the revealed-cell paragraph split created is removed again', async () => {
    const editor = await boot(buildDoc(MERGED_ROW0, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());
    const countBefore = editor.blocks.getBlocksCount();

    expect(domShape().spans).toEqual(['0,0:2x1']);

    split(0, 0);
    await sleep(CAPTURE);
    const splitDom = domShape();

    expect(splitDom.spans).toEqual([]);
    expect(splitDom.holders['0,1']).toHaveLength(1);
    expect(editor.blocks.getBlocksCount()).toBe(countBefore + 1);

    editor.history.undo();
    await sleep(300);

    // User-visible: the document is back to the merged table. No extra block.
    expect(domShape()).toEqual({ cells: 3, spans: ['0,0:2x1'], holders: { '0,0': ['a', 'b'], '1,0': ['c'], '1,1': ['d'] } });
    expect(editor.blocks.getBlocksCount()).toBe(countBefore);

    const undone = savedAsHtml(await editor.save());

    expect(contentOf(undone)).toEqual(contentOf(before));
    expect(blockIdsSorted(undone)).toEqual(blockIdsSorted(before));
    expect(hasMerge(undone)).toBe(true);
    expect(editor.history.canUndo()).toBe(false);
  }, 90_000);

  it('split then undo then redo: split comes back with exactly one paragraph in the revealed cell', async () => {
    const editor = await boot(buildDoc(MERGED_ROW0, TEXTS_2X2));
    const countBefore = editor.blocks.getBlocksCount();

    split(0, 0);
    await sleep(CAPTURE);
    const splitDom = domShape();

    editor.history.undo();
    await sleep(300);
    editor.history.redo();
    await sleep(300);

    expect(domShape()).toEqual(splitDom);
    expect(editor.blocks.getBlocksCount()).toBe(countBefore + 1);
    await expect(editor.save()).resolves.toBeDefined();
  }, 90_000);

  it('production mode: split then undo leaves no leftover block in the document', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const editor = await boot(buildDoc(MERGED_ROW0, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());

    split(0, 0);
    await sleep(CAPTURE);
    editor.history.undo();
    await sleep(300);

    const undone = savedAsHtml(await editor.save());

    expect(blockIdsSorted(undone)).toEqual(blockIdsSorted(before));
    expect(editor.blocks.getBlocksCount()).toBe(before.blocks.length);
  }, 90_000);

  it('adding a column then merging it: undo + redo shows the merged cell in the same order the merge did', async () => {
    const editor = await boot(buildDoc([[{ blocks: ['a'] }], [{ blocks: ['c'] }]], { a: 'A', c: 'C' }));
    addColumn();
    await sleep(CAPTURE);

    const withCol = contentOf(savedAsHtml(await editor.save()));
    const x = withCol[0][1].blocks[0];
    const y = withCol[1][1].blocks[0];

    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);

    // What the user saw after the merge: row-major.
    expect(domShape().holders['0,0']).toEqual(['a', x, 'c', y]);
    const merged = savedAsHtml(await editor.save());

    expect(contentOf(merged)[0][0].blocks).toEqual(['a', x, 'c', y]);

    editor.history.undo();
    await sleep(300);
    expect(domShape().holders).toEqual({ '0,0': ['a'], '0,1': [x], '1,0': ['c'], '1,1': [y] });

    editor.history.redo();
    await sleep(300);

    expect(domShape().holders['0,0']).toEqual(['a', x, 'c', y]);
    expect(contentOf(savedAsHtml(await editor.save()))).toEqual(contentOf(merged));
  }, 90_000);

  it('reloading the saved result of a merge shows the merged cell in the same order', async () => {
    const editor = await boot(buildDoc([[{ blocks: ['a'] }], [{ blocks: ['c'] }]], { a: 'A', c: 'C' }));
    addColumn();
    await sleep(CAPTURE);
    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);

    const merged = savedAsHtml(await editor.save());
    const seen = domShape().holders['0,0'];

    editor.destroy();
    blok = null;
    await boot(merged);

    expect(domShape().holders['0,0']).toEqual(seen);
  }, 90_000);

  it('merging cells that hold no blocks, then undo: no leftover block', async () => {
    // Loaded merge table (the load completeness sweep skips merge tables).
    const doc: LegacyCellContent[][] = [
      [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [] }, { blocks: [] }],
    ];
    const editor = await boot(buildDoc(doc, { a: 'A' }));
    const before = savedAsHtml(await editor.save());
    const beforeDom = domShape();
    const countBefore = editor.blocks.getBlocksCount();

    merge({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    expect(domShape().spans).toEqual(['0,0:2x1', '1,0:2x1']);

    editor.history.undo();
    await sleep(300);

    expect(domShape()).toEqual(beforeDom);
    expect(editor.blocks.getBlocksCount()).toBe(countBefore);
    const undone = savedAsHtml(await editor.save());

    expect(blockIdsSorted(undone)).toEqual(blockIdsSorted(before));
  }, 90_000);

  it('merge over an existing merge: undo returns to the earlier merge', async () => {
    const editor = await boot(buildDoc(MERGED_ROW0, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());
    const beforeDom = domShape();

    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    expect(domShape().spans).toEqual(['0,0:2x2']);

    editor.history.undo();
    await sleep(300);
    expect(contentOf(savedAsHtml(await editor.save()))).toEqual(contentOf(before));
    expect(domShape()).toEqual(beforeDom);

    editor.history.redo();
    await sleep(300);
    expect(domShape().spans).toEqual(['0,0:2x2']);
    expect(blockIdsSorted(savedAsHtml(await editor.save()))).toEqual(blockIdsSorted(before));
  }, 90_000);

  it('merge, type in origin, undo twice: text then merge revert, in that order', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());

    merge({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    const merged = savedAsHtml(await editor.save());

    await typeInto('a', 'A typed');
    await sleep(CAPTURE);
    expect(textOf(savedAsHtml(await editor.save()), 'a')).toBe('A typed');

    editor.history.undo();
    await sleep(300);
    const once = savedAsHtml(await editor.save());

    expect(textOf(once, 'a')).toBe('A');
    expect(contentOf(once)).toEqual(contentOf(merged));

    editor.history.undo();
    await sleep(300);
    const twice = savedAsHtml(await editor.save());

    expect(contentOf(twice)).toEqual(contentOf(before));
    expect(domShape().spans).toEqual([]);
    expect(domShape().holders).toEqual({ '0,0': ['a'], '0,1': ['b'], '1,0': ['c'], '1,1': ['d'] });
  }, 90_000);

  it('merge, type in origin within the capture window, undo, undo: reaches the unmerged original', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());

    merge({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await typeInto('a', 'A typed');
    await sleep(CAPTURE);

    editor.history.undo();
    await sleep(300);
    editor.history.undo();
    await sleep(300);
    const after = savedAsHtml(await editor.save());

    expect(contentOf(after)).toEqual(contentOf(before));
    expect(textOf(after, 'a')).toBe('A');
    expect(domShape().spans).toEqual([]);
  }, 90_000);

  it('merge, undo, new edit: redo stack is cleared (redo does not re-merge)', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));

    merge({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    editor.history.undo();
    await sleep(300);

    await typeInto('c', 'C typed');
    await sleep(CAPTURE);
    const afterEdit = savedAsHtml(await editor.save());

    editor.history.redo();
    await sleep(300);
    const afterRedo = savedAsHtml(await editor.save());

    expect(contentOf(afterRedo)).toEqual(contentOf(afterEdit));
    expect(textOf(afterRedo, 'c')).toBe('C typed');
    expect(domShape().spans).toEqual([]);
  }, 90_000);

  it('two separate merges: one undo reverts only the second', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));

    merge({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    const afterFirst = savedAsHtml(await editor.save());

    merge({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    expect(domShape().spans).toEqual(['0,0:2x1', '1,0:2x1']);

    editor.history.undo();
    await sleep(300);

    expect(contentOf(savedAsHtml(await editor.save()))).toEqual(contentOf(afterFirst));
    expect(domShape().spans).toEqual(['0,0:2x1']);
    expect(domShape().holders).toEqual({ '0,0': ['a', 'b'], '1,0': ['c'], '1,1': ['d'] });
  }, 90_000);

  it('multi-block cells keep their order through merge undo / redo', async () => {
    const multi: LegacyCellContent[][] = [
      [{ blocks: ['a', 'a2'] }, { blocks: ['b', 'b2'] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }],
    ];
    const editor = await boot(buildDoc(multi, { ...TEXTS_2X2, a2: 'A2', b2: 'B2' }));
    const before = savedAsHtml(await editor.save());

    merge({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    expect(domShape().holders['0,0']).toEqual(['a', 'a2', 'b', 'b2']);

    editor.history.undo();
    await sleep(300);
    expect(contentOf(savedAsHtml(await editor.save()))).toEqual(contentOf(before));
    expect(domShape().holders).toEqual({ '0,0': ['a', 'a2'], '0,1': ['b', 'b2'], '1,0': ['c'], '1,1': ['d'] });
    expect(before.blocks.map(b => b.id)).toEqual((savedAsHtml(await editor.save())).blocks.map(b => b.id));

    editor.history.redo();
    await sleep(300);
    const redone = savedAsHtml(await editor.save());

    expect(contentOf(redone)[0][0].blocks).toEqual(['a', 'a2', 'b', 'b2']);
    expect(domShape().holders['0,0']).toEqual(['a', 'a2', 'b', 'b2']);
  }, 90_000);

  it('merge -> undo -> redo -> undo cycles converge (no ghost blocks)', async () => {
    const editor = await boot(buildDoc(FLAT_2X2, TEXTS_2X2));
    const before = savedAsHtml(await editor.save());

    merge({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await sleep(CAPTURE);
    for (let i = 0; i < 3; i++) {
      editor.history.undo();
      await sleep(200);
      editor.history.redo();
      await sleep(200);
    }
    editor.history.undo();
    await sleep(300);
    const after = savedAsHtml(await editor.save());

    expect(blockIdsSorted(after)).toEqual(blockIdsSorted(before));
    expect(contentOf(after)).toEqual(contentOf(before));
    expect(domShape().holders).toEqual({ '0,0': ['a'], '0,1': ['b'], '1,0': ['c'], '1,1': ['d'] });
    expect(hasMerge(after)).toBe(false);
  }, 90_000);
});
