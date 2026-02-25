import type { API } from '../../../../types';
import type { TableModel } from '../../../../src/tools/table/table-model';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      block.setAttribute('data-blok-id', 'block-1');
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
        setBlockParent: ReturnType<typeof vi.fn>;
      };
      events: {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
      };
      caret: {
        setToBlock: ReturnType<typeof vi.fn>;
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
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
        caret: {
          setToBlock: vi.fn().mockReturnValue(true),
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
        model: createMockModel(),
      });

      expect(cellBlocks).toBeInstanceOf(TableCellBlocks);
    });

    it('should track active cell with blocks', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
        model: createMockModel(),
      });

      expect(cellBlocks.activeCellWithBlocks).toBeNull();

      cellBlocks.setActiveCellWithBlocks({ row: 0, col: 1 });
      expect(cellBlocks.activeCellWithBlocks).toEqual({ row: 0, col: 1 });

      cellBlocks.clearActiveCellWithBlocks();
      expect(cellBlocks.activeCellWithBlocks).toBeNull();
    });

    describe('click on blank cell space', () => {
      /**
       * Build a grid with one row and one cell containing a block holder
       */
      const buildGridWithBlock = (
        gridElement: HTMLElement,
        blockId: string
      ): { cell: HTMLElement; container: HTMLElement; blockHolder: HTMLElement } => {
        const row = document.createElement('div');
        row.setAttribute('data-blok-table-row', '');
        gridElement.appendChild(row);

        const cell = document.createElement('div');
        cell.setAttribute('data-blok-table-cell', '');
        row.appendChild(cell);

        const container = document.createElement('div');
        container.setAttribute('data-blok-table-cell-blocks', '');
        cell.appendChild(container);

        const blockHolder = document.createElement('div');
        blockHolder.setAttribute('data-blok-id', blockId);
        container.appendChild(blockHolder);

        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        editable.textContent = 'hello';
        blockHolder.appendChild(editable);

        return { cell, container, blockHolder };
      };

      it('should set caret to end of last block when clicking blank cell space', async () => {
        const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

        const cellBlocks = new TableCellBlocks({
          api: mockApi as never,
          gridElement: gridEl,
          tableBlockId: 'table-1',
          model: createMockModel(),
        });

        const { cell } = buildGridWithBlock(gridEl, 'block-1');

        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing click handler on non-contenteditable cell element
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockApi.caret.setToBlock).toHaveBeenCalledWith('block-1', 'end');

        cellBlocks.destroy();
      });

      it('should set caret to end of last block when clicking blocks container', async () => {
        const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

        const cellBlocks = new TableCellBlocks({
          api: mockApi as never,
          gridElement: gridEl,
          tableBlockId: 'table-1',
          model: createMockModel(),
        });

        const { container } = buildGridWithBlock(gridEl, 'block-2');

        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing click handler on non-contenteditable container element
        container.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockApi.caret.setToBlock).toHaveBeenCalledWith('block-2', 'end');

        cellBlocks.destroy();
      });

      it('should NOT set caret when clicking on block content', async () => {
        const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

        const cellBlocks = new TableCellBlocks({
          api: mockApi as never,
          gridElement: gridEl,
          tableBlockId: 'table-1',
          model: createMockModel(),
        });

        const { blockHolder } = buildGridWithBlock(gridEl, 'block-3');

        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing click handler on non-contenteditable cell element
        blockHolder.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockApi.caret.setToBlock).not.toHaveBeenCalled();

        cellBlocks.destroy();
      });

      it('should use the LAST block ID when cell has multiple blocks', async () => {
        const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

        const cellBlocks = new TableCellBlocks({
          api: mockApi as never,
          gridElement: gridEl,
          tableBlockId: 'table-1',
          model: createMockModel(),
        });

        const row = document.createElement('div');
        row.setAttribute('data-blok-table-row', '');
        gridEl.appendChild(row);

        const cell = document.createElement('div');
        cell.setAttribute('data-blok-table-cell', '');
        row.appendChild(cell);

        const container = document.createElement('div');
        container.setAttribute('data-blok-table-cell-blocks', '');
        cell.appendChild(container);

        const block1 = document.createElement('div');
        block1.setAttribute('data-blok-id', 'first-block');
        container.appendChild(block1);

        const block2 = document.createElement('div');
        block2.setAttribute('data-blok-id', 'second-block');
        container.appendChild(block2);

        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing click handler on non-contenteditable cell element
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockApi.caret.setToBlock).toHaveBeenCalledWith('second-block', 'end');

        cellBlocks.destroy();
      });

      it('should remove click listener on destroy', async () => {
        const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

        const cellBlocks = new TableCellBlocks({
          api: mockApi as never,
          gridElement: gridEl,
          tableBlockId: 'table-1',
          model: createMockModel(),
        });

        const { cell } = buildGridWithBlock(gridEl, 'block-4');

        cellBlocks.destroy();

        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing click handler on non-contenteditable cell element
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockApi.caret.setToBlock).not.toHaveBeenCalled();
      });
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

      block.setAttribute('data-blok-id', `blk-${Math.random()}`);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      block.appendChild(editable);
      container.appendChild(block);
      cell.appendChild(container);

      return { cell, editable };
    };

    let mockApi: { blocks: { delete: ReturnType<typeof vi.fn>; setBlockParent: ReturnType<typeof vi.fn> }; events: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } };
    let gridEl: HTMLElement;
    let onNavigateToCell: (position: { row: number; col: number }) => void;
    let cellBlocksAttr: string;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockApi = { blocks: { delete: vi.fn(), setBlockParent: vi.fn() }, events: { on: vi.fn(), off: vi.fn() } };

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
        model: createMockModel(),
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
        model: createMockModel(),
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
        model: createMockModel(),
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
        model: createMockModel(),
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
        model: createMockModel(),
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
      block0.setAttribute('data-blok-id', 'b0');
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
      block1.setAttribute('data-blok-id', 'b1');
      const editable1 = document.createElement('div');
      editable1.setAttribute('contenteditable', 'true');
      block1.appendChild(editable1);
      container1.appendChild(block1);
      cell1.appendChild(container1);

      row.appendChild(cell0);
      row.appendChild(cell1);
      gridElement.appendChild(row);

      const focusSpy = vi.spyOn(editable1, 'focus');

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      expect(preventSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
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
      block0a.setAttribute('data-blok-id', 'b0a');
      const editable0a = document.createElement('div');
      editable0a.setAttribute('contenteditable', 'true');
      block0a.appendChild(editable0a);
      const block0b = document.createElement('div');
      block0b.setAttribute('data-blok-id', 'b0b');
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
      block1.setAttribute('data-blok-id', 'b1');
      const editable1 = document.createElement('div');
      editable1.setAttribute('contenteditable', 'true');
      block1.appendChild(editable1);
      container1.appendChild(block1);
      cell1.appendChild(container1);

      row.appendChild(cell0);
      row.appendChild(cell1);
      gridElement.appendChild(row);

      const focusSpy = vi.spyOn(editable0b, 'focus');

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 1 });

      expect(preventSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
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
      blk00.setAttribute('data-blok-id', 'b00');
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
      blk10.setAttribute('data-blok-id', 'b10');
      const ed10 = document.createElement('div');
      ed10.setAttribute('contenteditable', 'true');
      blk10.appendChild(ed10);
      cont10.appendChild(blk10);
      cell10.appendChild(cont10);
      row1.appendChild(cell10);

      gridElement.appendChild(row0);
      gridElement.appendChild(row1);

      const focusSpy = vi.spyOn(ed10, 'focus');

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      expect(focusSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('block lifecycle in cells', () => {
    it('should re-mount a newly added block into the correct cell', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      // Existing block already in cell
      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // New block holder (not yet in cell — simulating it landing in main editor)
      const newBlockHolder = document.createElement('div');

      newBlockHolder.setAttribute('data-blok-id', 'new-1');

      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;
            if (id === 'new-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingBlock };
            if (index === 1) return { id: 'new-1', holder: newBlockHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // Directly test the claim method
      cellBlocks.claimBlockForCell(cell, 'new-1');

      expect(container.contains(newBlockHolder)).toBe(true);
    });

    it('should detect that a new block belongs to a cell based on adjacent block', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const newBlockHolder = document.createElement('div');

      newBlockHolder.setAttribute('data-blok-id', 'new-1');

      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;
            if (id === 'new-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingBlock };
            if (index === 1) return { id: 'new-1', holder: newBlockHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // Find cell for a block at index 1, whose previous sibling (index 0) is in a cell
      const foundCell = cellBlocks.findCellForNewBlock(1);

      expect(foundCell).toBe(cell);
    });

    it('should subscribe to block changed events on construction', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const api = {
        blocks: {},
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const gridElement = document.createElement('div');

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      expect(api.events.on).toHaveBeenCalledWith('block changed', expect.any(Function));
    });

    it('should unsubscribe from block changed events on destroy', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const api = {
        blocks: {},
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const gridElement = document.createElement('div');

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      cellBlocks.destroy();

      expect(api.events.off).toHaveBeenCalledWith('block changed', expect.any(Function));
    });

    it('should auto-claim block when block-added event fires for an adjacent cell block', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const newBlockHolder = document.createElement('div');

      newBlockHolder.setAttribute('data-blok-id', 'new-1');

      // In real code, insertToDOM places the holder inside the grid (as a sibling
      // of the previous block) before the block-added event fires.
      gridElement.appendChild(newBlockHolder);

      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;
            if (id === 'new-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingBlock };
            if (index === 1) return { id: 'new-1', holder: newBlockHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // Capture the event handler that was registered
      const onCall = (api.events.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => call[0] === 'block changed'
      );

      expect(onCall).toBeDefined();

      const handler = onCall?.[1] as (data: unknown) => void;

      // Simulate a block-added event
      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-1', holder: newBlockHolder },
            index: 1,
          },
        },
      });

      expect(container.contains(newBlockHolder)).toBe(true);
    });

    it('should not claim block when its holder is outside the grid and current block is not in this table', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // New block holder is outside the grid (e.g., placed by replaceWith outside the table)
      const newBlockHolder = document.createElement('div');

      newBlockHolder.setAttribute('data-blok-id', 'new-1');
      document.body.appendChild(newBlockHolder);

      const model = createMockModel();

      // existing-1 is NOT tracked by the model — simulating that the current block
      // is not owned by this table (e.g., undo/restore of a top-level block)
      (model.findCellForBlock as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;
            if (id === 'new-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingBlock };
            if (index === 1) return { id: 'new-1', holder: newBlockHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(-1),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model });

      const onCall = (api.events.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => call[0] === 'block changed'
      );
      const handler = onCall?.[1] as (data: unknown) => void;

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-1', holder: newBlockHolder },
            index: 1,
          },
        },
      });

      // Block should NOT have been claimed into the cell since it's outside the grid
      // and the current block is not owned by this table
      expect(container.contains(newBlockHolder)).toBe(false);

      newBlockHolder.remove();
    });

    it('should claim block outside the grid when current block is owned by this table', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // New block holder is outside the grid (placed by insertToDOM after the table)
      const newBlockHolder = document.createElement('div');

      newBlockHolder.setAttribute('data-blok-id', 'new-1');
      document.body.appendChild(newBlockHolder);

      const model = createMockModel();

      // existing-1 IS tracked by the model in cell (0,0) — simulating that the
      // current block is a cell paragraph owned by this table
      (model.findCellForBlock as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === 'existing-1') return { row: 0, col: 0 };

        return null;
      });

      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;
            if (id === 'new-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingBlock };
            if (index === 1) return { id: 'new-1', holder: newBlockHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model });

      const onCall = (api.events.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => call[0] === 'block changed'
      );
      const handler = onCall?.[1] as (data: unknown) => void;

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-1', holder: newBlockHolder },
            index: 1,
          },
        },
      });

      // Block SHOULD have been claimed into the cell because the current block
      // (existing-1 at index 0) is owned by this table
      expect(container.contains(newBlockHolder)).toBe(true);

      newBlockHolder.remove();
    });

    it('should not claim block if it is already inside a cell', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);

      // New block already in the container (already claimed)
      const newBlockHolder = document.createElement('div');

      newBlockHolder.setAttribute('data-blok-id', 'new-1');
      container.appendChild(newBlockHolder);

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const appendChildSpy = vi.spyOn(container, 'appendChild');

      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;
            if (id === 'new-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingBlock };
            if (index === 1) return { id: 'new-1', holder: newBlockHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const onCall = (api.events.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => call[0] === 'block changed'
      );
      const handler = onCall?.[1] as (data: unknown) => void;

      // Simulate a block-added event for a block that's already in cell
      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-1', holder: newBlockHolder },
            index: 1,
          },
        },
      });

      // appendChild should NOT have been called by the handler since the block is already in cell
      expect(appendChildSpy).not.toHaveBeenCalled();
    });

    it('should find cell from next block when previous block is not in a cell', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const existingBlock = document.createElement('div');

      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // A block not in any cell (previous to index 0)
      const outsideBlock = document.createElement('div');

      outsideBlock.setAttribute('data-blok-id', 'outside-1');

      const api = {
        blocks: {
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'new-1', holder: document.createElement('div') };
            if (index === 1) return { id: 'existing-1', holder: existingBlock };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // Block at index 0 — no previous block, but next block (index 1) is in a cell
      const foundCell = cellBlocks.findCellForNewBlock(0);

      expect(foundCell).toBe(cell);
    });

    it('should return null when no adjacent block is in a cell', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');

      const outsideBlock1 = document.createElement('div');

      outsideBlock1.setAttribute('data-blok-id', 'out-1');

      const outsideBlock2 = document.createElement('div');

      outsideBlock2.setAttribute('data-blok-id', 'out-2');

      const api = {
        blocks: {
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'out-1', holder: outsideBlock1 };
            if (index === 1) return { id: 'new-1', holder: document.createElement('div') };
            if (index === 2) return { id: 'out-2', holder: outsideBlock2 };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(3),
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const foundCell = cellBlocks.findCellForNewBlock(1);

      expect(foundCell).toBeNull();
    });
  });

  describe('empty cell guarantee', () => {
    it('should insert a paragraph block when cell has no blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'replacement-p',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      // Container is empty — no block holders
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      cellBlocks.ensureCellHasBlock(cell);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        1,
        true
      );
      expect(container.contains(mockBlockHolder)).toBe(true);
    });

    it('should NOT insert a block when cell already has blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockInsert = vi.fn();

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1) },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      const existingBlock = document.createElement('div');
      existingBlock.setAttribute('data-blok-id', 'existing-1');
      container.appendChild(existingBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      cellBlocks.ensureCellHasBlock(cell);

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should auto-fill cell when block-removed event leaves cell empty (after microtask)', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'auto-p',
        holder: mockBlockHolder,
      });

      let blockChangedCallback: ((data: unknown) => void) | undefined;

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(0),
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn((eventName: string, cb: (data: unknown) => void) => {
            if (eventName === 'block changed') {
              blockChangedCallback = cb;
            }
          }),
          off: vi.fn(),
        },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      // Block that will be "removed"
      const removedBlock = document.createElement('div');
      removedBlock.setAttribute('data-blok-id', 'removed-1');
      container.appendChild(removedBlock);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // Configure mock model to know about the block in cell (0,0)
      const model = createMockModel();

      vi.mocked(model.findCellForBlock).mockReturnValue({ row: 0, col: 0 });

      // Constructor subscribes to block events (side effect only)
      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model });

      // Simulate block removal — remove from DOM, then fire event
      removedBlock.remove();

      blockChangedCallback?.({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'removed-1', holder: removedBlock },
            index: 0,
          },
        },
      });

      // ensureCellHasBlock is now deferred — should NOT have been called yet
      expect(mockInsert).not.toHaveBeenCalled();

      // Flush the microtask queue
      await Promise.resolve();

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        0,
        true
      );
    });

    it('should NOT create a spurious paragraph when block-removed is immediately followed by block-added (replace scenario)', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'spurious-p',
        holder: mockBlockHolder,
      });

      let blockChangedCallback: ((data: unknown) => void) | undefined;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      // Cell with two blocks: the first will be replaced, the second provides adjacency
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      // Block being replaced (paragraph -> list)
      const originalBlock = document.createElement('div');
      originalBlock.setAttribute('data-blok-id', 'para-1');
      container.appendChild(originalBlock);

      // Second block in same cell (provides adjacency for findCellForNewBlock)
      const siblingBlock = document.createElement('div');
      siblingBlock.setAttribute('data-blok-id', 'sibling-1');
      container.appendChild(siblingBlock);

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // The replacement block (e.g. a list) that will be added at index 0.
      // In real code, replaceWith() places it where the original was (inside the
      // cell container), so it is already inside the grid when block-added fires.
      const replacementHolder = document.createElement('div');
      replacementHolder.setAttribute('data-blok-id', 'list-1');
      container.appendChild(replacementHolder);

      // After replace: flat list is [list-1 (index 0), sibling-1 (index 1)]
      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'list-1') return 0;
            if (id === 'sibling-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'list-1', holder: replacementHolder };
            if (index === 1) return { id: 'sibling-1', holder: siblingBlock };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn((eventName: string, cb: (data: unknown) => void) => {
            if (eventName === 'block changed') {
              blockChangedCallback = cb;
            }
          }),
          off: vi.fn(),
        },
      } as unknown as API;

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // Step 1: block-removed fires (paragraph is being replaced)
      // Remove the old block from DOM as the editor would
      originalBlock.remove();

      blockChangedCallback?.({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'para-1', holder: originalBlock },
            index: 0,
          },
        },
      });

      // Step 2: block-added fires immediately (replacement list block)
      // replacementHolder is NOT yet in a cell, so findCellForNewBlock will find
      // the sibling at index 1 in the same cell and claim it there
      blockChangedCallback?.({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'list-1', holder: replacementHolder },
            index: 0,
          },
        },
      });

      // Flush microtask queue
      await Promise.resolve();

      // The deferred ensureCellHasBlock should have been cancelled for the cell,
      // so no spurious paragraph was inserted
      expect(mockInsert).not.toHaveBeenCalled();

      // The replacement block should have been claimed into the cell
      expect(container.contains(replacementHolder)).toBe(true);
    });

    it('should claim replacement block into the correct cell when cell has a single block', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const spuriousBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'spurious-p',
        holder: spuriousBlockHolder,
      });

      let blockChangedCallback: ((data: unknown) => void) | undefined;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      // Cell (0,0) with a single block — the one being replaced
      const cell00 = document.createElement('div');
      cell00.setAttribute('data-blok-table-cell', '');
      const container00 = document.createElement('div');
      container00.setAttribute(CELL_BLOCKS_ATTR, '');
      const paraBlock = document.createElement('div');
      paraBlock.setAttribute('data-blok-id', 'para-1');
      container00.appendChild(paraBlock);
      cell00.appendChild(container00);

      // Cell (0,1) with a single block — NOT the target cell
      const cell01 = document.createElement('div');
      cell01.setAttribute('data-blok-table-cell', '');
      const container01 = document.createElement('div');
      container01.setAttribute(CELL_BLOCKS_ATTR, '');
      const otherBlock = document.createElement('div');
      otherBlock.setAttribute('data-blok-id', 'other-1');
      container01.appendChild(otherBlock);
      cell01.appendChild(container01);

      row.appendChild(cell00);
      row.appendChild(cell01);
      gridElement.appendChild(row);

      // The replacement block (e.g. a list) — not yet in any cell
      const replacementHolder = document.createElement('div');
      replacementHolder.setAttribute('data-blok-id', 'list-1');

      // The table block itself sits at index 0 in the flat list
      const tableBlockHolder = document.createElement('div');
      tableBlockHolder.setAttribute('data-blok-id', 'table-1');

      // After replace: flat list is [table(0), list-1(1), other-1(2)]
      // Before replace: flat list was [table(0), para-1(1), other-1(2)]
      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'list-1') return 1;
            if (id === 'other-1') return 2;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'table-1', holder: tableBlockHolder };
            if (index === 1) return { id: 'list-1', holder: replacementHolder };
            if (index === 2) return { id: 'other-1', holder: otherBlock };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(3),
          setBlockParent: vi.fn(),
        },
        events: {
          on: vi.fn((eventName: string, cb: (data: unknown) => void) => {
            if (eventName === 'block changed') {
              blockChangedCallback = cb;
            }
          }),
          off: vi.fn(),
        },
      } as unknown as API;

      const model = createMockModel();
      vi.mocked(model.findCellForBlock).mockImplementation((blockId: string) => {
        if (blockId === 'para-1') return { row: 0, col: 0 };
        if (blockId === 'other-1') return { row: 0, col: 1 };

        return null;
      });

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model });

      // Step 1: block-removed fires BEFORE holder.remove()
      // At this point paraBlock.holder is still inside container00 in cell00
      blockChangedCallback?.({
        event: {
          type: 'block-removed',
          detail: {
            target: { id: 'para-1', holder: paraBlock },
            index: 1,
          },
        },
      });

      // Step 2: Editor removes old holder from DOM (blocks.ts:173)
      paraBlock.remove();

      // Step 3: Editor inserts new holder into main editor area (not in any cell)
      // (In reality this happens via insertAdjacentElement on the table block)

      // Step 4: block-added fires with new holder NOT in any cell
      // Without the fix, findCellForNewBlock(1) checks:
      //   index 0 → tableBlockHolder (not in any cell) → null
      //   index 2 → otherBlock in cell01 → returns cell01 (WRONG!)
      blockChangedCallback?.({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'list-1', holder: replacementHolder },
            index: 1,
          },
        },
      });

      // Flush microtask queue
      await Promise.resolve();

      // The replacement block should be in cell (0,0), NOT cell (0,1)
      expect(container00.contains(replacementHolder)).toBe(true);
      expect(container01.contains(replacementHolder)).toBe(false);

      // No spurious paragraph should have been inserted
      expect(mockInsert).not.toHaveBeenCalled();
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
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      const result = cellBlocks.initializeCells([['']]);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        1,
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
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      const result = cellBlocks.initializeCells([['Hello world']]);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Hello world' },
        expect.anything(),
        1,
        false
      );
      expect(result[0][0]).toEqual({ blocks: ['migrated-1'] });
    });

    it('should split string cells with <br> into multiple paragraph blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      let callCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        callCount++;

        return {
          id: `block-${callCount}`,
          holder: document.createElement('div'),
        };
      });

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      const result = cellBlocks.initializeCells([['line one<br>line two<br>line three']]);

      expect(mockInsert).toHaveBeenCalledTimes(3);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'line one' }, expect.anything(), 1, false);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'line two' }, expect.anything(), 1, false);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'line three' }, expect.anything(), 1, false);
      expect(result[0][0]).toEqual({ blocks: ['block-1', 'block-2', 'block-3'] });
    });

    it('should keep single-line string cells as one paragraph block', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'single-1',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      const result = cellBlocks.initializeCells([['no line breaks']]);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'no line breaks' }, expect.anything(), 1, false);
      expect(result[0][0]).toEqual({ blocks: ['single-1'] });
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
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      const result = cellBlocks.initializeCells([[{ blocks: ['existing-1'] }]]);

      expect(api.blocks.insert).not.toHaveBeenCalled();
      expect(mockGetBlockIndex).toHaveBeenCalledWith('existing-1');
      expect(container.contains(existingBlockHolder)).toBe(true);
      expect(result[0][0]).toEqual({ blocks: ['existing-1'] });
    });

    it('should set parentId on mounted existing blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const imageHolder = document.createElement('div');
      imageHolder.setAttribute('data-blok-id', 'image-1');
      const paragraphHolder = document.createElement('div');
      paragraphHolder.setAttribute('data-blok-id', 'cell-1');

      const blockMap: Record<string, { id: string; holder: HTMLElement }> = {
        'image-1': { id: 'image-1', holder: imageHolder },
        'cell-1': { id: 'cell-1', holder: paragraphHolder },
      };
      const indexMap: Record<string, number> = { 'image-1': 1, 'cell-1': 2 };

      const setBlockParentMock = vi.fn();
      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => indexMap[id]),
          getBlockByIndex: vi.fn((index: number) => {
            const entry = Object.entries(indexMap).find(([, i]) => i === index);

            return entry ? blockMap[entry[0]] : undefined;
          }),
          setBlockParent: setBlockParentMock,
        },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      cellBlocks.initializeCells([[{ blocks: ['image-1', 'cell-1'] }]]);

      // Both blocks should have their parent set to the table block
      expect(setBlockParentMock).toHaveBeenCalledWith('image-1', 'table-1');
      expect(setBlockParentMock).toHaveBeenCalledWith('cell-1', 'table-1');
    });

    it('should set parentId on newly created fallback blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const setBlockParentMock = vi.fn();
      const mockInsert = vi.fn().mockReturnValue({
        id: 'new-para-1',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: setBlockParentMock,
        },
        events: { on: vi.fn(), off: vi.fn() },
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
        model: createMockModel(),
      });

      cellBlocks.initializeCells([['']]);

      // Newly created fallback paragraph should also have parent set
      expect(setBlockParentMock).toHaveBeenCalledWith('new-para-1', 'table-1');
    });
  });

  describe('stripPlaceholders safety for non-paragraph blocks', () => {
    it('should be a no-op when cell contains a non-paragraph block without placeholder attributes', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const headerHolder = document.createElement('div');
      headerHolder.setAttribute('data-blok-id', 'header-1');

      const headerContent = document.createElement('h2');
      headerContent.setAttribute('contenteditable', 'true');
      headerContent.textContent = 'My Header';
      headerHolder.appendChild(headerContent);

      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        id: 'header-1',
        holder: headerHolder,
      });

      const api = {
        blocks: {
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // claimBlockForCell calls stripPlaceholders internally
      cellBlocks.claimBlockForCell(cell, 'header-1');

      // Block should be mounted in the container
      expect(container.contains(headerHolder)).toBe(true);
      // Header content should be completely unchanged
      expect(headerContent).toHaveTextContent('My Header');
      expect(headerContent.tagName).toBe('H2');
      expect(headerContent).toHaveAttribute('contenteditable', 'true');
      // Should have no placeholder attributes (and none should have been added)
      expect(headerContent).not.toHaveAttribute('data-blok-placeholder-active');
      expect(headerContent).not.toHaveAttribute('data-placeholder');
    });

    it('should strip placeholder attrs from paragraph but leave header block untouched in mixed cell', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Paragraph block WITH placeholder attributes
      const paragraphHolder = document.createElement('div');
      paragraphHolder.setAttribute('data-blok-id', 'para-1');

      const paragraphContent = document.createElement('div');
      paragraphContent.setAttribute('contenteditable', 'true');
      paragraphContent.setAttribute('data-blok-placeholder-active', 'true');
      paragraphContent.setAttribute('data-placeholder', 'Type something...');
      paragraphContent.textContent = '';
      paragraphHolder.appendChild(paragraphContent);

      // Header block WITHOUT placeholder attributes
      const headerHolder = document.createElement('div');
      headerHolder.setAttribute('data-blok-id', 'header-1');

      const headerContent = document.createElement('h2');
      headerContent.setAttribute('contenteditable', 'true');
      headerContent.textContent = 'My Header';
      headerHolder.appendChild(headerContent);

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'para-1') return 0;
            if (id === 'header-1') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'para-1', holder: paragraphHolder };
            if (index === 1) return { id: 'header-1', holder: headerHolder };

            return undefined;
          }),
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // initializeCells calls stripPlaceholders after mounting blocks
      cellBlocks.initializeCells([[{ blocks: ['para-1', 'header-1'] }]]);

      // Paragraph's placeholder attributes should be stripped
      expect(paragraphContent).not.toHaveAttribute('data-blok-placeholder-active');
      expect(paragraphContent).not.toHaveAttribute('data-placeholder');

      // Header block should be completely untouched
      expect(headerContent).toHaveTextContent('My Header');
      expect(headerContent.tagName).toBe('H2');
      expect(headerContent).toHaveAttribute('contenteditable', 'true');
      expect(headerContent).not.toHaveAttribute('data-blok-placeholder-active');
      expect(headerContent).not.toHaveAttribute('data-placeholder');
    });

    it('should not error when ensureCellHasBlock triggers stripPlaceholders on a cell with code block content', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const codeBlockHolder = document.createElement('div');
      codeBlockHolder.setAttribute('data-blok-id', 'code-1');

      const codeContent = document.createElement('pre');
      const codeElement = document.createElement('code');
      codeElement.textContent = 'const x = 42;';
      codeContent.appendChild(codeElement);
      codeBlockHolder.appendChild(codeContent);

      const mockInsert = vi.fn().mockReturnValue({
        id: 'code-1',
        holder: codeBlockHolder,
      });

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      // Container is empty — ensureCellHasBlock will insert and call stripPlaceholders
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      // Should not throw — stripPlaceholders should be safe even for code blocks
      expect(() => cellBlocks.ensureCellHasBlock(cell)).not.toThrow();

      // Code content should be unchanged
      expect(codeElement).toHaveTextContent('const x = 42;');
      expect(codeContent.tagName).toBe('PRE');
    });
  });

  describe('getBlockIdsFromCells', () => {
    it('should collect block IDs from cells with blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-blok-table-row', '');

      // Cell with two blocks
      const cell0 = document.createElement('div');
      cell0.setAttribute('data-blok-table-cell', '');
      const container0 = document.createElement('div');
      container0.setAttribute(CELL_BLOCKS_ATTR, '');
      const block0a = document.createElement('div');
      block0a.setAttribute('data-blok-id', 'block-a');
      const block0b = document.createElement('div');
      block0b.setAttribute('data-blok-id', 'block-b');
      container0.appendChild(block0a);
      container0.appendChild(block0b);
      cell0.appendChild(container0);

      // Cell with one block
      const cell1 = document.createElement('div');
      cell1.setAttribute('data-blok-table-cell', '');
      const container1 = document.createElement('div');
      container1.setAttribute(CELL_BLOCKS_ATTR, '');
      const block1 = document.createElement('div');
      block1.setAttribute('data-blok-id', 'block-c');
      container1.appendChild(block1);
      cell1.appendChild(container1);

      row.appendChild(cell0);
      row.appendChild(cell1);
      gridElement.appendChild(row);

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const ids = cellBlocks.getBlockIdsFromCells([cell0, cell1]);

      expect(ids).toEqual(['block-a', 'block-b', 'block-c']);
    });

    it('should return empty array for cells without a blocks container', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');

      // Cell without a blocks container
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const ids = cellBlocks.getBlockIdsFromCells([cell]);

      expect(ids).toEqual([]);
    });

    it('should return empty array for cells with empty blocks container', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      cell.appendChild(container);

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const ids = cellBlocks.getBlockIdsFromCells([cell]);

      expect(ids).toEqual([]);
    });
  });

  describe('deleteBlocks', () => {
    it('should delete blocks in reverse index order to avoid shifting', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockDelete = vi.fn();
      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'b1') return 0;
            if (id === 'b2') return 1;
            if (id === 'b3') return 2;

            return undefined;
          }),
          delete: mockDelete,
        },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      cellBlocks.deleteBlocks(['b1', 'b2', 'b3']);

      // Should delete in reverse order: 2, 1, 0
      expect(mockDelete).toHaveBeenCalledTimes(3);
      expect(mockDelete.mock.calls[0][0]).toBe(2);
      expect(mockDelete.mock.calls[1][0]).toBe(1);
      expect(mockDelete.mock.calls[2][0]).toBe(0);
    });

    it('should skip block IDs that have no index', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockDelete = vi.fn();
      const api = {
        blocks: {
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'b1') return 0;

            return undefined;
          }),
          delete: mockDelete,
        },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      cellBlocks.deleteBlocks(['b1', 'nonexistent', 'also-missing']);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith(0);
    });
  });

  describe('initializeCells recovery for missing blocks', () => {
    it('should preserve missing block IDs while rendering a fallback paragraph when all referenced blocks are missing', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const fallbackHolder = document.createElement('div');
      fallbackHolder.setAttribute('data-blok-id', 'fallback-p');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'fallback-p',
        holder: fallbackHolder,
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          getBlockByIndex: vi.fn().mockReturnValue(undefined),
          getBlocksCount: vi.fn().mockReturnValue(0),
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const result = cellBlocks.initializeCells([[{ blocks: ['nonexistent-block-id'] }]]);

      // A fallback paragraph should have been inserted
      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        0,
        false
      );
      // The container should contain the fallback block
      expect(container.contains(fallbackHolder)).toBe(true);
      // The normalized result should preserve original IDs and append fallback ID(s)
      expect(result[0][0].blocks[0]).toBe('nonexistent-block-id');
      expect(result[0][0].blocks[1]).toBe('fallback-p');
    });

    it('should preserve missing IDs when a cell mixes existing and missing block references', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const existingHolder = document.createElement('div');
      existingHolder.setAttribute('data-blok-id', 'existing-1');

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'existing-1') return 0;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'existing-1', holder: existingHolder };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const result = cellBlocks.initializeCells([[{ blocks: ['existing-1', 'missing-1'] }]]);

      // The existing block should be mounted
      expect(container.contains(existingHolder)).toBe(true);
      // No fallback needed — cell has at least one block
      expect(api.blocks.insert).not.toHaveBeenCalled();
      // Normalized content should preserve both existing and missing IDs
      expect(result[0][0]).toEqual({ blocks: ['existing-1', 'missing-1'] });
    });

    it('should preserve missing IDs for body cells while rendering fallbacks in a mixed 3x3 table', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Header row blocks exist, body row blocks are missing (the real-world bug scenario)
      const headerHolders = ['h1', 'h2', 'h3'].map(id => {
        const holder = document.createElement('div');
        holder.setAttribute('data-blok-id', id);

        return holder;
      });

      let insertCallCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        const holder = document.createElement('div');
        const id = `fallback-${insertCallCount++}`;
        holder.setAttribute('data-blok-id', id);

        return { id, holder };
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn((id: string) => {
            const headerIndex = ['h1', 'h2', 'h3'].indexOf(id);
            if (headerIndex !== -1) return headerIndex;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index < 3) return { id: ['h1', 'h2', 'h3'][index], holder: headerHolders[index] };

            return undefined;
          }),
          getBlocksCount: vi.fn().mockReturnValue(3),
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      // Build 3x3 grid
      const gridElement = document.createElement('div');

      for (let r = 0; r < 3; r++) {
        const row = document.createElement('div');
        row.setAttribute('data-blok-table-row', '');

        for (let c = 0; c < 3; c++) {
          const cell = document.createElement('div');
          cell.setAttribute('data-blok-table-cell', '');
          const container = document.createElement('div');
          container.setAttribute(CELL_BLOCKS_ATTR, '');
          cell.appendChild(container);
          row.appendChild(cell);
        }
        gridElement.appendChild(row);
      }

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const content = [
        [{ blocks: ['h1'] }, { blocks: ['h2'] }, { blocks: ['h3'] }],
        [{ blocks: ['missing-1'] }, { blocks: ['missing-2'] }, { blocks: ['missing-3'] }],
        [{ blocks: ['missing-4'] }, { blocks: ['missing-5'] }, { blocks: ['missing-6'] }],
      ];

      const result = cellBlocks.initializeCells(content);

      // Header row: blocks exist, should be mounted, no insert calls
      expect(result[0][0]).toEqual({ blocks: ['h1'] });
      expect(result[0][1]).toEqual({ blocks: ['h2'] });
      expect(result[0][2]).toEqual({ blocks: ['h3'] });

      // Body rows: blocks are missing, fallback paragraphs should be created
      expect(mockInsert).toHaveBeenCalledTimes(6);

      // Body rows should keep original missing IDs and append fallback IDs in normalized output
      for (let r = 1; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          expect(result[r][c].blocks[0]).toBe(content[r][c].blocks[0]);
          expect(result[r][c].blocks[1]).toMatch(/^fallback-/);

          const bodyCell = gridElement
            .querySelectorAll('[data-blok-table-row]')
            [r]
            ?.querySelectorAll('[data-blok-table-cell]')[c] as HTMLElement | undefined;
          const bodyContainer = bodyCell?.querySelector(`[${CELL_BLOCKS_ATTR}]`);
          const renderedFallback = bodyContainer?.querySelector('[data-blok-id]');

          expect(renderedFallback).not.toBeNull();
          expect(renderedFallback?.getAttribute('data-blok-id')).toMatch(/^fallback-/);
        }
      }
    });
  });

  describe('initializeCells with multiple blocks per cell', () => {
    it('should mount all block references when cell has multiple blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const holderA = document.createElement('div');
      const holderB = document.createElement('div');

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            if (id === 'block-a') return 0;
            if (id === 'block-b') return 1;

            return undefined;
          }),
          getBlockByIndex: vi.fn((index: number) => {
            if (index === 0) return { id: 'block-a', holder: holderA };
            if (index === 1) return { id: 'block-b', holder: holderB };

            return undefined;
          }),
          setBlockParent: vi.fn(),
        },
        events: { on: vi.fn(), off: vi.fn() },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const result = cellBlocks.initializeCells([[{ blocks: ['block-a', 'block-b'] }]]);

      expect(container.contains(holderA)).toBe(true);
      expect(container.contains(holderB)).toBe(true);
      // Should preserve the original block references
      expect(result[0][0]).toEqual({ blocks: ['block-a', 'block-b'] });
      // Should not have called insert (blocks already exist)
      expect(api.blocks.insert).not.toHaveBeenCalled();
    });
  });

  describe('Enter key in cell', () => {
    it('should not be prevented by table keyboard handler', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      const block = document.createElement('div');

      block.setAttribute('data-blok-id', 'b1');
      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      block.appendChild(editable);
      container.appendChild(block);
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const api = { blocks: {}, events: { on: vi.fn(), off: vi.fn() } } as unknown as API;
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1', model: createMockModel() });

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      // Enter should NOT be prevented — let the editor handle it
      expect(preventSpy).not.toHaveBeenCalled();
    });
  });
});
