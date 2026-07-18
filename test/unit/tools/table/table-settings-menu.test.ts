import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';

/**
 * Shape of the block-settings items the table exposes.
 * renderSettings() returns MenuConfig (a union); tests read the fields they
 * assert on, following the convention used by the quote tool's tests.
 */
interface SettingsItem {
  name: string;
  title: string;
  isActive?: boolean;
  onActivate: () => void;
}

const createMockAPI = (): API => {
  return {
    styles: {
      block: 'blok-block',
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
      getById: () => null,
      getChildren: () => [],
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

interface MockBlock extends BlockAPI {
  dispatchChange: () => void;
}

const createMockBlock = (): MockBlock => {
  return {
    id: 'table-block',
    stretched: false,
    dispatchChange: vi.fn(),
  } as unknown as MockBlock;
};

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {},
  block: BlockAPI = createMockBlock(),
  readOnly = false
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly,
  block,
});

const mountTable = (
  data: Partial<TableData> = {},
  config: TableConfig = {},
  block: BlockAPI = createMockBlock(),
  readOnly = false
): { tool: Table; element: HTMLElement } => {
  const tool = new Table(createTableOptions(data, config, block, readOnly));
  const element = tool.render();

  document.body.appendChild(element);
  tool.rendered();

  return { tool,
    element };
};

const getSettings = (tool: Table): SettingsItem[] =>
  tool.renderSettings() as unknown as SettingsItem[];

const getSettingsItem = (tool: Table, name: string): SettingsItem => {
  const item = getSettings(tool).find(entry => entry.name === name);

  expect(item, `settings item "${name}" should exist`).toBeDefined();

  return item as SettingsItem;
};

describe('Table block settings menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('menu contents', () => {
    it('exposes header row, header column, fit to page width and full width', () => {
      const { tool } = mountTable({ content: [['A', 'B'], ['C', 'D']] });
      const names = getSettings(tool).map(item => item.name);

      expect(names).toContain('table-heading-row');
      expect(names).toContain('table-heading-column');
      expect(names).toContain('table-fit-to-page-width');
      expect(names).toContain('table-full-width');
    });

    it('titles come from i18n', () => {
      const { tool } = mountTable({ content: [['A', 'B'], ['C', 'D']] });

      expect(getSettingsItem(tool, 'table-heading-row').title).toBe('tools.table.headerRow');
      expect(getSettingsItem(tool, 'table-heading-column').title).toBe('tools.table.headerColumn');
      expect(getSettingsItem(tool, 'table-fit-to-page-width').title).toBe('tools.table.fitToPageWidth');
      expect(getSettingsItem(tool, 'table-full-width').title).toBe('tools.table.fullWidth');
    });
  });

  describe('header toggles', () => {
    it('header row toggle turns the heading row on and persists it', () => {
      const { tool, element } = mountTable({ content: [['A', 'B'], ['C', 'D']] });

      expect(getSettingsItem(tool, 'table-heading-row').isActive).toBe(false);

      getSettingsItem(tool, 'table-heading-row').onActivate();

      const firstRow = element.querySelector('[data-blok-table-row]');

      expect(firstRow?.hasAttribute('data-blok-table-heading')).toBe(true);
      expect(tool.save(element).withHeadings).toBe(true);
      expect(getSettingsItem(tool, 'table-heading-row').isActive).toBe(true);
    });

    it('header row toggle turns the heading row back off', () => {
      const { tool, element } = mountTable({ withHeadings: true,
        content: [['A', 'B'], ['C', 'D']] });

      getSettingsItem(tool, 'table-heading-row').onActivate();

      const firstRow = element.querySelector('[data-blok-table-row]');

      expect(firstRow?.hasAttribute('data-blok-table-heading')).toBe(false);
      expect(tool.save(element).withHeadings).toBe(false);
    });

    it('header column toggle turns the heading column on and persists it', () => {
      const { tool, element } = mountTable({ content: [['A', 'B'], ['C', 'D']] });

      getSettingsItem(tool, 'table-heading-column').onActivate();

      const firstCell = element.querySelector('[data-blok-table-cell-col="0"]');

      expect(firstCell?.hasAttribute('data-blok-table-heading-col')).toBe(true);
      expect(tool.save(element).withHeadingColumn).toBe(true);
    });
  });

  describe('full width toggle', () => {
    it('drives the block stretched flag and round-trips through save()', () => {
      const block = createMockBlock();
      const { tool, element } = mountTable({ content: [['A', 'B'], ['C', 'D']] }, {}, block);

      expect(getSettingsItem(tool, 'table-full-width').isActive).toBe(false);

      getSettingsItem(tool, 'table-full-width').onActivate();

      expect(block.stretched).toBe(true);
      expect(tool.save(element).stretched).toBe(true);
      expect(getSettingsItem(tool, 'table-full-width').isActive).toBe(true);

      getSettingsItem(tool, 'table-full-width').onActivate();

      expect(block.stretched).toBe(false);
      expect(tool.save(element).stretched).toBe(false);
    });
  });

  describe('fit to page width', () => {
    it('clears colWidths and returns the grid to fluid percent mode', () => {
      const { tool, element } = mountTable({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [400, 200],
      });

      const grid = element.querySelector('table') as HTMLTableElement;

      expect(grid.style.width).toBe('601px');

      getSettingsItem(tool, 'table-fit-to-page-width').onActivate();

      expect(tool.save(element).colWidths).toBeUndefined();
      expect(grid.style.width).toBe('100%');

      const cols = Array.from(grid.querySelectorAll('col'));

      cols.forEach(col => {
        expect(col.style.width).toBe('50%');
      });
    });

    it('returns the table to fluid mode after a resize drag pinned pixel widths', () => {
      const { tool, element } = mountTable({ content: [['A', 'B'], ['C', 'D']] });
      const grid = element.querySelector('table') as HTMLTableElement;
      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100,
        bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 220 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(tool.save(element).colWidths).toBeDefined();
      expect(grid.style.width.endsWith('px')).toBe(true);

      getSettingsItem(tool, 'table-fit-to-page-width').onActivate();

      expect(tool.save(element).colWidths).toBeUndefined();
      expect(grid.style.width).toBe('100%');
    });
  });

  describe('text size', () => {
    it('exposes compact and comfortable text entries with i18n titles', () => {
      const { tool } = mountTable({ content: [['A', 'B'], ['C', 'D']] });

      expect(getSettingsItem(tool, 'table-text-compact').title).toBe('tools.table.compactText');
      expect(getSettingsItem(tool, 'table-text-comfortable').title).toBe('tools.table.comfortableText');
    });

    it('compact is active by default and comfortable is not', () => {
      const { tool } = mountTable({ content: [['A', 'B'], ['C', 'D']] });

      expect(getSettingsItem(tool, 'table-text-compact').isActive).toBe(true);
      expect(getSettingsItem(tool, 'table-text-comfortable').isActive).toBe(false);
    });

    it('switching to comfortable marks the grid and persists through save()', () => {
      const { tool, element } = mountTable({ content: [['A', 'B'], ['C', 'D']] });

      getSettingsItem(tool, 'table-text-comfortable').onActivate();

      const grid = element.querySelector('table');

      expect(grid?.getAttribute('data-blok-table-text-size')).toBe('comfortable');
      expect(tool.save(element).textSize).toBe('comfortable');
      expect(getSettingsItem(tool, 'table-text-comfortable').isActive).toBe(true);
      expect(getSettingsItem(tool, 'table-text-compact').isActive).toBe(false);
    });

    it('switching back to compact removes the marker and omits textSize from save()', () => {
      const { tool, element } = mountTable({
        textSize: 'comfortable',
        content: [['A', 'B'], ['C', 'D']],
      });

      getSettingsItem(tool, 'table-text-compact').onActivate();

      const grid = element.querySelector('table');

      expect(grid?.hasAttribute('data-blok-table-text-size')).toBe(false);
      expect(tool.save(element).textSize).toBeUndefined();
      expect(getSettingsItem(tool, 'table-text-compact').isActive).toBe(true);
    });

    it('renders the comfortable marker when loaded from saved data', () => {
      const { tool, element } = mountTable({
        textSize: 'comfortable',
        content: [['A', 'B'], ['C', 'D']],
      });

      const grid = element.querySelector('table');

      expect(grid?.getAttribute('data-blok-table-text-size')).toBe('comfortable');
      expect(getSettingsItem(tool, 'table-text-comfortable').isActive).toBe(true);
    });
  });

  describe('config', () => {
    it('withHeadingColumn config presets the heading column flag', () => {
      // Saved data has no withHeadingColumn yet (fresh table) — same contract as
      // the existing withHeadings config option.
      const tool = new Table({
        data: { withHeadings: false,
          content: [['A', 'B'], ['C', 'D']] } as unknown as TableData,
        config: { withHeadingColumn: true },
        api: createMockAPI(),
        readOnly: false,
        block: createMockBlock(),
      });
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      expect(tool.save(element).withHeadingColumn).toBe(true);

      const firstCell = element.querySelector('[data-blok-table-cell-col="0"]');

      expect(firstCell?.hasAttribute('data-blok-table-heading-col')).toBe(true);
    });
  });
});
