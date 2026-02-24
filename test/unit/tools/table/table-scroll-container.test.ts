import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (): API => {
  return {
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
      delete: () => {},
      insert: () => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `mock-${Math.random().toString(36).slice(2, 8)}`);

        return { id: `mock-${Math.random().toString(36).slice(2, 8)}`, holder };
      },
      getCurrentBlockIndex: () => 0,
      getBlocksCount: () => 0,
      getBlockIndex: () => undefined,
      setBlockParent: vi.fn(),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
  } as unknown as API;
};

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {}
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

describe('Table scroll container', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('with colWidths', () => {
    it('wrapper does NOT have a scroll container attribute', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      expect(element.hasAttribute('data-blok-table-scroll')).toBe(false);
    });

    it('inserts a scroll container between wrapper and grid', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer).not.toBeNull();

      // The scroll container should contain the grid (which has rows)
      const rows = scrollContainer?.querySelectorAll('[data-blok-table-row]');

      expect(rows?.length).toBe(2);
    });

    it('scroll container is a direct child of the wrapper', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer?.parentElement).toBe(element);
    });

    it('add-row button is a direct child of wrapper, not inside the scroll container', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      expect(addRowBtn).not.toBeNull();
      // The add-row button should be a direct child of the wrapper
      expect(addRowBtn.parentElement).toBe(element);

      // NOT inside the scroll container
      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer?.contains(addRowBtn)).toBe(false);

      document.body.removeChild(element);
    });
  });

  describe('without colWidths', () => {
    it('grid is a direct child of wrapper (no scroll container)', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      // No scroll container
      expect(element.querySelector('[data-blok-table-scroll]')).toBeNull();

      // The grid (with rows) is a direct child
      const firstChild = element.firstElementChild as HTMLElement;
      const rows = firstChild?.querySelectorAll('[data-blok-table-row]');

      expect(rows?.length).toBe(2);
    });

    it('wrapper does NOT have a scroll container', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      expect(element.querySelector('[data-blok-table-scroll]')).toBeNull();
    });
  });

  describe('resize creates scroll container on demand', () => {
    it('enableScrollOverflow during resize creates scroll container', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Initially no scroll container (no colWidths)
      expect(element.querySelector('[data-blok-table-scroll]')).toBeNull();

      // Simulate a resize drag: triggers enableScrollOverflow
      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      if (handle) {
        handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
        document.dispatchEvent(new PointerEvent('pointerup', {}));

        // After resize, a scroll container should have been created
        const scrollContainer = element.querySelector('[data-blok-table-scroll]');

        expect(scrollContainer).not.toBeNull();

        // Grid should be inside the scroll container
        const rows = scrollContainer?.querySelectorAll('[data-blok-table-row]');

        expect(rows?.length).toBe(1);
      }

      document.body.removeChild(element);
    });
  });
});
