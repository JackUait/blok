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

  describe('without colWidths (editable)', () => {
    it('creates scroll container without padding classes (grips are in overlay)', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.classList.contains('pt-[9px]')).toBe(false);
      expect(scrollContainer?.classList.contains('pl-[9px]')).toBe(false);

      const rows = scrollContainer?.querySelectorAll('[data-blok-table-row]');

      expect(rows?.length).toBe(2);
    });

    it('scroll container does NOT have overflow-x-auto in percent mode', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer).not.toBeNull();
      expect(scrollContainer?.classList.contains('overflow-x-auto')).toBe(false);
      expect(scrollContainer?.classList.contains('overflow-y-hidden')).toBe(false);
    });

    it('add-col button is NOT inside the scroll container (prevents unwanted horizontal scroll)', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;
      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(addColBtn).not.toBeNull();
      expect(scrollContainer?.contains(addColBtn)).toBe(false);
      expect(addColBtn.parentElement).toBe(element);

      document.body.removeChild(element);
    });
  });

  describe('scroll overflow classes', () => {
    it('scroll container has overflow classes when colWidths are present', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.querySelector('[data-blok-table-scroll]');

      expect(scrollContainer?.classList.contains('overflow-x-auto')).toBe(true);
      expect(scrollContainer?.classList.contains('overflow-y-hidden')).toBe(true);
    });
  });

  describe('with colWidths (readOnly)', () => {
    it('initializes scroll haze overlays after rendered()', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({
          content: [['A', 'B'], ['C', 'D']],
          colWidths: [200, 200],
        }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const leftHaze = element.querySelector('[data-blok-table-haze="left"]');
      const rightHaze = element.querySelector('[data-blok-table-haze="right"]');

      expect(leftHaze).not.toBeNull();
      expect(rightHaze).not.toBeNull();

      document.body.removeChild(element);
    });
  });

  describe('without colWidths (readOnly)', () => {
    it('grid is a direct child of wrapper (no scroll container)', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({ content: [['A', 'B'], ['C', 'D']] }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      expect(element.querySelector('[data-blok-table-scroll]')).toBeNull();

      const firstChild = element.firstElementChild as HTMLElement;
      const rows = firstChild?.querySelectorAll('[data-blok-table-row]');

      expect(rows?.length).toBe(2);
    });
  });

  describe('resize preserves scroll container', () => {
    it('scroll container exists before and after resize — no mid-drag reparenting', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Scroll container exists from initial render
      const scrollBefore = element.querySelector('[data-blok-table-scroll]');

      expect(scrollBefore).not.toBeNull();

      // Simulate a resize drag
      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle).not.toBeNull();

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      // Same scroll container still exists (not recreated)
      const scrollAfter = element.querySelector('[data-blok-table-scroll]');

      expect(scrollAfter).toBe(scrollBefore);

      // Grid still inside the scroll container
      const rows = scrollAfter?.querySelectorAll('[data-blok-table-row]');

      expect(rows?.length).toBe(1);

      document.body.removeChild(element);
    });
  });
});
