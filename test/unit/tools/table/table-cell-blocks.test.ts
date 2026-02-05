import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TableCellBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('detectMarkdownListTrigger', () => {
    it('should detect unordered list trigger "- "', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('- ');
      expect(result).toEqual({ style: 'unordered', textAfter: '' });
    });

    it('should detect ordered list trigger "1. "', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('1. ');
      expect(result).toEqual({ style: 'ordered', textAfter: '' });
    });

    it('should detect checklist trigger "[] "', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('[] ');
      expect(result).toEqual({ style: 'checklist', textAfter: '' });
    });

    it('should capture text after trigger', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('- Hello world');
      expect(result).toEqual({ style: 'unordered', textAfter: 'Hello world' });
    });

    it('should return null for non-matching content', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      expect(detectMarkdownListTrigger('Hello world')).toBeNull();
      expect(detectMarkdownListTrigger('--')).toBeNull();
      expect(detectMarkdownListTrigger('2. ')).toBeNull(); // Only "1. " triggers
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

  describe('convertCellToBlocks', () => {
    let mockApi: {
      blocks: {
        insert: ReturnType<typeof vi.fn>;
      };
    };
    let gridEl: HTMLElement;
    let cell: HTMLElement;

    beforeEach(() => {
      vi.clearAllMocks();

      mockApi = {
        blocks: {
          insert: vi.fn().mockReturnValue({ id: 'list-item-1' }),
        },
      };

      gridEl = document.createElement('div');

      // Create a cell
      cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('contenteditable', 'true');
      cell.textContent = '- Item text';
      gridEl.appendChild(cell);
    });

    it('should convert cell from contenteditable to block container', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      const result = await cellBlocks.convertCellToBlocks(cell, 'unordered', 'Item text');

      // Cell should no longer be contenteditable
      expect(cell.getAttribute('contenteditable')).toBe('false');

      // Should have a blocks container
      const container = cell.querySelector('[data-blok-table-cell-blocks]');
      expect(container).not.toBeNull();

      // Should return block IDs
      expect(result.blocks).toContain('list-item-1');
    });

    it('should insert a listItem block with correct data', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      await cellBlocks.convertCellToBlocks(cell, 'ordered', 'First item');

      expect(mockApi.blocks.insert).toHaveBeenCalledWith(
        'listItem',
        expect.objectContaining({
          text: 'First item',
          style: 'ordered',
          depth: 0,
        }),
        {}, // config
        undefined, // index
        true // needToFocus
      );
    });
  });

  describe('handleCellInput', () => {
    let mockApi: {
      blocks: {
        insert: ReturnType<typeof vi.fn>;
      };
    };
    let gridEl: HTMLElement;
    let cell: HTMLElement;

    beforeEach(() => {
      vi.clearAllMocks();

      mockApi = {
        blocks: {
          insert: vi.fn().mockReturnValue({ id: 'list-item-1' }),
        },
      };

      gridEl = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      gridEl.appendChild(row);

      cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('contenteditable', 'true');
      row.appendChild(cell);
    });

    it('should detect markdown trigger and convert cell', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      const convertSpy = vi
        .spyOn(cellBlocks, 'convertCellToBlocks')
        .mockResolvedValue({ blocks: ['b1'] });

      cell.textContent = '- ';

      await cellBlocks.handleCellInput(cell);

      expect(convertSpy).toHaveBeenCalledWith(cell, 'unordered', '');
    });

    it('should pass text after trigger to convertCellToBlocks', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      const convertSpy = vi
        .spyOn(cellBlocks, 'convertCellToBlocks')
        .mockResolvedValue({ blocks: ['b1'] });

      cell.textContent = '1. Start typing';

      await cellBlocks.handleCellInput(cell);

      expect(convertSpy).toHaveBeenCalledWith(cell, 'ordered', 'Start typing');
    });

    it('should not convert if no markdown trigger detected', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      const convertSpy = vi
        .spyOn(cellBlocks, 'convertCellToBlocks')
        .mockResolvedValue({ blocks: ['b1'] });

      cell.textContent = 'Regular text';

      await cellBlocks.handleCellInput(cell);

      expect(convertSpy).not.toHaveBeenCalled();
    });

    it('should not convert if cell already has blocks', async () => {
      const { TableCellBlocks } = await import('../../../../src/tools/table/table-cell-blocks');

      const cellBlocks = new TableCellBlocks({
        api: mockApi as never,
        gridElement: gridEl,
        tableBlockId: 'table-1',
      });

      const convertSpy = vi
        .spyOn(cellBlocks, 'convertCellToBlocks')
        .mockResolvedValue({ blocks: ['b1'] });

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');
      cell.appendChild(container);
      cell.setAttribute('contenteditable', 'false');

      await cellBlocks.handleCellInput(cell);

      expect(convertSpy).not.toHaveBeenCalled();
    });
  });
});
