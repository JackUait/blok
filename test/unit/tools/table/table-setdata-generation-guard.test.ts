import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Tests for the setData generation guard.
 *
 * When Yjs undo/redo fires rapidly, re-entrant setData calls can occur
 * (e.g., api.blocks.insert inside initializeCells triggers a Yjs update
 * event that calls setData again). Without a guard, the stale outer setData
 * overwrites the newer call's model state and reinitializes controls on
 * detached DOM elements, causing orphaned blocks and corrupted state.
 *
 * The generation guard increments a counter at the start of each setData.
 * Before and after initializeCells, it checks if the counter is still current.
 * If not (a re-entrant setData ran), the stale call bails out.
 */

const createMockAPI = (overrides: Partial<Record<string, unknown>> = {}): API => {
  const { blocks: blocksOverrides, events: eventsOverrides, ...restOverrides } = overrides;

  return {
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: {
      t: (key: string) => key,
    },
    blocks: {
      delete: vi.fn(),
      insert: vi.fn().mockImplementation(() => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `mock-${Math.random().toString(36).slice(2, 8)}`);

        return { id: `mock-${Math.random().toString(36).slice(2, 8)}`, holder };
      }),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlocksCount: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockReturnValue(undefined),
      setBlockParent: vi.fn(),
      isSyncingFromYjs: false,
      ...(blocksOverrides as Record<string, unknown>),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
      ...(eventsOverrides as Record<string, unknown>),
    },
    ...restOverrides,
  } as unknown as API;
};

describe('Table setData generation guard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('does not overwrite model after re-entrant setData during initializeCells', () => {
    let insertCounter = 0;
    const blockIndexMap = new Map<string, number>();
    let tableRef: Table | null = null;
    let reentrantCallMade = false;

    const mockApi = createMockAPI({
      blocks: {
        delete: vi.fn(),
        isSyncingFromYjs: false,
        insert: vi.fn().mockImplementation(() => {
          insertCounter++;
          const blockId = `cell-block-${insertCounter}`;
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-id', blockId);
          blockIndexMap.set(blockId, insertCounter - 1);

          // Simulate re-entrant setData: on the 2nd insert (first call is
          // creating cells via initializeCells), trigger a second setData
          // like a Yjs undo event would.
          // Insert #1 is from initial render, #2 is from the first setData's
          // initializeCells processing the first cell.
          if (insertCounter === 2 && !reentrantCallMade && tableRef) {
            reentrantCallMade = true;
            tableRef.setData({ content: [['FINAL']], withHeadings: true });
          }

          return { id: blockId, holder };
        }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(0),
        getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        setBlockParent: vi.fn(),
      },
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);

    tableRef = table;
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    // 1 cell block from initial render
    expect(insertCounter).toBe(1);

    // Call setData with a 2x2 table (4 cells).
    // During initializeCells on the first cell, the insert triggers
    // a re-entrant setData({ content: [['FINAL']], withHeadings: true }).
    table.setData({ content: [['X', 'Y'], ['P', 'Q']], withHeadings: false });

    // The DOM should reflect the LAST (re-entrant) setData call
    const finalWrapper = container.firstElementChild as HTMLElement;
    const finalSc = finalWrapper?.firstElementChild as HTMLElement;
    const finalGrid = finalSc?.firstElementChild as HTMLElement;
    const finalCells = finalGrid?.querySelectorAll('[data-blok-table-cell]');

    expect(finalCells).toHaveLength(1);

    // The saved model should reflect the re-entrant call's data, NOT
    // the stale outer call's data. Without the guard, the stale call's
    // model.replaceAll() would overwrite the re-entrant call's model.
    const saved = table.save(finalWrapper);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content).toHaveLength(1);
    expect(saved.content[0]).toHaveLength(1);
  });

  it('allows setData to proceed normally when called once (no re-entrancy)', () => {
    let insertCounter = 0;
    const blockIndexMap = new Map<string, number>();

    const mockApi = createMockAPI({
      blocks: {
        delete: vi.fn(),
        isSyncingFromYjs: false,
        insert: vi.fn().mockImplementation(() => {
          insertCounter++;
          const blockId = `cell-block-${insertCounter}`;
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-id', blockId);
          blockIndexMap.set(blockId, insertCounter - 1);

          return { id: blockId, holder };
        }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(0),
        getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        setBlockParent: vi.fn(),
      },
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    // 1 initial block
    expect(insertCounter).toBe(1);

    // Single setData call — should work normally
    table.setData({ content: [['X', 'Y'], ['P', 'Q']] });

    const newWrapper = container.firstElementChild as HTMLElement;
    const newSc = newWrapper?.firstElementChild as HTMLElement;
    const newGrid = newSc?.firstElementChild as HTMLElement;
    const newRows = newGrid?.querySelectorAll('[data-blok-table-row]');

    expect(newRows).toHaveLength(2);

    // 1 initial + 4 from setData = 5 total
    expect(insertCounter).toBe(5);
  });

  it('prevents stale model overwrite with nested re-entrant setData', () => {
    let insertCounter = 0;
    const blockIndexMap = new Map<string, number>();
    let tableRef: Table | null = null;
    let reentrantCount = 0;

    const mockApi = createMockAPI({
      blocks: {
        delete: vi.fn(),
        isSyncingFromYjs: false,
        insert: vi.fn().mockImplementation(() => {
          insertCounter++;
          const blockId = `cell-block-${insertCounter}`;
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-id', blockId);
          blockIndexMap.set(blockId, insertCounter - 1);

          // Chain of re-entrancy:
          // First setData(3x3) -> first insert triggers setData(2x2)
          // setData(2x2) -> first insert triggers setData(1x1)
          // setData(1x1) -> completes normally
          if (insertCounter === 2 && reentrantCount === 0 && tableRef) {
            reentrantCount++;
            tableRef.setData({ content: [['M', 'N'], ['O', 'P']], withHeadings: false });
          } else if (insertCounter === 3 && reentrantCount === 1 && tableRef) {
            reentrantCount++;
            tableRef.setData({ content: [['FINAL']], withHeadings: true });
          }

          return { id: blockId, holder };
        }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(0),
        getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        setBlockParent: vi.fn(),
      },
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);

    tableRef = table;
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    expect(insertCounter).toBe(1);

    // Trigger the chain: setData(3x3) -> re-enter setData(2x2) -> re-enter setData(1x1)
    table.setData({
      content: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
      withHeadings: false,
    });

    // The DOM should reflect the innermost (latest) setData call
    const finalWrapper = container.firstElementChild as HTMLElement;
    const finalSc = finalWrapper?.firstElementChild as HTMLElement;
    const finalGrid = finalSc?.firstElementChild as HTMLElement;
    const finalCells = finalGrid?.querySelectorAll('[data-blok-table-cell]');

    expect(finalCells).toHaveLength(1);

    // The model should reflect the innermost call, not any stale outer call
    const saved = table.save(finalWrapper);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content).toHaveLength(1);
    expect(saved.content[0]).toHaveLength(1);
  });

  it('bails before DOM rebuild when setData is called during block deletion', () => {
    let insertCounter = 0;
    let deleteCounter = 0;
    const blockIndexMap = new Map<string, number>();
    let tableRef: Table | null = null;
    let reentrantCallMade = false;

    const mockApi = createMockAPI({
      blocks: {
        delete: vi.fn().mockImplementation(() => {
          deleteCounter++;

          // Simulate re-entrant setData triggered during deleteAllBlocks
          // (e.g., a Yjs observer on block removal fires a new setData)
          if (deleteCounter === 1 && !reentrantCallMade && tableRef) {
            reentrantCallMade = true;
            tableRef.setData({ content: [['FINAL']], withHeadings: true });
          }
        }),
        isSyncingFromYjs: false,
        insert: vi.fn().mockImplementation(() => {
          insertCounter++;
          const blockId = `cell-block-${insertCounter}`;
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-id', blockId);
          blockIndexMap.set(blockId, insertCounter - 1);

          return { id: blockId, holder };
        }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(0),
        getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        setBlockParent: vi.fn(),
      },
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);

    tableRef = table;
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    // 2 cell blocks from initial render
    expect(insertCounter).toBe(2);

    // First setData: during deleteAllBlocks, the first delete triggers
    // re-entrant setData([['FINAL']]). The stale outer call should bail
    // at the generation check before DOM rebuild.
    table.setData({ content: [['X', 'Y', 'Z']], withHeadings: false });

    // The model should reflect the re-entrant call's state
    const finalWrapper = container.firstElementChild as HTMLElement;
    const saved = table.save(finalWrapper);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content).toHaveLength(1);
    expect(saved.content[0]).toHaveLength(1);
  });

  it('does not let stale delete-row action overwrite model after re-entrant setData', () => {
    let insertCounter = 0;
    const blockIndexMap = new Map<string, number>();
    let tableRef: Table | null = null;
    let reentrantCallMade = false;

    const mockApi = createMockAPI({
      blocks: {
        delete: vi.fn().mockImplementation(() => {
          if (!reentrantCallMade && tableRef) {
            reentrantCallMade = true;
            tableRef.setData({ content: [['FINAL']], withHeadings: true });
          }
        }),
        isSyncingFromYjs: false,
        insert: vi.fn().mockImplementation(() => {
          insertCounter++;
          const blockId = `cell-block-${insertCounter}`;
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-id', blockId);
          blockIndexMap.set(blockId, insertCounter - 1);

          return { id: blockId, holder };
        }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(0),
        getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        setBlockParent: vi.fn(),
      },
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A'], ['B']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);

    tableRef = table;
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    const gridEl = (element.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    const action: RowColAction = { type: 'delete-row', index: 0 };

    (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
      .handleRowColAction(gridEl, action);

    const finalWrapper = container.firstElementChild as HTMLElement;
    const saved = table.save(finalWrapper);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content).toHaveLength(1);
    expect(saved.content[0]).toHaveLength(1);
  });

  it('does not let stale delete-col action overwrite model after re-entrant setData', () => {
    let insertCounter = 0;
    const blockIndexMap = new Map<string, number>();
    let tableRef: Table | null = null;
    let reentrantCallMade = false;

    const mockApi = createMockAPI({
      blocks: {
        delete: vi.fn().mockImplementation(() => {
          if (!reentrantCallMade && tableRef) {
            reentrantCallMade = true;
            tableRef.setData({ content: [['FINAL']], withHeadings: true });
          }
        }),
        isSyncingFromYjs: false,
        insert: vi.fn().mockImplementation(() => {
          insertCounter++;
          const blockId = `cell-block-${insertCounter}`;
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-id', blockId);
          blockIndexMap.set(blockId, insertCounter - 1);

          return { id: blockId, holder };
        }),
        getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        getBlocksCount: vi.fn().mockReturnValue(0),
        getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        setBlockParent: vi.fn(),
      },
    });

    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
      config: {},
      api: mockApi,
      readOnly: false,
      block: { id: 'table-1' } as never,
    };

    const table = new Table(options);

    tableRef = table;
    const element = table.render();

    container.appendChild(element);
    table.rendered();

    const gridEl = (element.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    const action: RowColAction = { type: 'delete-col', index: 0 };

    (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
      .handleRowColAction(gridEl, action);

    const finalWrapper = container.firstElementChild as HTMLElement;
    const saved = table.save(finalWrapper);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content).toHaveLength(1);
    expect(saved.content[0]).toHaveLength(1);
  });
});
