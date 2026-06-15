import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableGrid, CELL_ATTR, CELL_COL_ATTR, CELL_ROW_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { TableCellBlocks, CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Regression for H1/H2: a block added to a cell that sits AFTER a merge must
 * sync to the correct LOGICAL model column, not the physical <td> index.
 *
 * Before the fix, syncBlockToModel used cells.indexOf(cell) (physical), which
 * in a merge-touched row points at a spanned coordinate. addBlockToCell then
 * silently no-ops on the spanned cell and the block is dropped on save.
 */
describe('TableCellBlocks block sync on merged grids', () => {
  let blockChangedHandler: ((data: unknown) => void) | undefined;
  let instance: TableCellBlocks | undefined;

  const makeApi = () => ({
    events: {
      on: (event: string, handler: (data: unknown) => void) => {
        if (event === 'block changed') {
          blockChangedHandler = handler;
        }
      },
      off: vi.fn(),
    },
    blocks: {
      isSyncingFromYjs: false,
      getBlockIndex: vi.fn(),
      getBlockByIndex: vi.fn(),
    },
  });

  /** Append a fresh block holder into the blocks container of the given cell. */
  const addBlockHolderTo = (cell: HTMLElement, id: string): HTMLElement => {
    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      throw new Error('cell has no blocks container');
    }

    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);
    container.appendChild(holder);

    return holder;
  };

  const emitBlockAdded = (id: string, holder: HTMLElement, index: number): void => {
    blockChangedHandler?.({
      event: { type: 'block-added', detail: { target: { id, holder }, index } },
    });
  };

  const cellAt = (table: HTMLElement, row: number, col: number): HTMLElement => {
    const el = table.querySelector<HTMLElement>(
      `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
    );

    if (!el) {
      throw new Error(`no DOM cell at ${row},${col}`);
    }

    return el;
  };

  const mountModel = (data: TableData): { model: TableModel; table: HTMLElement } => {
    const model = new TableModel(data);
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGridFromModel(model);

    document.body.appendChild(table);

    instance = new TableCellBlocks({
      api: makeApi() as never,
      gridElement: table,
      tableBlockId: 'table-block',
      model,
    });

    return { model, table };
  };

  beforeEach(() => {
    blockChangedHandler = undefined;
    instance = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('routes a block added after a horizontal merge to the correct logical column', () => {
    const { model, table } = mountModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ],
    });

    // logical col 2 = physical index 1 in row 0 (only 2 <td> rendered)
    const targetCell = cellAt(table, 0, 2);
    const holder = addBlockHolderTo(targetCell, 'blk-after-merge');

    emitBlockAdded('blk-after-merge', holder, 0);

    expect(model.getCellBlocks(0, 2)).toEqual(['blk-after-merge']);
    expect(model.findCellForBlock('blk-after-merge')).toEqual({ row: 0, col: 2 });
  });

  it('routes a block added in a row below a rowspan to the correct logical column', () => {
    const { model, table } = mountModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [], rowspan: 2 }, { blocks: [] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      ],
    });

    // logical (1,1) = physical index 0 in row 1 (col 0 covered by rowspan)
    const targetCell = cellAt(table, 1, 1);
    const holder = addBlockHolderTo(targetCell, 'blk-below-merge');

    emitBlockAdded('blk-below-merge', holder, 0);

    expect(model.getCellBlocks(1, 1)).toEqual(['blk-below-merge']);
    expect(model.findCellForBlock('blk-below-merge')).toEqual({ row: 1, col: 1 });
  });

  it('still routes correctly on an unmerged grid', () => {
    const { model, table } = mountModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ],
    });

    const targetCell = cellAt(table, 1, 1);
    const holder = addBlockHolderTo(targetCell, 'blk-plain');

    emitBlockAdded('blk-plain', holder, 0);

    expect(model.getCellBlocks(1, 1)).toEqual(['blk-plain']);
  });
});
