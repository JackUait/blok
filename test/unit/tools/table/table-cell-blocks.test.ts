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
      };
      events: {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
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
        events: {
          on: vi.fn(),
          off: vi.fn(),
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

      block.setAttribute('data-blok-id', `blk-${Math.random()}`);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      block.appendChild(editable);
      container.appendChild(block);
      cell.appendChild(container);

      return { cell, editable };
    };

    let mockApi: { blocks: { delete: ReturnType<typeof vi.fn> }; events: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } };
    let gridEl: HTMLElement;
    let onNavigateToCell: (position: { row: number; col: number }) => void;
    let cellBlocksAttr: string;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockApi = { blocks: { delete: vi.fn() }, events: { on: vi.fn(), off: vi.fn() } };

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
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      expect(focusSpy).toHaveBeenCalled();
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
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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
        },
        events: {
          on: vi.fn(),
          off: vi.fn(),
        },
      } as unknown as API;

      new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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
        blocks: { insert: mockInsert },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      cellBlocks.ensureCellHasBlock(cell);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        undefined,
        true
      );
      expect(container.contains(mockBlockHolder)).toBe(true);
    });

    it('should NOT insert a block when cell already has blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockInsert = vi.fn();

      const api = {
        blocks: { insert: mockInsert },
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

      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      cellBlocks.ensureCellHasBlock(cell);

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should auto-fill cell when block-removed event leaves cell empty', async () => {
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

      // Constructor subscribes to block events (side effect only)
      new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

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

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        undefined,
        true
      );
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
      });

      const result = cellBlocks.initializeCells([[{ blocks: ['existing-1'] }]]);

      expect(api.blocks.insert).not.toHaveBeenCalled();
      expect(mockGetBlockIndex).toHaveBeenCalledWith('existing-1');
      expect(container.contains(existingBlockHolder)).toBe(true);
      expect(result[0][0]).toEqual({ blocks: ['existing-1'] });
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
      const cellBlocks = new TableCellBlocks({ api, gridElement, tableBlockId: 't1' });

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      cellBlocks.handleKeyDown(event, { row: 0, col: 0 });

      // Enter should NOT be prevented — let the editor handle it
      expect(preventSpy).not.toHaveBeenCalled();
    });
  });
});
