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
    toolbar: {
      close: vi.fn(),
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

describe('Table grip overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scroll container padding removed', () => {
    it('scroll container should NOT have top or left padding classes', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.classList.contains('pt-[9px]')).toBe(false);
      expect(scrollContainer?.classList.contains('pl-[9px]')).toBe(false);
    });

    it('scroll container still has overflow classes', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer?.classList.contains('overflow-x-auto')).toBe(true);
      expect(scrollContainer?.classList.contains('overflow-y-hidden')).toBe(true);
    });
  });

  describe('overlay structure', () => {
    it('creates a grip overlay element as child of wrapper', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const overlay = element.querySelector('[data-blok-table-grip-overlay]');

      expect(overlay).not.toBeNull();
      expect(overlay?.parentElement).toBe(element);

      document.body.removeChild(element);
    });

    it('grips are children of the overlay, not the grid', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const overlay = element.querySelector('[data-blok-table-grip-overlay]');
      const grid = element.querySelector('[data-blok-table-grid]');

      // Grips should be in the overlay
      const overlayGrips = overlay?.querySelectorAll('[data-blok-table-grip]');

      expect(overlayGrips?.length).toBeGreaterThan(0);

      // Grid should NOT contain grips
      const gridGrips = grid?.querySelectorAll('[data-blok-table-grip]');

      expect(gridGrips?.length ?? 0).toBe(0);

      document.body.removeChild(element);
    });

    it('overlay has pointer-events none so clicks pass through to cells', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const overlay = element.querySelector('[data-blok-table-grip-overlay]') as HTMLElement;

      expect(overlay?.style.pointerEvents).toBe('none');

      document.body.removeChild(element);
    });

    it('overlay is not inside the scroll container', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const overlay = element.querySelector('[data-blok-table-grip-overlay]');
      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(overlay).not.toBeNull();
      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.contains(overlay)).toBe(false);

      document.body.removeChild(element);
    });
  });

  describe('wrapper overflow', () => {
    it('wrapper should NOT have overflow-x-clip when editable', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      expect(element.classList.contains('overflow-x-clip')).toBe(false);
    });
  });
});
