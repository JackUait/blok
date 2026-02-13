import type { API } from '../../../../types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('table-operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mountCellBlocksReadOnly', () => {
    it('should render legacy string content as paragraph blocks', async () => {
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

      // Mock API with blocks.insert that returns a block holder
      const mockBlockHolder = document.createElement('div');
      mockBlockHolder.setAttribute('data-blok-id', 'new-block-1');
      mockBlockHolder.textContent = 'Legacy content';

      const mockInsert = vi.fn().mockReturnValue({
        id: 'new-block-1',
        holder: mockBlockHolder,
      });

      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        id: 'new-block-1',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
        },
      } as unknown as API;

      // Legacy content: array with a single row containing a string
      const legacyContent = [['Legacy content']];

      // Call the function
      mountCellBlocksReadOnly(gridElement, legacyContent, api);

      // Verify that api.blocks.insert was called with correct parameters
      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Legacy content' },
        expect.anything(),
        undefined,
        true
      );

      // Verify that the block holder was appended to the container
      expect(container.contains(mockBlockHolder)).toBe(true);
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

      const mockBlockHolder = document.createElement('div');
      mockBlockHolder.setAttribute('data-blok-id', 'empty-block');

      const mockInsert = vi.fn().mockReturnValue({
        id: 'empty-block',
        holder: mockBlockHolder,
      });

      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        id: 'empty-block',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
        },
      } as unknown as API;

      const legacyContent = [['']];

      mountCellBlocksReadOnly(gridElement, legacyContent, api);

      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        expect.anything(),
        undefined,
        true
      );

      expect(container.contains(mockBlockHolder)).toBe(true);
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
        },
      } as unknown as API;

      // Mixed content: first cell is legacy string, second is block-based
      const mixedContent = [
        ['Legacy text', { blocks: ['existing-block'] }]
      ];

      mountCellBlocksReadOnly(gridElement, mixedContent, api);

      // Verify legacy string was converted
      expect(mockInsert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Legacy text' },
        expect.anything(),
        undefined,
        true
      );
      expect(container0.contains(legacyBlockHolder)).toBe(true);

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
        },
      } as unknown as API;

      const blockBasedContent = [[{ blocks: ['block-1'] }]];

      mountCellBlocksReadOnly(gridElement, blockBasedContent, api);

      // Should NOT call insert for block-based content
      expect(mockInsert).not.toHaveBeenCalled();

      // Should mount the existing block
      expect(container.contains(existingBlockHolder)).toBe(true);
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

      // Mock API that creates a new block holder each time insert is called
      let insertCallCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        insertCallCount++;
        const holder = document.createElement('div');
        holder.setAttribute('data-blok-id', `block-${insertCallCount}`);
        holder.textContent = 'Test content';
        return { id: `block-${insertCallCount}`, holder };
      });

      const api = {
        blocks: {
          insert: mockInsert,
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
        },
      } as unknown as API;

      const legacyContent = [['Test content']];

      // Call mountCellBlocksReadOnly TWICE (simulating rendered() being called multiple times)
      mountCellBlocksReadOnly(gridElement, legacyContent, api);
      mountCellBlocksReadOnly(gridElement, legacyContent, api);

      // CRITICAL: api.blocks.insert should only be called ONCE, not twice
      expect(mockInsert).toHaveBeenCalledTimes(1);

      // Verify only ONE block exists in the container
      const blocksInContainer = container.querySelectorAll('[data-blok-id]');
      expect(blocksInContainer.length).toBe(1);

      // Verify the content is not duplicated
      expect(container.textContent).toBe('Test content');
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
});
