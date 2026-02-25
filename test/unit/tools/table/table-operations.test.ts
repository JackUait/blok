import type { API } from '../../../../types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('table-operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mountCellBlocksReadOnly', () => {
    it('should render legacy string content as plain text without creating blocks', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Create DOM structure: grid > row > cell > container
      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const mockInsert = vi.fn();

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Legacy content: array with a single row containing a string
      const legacyContent = [['Legacy content']];

      // Call the function
      mountCellBlocksReadOnly(gridElement, legacyContent, api, 'table-id');

      expect(mockInsert).not.toHaveBeenCalled();
      expect(container).toHaveTextContent('Legacy content');
    });

    it('should handle empty legacy string content', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const mockInsert = vi.fn();

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      const legacyContent = [['']];

      mountCellBlocksReadOnly(gridElement, legacyContent, api, 'table-id');

      expect(mockInsert).not.toHaveBeenCalled();
      expect(container).toHaveTextContent('');
    });

    it('should handle mixed legacy strings and block-based cells', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      // Cell 0: legacy string
      const cell0 = document.createElement('div');
      cell0.setAttribute(CELL_ATTR, '');
      const container0 = document.createElement('div');
      container0.setAttribute(CELL_BLOCKS_ATTR, '');
      cell0.appendChild(container0);

      // Cell 1: block-based
      const cell1 = document.createElement('div');
      cell1.setAttribute(CELL_ATTR, '');
      const container1 = document.createElement('div');
      container1.setAttribute(CELL_BLOCKS_ATTR, '');
      cell1.appendChild(container1);

      row.appendChild(cell0);
      row.appendChild(cell1);
      gridElement.appendChild(row);

      // Mock holders
      const legacyBlockHolder = document.createElement('div');
      legacyBlockHolder.setAttribute('data-blok-id', 'legacy-block');
      legacyBlockHolder.textContent = 'Legacy text';

      const existingBlockHolder = document.createElement('div');
      existingBlockHolder.setAttribute('data-blok-id', 'existing-block');
      existingBlockHolder.textContent = 'Existing block';

      const mockInsert = vi.fn().mockReturnValue({
        id: 'legacy-block',
        holder: legacyBlockHolder,
      });

      const mockGetBlockIndex = vi.fn((id: string) => {
        if (id === 'existing-block') return 0;
        if (id === 'legacy-block') return 1;
        return undefined;
      });

      const mockGetBlockByIndex = vi.fn((index: number) => {
        if (index === 0) return { id: 'existing-block', holder: existingBlockHolder };
        if (index === 1) return { id: 'legacy-block', holder: legacyBlockHolder };
        return undefined;
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Mixed content: first cell is legacy string, second is block-based
      const mixedContent = [
        ['Legacy text', { blocks: ['existing-block'] }]
      ];

      mountCellBlocksReadOnly(gridElement, mixedContent, api, 'table-id');

      // Legacy cell should render as plain text without block insertion.
      expect(mockInsert).not.toHaveBeenCalled();
      expect(container0).toHaveTextContent('Legacy text');

      // Verify existing block was mounted
      expect(container1.contains(existingBlockHolder)).toBe(true);
    });

    it('should handle block-based cells without modification', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const existingBlockHolder = document.createElement('div');
      existingBlockHolder.setAttribute('data-blok-id', 'block-1');

      const mockInsert = vi.fn();
      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        id: 'block-1',
        holder: existingBlockHolder,
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      const blockBasedContent = [[{ blocks: ['block-1'] }]];

      mountCellBlocksReadOnly(gridElement, blockBasedContent, api, 'table-id');

      // Should NOT call insert for block-based content
      expect(mockInsert).not.toHaveBeenCalled();

      // Should mount the existing block
      expect(container.contains(existingBlockHolder)).toBe(true);
    });

    it('should strip placeholder attributes from mounted blocks', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // Simulate a readonly paragraph block whose drawView() sets placeholder attributes
      const blockHolder = document.createElement('div');
      blockHolder.setAttribute('data-blok-id', 'block-1');

      const paragraphDiv = document.createElement('div');
      paragraphDiv.setAttribute('data-blok-placeholder-active', 'Type or press / for menu');
      paragraphDiv.setAttribute('data-placeholder', 'Some placeholder');
      blockHolder.appendChild(paragraphDiv);

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn().mockReturnValue(0),
          getBlockByIndex: vi.fn().mockReturnValue({
            id: 'block-1',
            holder: blockHolder,
          }),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      const content = [[{ blocks: ['block-1'] }]];

      mountCellBlocksReadOnly(gridElement, content, api, 'table-id');

      // Placeholder attributes must be stripped — paragraphs inside table cells
      // should not show standalone-paragraph placeholders (especially in readonly)
      expect(paragraphDiv.hasAttribute('data-blok-placeholder-active')).toBe(false);
      expect(paragraphDiv.hasAttribute('data-placeholder')).toBe(false);
    });

    it('should be idempotent when called multiple times with legacy string content', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Create DOM structure: grid > row > cell > container
      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const mockInsert = vi.fn();

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      const legacyContent = [['Test content']];

      // Call mountCellBlocksReadOnly TWICE (simulating rendered() being called multiple times)
      mountCellBlocksReadOnly(gridElement, legacyContent, api, 'table-id');
      mountCellBlocksReadOnly(gridElement, legacyContent, api, 'table-id');

      // Read-only legacy rendering should never insert blocks.
      expect(mockInsert).not.toHaveBeenCalled();
      expect(container).toHaveTextContent('Test content');
    });

    it('should not call setBlockParent or insert for legacy string cells in read-only mode', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const mockSetBlockParent = vi.fn();
      const mockInsert = vi.fn();

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          setBlockParent: mockSetBlockParent,
          getBlocksCount: vi.fn().mockReturnValue(5),
        },
      } as unknown as API;

      const legacyContent = [['Cell text']];
      const tableBlockId = 'table-block-123';

      mountCellBlocksReadOnly(gridElement, legacyContent, api, tableBlockId);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockSetBlockParent).not.toHaveBeenCalled();
      expect(container).toHaveTextContent('Cell text');
    });
  });

  describe('normalizeTableData', () => {
    it('should preserve initialColWidth when present in data', async () => {
      const { normalizeTableData } = await import('../../../../src/tools/table/table-operations');

      const data = {
        withHeadings: false,
        withHeadingColumn: false,
        content: [['a', 'b']],
        colWidths: [200, 300],
        initialColWidth: 250,
      };

      const result = normalizeTableData(data, {});

      expect(result.initialColWidth).toBe(250);
    });

    it('should return undefined initialColWidth when not in data', async () => {
      const { normalizeTableData } = await import('../../../../src/tools/table/table-operations');

      const data = {
        withHeadings: false,
        withHeadingColumn: false,
        content: [['a', 'b']],
        colWidths: [200, 300],
      };

      const result = normalizeTableData(data, {});

      expect(result.initialColWidth).toBeUndefined();
    });
  });

  describe('computeInitialColWidth', () => {
    it('should return the average of column widths', async () => {
      const { computeInitialColWidth } = await import('../../../../src/tools/table/table-operations');

      expect(computeInitialColWidth([200, 300, 100])).toBe(200);
    });

    it('should return 0 for empty array', async () => {
      const { computeInitialColWidth } = await import('../../../../src/tools/table/table-operations');

      expect(computeInitialColWidth([])).toBe(0);
    });

    it('should round to 2 decimal places', async () => {
      const { computeInitialColWidth } = await import('../../../../src/tools/table/table-operations');

      expect(computeInitialColWidth([100, 100, 100])).toBe(100);
      expect(computeInitialColWidth([150, 250])).toBe(200);
    });
  });

  describe('computeInsertColumnWidths', () => {
    it('should use initialColWidth/2 for inserted column width when initialColWidth is set', async () => {
      const { computeInsertColumnWidths } = await import('../../../../src/tools/table/table-operations');
      const { TableGrid, CELL_ATTR } = await import('../../../../src/tools/table/table-core');

      const grid = new TableGrid({ readOnly: false });
      const gridEl = grid.createGrid(1, 3, [200, 300, 100]);

      // Apply pixel widths to cells so the grid is in px mode
      const cells = gridEl.querySelectorAll(`[${CELL_ATTR}]`);
      (cells[0] as HTMLElement).style.width = '200px';
      (cells[1] as HTMLElement).style.width = '300px';
      (cells[2] as HTMLElement).style.width = '100px';

      const data = {
        withHeadings: false,
        withHeadingColumn: false,
        content: [['a', 'b', 'c']],
        colWidths: [200, 300, 100],
        initialColWidth: 250,
      };

      const result = computeInsertColumnWidths(gridEl, 1, data.colWidths, data.initialColWidth, grid);

      // New column should be initialColWidth / 2 = 125
      expect(result).toEqual([200, 125, 300, 100]);
    });

    it('should fall back to half-average when initialColWidth is not set', async () => {
      const { computeInsertColumnWidths } = await import('../../../../src/tools/table/table-operations');
      const { TableGrid, CELL_ATTR } = await import('../../../../src/tools/table/table-core');

      const grid = new TableGrid({ readOnly: false });
      const gridEl = grid.createGrid(1, 3, [200, 300, 100]);

      const cells = gridEl.querySelectorAll(`[${CELL_ATTR}]`);
      (cells[0] as HTMLElement).style.width = '200px';
      (cells[1] as HTMLElement).style.width = '300px';
      (cells[2] as HTMLElement).style.width = '100px';

      const data = {
        withHeadings: false,
        withHeadingColumn: false,
        content: [['a', 'b', 'c']],
        colWidths: [200, 300, 100],
      };

      const result = computeInsertColumnWidths(gridEl, 1, data.colWidths, undefined, grid);

      // Half average of [200, 300, 100] = 100
      expect(result).toEqual([200, 100, 300, 100]);
    });
  });

  describe('SCROLL_OVERFLOW_CLASSES', () => {
    it('should include overflow-y-hidden to prevent implicit vertical scrollbar from overflow-x-auto', async () => {
      const { SCROLL_OVERFLOW_CLASSES } = await import('../../../../src/tools/table/table-operations');

      // CSS spec: setting overflow-x to non-visible without setting overflow-y
      // causes the browser to compute overflow-y as 'auto' instead of 'visible'.
      // This creates an unwanted vertical scrollbar when absolutely-positioned
      // children (e.g. the add-row button) extend beyond the wrapper.
      // SCROLL_OVERFLOW_CLASSES must explicitly set overflow-y to prevent this.
      expect(SCROLL_OVERFLOW_CLASSES).toContain('overflow-y-hidden');
    });

    it('should apply overflow-y-hidden via enableScrollOverflow', async () => {
      const { enableScrollOverflow } = await import('../../../../src/tools/table/table-operations');

      const element = document.createElement('div');

      enableScrollOverflow(element);

      expect(element.classList.contains('overflow-y-hidden')).toBe(true);
      expect(element.classList.contains('overflow-x-auto')).toBe(true);
    });
  });
});
