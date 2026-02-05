import type { API } from '../../../../types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TableCellBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CellContent type', () => {
    it('isCellWithBlocks always returns true for CellContent', async () => {
      const { isCellWithBlocks } = await import('../../../../src/tools/table/types');

      const cell = { blocks: ['block-1'] };

      expect(isCellWithBlocks(cell)).toBe(true);
    });
  });

  describe('isInCellBlock', () => {
    it('should return true when element is inside a cell block container', async () => {
      // Create DOM structure: cell > container > block > content
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');

      const container = document.createElement('div');
      container.setAttribute('data-blok-table-cell-blocks', '');
      cell.appendChild(container);

      const block = document.createElement('div');
      block.setAttribute('data-blok-block', 'block-1');
      container.appendChild(block);

      const content = document.createElement('div');
      content.setAttribute('contenteditable', 'true');
      block.appendChild(content);

      // Import after setting up DOM
      const { isInCellBlock } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(isInCellBlock(content)).toBe(true);
    });

    it('should return false when element is in plain text cell', async () => {
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('contenteditable', 'true');

      const { isInCellBlock } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(isInCellBlock(cell)).toBe(false);
    });
  });

  describe('getCellFromElement', () => {
    it('should return the cell element containing the given element', async () => {
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');

      const nested = document.createElement('span');
      cell.appendChild(nested);

      const { getCellFromElement } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(getCellFromElement(nested)).toBe(cell);
    });

    it('should return null when element is not inside a cell', async () => {
      const div = document.createElement('div');

      const { getCellFromElement } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(getCellFromElement(div)).toBeNull();
    });
  });

  describe('TableCellBlocks class', () => {
    let mockApi: {
      blocks: {
        insert: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        getBlockByIndex: ReturnType<typeof vi.fn>;
        getBlockIndex: ReturnType<typeof vi.fn>;
        getCurrentBlockIndex: ReturnType<typeof vi.fn>;
        getBlocksCount: ReturnType<typeof vi.fn>;
      };
    };
    let gridEl: HTMLElement;

    beforeEach(() => {
      vi.clearAllMocks();

      mockApi = {
        blocks: {
          insert: vi.fn().mockReturnValue({ id: 'new-block-id' }),
          delete: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlockIndex: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(1),
        },
      };

      gridEl = document.createElement('div');
    });

    it('should instantiate with API and grid element', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      expect(cellBlocks).toBeInstanceOf(TableCellBlocks);
    });

    it('should track active cell with blocks', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      expect(cellBlocks.activeCellWithBlocks).toBeNull();

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 1 });
      expect(cellBlocks.activeCellWithBlocks).toEqual({ row: 0, col: 1 });

      cellBlocks.clearActiveCellWithBlocks();
      expect(cellBlocks.activeCellWithBlocks).toBeNull();
    });
  });

  describe('handleKeyDown in cell blocks', () => {
    let mockApi: { blocks: { delete: ReturnType<typeof vi.fn> } };
    let gridEl: HTMLElement;
    let cell: HTMLElement;
    let onNavigateToCell: (position: { row: number; col: number }) => void;

    beforeEach(() => {
      vi.clearAllMocks();
      mockApi = { blocks: { delete: vi.fn() } };

      // Create grid with rows
      gridEl = document.createElement('div');

      const row1 = document.createElement('div');
      row1.setAttribute('data-blok-table-row', '');

      cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      row1.appendChild(cell);

      const cell2 = document.createElement('div');
      cell2.setAttribute('data-blok-table-cell', '');
      cell2.setAttribute('contenteditable', 'true');
      row1.appendChild(cell2);

      gridEl.appendChild(row1);

      const row2 = document.createElement('div');
      row2.setAttribute('data-blok-table-row', '');

      const cell3 = document.createElement('div');
      cell3.setAttribute('data-blok-table-cell', '');
      cell3.setAttribute('contenteditable', 'true');
      row2.appendChild(cell3);

      gridEl.appendChild(row2);

      onNavigateToCell = vi.fn();
    });

    it('should navigate to next cell on Tab', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, cell);

      expect(preventDefault).toHaveBeenCalled();
      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 1 });
    });

    it('should navigate to previous cell on Shift+Tab', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 1 });

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });

      cellBlocks.handleKeyDown(event, cell);

      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 0 });
    });

    it('should navigate to cell below on Shift+Enter', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });

      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });

      cellBlocks.handleKeyDown(event, cell);

      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 1, col: 0 });
    });

    it('should wrap to next row when Tab at end of row', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      // Last column of first row
      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 1 });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });

      cellBlocks.handleKeyDown(event, cell);

      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 1, col: 0 });
    });

    it('should wrap to previous row when Shift+Tab at start of row', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      // First column of second row
      cellBlocks.setActiveCellWithBlocks({ row: 1, col: 0 });

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });

      cellBlocks.handleKeyDown(event, cell);

      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 1 });
    });

    it('should not navigate if no active cell with blocks', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      // No active cell set

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });

      cellBlocks.handleKeyDown(event, cell);

      expect(onNavigateToCell).not.toHaveBeenCalled();
    });

    it('should clear active cell when navigating on Shift+Enter at last row', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      // Last row
      cellBlocks.setActiveCellWithBlocks({ row: 1, col: 0 });

      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });

      cellBlocks.handleKeyDown(event, cell);

      // Should not navigate since we're at the last row
      expect(onNavigateToCell).not.toHaveBeenCalled();
      // Active cell should be cleared
      expect(cellBlocks.activeCellWithBlocks).toBeNull();
    });
  });

  describe('handleEnterInList', () => {
    let mockApi: { blocks: { insert: ReturnType<typeof vi.fn> } };
    let gridEl: HTMLElement;
    let onNavigateToCell: (position: { row: number; col: number }) => void;

    beforeEach(() => {
      vi.clearAllMocks();
      mockApi = { blocks: { insert: vi.fn().mockReturnValue({ id: 'b1' }) } };

      gridEl = document.createElement('div');

      const row1 = document.createElement('div');

      row1.setAttribute('data-blok-table-row', '');
      const cell1 = document.createElement('div');

      cell1.setAttribute('data-blok-table-cell', '');
      row1.appendChild(cell1);
      gridEl.appendChild(row1);

      const row2 = document.createElement('div');

      row2.setAttribute('data-blok-table-row', '');
      const cell2 = document.createElement('div');

      cell2.setAttribute('data-blok-table-cell', '');
      row2.appendChild(cell2);
      gridEl.appendChild(row2);

      onNavigateToCell = vi.fn();
    });

    it('should exit to cell below when Enter pressed on empty list item', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });

      const isEmpty = true;
      const result = cellBlocks.handleEnterInList(isEmpty);

      expect(result).toBe(true); // Handled
      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 1, col: 0 });
    });

    it('should return false (not handled) for non-empty list item', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 0 });

      const isEmpty = false;
      const result = cellBlocks.handleEnterInList(isEmpty);

      expect(result).toBe(false); // Not handled
      expect(onNavigateToCell).not.toHaveBeenCalled();
    });

    it('should return false when no active cell with blocks', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      // Don't set active cell
      const result = cellBlocks.handleEnterInList(true);

      expect(result).toBe(false);
      expect(onNavigateToCell).not.toHaveBeenCalled();
    });

    it('should clear active cell when on last row', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      // Set to last row (row 1, which is the second row)
      cellBlocks.setActiveCellWithBlocks({ row: 1, col: 0 });

      const result = cellBlocks.handleEnterInList(true);

      expect(result).toBe(true); // Still handled
      expect(onNavigateToCell).not.toHaveBeenCalled(); // No navigation since on last row
      expect(cellBlocks.activeCellWithBlocks).toBeNull(); // But active cell cleared
    });
  });

  describe('initializeCells', () => {
    it('should create a paragraph block for each empty cell', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'block-1',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: { insert: mockInsert },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement,
        tableBlockId: 'table-1',
      });

      const result = cellBlocks.initializeCells([['']]);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        undefined,
        false
      );
      // Result should be normalized to block references
      expect(result[0][0]).toEqual({ blocks: ['block-1'] });
      // Block holder should be mounted in the container
      expect(container.contains(mockBlockHolder)).toBe(true);
    });

    it('should migrate legacy string content to paragraph blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'migrated-1',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: { insert: mockInsert },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement,
        tableBlockId: 'table-1',
      });

      const result = cellBlocks.initializeCells([['Hello world']]);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Hello world' },
        expect.anything(),
        undefined,
        false
      );
      expect(result[0][0]).toEqual({ blocks: ['migrated-1'] });
    });

    it('should mount existing block references', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const existingBlockHolder = document.createElement('div');
      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        holder: existingBlockHolder,
        id: 'existing-1',
      });

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
        },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement,
        tableBlockId: 'table-1',
      });

      const result = cellBlocks.initializeCells([[{ blocks: ['existing-1'] }]]);

      expect(api.blocks.insert).not.toHaveBeenCalled();
      expect(mockGetBlockIndex).toHaveBeenCalledWith('existing-1');
      expect(container.contains(existingBlockHolder)).toBe(true);
      expect(result[0][0]).toEqual({ blocks: ['existing-1'] });
    });
  });
});
