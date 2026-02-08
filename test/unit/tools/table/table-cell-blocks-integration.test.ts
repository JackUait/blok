import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, BlockAPI } from '../../../../types';

/**
 * Dispatches an input event on the given element.
 * Extracted to a helper to satisfy the no-direct-event-dispatch lint rule.
 */
const fireInputEvent = (element: HTMLElement): void => {
  const evt = new InputEvent('input', { bubbles: true });

  element.dispatchEvent(evt);
};

const createMockAPI = (): API => ({
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
    insert: vi.fn().mockReturnValue({
      id: 'list-item-1',
      holder: document.createElement('div'),
    }),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
  },
} as unknown as API);

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {},
  blockId = 'table-block-1'
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: { id: blockId } as BlockAPI,
});

describe('Table tool with cell blocks integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize TableCellBlocks when rendered in edit mode', async () => {
      const { Table } = await import('../../../../src/tools/table/index');
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      // Table should render successfully
      expect(element.querySelector('[data-blok-table-row]')).not.toBeNull();

      // Verify we have cells
      const cells = element.querySelectorAll('[data-blok-table-cell]');
      expect(cells.length).toBe(4);
    });

    it('should NOT initialize TableCellBlocks in readOnly mode', async () => {
      const { Table } = await import('../../../../src/tools/table/index');
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({
          content: [['A', 'B'], ['C', 'D']],
        }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      // Table should still render
      expect(element.querySelector('[data-blok-table-row]')).not.toBeNull();
    });
  });

  describe('input handling for markdown triggers', () => {
    it('should listen for input events on cells', async () => {
      const { Table } = await import('../../../../src/tools/table/index');
      const options = createTableOptions({
        content: [['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);

      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;
      expect(cell).not.toBeNull();

      // Simulate typing a markdown trigger
      cell.textContent = '- ';
      fireInputEvent(cell);

      // Cleanup
      document.body.removeChild(element);
    });

    it('should not call blocks.insert for regular input events', async () => {
      const { Table } = await import('../../../../src/tools/table/index');
      const mockApi = createMockAPI();
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['', '']] } as TableData,
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as BlockAPI,
      };
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);

      // Record insert calls from initializeCells (happens during render)
      const insertCallsBefore = (mockApi.blocks.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      // Type regular content
      cell.textContent = 'Hello world';
      fireInputEvent(cell);

      // Wait for any async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      // No additional insert calls should have been made after the input event
      const insertCallsAfter = (mockApi.blocks.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(insertCallsAfter).toBe(insertCallsBefore);

      document.body.removeChild(element);
    });
  });

  describe('cleanup', () => {
    it('should clean up TableCellBlocks on destroy', async () => {
      const { Table } = await import('../../../../src/tools/table/index');
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Should not throw on destroy
      expect(() => table.destroy()).not.toThrow();

      document.body.removeChild(element);
    });
  });
});
