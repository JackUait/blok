import { describe, it, expect } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

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
} as unknown as API);

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {}
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

describe('Table Tool', () => {
  describe('static properties', () => {
    it('has toolbox config with icon and title', () => {
      const toolbox = Table.toolbox;

      expect(toolbox).toHaveProperty('icon');
      expect(toolbox).toHaveProperty('title', 'Table');
    });

    it('supports read-only mode', () => {
      expect(Table.isReadOnlySupported).toBe(true);
    });

    it('enables line breaks', () => {
      expect(Table.enableLineBreaks).toBe(true);
    });

    it('has paste config for table tags', () => {
      const config = Table.pasteConfig;

      expect(config).not.toBe(false);

      if (config !== false) {
        expect(config.tags).toContain('TABLE');
      }
    });
  });

  describe('render', () => {
    it('renders a table element with data-blok-tool attribute', () => {
      const options = createTableOptions();
      const table = new Table(options);
      const element = table.render();

      expect(element).toHaveAttribute('data-blok-tool', 'table');
    });

    it('renders default 2x2 grid when no data provided', () => {
      const options = createTableOptions();
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(2);

      const cells = rows[0].querySelectorAll('[data-blok-table-cell]');
      expect(cells).toHaveLength(2);
    });

    it('renders grid from provided content data', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C'], ['D', 'E', 'F']],
      });
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(2);

      const firstCell = element.querySelector('[data-blok-table-cell]');
      expect(firstCell?.innerHTML).toBe('A');
    });

    it('respects config rows and cols for empty tables', () => {
      const options = createTableOptions({}, { rows: 3, cols: 4 });
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(3);

      const cells = rows[0].querySelectorAll('[data-blok-table-cell]');
      expect(cells).toHaveLength(4);
    });
  });

  describe('save', () => {
    it('extracts content as 2D array', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.content).toEqual([['A', 'B'], ['C', 'D']]);
    });

    it('preserves withHeadings setting', () => {
      const options = createTableOptions({ withHeadings: true, content: [['H1'], ['D1']] });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.withHeadings).toBe(true);
    });
  });

  describe('validate', () => {
    it('returns true for table with content', () => {
      const options = createTableOptions();
      const table = new Table(options);

      expect(table.validate({ withHeadings: false, content: [['A']] })).toBe(true);
    });

    it('returns false for table with no content rows', () => {
      const options = createTableOptions();
      const table = new Table(options);

      expect(table.validate({ withHeadings: false, content: [] })).toBe(false);
    });
  });
});
