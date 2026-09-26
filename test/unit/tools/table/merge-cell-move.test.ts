/**
 * Moving a block inside one table cell, through every user path: keyboard
 * (Cmd/Ctrl+Shift+Up/Down), blocks.moveTo, blocks.move and a drag drop. The
 * DOM, the table model and save() must agree on the new order, undo must
 * restore the old one and redo must re-apply the move.
 *
 * The merged-cell cases use a merge over a merge: the origin cell holds
 * c00,c01,c10,c11,c21,c20, an order no index move of the original row-major
 * flat array gives, with other cells' blocks after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { TableConfig, TableData } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../types';

interface Range { minRow: number; maxRow: number; minCol: number; maxCol: number }

interface GridCell { blocks: string[]; mergedInto?: [number, number] }

interface MovableBlock { id: string }

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: {
      blocks: MovableBlock[];
      currentBlockIndex: number;
      moveCurrentBlockUp: () => void;
      moveCurrentBlockDown: () => void;
    };
    yjsManager: { stopCapturing: () => void };
    blockSelection: { clearSelection: () => void };
    dragManager: {
      lazyInit: () => void;
      handleDrop: (source: MovableBlock, sources: MovableBlock[], target: MovableBlock, edge: 'top' | 'bottom') => void;
    };
  };
}

interface Layers { dom: string[]; model: string[]; saved: string[] }

interface MoveCase { name: string; act: (instance: TestEditor) => void; expected: string[] }

const tables = new Map<string, Table>();

class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

const liveTable = (): Table => {
  const table = tables.get('tbl');

  if (table === undefined) {
    throw new Error('no table');
  }

  return table;
};

const merge = (range: Range): void => {
  const selection = (liveTable() as unknown as { subsystems: { cellSelectionSubsystem: { onMergeCells?: (r: Range) => void } | null } })
    .subsystems.cellSelectionSubsystem;

  if (selection?.onMergeCells === undefined) {
    throw new Error('no merge callback');
  }
  selection.onMergeCells(range);
};

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const P = (id: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id }, parent: 'tbl' });

const tableDoc = (cells: string[][][]): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: cells.map(row => row.map(blocks => ({ blocks }))) },
    content: cells.flat(2),
  },
  ...cells.flat(2).map(P),
];

let holder: HTMLDivElement;
let editor: TestEditor | null = null;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: TrackedTable }, data: { blocks } }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Merge column 1 rows 1-2, then rows 0-2 × cols 0-1: origin order is c00,c01,c10,c11,c21,c20. */
const bootMerged = async (): Promise<TestEditor> => {
  const instance = await boot(tableDoc(Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (__, c) => [`c${r}${c}`]))));

  merge({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 1 });
  await settle();
  merge({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 });
  await settle();

  return instance;
};

const MERGED = ['c00', 'c01', 'c10', 'c11', 'c21', 'c20'];

/** A 1×2 table: cell (0,0) holds x,y,z and cell (0,1) holds w. */
const bootPlain = (): Promise<TestEditor> => boot(tableDoc([[['x', 'y', 'z'], ['w']]]));

const PLAIN = ['x', 'y', 'z'];

/** DOM, model and save() of cell (0,0). */
const layers = async (instance: TestEditor): Promise<Layers> => {
  const container = holder.querySelector('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-table-cell-blocks]');
  const model = (liveTable() as unknown as { model: { snapshot: () => { content: GridCell[][] } } }).model.snapshot().content;
  const saved = (await instance.save()).blocks.find(block => block.id === 'tbl')?.data.content as GridCell[][];

  return {
    dom: Array.from(container?.children ?? []).map(child => child.getAttribute('data-blok-id') ?? '').filter(id => id !== ''),
    model: model[0][0].blocks,
    saved: saved[0][0].blocks,
  };
};

const same = (order: string[]): Layers => ({ dom: order, model: order, saved: order });

const keyboard = (instance: TestEditor, id: string, direction: 'up' | 'down'): void => {
  const manager = instance.module.blockManager;

  // A merge leaves the origin's first block selected, and a selection moves
  // instead of the caret block. Clicking into the block clears it.
  instance.module.blockSelection.clearSelection();
  manager.currentBlockIndex = manager.blocks.findIndex(block => block.id === id);
  if (direction === 'up') {
    manager.moveCurrentBlockUp();
  } else {
    manager.moveCurrentBlockDown();
  }
};

/** The drop a pointer release makes once the detector has picked a target and edge. */
const drag = (instance: TestEditor, sourceId: string, targetId: string, edge: 'top' | 'bottom'): void => {
  const { blockManager, dragManager } = instance.module;
  const find = (id: string): MovableBlock => {
    const block = blockManager.blocks.find(candidate => candidate.id === id);

    if (block === undefined) {
      throw new Error(`no block ${id}`);
    }

    return block;
  };
  const source = find(sourceId);

  dragManager.lazyInit();
  dragManager.handleDrop(source, [source], find(targetId), edge);
};

const flatMove = (instance: TestEditor, id: string, onto: string): void => {
  const at = (blockId: string): number => instance.blocks.getBlockIndex(blockId) ?? -1;

  instance.blocks.move(at(onto), at(id));
};

const expectMove = async (instance: TestEditor, before: string[], { act, expected }: MoveCase): Promise<void> => {
  instance.module.yjsManager.stopCapturing();
  expect(await layers(instance)).toEqual(same(before));

  act(instance);
  await settle();

  expect(await layers(instance), 'after the move').toEqual(same(expected));
};

const expectMoveUndoRedo = async (instance: TestEditor, before: string[], move: MoveCase): Promise<void> => {
  await expectMove(instance, before, move);

  instance.module.yjsManager.stopCapturing();
  instance.history.undo();
  await settle();

  expect.soft(await layers(instance), 'after undo').toEqual(same(before));

  instance.history.redo();
  await settle();

  expect.soft(await layers(instance), 'after redo').toEqual(same(move.expected));
};

const PLAIN_MOVES: MoveCase[] = [
  { name: 'keyboard move up', act: instance => keyboard(instance, 'z', 'up'), expected: ['x', 'z', 'y'] },
  { name: 'keyboard move down', act: instance => keyboard(instance, 'x', 'down'), expected: ['y', 'x', 'z'] },
  { name: 'blocks.moveTo before', act: instance => instance.blocks.moveTo('z', { position: { before: 'x' } }), expected: ['z', 'x', 'y'] },
  { name: 'blocks.moveTo after', act: instance => instance.blocks.moveTo('x', { position: { after: 'z' } }), expected: ['y', 'z', 'x'] },
  { name: 'blocks.move', act: instance => flatMove(instance, 'z', 'x'), expected: ['z', 'x', 'y'] },
];

const PLAIN_DRAGS: MoveCase[] = [
  { name: 'drag above the first block', act: instance => drag(instance, 'z', 'x', 'top'), expected: ['z', 'x', 'y'] },
  { name: 'drag below the last block', act: instance => drag(instance, 'x', 'z', 'bottom'), expected: ['y', 'z', 'x'] },
];

const MERGED_MOVES: MoveCase[] = [
  { name: 'keyboard move up of a block whose flat predecessor is in another cell', act: instance => keyboard(instance, 'c10', 'up'), expected: ['c00', 'c10', 'c01', 'c11', 'c21', 'c20'] },
  { name: 'keyboard move up of the last block', act: instance => keyboard(instance, 'c20', 'up'), expected: ['c00', 'c01', 'c10', 'c11', 'c20', 'c21'] },
  { name: 'keyboard move down of the last-but-one block', act: instance => keyboard(instance, 'c21', 'down'), expected: ['c00', 'c01', 'c10', 'c11', 'c20', 'c21'] },
  { name: 'keyboard move down of a block whose flat successor is in another cell', act: instance => keyboard(instance, 'c11', 'down'), expected: ['c00', 'c01', 'c10', 'c21', 'c11', 'c20'] },
  { name: 'blocks.moveTo before c11', act: instance => instance.blocks.moveTo('c20', { parentId: 'tbl', position: { before: 'c11' } }), expected: ['c00', 'c01', 'c10', 'c20', 'c11', 'c21'] },
  { name: 'blocks.moveTo before c21', act: instance => instance.blocks.moveTo('c10', { parentId: 'tbl', position: { before: 'c21' } }), expected: ['c00', 'c01', 'c11', 'c10', 'c21', 'c20'] },
  { name: 'blocks.moveTo before c20', act: instance => instance.blocks.moveTo('c10', { parentId: 'tbl', position: { before: 'c20' } }), expected: ['c00', 'c01', 'c11', 'c21', 'c10', 'c20'] },
  { name: 'blocks.moveTo after c21', act: instance => instance.blocks.moveTo('c10', { parentId: 'tbl', position: { after: 'c21' } }), expected: ['c00', 'c01', 'c11', 'c21', 'c10', 'c20'] },
  { name: 'blocks.moveTo after c20', act: instance => instance.blocks.moveTo('c11', { parentId: 'tbl', position: { after: 'c20' } }), expected: ['c00', 'c01', 'c10', 'c21', 'c20', 'c11'] },
  { name: 'blocks.move onto another block of the cell', act: instance => flatMove(instance, 'c20', 'c11'), expected: ['c00', 'c01', 'c10', 'c20', 'c11', 'c21'] },
];

const MERGED_DRAGS: MoveCase[] = [
  { name: 'drag below c21', act: instance => drag(instance, 'c10', 'c21', 'bottom'), expected: ['c00', 'c01', 'c11', 'c21', 'c10', 'c20'] },
  { name: 'drag above c21', act: instance => drag(instance, 'c20', 'c21', 'top'), expected: ['c00', 'c01', 'c10', 'c11', 'c20', 'c21'] },
  { name: 'drag below c20', act: instance => drag(instance, 'c21', 'c20', 'bottom'), expected: ['c00', 'c01', 'c10', 'c11', 'c20', 'c21'] },
];

describe('moving a block inside one table cell', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  describe('a plain cell', () => {
    it.each(PLAIN_MOVES)('$name', async (move) => {
      await expectMove(await bootPlain(), PLAIN, move);
    });

    // Two undo steps: the move entry, then the tracked table-data write the
    // parent sync makes after it. Undo pops the data write and the table
    // saves the DOM order back.
    it.fails.each(PLAIN_MOVES)('$name, then undo and redo', async (move) => {
      await expectMoveUndoRedo(await bootPlain(), PLAIN, move);
    });

    // A drop inside the cell moves the holder and save() but leaves the
    // table model at the old order.
    it.fails.each(PLAIN_DRAGS)('$name', async (move) => {
      await expectMoveUndoRedo(await bootPlain(), PLAIN, move);
    });
  });

  describe('a merged cell whose order differs from the original flat order', () => {
    it.each(MERGED_MOVES)('$name', async (move) => {
      await expectMove(await bootMerged(), MERGED, move);
    });

    // Same two-step undo as the plain cell.
    it.fails.each(MERGED_MOVES)('$name, then undo and redo', async (move) => {
      await expectMoveUndoRedo(await bootMerged(), MERGED, move);
    });

    // Same stale table model as the plain-cell drop.
    it.fails.each(MERGED_DRAGS)('$name', async (move) => {
      await expectMoveUndoRedo(await bootMerged(), MERGED, move);
    });
  });
});
