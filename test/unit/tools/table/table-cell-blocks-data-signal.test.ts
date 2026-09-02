import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CELL_BLOCKS_ATTR, TableCellBlocks } from '../../../../src/tools/table/table-cell-blocks';
import type { TableModel } from '../../../../src/tools/table/table-model';
import type { API } from '../../../../types';

/**
 * Dropping a cell reference is the ONE table data change that no block event
 * announces: `onParentChanged` fires only when a block GAINS a parent, so a
 * removal (or a move out of the grid) leaves the table's `cell.blocks` array
 * stale. It used to ride the cell container's childList mutation, but that
 * container is now `data-blok-mutation-free` (a remote peer's presence label
 * inside a cell must not score a table edit), so the signal has to be explicit.
 */
const createMockModel = (): TableModel => ({
  findCellForBlock: vi.fn(() => null),
  removeBlockFromCell: vi.fn(),
  addBlockToCell: vi.fn(),
  getCellBlocks: vi.fn(() => []),
  snapshot: vi.fn(),
  rows: 1,
  cols: 1,
} as unknown as TableModel);

/** The 'block changed' listener TableCellBlocks registers on the events API. */
const blockChangedHandler = (eventsOn: ReturnType<typeof vi.fn>): (data: unknown) => void => {
  const call = eventsOn.mock.calls.find((entry: unknown[]) => entry[0] === 'block changed');

  if (!call) {
    throw new Error('block changed handler not registered');
  }

  return call[1] as (data: unknown) => void;
};

describe('TableCellBlocks — signalling a table data change on cell-block removal', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const setup = (): {
    handler: (data: unknown) => void;
    dispatchChange: ReturnType<typeof vi.fn>;
    destroy: () => void;
  } => {
    const grid = document.createElement('div');
    const row = document.createElement('div');
    const cell = document.createElement('div');
    const container = document.createElement('div');
    const holder = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');
    cell.setAttribute('data-blok-table-cell', '');
    cell.setAttribute('data-blok-table-cell-row', '0');
    cell.setAttribute('data-blok-table-cell-col', '0');
    container.setAttribute(CELL_BLOCKS_ATTR, '');
    holder.setAttribute('data-blok-id', 'cell-block');

    container.appendChild(holder);
    cell.appendChild(container);
    row.appendChild(cell);
    grid.appendChild(row);

    const eventsApi = { on: vi.fn(), off: vi.fn() };
    const dispatchChange = vi.fn();
    const api = {
      blocks: {
        insert: vi.fn(),
        getBlockIndex: vi.fn(() => undefined),
        getBlockByIndex: vi.fn(() => undefined),
        getCurrentBlockIndex: vi.fn().mockReturnValue(-1),
        getBlocksCount: vi.fn().mockReturnValue(2),
        setBlockParent: vi.fn(),
      },
      events: eventsApi,
    } as unknown as API;

    const model = createMockModel();

    vi.mocked(model.findCellForBlock).mockImplementation((blockId: string) =>
      blockId === 'cell-block' ? { row: 0, col: 0 } : null
    );

    const instance = new TableCellBlocks({
      api,
      gridElement: grid,
      tableBlockId: 'table-1',
      model,
      // What the Table tool wires here is `this.block?.dispatchChange()`.
      onCellReferenceDropped: dispatchChange,
    });

    return {
      handler: blockChangedHandler(eventsApi.on),
      dispatchChange,
      destroy: () => instance.destroy(),
    };
  };

  it('dispatches a table change when a tracked cell block is removed', async () => {
    const { handler, dispatchChange, destroy } = setup();

    handler({
      event: { type: 'block-removed', detail: { target: { id: 'cell-block', holder: document.createElement('div') }, index: 1 } },
    });

    expect(dispatchChange).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    destroy();
  });

  it('dispatches a table change when a tracked cell block moves out of the grid', async () => {
    const { handler, dispatchChange, destroy } = setup();

    handler({
      event: { type: 'block-moved', detail: { target: { id: 'cell-block', holder: document.createElement('div') } } },
    });

    expect(dispatchChange).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    destroy();
  });

  it('stays quiet for a block this table never tracked', async () => {
    const { handler, dispatchChange, destroy } = setup();

    handler({
      event: { type: 'block-removed', detail: { target: { id: 'foreign', holder: document.createElement('div') }, index: 1 } },
    });

    expect(dispatchChange).not.toHaveBeenCalled();

    await Promise.resolve();
    destroy();
  });
});
