import type { API } from '../../../../types';
import type { TableModel } from '../../../../src/tools/table/table-model';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMockModel = (): TableModel => ({
  findCellForBlock: vi.fn(() => null),
  removeBlockFromCell: vi.fn(),
  addBlockToCell: vi.fn(),
  addRow: vi.fn(),
  deleteRow: vi.fn(),
  addColumn: vi.fn(),
  deleteColumn: vi.fn(),
  moveRow: vi.fn(),
  moveColumn: vi.fn(),
  replaceAll: vi.fn(),
  snapshot: vi.fn(),
  setCellBlocks: vi.fn(),
  getCellBlocks: vi.fn(() => []),
  setWithHeadings: vi.fn(),
  setWithHeadingColumn: vi.fn(),
  setStretched: vi.fn(),
  setColWidths: vi.fn(),
  setInitialColWidth: vi.fn(),
  rows: 0,
  cols: 0,
} as unknown as TableModel);

/**
 * Extract the 'block changed' event handler from a mock API's events.on calls.
 */
const getBlockChangedHandler = (eventsOn: ReturnType<typeof vi.fn>): (data: unknown) => void => {
  const onCall = eventsOn.mock.calls.find(
    (call: unknown[]) => call[0] === 'block changed'
  );

  if (!onCall) {
    throw new Error('block changed handler not registered');
  }

  return onCall[1] as (data: unknown) => void;
};

describe('removedBlockCells index-based key bugs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cross-table interference', () => {
    it('should not treat a foreign adjacent block as this table ownership during replace matching', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridA = document.createElement('div');
      const rowA = document.createElement('div');
      rowA.setAttribute('data-blok-table-row', '');

      const cellA = document.createElement('div');
      cellA.setAttribute('data-blok-table-cell', '');
      const containerA = document.createElement('div');
      containerA.setAttribute(CELL_BLOCKS_ATTR, '');

      const blockAHolder = document.createElement('div');
      blockAHolder.setAttribute('data-blok-id', 'block-a');
      containerA.appendChild(blockAHolder);

      // Foreign block holder from another table temporarily present in gridA.
      const foreignHolder = document.createElement('div');
      foreignHolder.setAttribute('data-blok-id', 'foreign-block');
      containerA.appendChild(foreignHolder);

      cellA.appendChild(containerA);
      rowA.appendChild(cellA);
      gridA.appendChild(rowA);

      const tableAHolder = document.createElement('div');
      tableAHolder.setAttribute('data-blok-id', 'table-a');
      const insertedHolder = document.createElement('div');
      insertedHolder.setAttribute('data-blok-id', 'inserted');

      const eventsApi = {
        on: vi.fn(),
        off: vi.fn(),
      };

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'inserted') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            // New flat list around index=1:
            // 0 -> table-a, 1 -> inserted, 2 -> foreign-block
            if (index === 0) return { id: 'table-a', holder: tableAHolder };
            if (index === 1) return { id: 'inserted', holder: insertedHolder };
            if (index === 2) return { id: 'foreign-block', holder: foreignHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(3),
          setBlockParent: vi.fn(),
        },
        events: eventsApi,
      } as unknown as API;

      const model = createMockModel();
      vi.mocked(model.findCellForBlock).mockImplementation((blockId: string) => {
        if (blockId === 'block-a') return { row: 0, col: 0 };
        // foreign-block is deliberately not tracked by Table A model.
        return null;
      });

      const instance = new TableCellBlocks({ api, gridElement: gridA, tableBlockId: 'table-a', model });
      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'block-a', holder: blockAHolder },
            index: 1,
          },
        },
      });

      blockAHolder.remove();

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'inserted', holder: insertedHolder },
            index: 1,
          },
        },
      });

      expect(containerA.contains(insertedHolder)).toBe(false);

      await Promise.resolve();
      instance.destroy();
    });

    it('should NOT let Table A claim a block that was added between two tables at the same index', async () => {
      /**
       * Scenario:
       * - Table A (index 0) has cellA with blockA at flat index 1
       * - Table B (index 2) has cellB with blockB at flat index 3
       * - blockA is removed from Table A at index 1
       * - Table A records removedBlockCells for index 1
       * - A new blockC is added at index 1 (e.g., standalone insertion between tables)
       * - Table A's handler should NOT claim blockC because the adjacent blocks
       *   at index 0 (table-a) and index 2 (table-b) are NOT cell blocks of Table A.
       */
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // ─── Table A grid ───
      const gridA = document.createElement('div');
      const rowA = document.createElement('div');
      rowA.setAttribute('data-blok-table-row', '');
      const cellA = document.createElement('div');
      cellA.setAttribute('data-blok-table-cell', '');
      const containerA = document.createElement('div');
      containerA.setAttribute(CELL_BLOCKS_ATTR, '');
      const blockAHolder = document.createElement('div');
      blockAHolder.setAttribute('data-blok-id', 'block-a');
      containerA.appendChild(blockAHolder);
      cellA.appendChild(containerA);
      rowA.appendChild(cellA);
      gridA.appendChild(rowA);

      // ─── Table B grid ───
      const gridB = document.createElement('div');
      const rowB = document.createElement('div');
      rowB.setAttribute('data-blok-table-row', '');
      const cellB = document.createElement('div');
      cellB.setAttribute('data-blok-table-cell', '');
      const containerB = document.createElement('div');
      containerB.setAttribute(CELL_BLOCKS_ATTR, '');
      const blockBHolder = document.createElement('div');
      blockBHolder.setAttribute('data-blok-id', 'block-b');
      containerB.appendChild(blockBHolder);
      cellB.appendChild(containerB);
      rowB.appendChild(cellB);
      gridB.appendChild(rowB);

      // Table A block at index 0, blockA at index 1
      // Table B block at index 2, blockB at index 3
      const tableAHolder = document.createElement('div');
      tableAHolder.setAttribute('data-blok-id', 'table-a');
      const tableBHolder = document.createElement('div');
      tableBHolder.setAttribute('data-blok-id', 'table-b');

      // New block that will be added at index 1 (same as blockA's old index)
      const newBlockHolder = document.createElement('div');
      newBlockHolder.setAttribute('data-blok-id', 'block-c');

      // Mock block insert for ensureCellHasBlock (to prevent unhandled errors in microtask)
      const mockInsertHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'auto-para',
        holder: mockInsertHolder,
      });

      // Shared blocks API mock - represents the flat block list
      const blocksApi = {
        insert: mockInsert,
        getBlockIndex: vi.fn((id: string) => {
          if (id === 'block-c') return 1;
          if (id === 'block-b') return 3;

          return undefined;
        }),
        getBlockByIndex: vi.fn((index: number) => {
          if (index === 0) return { id: 'table-a', holder: tableAHolder };
          if (index === 1) return { id: 'block-c', holder: newBlockHolder };
          if (index === 2) return { id: 'table-b', holder: tableBHolder };
          if (index === 3) return { id: 'block-b', holder: blockBHolder };

          return undefined;
        }),
        getBlocksCount: vi.fn().mockReturnValue(4),
        setBlockParent: vi.fn(),
      };

      // Both tables share the same events dispatcher
      const eventHandlers: Array<(data: unknown) => void> = [];
      const eventsApi = {
        on: vi.fn((_eventName: string, cb: (data: unknown) => void) => {
          eventHandlers.push(cb);
        }),
        off: vi.fn(),
      };

      const apiA = { blocks: blocksApi, events: eventsApi } as unknown as API;
      const apiB = { blocks: blocksApi, events: eventsApi } as unknown as API;

      const modelA = createMockModel();
      vi.mocked(modelA.findCellForBlock).mockImplementation((blockId: string) => {
        if (blockId === 'block-a') return { row: 0, col: 0 };

        return null;
      });

      const modelB = createMockModel();

      // Construct both table instances - both subscribe to 'block changed'
      const instanceA = new TableCellBlocks({ api: apiA, gridElement: gridA, tableBlockId: 'table-a', model: modelA });
      const instanceB = new TableCellBlocks({ api: apiB, gridElement: gridB, tableBlockId: 'table-b', model: modelB });

      // Step 1: blockA is removed from Table A at index 1
      const removeEvent = {
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'block-a', holder: blockAHolder },
            index: 1,
          },
        },
      };

      // Fire to all handlers (both tables)
      for (const handler of eventHandlers) {
        handler(removeEvent);
      }

      // Remove blockA from DOM
      blockAHolder.remove();

      // Step 2: A new block-c is added at index 1 (this is NOT a replacement
      // intended for Table A - it's an unrelated insertion)
      const addEvent = {
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'block-c', holder: newBlockHolder },
            index: 1,
          },
        },
      };

      // Fire to all handlers
      for (const handler of eventHandlers) {
        handler(addEvent);
      }

      // block-c should NOT be in Table A's cell
      expect(containerA.contains(newBlockHolder)).toBe(false);

      // block-c should also NOT be in Table B's cell (it's an unrelated block)
      expect(containerB.contains(newBlockHolder)).toBe(false);

      // Flush microtask to prevent unhandled errors leaking between tests
      await Promise.resolve();

      // Clean up
      instanceA.destroy();
      instanceB.destroy();
    });

    it('should NOT claim a block when another table replaces its own block at the same flat index', async () => {
      /**
       * Scenario:
       * - Table A has blockA at index 1, Table B has blockB at index 3
       * - blockA is removed from Table A (block-removed at index 1)
       * - Table B replaces blockB: block-removed at index 3, block-added at index 3
       * - Simultaneously, an unrelated block is inserted at index 1 (Table B or standalone)
       * - Table A should NOT claim the unrelated block at index 1
       */
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Table A: single cell
      const gridA = document.createElement('div');
      const rowA = document.createElement('div');
      rowA.setAttribute('data-blok-table-row', '');
      const cellA = document.createElement('div');
      cellA.setAttribute('data-blok-table-cell', '');
      const containerA = document.createElement('div');
      containerA.setAttribute(CELL_BLOCKS_ATTR, '');
      const blockAHolder = document.createElement('div');
      blockAHolder.setAttribute('data-blok-id', 'block-a');
      containerA.appendChild(blockAHolder);
      cellA.appendChild(containerA);
      rowA.appendChild(cellA);
      gridA.appendChild(rowA);

      const tableAHolder = document.createElement('div');
      const tableBHolder = document.createElement('div');
      const newBlockHolder = document.createElement('div');
      newBlockHolder.setAttribute('data-blok-id', 'block-c');

      // Mock insert for ensureCellHasBlock
      const mockInsertHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'auto-para',
        holder: mockInsertHolder,
      });

      const blocksApi = {
        insert: mockInsert,
        getBlockIndex: vi.fn((id: string) => {
          if (id === 'block-c') return 1;

          return undefined;
        }),
        getBlockByIndex: vi.fn((index: number) => {
          // After removal and insertion: [table-a(0), block-c(1), table-b(2)]
          if (index === 0) return { id: 'table-a', holder: tableAHolder };
          if (index === 1) return { id: 'block-c', holder: newBlockHolder };
          if (index === 2) return { id: 'table-b', holder: tableBHolder };

          return undefined;
        }),
        getBlocksCount: vi.fn().mockReturnValue(3),
        setBlockParent: vi.fn(),
      };

      const eventsApi = {
        on: vi.fn(),
        off: vi.fn(),
      };

      const api = { blocks: blocksApi, events: eventsApi } as unknown as API;

      const model = createMockModel();
      vi.mocked(model.findCellForBlock).mockImplementation((blockId: string) => {
        if (blockId === 'block-a') return { row: 0, col: 0 };

        return null;
      });

      const instance = new TableCellBlocks({ api, gridElement: gridA, tableBlockId: 'table-a', model });

      const handler = getBlockChangedHandler(eventsApi.on);

      // blockA removed at index 1
      handler({
        event: {
          type: 'block-removed',
          detail: { target: { id: 'block-a', holder: blockAHolder }, index: 1 },
        },
      });

      blockAHolder.remove();

      // Unrelated block-c added at index 1 (between the two tables)
      handler({
        event: {
          type: 'block-added',
          detail: { target: { id: 'block-c', holder: newBlockHolder }, index: 1 },
        },
      });

      // Table A should NOT claim block-c: the block at index 2 is table-b
      // (not a cell block of Table A), so the adjacency check fails.
      expect(containerA.contains(newBlockHolder)).toBe(false);

      await Promise.resolve();
      instance.destroy();
    });
  });

  describe('genuine replace still works', () => {
    it('should correctly claim a replacement block into the same cell when the table has multiple cells', async () => {
      /**
       * This is the LEGITIMATE use case for removedBlockCells:
       * - Cell has a single block (paragraph) at index 1
       * - User converts it to a list (replaceWith)
       * - block-removed fires at index 1, block-added fires at index 1
       * - The list block should be placed in the same cell as the paragraph was
       *
       * In this case, cell01 has other-1 at index 2, providing adjacency to
       * confirm the new block belongs to this table.
       */
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      // Cell (0,0) with single block being replaced
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      const paraHolder = document.createElement('div');
      paraHolder.setAttribute('data-blok-id', 'para-1');
      container.appendChild(paraHolder);
      cell.appendChild(container);

      // Cell (0,1) with another block
      const cell2 = document.createElement('div');
      cell2.setAttribute('data-blok-table-cell', '');
      const container2 = document.createElement('div');
      container2.setAttribute(CELL_BLOCKS_ATTR, '');
      const otherHolder = document.createElement('div');
      otherHolder.setAttribute('data-blok-id', 'other-1');
      container2.appendChild(otherHolder);
      cell2.appendChild(container2);

      row.appendChild(cell);
      row.appendChild(cell2);
      gridElement.appendChild(row);

      const tableBlockHolder = document.createElement('div');
      tableBlockHolder.setAttribute('data-blok-id', 'table-1');

      const replacementHolder = document.createElement('div');
      replacementHolder.setAttribute('data-blok-id', 'list-1');

      // After replace: [table-1(0), list-1(1), other-1(2)]
      const eventsApi = {
        on: vi.fn(),
        off: vi.fn(),
      };

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'list-1') return 1;
            if (id === 'other-1') return 2;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'table-1', holder: tableBlockHolder };
            if (index === 1) return { id: 'list-1', holder: replacementHolder };
            if (index === 2) return { id: 'other-1', holder: otherHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(3),
          setBlockParent: vi.fn(),
        },
        events: eventsApi,
      } as unknown as API;

      const model = createMockModel();
      vi.mocked(model.findCellForBlock).mockImplementation((blockId: string) => {
        if (blockId === 'para-1') return { row: 0, col: 0 };
        if (blockId === 'other-1') return { row: 0, col: 1 };

        return null;
      });

      const instance = new TableCellBlocks({ api, gridElement, tableBlockId: 'table-1', model });

      const handler = getBlockChangedHandler(eventsApi.on);

      // Step 1: block-removed for para-1 at index 1 (holder still in cell)
      handler({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'para-1', holder: paraHolder },
            index: 1,
          },
        },
      });

      // Step 2: holder removed from DOM
      paraHolder.remove();

      // Step 3: block-added for list-1 at index 1 (genuine replace)
      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'list-1', holder: replacementHolder },
            index: 1,
          },
        },
      });

      // Replacement should be placed in the same cell as the original
      expect(container.contains(replacementHolder)).toBe(true);
      // Should NOT be in the other cell
      expect(container2.contains(replacementHolder)).toBe(false);

      // Flush microtask
      await Promise.resolve();

      // No spurious paragraph should be inserted
      expect(api.blocks.insert).not.toHaveBeenCalled();

      instance.destroy();
    });

    it('should correctly claim a replacement block in a single-cell table with no other cell blocks', async () => {
      /**
       * Edge case: table with exactly one cell and one block.
       * After removal, the only adjacent block is the table block itself.
       * The adjacency check should still pass because:
       * - table block is at index-1
       * - No block exists at index+1 (end of flat list)
       */
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      const paraHolder = document.createElement('div');
      paraHolder.setAttribute('data-blok-id', 'para-1');
      container.appendChild(paraHolder);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const tableBlockHolder = document.createElement('div');
      tableBlockHolder.setAttribute('data-blok-id', 'table-1');

      const replacementHolder = document.createElement('div');
      replacementHolder.setAttribute('data-blok-id', 'list-1');

      // After replace: [table-1(0), list-1(1)]
      const eventsApi = {
        on: vi.fn(),
        off: vi.fn(),
      };

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'list-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'table-1', holder: tableBlockHolder };
            if (index === 1) return { id: 'list-1', holder: replacementHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
        },
        events: eventsApi,
      } as unknown as API;

      const model = createMockModel();
      vi.mocked(model.findCellForBlock).mockImplementation((blockId: string) => {
        if (blockId === 'para-1') return { row: 0, col: 0 };

        return null;
      });

      const instance = new TableCellBlocks({ api, gridElement, tableBlockId: 'table-1', model });

      const handler = getBlockChangedHandler(eventsApi.on);

      // block-removed at index 1
      handler({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'para-1', holder: paraHolder },
            index: 1,
          },
        },
      });

      paraHolder.remove();

      // block-added at index 1 (genuine replace)
      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'list-1', holder: replacementHolder },
            index: 1,
          },
        },
      });

      // Replacement should be placed in the cell
      expect(container.contains(replacementHolder)).toBe(true);

      await Promise.resolve();
      expect(api.blocks.insert).not.toHaveBeenCalled();

      instance.destroy();
    });
  });
});
