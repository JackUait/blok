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
    /**
     * Helper to build a cell element with a blocks container and a contenteditable inside it
     */
    const buildCellWithEditable = (cellBlocksAttr: string): { cell: HTMLElement; editable: HTMLElement } => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');

      const container = document.createElement('div');

      container.setAttribute(cellBlocksAttr, '');

      const block = document.createElement('div');

      block.setAttribute('data-blok-block', `blk-${Math.random()}`);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      block.appendChild(editable);
      container.appendChild(block);
      cell.appendChild(container);

      return { cell, editable };
    };

    let mockApi: { blocks: { delete: ReturnType<typeof vi.fn> } };
    let gridEl: HTMLElement;
    let onNavigateToCell: (position: { row: number; col: number }) => void;
    let cellBlocksAttr: string;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockApi = { blocks: { delete: vi.fn() } };

      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      cellBlocksAttr = CELL_BLOCKS_ATTR;

      // Create grid with rows — each cell has a blocks container + contenteditable
      gridEl = document.createElement('div');

      const row1 = document.createElement('div');

      row1.setAttribute('data-blok-table-row', '');

      const { cell: c1 } = buildCellWithEditable(cellBlocksAttr);
      const { cell: c2 } = buildCellWithEditable(cellBlocksAttr);

      row1.appendChild(c1);
      row1.appendChild(c2);
      gridEl.appendChild(row1);

      const row2 = document.createElement('div');

      row2.setAttribute('data-blok-table-row', '');

      const { cell: c3 } = buildCellWithEditable(cellBlocksAttr);

      row2.appendChild(c3);
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

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

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

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });

      cellBlocks.handleKeyDown(event, { row: 0, col: 1 });

      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 0 });
    });

    it('should wrap to next row when Tab at end of row', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });

      cellBlocks.handleKeyDown(event, { row: 0, col: 1 });

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

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });

      cellBlocks.handleKeyDown(event, { row: 1, col: 0 });

      expect(onNavigateToCell).toHaveBeenCalledWith({ row: 0, col: 1 });
    });

    it('should ignore non-Tab keys', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        onNavigateToCell,
      });

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(onNavigateToCell).not.toHaveBeenCalled();
    });
  });

  describe('Tab navigation between cells (always-blocks)', () => {
    it('should focus first contenteditable in next cell on Tab', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      // Cell 0
      const cell0 = document.createElement('div');
      cell0.setAttribute('data-blok-table-cell', '');
      const container0 = document.createElement('div');
      container0.setAttribute(CELL_BLOCKS_ATTR, '');
      const block0 = document.createElement('div');
      block0.setAttribute('data-blok-block', 'b0');
      const editable0 = document.createElement('div');
      editable0.setAttribute('contenteditable', 'true');
      block0.appendChild(editable0);
      container0.appendChild(block0);
      cell0.appendChild(container0);

      // Cell 1
      const cell1 = document.createElement('div');
      cell1.setAttribute('data-blok-table-cell', '');
      const container1 = document.createElement('div');
      container1.setAttribute(CELL_BLOCKS_ATTR, '');
      const block1 = document.createElement('div');
      block1.setAttribute('data-blok-block', 'b1');
      const editable1 = document.createElement('div');
      editable1.setAttribute('contenteditable', 'true');
      block1.appendChild(editable1);
      container1.appendChild(block1);
      cell1.appendChild(container1);

      row.appendChild(cell0);
      row.appendChild(cell1);
      gridElement.appendChild(row);

      const focusSpy = vi.spyOn(editable1, 'focus');

      const api = { blocks: {} } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      expect(preventSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('should focus last contenteditable in previous cell on Shift+Tab', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      // Cell 0 with two blocks
      const cell0 = document.createElement('div');
      cell0.setAttribute('data-blok-table-cell', '');
      const container0 = document.createElement('div');
      container0.setAttribute(CELL_BLOCKS_ATTR, '');
      const block0a = document.createElement('div');
      block0a.setAttribute('data-blok-block', 'b0a');
      const editable0a = document.createElement('div');
      editable0a.setAttribute('contenteditable', 'true');
      block0a.appendChild(editable0a);
      const block0b = document.createElement('div');
      block0b.setAttribute('data-blok-block', 'b0b');
      const editable0b = document.createElement('div');
      editable0b.setAttribute('contenteditable', 'true');
      block0b.appendChild(editable0b);
      container0.appendChild(block0a);
      container0.appendChild(block0b);
      cell0.appendChild(container0);

      // Cell 1
      const cell1 = document.createElement('div');
      cell1.setAttribute('data-blok-table-cell', '');
      const container1 = document.createElement('div');
      container1.setAttribute(CELL_BLOCKS_ATTR, '');
      const block1 = document.createElement('div');
      block1.setAttribute('data-blok-block', 'b1');
      const editable1 = document.createElement('div');
      editable1.setAttribute('contenteditable', 'true');
      block1.appendChild(editable1);
      container1.appendChild(block1);
      cell1.appendChild(container1);

      row.appendChild(cell0);
      row.appendChild(cell1);
      gridElement.appendChild(row);

      const focusSpy = vi.spyOn(editable0b, 'focus');

      const api = { blocks: {} } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 1 });

      expect(preventSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('should wrap to next row on Tab at end of row', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');

      // Row 0 with 1 cell
      const row0 = document.createElement('div');
      row0.setAttribute('data-blok-table-row', '');
      const cell00 = document.createElement('div');
      cell00.setAttribute('data-blok-table-cell', '');
      const cont00 = document.createElement('div');
      cont00.setAttribute(CELL_BLOCKS_ATTR, '');
      const blk00 = document.createElement('div');
      blk00.setAttribute('data-blok-block', 'b00');
      const ed00 = document.createElement('div');
      ed00.setAttribute('contenteditable', 'true');
      blk00.appendChild(ed00);
      cont00.appendChild(blk00);
      cell00.appendChild(cont00);
      row0.appendChild(cell00);

      // Row 1 with 1 cell
      const row1 = document.createElement('div');
      row1.setAttribute('data-blok-table-row', '');
      const cell10 = document.createElement('div');
      cell10.setAttribute('data-blok-table-cell', '');
      const cont10 = document.createElement('div');
      cont10.setAttribute(CELL_BLOCKS_ATTR, '');
      const blk10 = document.createElement('div');
      blk10.setAttribute('data-blok-block', 'b10');
      const ed10 = document.createElement('div');
      ed10.setAttribute('contenteditable', 'true');
      blk10.appendChild(ed10);
      cont10.appendChild(blk10);
      cell10.appendChild(cont10);
      row1.appendChild(cell10);

      gridElement.appendChild(row0);
      gridElement.appendChild(row1);

      const focusSpy = vi.spyOn(ed10, 'focus');

      const api = { blocks: {} } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      expect(focusSpy).toHaveBeenCalled();
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
