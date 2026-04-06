import type { API } from '../../../../types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('table-operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mountCellBlocksReadOnly', () => {
    it('should render legacy string content as plain text without creating blocks', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Create DOM structure: grid > row > cell > container
      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

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
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

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
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      // Cell 0: legacy string
      const cell0 = document.createElement('div');
      cell0.setAttribute(CELL_ATTR, '');
      cell0.setAttribute(CELL_COL_ATTR, '0');
      const container0 = document.createElement('div');
      container0.setAttribute(CELL_BLOCKS_ATTR, '');
      cell0.appendChild(container0);

      // Cell 1: block-based
      const cell1 = document.createElement('div');
      cell1.setAttribute(CELL_ATTR, '');
      cell1.setAttribute(CELL_COL_ATTR, '1');
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
        if (index === 0) return { id: 'existing-block', holder: existingBlockHolder, parentId: 'table-id' };
        if (index === 1) return { id: 'legacy-block', holder: legacyBlockHolder, parentId: 'table-id' };
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
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

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
        parentId: 'table-id',
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
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

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
            parentId: 'table-id',
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
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Create DOM structure: grid > row > cell > container
      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

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

    it('should render legacy string HTML markup as real HTML, not as literal text', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Legacy content containing HTML markup (e.g. bold text from a rich-text paste)
      const legacyContent = [['Hello <b>world</b>']];

      mountCellBlocksReadOnly(gridElement, legacyContent, api, 'table-id');

      // The text should be visible and correct
      expect(container.textContent).toBe('Hello world');
      // The HTML must be interpreted — a <b> element must exist in the DOM,
      // NOT appear as the literal string "<b>world</b>"
      expect(container.querySelector('b')).not.toBeNull();
      expect(container.innerHTML).not.toContain('&lt;b&gt;');
    });

    it('should not call setBlockParent or insert for legacy string cells in read-only mode', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

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

    it('should not steal a block holder that is already mounted in another table cell', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // --- Grid 1: one row, one cell ---
      const grid1 = document.createElement('div');
      const row1 = document.createElement('div');
      row1.setAttribute(ROW_ATTR, '');

      const cell1 = document.createElement('div');
      cell1.setAttribute(CELL_ATTR, '');
      cell1.setAttribute(CELL_COL_ATTR, '0');

      const container1 = document.createElement('div');
      container1.setAttribute(CELL_BLOCKS_ATTR, '');
      container1.setAttribute('data-blok-nested-blocks', '');

      cell1.appendChild(container1);
      row1.appendChild(cell1);
      grid1.appendChild(row1);

      // --- Grid 2: one row, one cell ---
      const grid2 = document.createElement('div');
      const row2 = document.createElement('div');
      row2.setAttribute(ROW_ATTR, '');

      const cell2 = document.createElement('div');
      cell2.setAttribute(CELL_ATTR, '');
      cell2.setAttribute(CELL_COL_ATTR, '0');

      const container2 = document.createElement('div');
      container2.setAttribute(CELL_BLOCKS_ATTR, '');
      container2.setAttribute('data-blok-nested-blocks', '');

      cell2.appendChild(container2);
      row2.appendChild(cell2);
      grid2.appendChild(row2);

      // Shared block holder referenced by both tables
      const sharedBlockHolder = document.createElement('div');
      sharedBlockHolder.setAttribute('data-blok-id', 'shared-block');

      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        id: 'shared-block',
        holder: sharedBlockHolder,
        parentId: 'table-1',
      });

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Both tables reference the same block ID (corrupted data)
      const content = [[{ blocks: ['shared-block'] }]];

      // Mount grid1 first — block belongs to table-1 so it should land in container1
      mountCellBlocksReadOnly(grid1, content, api, 'table-1');

      // Mount grid2 second — block belongs to table-1, not table-2, so it must be skipped
      mountCellBlocksReadOnly(grid2, content, api, 'table-2');

      // Grid1's cell must still contain the block holder
      expect(container1.contains(sharedBlockHolder)).toBe(true);
      // Grid2's cell must NOT have the block (parent mismatch → skipped)
      expect(container2.contains(sharedBlockHolder)).toBe(false);
      expect(container2.children).toHaveLength(0);
    });

    it('should wrap legacy string content in a div with leading-[1.5] to match paragraph line-height', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      const legacyContent = [['Hello world']];

      mountCellBlocksReadOnly(gridElement, legacyContent, api, 'table-id');

      // Legacy text must be wrapped in a div with leading-[1.5] so its
      // line-height matches paragraph blocks used in edit mode.
      const wrapper = container.querySelector('div');

      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains('leading-[1.5]')).toBe(true);
      expect(wrapper!.textContent).toBe('Hello world');
    });

    it('should not duplicate block holders when called on a container that already has them mounted', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // Create DOM structure: grid > row > cell > container (with nested-blocks attr)
      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      container.setAttribute('data-blok-nested-blocks', '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // Simulate edit mode: block holder is ALREADY mounted inside the container
      const blockHolder = document.createElement('div');
      blockHolder.setAttribute('data-blok-id', 'block-1');
      blockHolder.textContent = 'Cell content';
      container.appendChild(blockHolder);

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn().mockReturnValue(0),
          getBlockByIndex: vi.fn().mockReturnValue({
            id: 'block-1',
            holder: blockHolder,
            parentId: 'table-id',
          }),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      const content = [[{ blocks: ['block-1'] }]];

      // This simulates setReadOnly(true) calling mountCellBlocksReadOnly
      // while block holders are still in the container from edit mode.
      mountCellBlocksReadOnly(gridElement, content, api, 'table-id');

      // Must have exactly ONE block holder, not a duplicate
      const holders = container.querySelectorAll('[data-blok-id]');
      expect(holders).toHaveLength(1);
      expect(container.textContent).toBe('Cell content');
    });

    it('should skip blocks whose parent does not match the table block ID', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const gridElement = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');

      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, '0');

      const container = document.createElement('div');
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      container.setAttribute('data-blok-nested-blocks', '');

      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      // Block that belongs to THIS table
      const ownBlockHolder = document.createElement('div');
      ownBlockHolder.setAttribute('data-blok-id', 'own-block');
      ownBlockHolder.textContent = 'Own content';

      // Block that belongs to ANOTHER table (cross-table reference)
      const foreignBlockHolder = document.createElement('div');
      foreignBlockHolder.setAttribute('data-blok-id', 'foreign-block');
      foreignBlockHolder.textContent = 'Foreign content';

      const mockGetBlockIndex = vi.fn((id: string) => {
        if (id === 'own-block') return 0;
        if (id === 'foreign-block') return 1;
        return undefined;
      });

      const mockGetBlockByIndex = vi.fn((index: number) => {
        if (index === 0) return { id: 'own-block', holder: ownBlockHolder, parentId: 'table-1' };
        if (index === 1) return { id: 'foreign-block', holder: foreignBlockHolder, parentId: 'table-2' };
        return undefined;
      });

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
          getBlocksCount: vi.fn().mockReturnValue(2),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Corrupted content: cell references both own block and foreign block
      const content = [[{ blocks: ['own-block', 'foreign-block'] }]];

      mountCellBlocksReadOnly(gridElement, content, api, 'table-1');

      // Only the own block should be mounted; foreign block must be skipped
      const holders = container.querySelectorAll('[data-blok-id]');
      expect(holders).toHaveLength(1);
      expect(container.textContent).toBe('Own content');
    });

    it('should skip cross-table blocks instead of cloning them', async () => {
      const { mountCellBlocksReadOnly } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } = await import('../../../../src/tools/table/table-core');
      const { CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      // --- Grid 1 ---
      const grid1 = document.createElement('div');
      const row1 = document.createElement('div');
      row1.setAttribute(ROW_ATTR, '');

      const cell1 = document.createElement('div');
      cell1.setAttribute(CELL_ATTR, '');
      cell1.setAttribute(CELL_COL_ATTR, '0');

      const container1 = document.createElement('div');
      container1.setAttribute(CELL_BLOCKS_ATTR, '');
      container1.setAttribute('data-blok-nested-blocks', '');

      cell1.appendChild(container1);
      row1.appendChild(cell1);
      grid1.appendChild(row1);

      // --- Grid 2 ---
      const grid2 = document.createElement('div');
      const row2 = document.createElement('div');
      row2.setAttribute(ROW_ATTR, '');

      const cell2 = document.createElement('div');
      cell2.setAttribute(CELL_ATTR, '');
      cell2.setAttribute(CELL_COL_ATTR, '0');

      const container2 = document.createElement('div');
      container2.setAttribute(CELL_BLOCKS_ATTR, '');
      container2.setAttribute('data-blok-nested-blocks', '');

      cell2.appendChild(container2);
      row2.appendChild(cell2);
      grid2.appendChild(row2);

      // Block owned by table-1
      const sharedBlockHolder = document.createElement('div');
      sharedBlockHolder.setAttribute('data-blok-id', 'shared-block');
      sharedBlockHolder.innerHTML = '<div class="blok-block">Paragraph text</div>';

      const mockGetBlockIndex = vi.fn().mockReturnValue(0);
      const mockGetBlockByIndex = vi.fn().mockReturnValue({
        id: 'shared-block',
        holder: sharedBlockHolder,
        parentId: 'table-1',
      });

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: mockGetBlockIndex,
          getBlockByIndex: mockGetBlockByIndex,
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Both tables reference the same block (corrupted data)
      const content = [[{ blocks: ['shared-block'] }]];

      mountCellBlocksReadOnly(grid1, content, api, 'table-1');
      mountCellBlocksReadOnly(grid2, content, api, 'table-2');

      // Grid1 has the original holder (block belongs to table-1)
      expect(container1.contains(sharedBlockHolder)).toBe(true);

      // Grid2 must be empty — block belongs to table-1, not table-2
      expect(container2.children).toHaveLength(0);
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

  describe('setupKeyboardNavigation', () => {
    it('should return a cleanup function that removes the keydown listener', async () => {
      const { setupKeyboardNavigation } = await import('../../../../src/tools/table/table-operations');
      const { ROW_ATTR, CELL_ATTR } = await import('../../../../src/tools/table/table-core');

      const gridEl = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute(ROW_ATTR, '');
      const cell = document.createElement('div');
      cell.setAttribute(CELL_ATTR, '');
      row.appendChild(cell);
      gridEl.appendChild(row);

      const handleKeyDown = vi.fn();
      const cellBlocks = { handleKeyDown } as unknown as Parameters<typeof setupKeyboardNavigation>[1];

      const cleanup = setupKeyboardNavigation(gridEl, cellBlocks);

      expect(typeof cleanup).toBe('function');

      // Dispatch a keydown event — handler should fire
      const event = new KeyboardEvent('keydown', { bubbles: true });
      cell.dispatchEvent(event);

      expect(handleKeyDown).toHaveBeenCalledTimes(1);

      // Call cleanup — handler should be removed
      cleanup();
      handleKeyDown.mockClear();

      const event2 = new KeyboardEvent('keydown', { bubbles: true });
      cell.dispatchEvent(event2);

      expect(handleKeyDown).not.toHaveBeenCalled();
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
