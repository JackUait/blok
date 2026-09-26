/**
 * Merge and split driven through a real Blok. After each op the four layers
 * must agree: the model grid, the DOM (holders inside each <td>), the block
 * tree (parentId / contentIds) and the saved JSON. A reload of the saved JSON
 * must render the same grid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ListItem } from '../../../../src/tools/list';
import { ToggleItem } from '../../../../src/tools/toggle';
import { validateTreeOrder } from '../../../../src/components/utils/hierarchy-invariant';
import type { TableConfig, TableData } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../types';

interface Range {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

interface SelectionHandle {
  onMergeCells: ((range: Range) => void) | undefined;
  onSplitCell: ((row: number, col: number) => void) | undefined;
}

interface GridCell {
  blocks: string[];
  colspan?: number;
  rowspan?: number;
  mergedInto?: [number, number];
}

interface ModelHandle {
  snapshot: () => { content: GridCell[][] };
}

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const tables = new Map<string, Table>();

/** Records every live Table by block id so the test can reach its subsystems. */
class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

const tableOf = (id: string): Table => {
  const table = tables.get(id);

  if (table === undefined) {
    throw new Error(`no table ${id}`);
  }

  return table;
};

const selectionOf = (id: string): SelectionHandle => {
  const selection = (tableOf(id) as unknown as { subsystems: { cellSelectionSubsystem: SelectionHandle | null } })
    .subsystems.cellSelectionSubsystem;

  if (selection === null) {
    throw new Error('no cell selection');
  }

  return selection;
};

const modelOf = (id: string): ModelHandle => (tableOf(id) as unknown as { model: ModelHandle }).model;

let editors: TestEditor[] = [];
let holders: HTMLDivElement[] = [];

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const boot = async (blocks: OutputBlockData[]): Promise<{ instance: TestEditor; root: HTMLDivElement }> => {
  const root = document.createElement('div');

  document.body.appendChild(root);
  holders.push(root);

  const instance = new Blok({
    holder: root,
    tools: { paragraph: Paragraph, list: ListItem, toggle: ToggleItem, table: TrackedTable },
    data: { blocks },
  }) as unknown as TestEditor;

  editors.push(instance);
  await instance.isReady;
  await settle();

  return { instance, root };
};

/** Run the production merge callback (the one the "Merge cells" menu item calls). */
const merge = async (tableId: string, range: Range): Promise<void> => {
  const fn = selectionOf(tableId).onMergeCells;

  if (fn === undefined) {
    throw new Error('no merge callback');
  }
  fn(range);
  await settle();
};

const split = async (tableId: string, row: number, col: number): Promise<void> => {
  const fn = selectionOf(tableId).onSplitCell;

  if (fn === undefined) {
    throw new Error('no split callback');
  }
  fn(row, col);
  await settle();
};

const P = (id: string, parent = 'tbl'): OutputBlockData => ({ id, type: 'paragraph', data: { text: id }, parent });

const gridTable = (rows: number, cols: number, cellIds: string[][][]): OutputBlockData => ({
  id: 'tbl',
  type: 'table',
  data: {
    withHeadings: false,
    content: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => ({ blocks: cellIds[r][c] }))),
  },
  content: cellIds.flat(2),
});

/** A rows × cols table whose cell (r,c) holds one paragraph `c<r><c>`. */
const plainTable = (rows: number, cols: number): OutputBlockData[] => {
  const ids = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => [`c${r}${c}`]));

  return [gridTable(rows, cols, ids), ...ids.flat(2).map(id => P(id)), P('after', '')].map(block =>
    block.parent === '' ? { id: block.id, type: block.type, data: block.data } : block
  );
};

/** DOM view: for every rendered <td>, its coords, spans and direct holder ids. */
const domGrid = (root: HTMLElement): Array<{ at: string; colspan: number; rowspan: number; blocks: string[] }> =>
  Array.from(root.querySelectorAll<HTMLTableCellElement>('[data-blok-table-cell]')).map(td => {
    const container = td.querySelector('[data-blok-table-cell-blocks]');

    return {
      at: `${td.getAttribute('data-blok-table-cell-row')},${td.getAttribute('data-blok-table-cell-col')}`,
      colspan: td.colSpan,
      rowspan: td.rowSpan,
      blocks: Array.from(container?.children ?? [])
        .map(child => child.getAttribute('data-blok-id') ?? '')
        .filter(id => id !== ''),
    };
  });

/** Same view built from a grid (model snapshot or saved content). */
const gridView = (content: GridCell[][]): Array<{ at: string; colspan: number; rowspan: number; blocks: string[] }> =>
  content.flatMap((row, r) => row.flatMap((cell, c) => cell.mergedInto !== undefined
    ? []
    : [{ at: `${r},${c}`, colspan: cell.colspan ?? 1, rowspan: cell.rowspan ?? 1, blocks: cell.blocks }]));

const isGrid = (value: unknown): value is GridCell[][] =>
  Array.isArray(value) && value.every(row => Array.isArray(row));

const savedGrid = (saved: OutputData): GridCell[][] => {
  const table = saved.blocks.find(block => block.id === 'tbl');
  const grid: unknown = table?.data.content;

  if (!isGrid(grid)) {
    throw new Error('no saved grid');
  }

  return grid;
};

const liveBlocks = (instance: TestEditor): Array<{ id: string; name: string; parentId: string | null; contentIds: readonly string[] }> =>
  Array.from({ length: instance.blocks.getBlocksCount() }, (_, index) => {
    const block = instance.blocks.getBlockByIndex(index);

    if (block === undefined) {
      throw new Error(`no block at ${index}`);
    }

    return { id: block.id, name: block.name, parentId: block.parentId, contentIds: block.contentIds };
  });

/**
 * Checks that model, DOM, block tree and saved JSON agree, and that a reload
 * of the saved JSON renders the same grid. Returns the saved grid view.
 */
const expectLayersAgree = async (instance: TestEditor, root: HTMLElement): Promise<ReturnType<typeof gridView>> => {
  const model = gridView(modelOf('tbl').snapshot().content);
  const dom = domGrid(root);

  // 1. DOM mirrors the model.
  expect.soft(dom).toEqual(model);

  // 2. save() equals the model.
  const saved = await instance.save();
  const savedView = gridView(savedGrid(saved));

  expect.soft(savedView).toEqual(model);

  // 3. Block tree: every cell block names the table; the flat order and
  // contentIds list the grid ids row-major, as keyboard moves and reload read them.
  const gridIds = savedGrid(saved).flat().flatMap(cell => cell.blocks);

  for (const id of gridIds) {
    expect.soft({ id, parent: instance.blocks.getById(id)?.parentId }).toEqual({ id, parent: 'tbl' });
  }
  expect.soft(instance.blocks.getChildren('tbl').map(child => child.id), 'flat order is grid order').toEqual(gridIds);
  expect.soft(instance.blocks.getById('tbl')?.contentIds, 'live contentIds are in grid order').toEqual(gridIds);
  expect.soft(saved.blocks.find(block => block.id === 'tbl')?.content, 'saved content is in grid order').toEqual(gridIds);
  expect.soft(validateTreeOrder(liveBlocks(instance)).map(v => v.message)).toEqual([]);

  // 4. Reload renders the same grid. The reload registers its own 'tbl';
  // put the live one back so later merges hit the editor under test.
  const live = tableOf('tbl');
  const reloaded = await boot(saved.blocks);

  tables.set('tbl', live);
  expect.soft(domGrid(reloaded.root)).toEqual(model);

  return savedView;
};

describe('merge/split keep model, DOM, block tree and saved data in agreement', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
  });

  afterEach(() => {
    editors.forEach(e => e.destroy());
    editors = [];
    holders.forEach(h => h.remove());
    holders = [];
    vi.restoreAllMocks();
  });

  it('horizontal merge of row 0 in a 2x2', async () => {
    const { instance, root } = await boot(plainTable(2, 2));

    await merge('tbl', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    const view = await expectLayersAgree(instance, root);

    expect(view[0]).toEqual({ at: '0,0', colspan: 2, rowspan: 1, blocks: ['c00', 'c01'] });
  });

  it('vertical merge of column 0 in a 2x2', async () => {
    const { instance, root } = await boot(plainTable(2, 2));

    await merge('tbl', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    const view = await expectLayersAgree(instance, root);

    expect(view[0]).toEqual({ at: '0,0', colspan: 1, rowspan: 2, blocks: ['c00', 'c10'] });
  });

  it('2D merge of a 2x2 rect inside a 3x3', async () => {
    const { instance, root } = await boot(plainTable(3, 3));

    await merge('tbl', { minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 });

    const view = await expectLayersAgree(instance, root);

    expect(view.find(cell => cell.at === '1,1')).toEqual({ at: '1,1', colspan: 2, rowspan: 2, blocks: ['c11', 'c12', 'c21', 'c22'] });
  });

  it('merge spanning an entire row, then an entire column over it', async () => {
    const { instance, root } = await boot(plainTable(3, 3));

    await merge('tbl', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });
    await expectLayersAgree(instance, root);

    await merge('tbl', { minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });

    const view = await expectLayersAgree(instance, root);

    expect(view).toEqual([{
      at: '0,0',
      colspan: 3,
      rowspan: 3,
      blocks: ['c00', 'c01', 'c02', 'c10', 'c11', 'c12', 'c20', 'c21', 'c22'],
    }]);
  });

  it('merge over an existing merge (existing merge fully inside the new rect)', async () => {
    const { instance, root } = await boot(plainTable(3, 3));

    await merge('tbl', { minRow: 1, maxRow: 2, minCol: 1, maxCol: 1 });
    await merge('tbl', { minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 });

    const view = await expectLayersAgree(instance, root);

    expect(view.find(cell => cell.at === '0,0')).toEqual({
      at: '0,0', colspan: 2, rowspan: 3, blocks: ['c00', 'c01', 'c10', 'c11', 'c21', 'c20'],
    });
  });

  it('cells with multiple blocks, lists and a toggle with a child', async () => {
    const { instance, root } = await boot([
      gridTable(2, 2, [[['a1', 'a2'], ['l1', 'l2']], [['t1'], ['b1', 'b2']]]),
      P('a1'),
      P('a2'),
      { id: 'l1', type: 'list', data: { text: 'l1', style: 'unordered' }, parent: 'tbl' },
      { id: 'l2', type: 'list', data: { text: 'l2', style: 'ordered' }, parent: 'tbl' },
      { id: 't1', type: 'toggle', data: { text: 't1', isOpen: true }, parent: 'tbl', content: ['tk'] },
      P('tk', 't1'),
      P('b1'),
      P('b2'),
      { id: 'after', type: 'paragraph', data: { text: 'after' } },
    ]);

    await merge('tbl', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    const view = await expectLayersAgree(instance, root);

    expect(view).toEqual([{ at: '0,0', colspan: 2, rowspan: 2, blocks: ['a1', 'a2', 'l1', 'l2', 't1', 'b1', 'b2'] }]);
    // The toggle's child stays inside the toggle, not flattened into the cell.
    expect(root.querySelector('[data-blok-id="tk"]')?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('t1');
    expect(instance.blocks.getById('tk')?.parentId).toBe('t1');
  });

  it('split then save: every freed cell gets an editable block that the model and the tree know', async () => {
    const { instance, root } = await boot(plainTable(2, 2));

    await merge('tbl', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await split('tbl', 0, 0);

    const view = await expectLayersAgree(instance, root);

    expect(view.map(cell => cell.at)).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(view[0].blocks).toEqual(['c00', 'c01', 'c10', 'c11']);

    for (const cell of view.slice(1)) {
      expect(cell.blocks).toHaveLength(1);
      expect(instance.blocks.getById(cell.blocks[0])?.name).toBe('paragraph');
    }
  });

  it('merge → split → merge', async () => {
    const { instance, root } = await boot(plainTable(2, 2));

    await merge('tbl', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await split('tbl', 0, 0);
    await expectLayersAgree(instance, root);

    await merge('tbl', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    const view = await expectLayersAgree(instance, root);

    expect(view).toHaveLength(1);
    expect(view[0].colspan).toBe(2);
    expect(view[0].rowspan).toBe(2);
  });

  it('reports what the origin holds when absorbed cells are empty paragraphs', async () => {
    const { instance, root } = await boot([
      gridTable(1, 3, [[['x'], ['e1'], ['e2']]]),
      P('x'),
      { id: 'e1', type: 'paragraph', data: { text: '' }, parent: 'tbl' },
      { id: 'e2', type: 'paragraph', data: { text: '' }, parent: 'tbl' },
    ]);

    await merge('tbl', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });

    const view = await expectLayersAgree(instance, root);

    // Fact pin (UX question, not a verdict): empty absorbed paragraphs are kept.
    expect(view[0].blocks).toEqual(['x', 'e1', 'e2']);
  });
});

/** Block ids inside the origin <td> at (r,c), in DOM order. */
const cellHolderIds = (root: HTMLElement, row: number, col: number): string[] =>
  domGrid(root).find(cell => cell.at === `${row},${col}`)?.blocks ?? [];

describe('a merged cell keeps its block order through reparent, reload and re-save', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
  });

  afterEach(() => {
    editors.forEach(e => e.destroy());
    editors = [];
    holders.forEach(h => h.remove());
    holders = [];
    vi.restoreAllMocks();
  });

  /** Merge column 1 rows 1-2, then rows 0-2 × cols 0-1: origin order is c00,c01,c10,c11,c21,c20. */
  const mergeOverMerge = async (): Promise<{ instance: TestEditor; root: HTMLDivElement }> => {
    const booted = await boot(plainTable(3, 3));

    await merge('tbl', { minRow: 1, maxRow: 2, minCol: 1, maxCol: 1 });
    await merge('tbl', { minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 });

    return booted;
  };

  const expected = ['c00', 'c01', 'c10', 'c11', 'c21', 'c20'];

  it('a same-parent setBlockParent on a merged-cell block does not reorder the cell (live session)', async () => {
    const { instance, root } = await mergeOverMerge();

    expect(cellHolderIds(root, 0, 0)).toEqual(expected);

    instance.blocks.setBlockParent('c20', 'tbl');
    await settle();

    expect(cellHolderIds(root, 0, 0)).toEqual(expected);
  });

  it('merge over a merge: reload shows the cell in the saved order, and a re-save keeps it', async () => {
    const { instance } = await mergeOverMerge();
    const saved = await instance.save();

    expect(savedGrid(saved)[0][0].blocks).toEqual(expected);

    const reloaded = await boot(saved.blocks);

    expect.soft(cellHolderIds(reloaded.root, 0, 0), 'reloaded DOM').toEqual(expected);

    const resaved = await reloaded.instance.save();

    expect.soft(savedGrid(resaved)[0][0].blocks, 're-saved grid').toEqual(expected);
  });

  it('merge → split → merge: the block created in the freed cell keeps its place after reload and re-save', async () => {
    const { instance, root } = await boot(plainTable(2, 2));

    await merge('tbl', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    await split('tbl', 0, 0);

    const freed = cellHolderIds(root, 0, 1);

    expect(freed).toHaveLength(1);

    await merge('tbl', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    const order = ['c00', 'c01', freed[0], 'c10', 'c11'];

    expect(cellHolderIds(root, 0, 0)).toEqual(order);

    const saved = await instance.save();

    expect(savedGrid(saved)[0][0].blocks).toEqual(order);

    const reloaded = await boot(saved.blocks);

    expect.soft(cellHolderIds(reloaded.root, 0, 0), 'reloaded DOM').toEqual(order);
    expect.soft(savedGrid(await reloaded.instance.save())[0][0].blocks, 're-saved grid').toEqual(order);
  });

  it('insert a row above, then merge column 0 vertically: reload keeps the new row\'s block first', async () => {
    const { instance, root } = await boot(plainTable(2, 2));
    const table = tableOf('tbl');
    const gridEl = (table as unknown as { gridElement: HTMLElement | null }).gridElement;

    if (gridEl === null) {
      throw new Error('no grid');
    }
    (table as unknown as { subsystems: { handleRowColAction: (g: HTMLElement, a: unknown) => void } })
      .subsystems.handleRowColAction(gridEl, { type: 'insert-row-above', index: 0 });
    await settle();

    const added = cellHolderIds(root, 0, 0);

    expect(added).toHaveLength(1);

    await merge('tbl', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    const order = [added[0], 'c00'];

    expect(cellHolderIds(root, 0, 0)).toEqual(order);

    const saved = await instance.save();

    expect(savedGrid(saved)[0][0].blocks).toEqual(order);

    const reloaded = await boot(saved.blocks);

    expect.soft(cellHolderIds(reloaded.root, 0, 0), 'reloaded DOM').toEqual(order);
    expect.soft(savedGrid(await reloaded.instance.save())[0][0].blocks, 're-saved grid').toEqual(order);
  });
});
