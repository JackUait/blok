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

    it('renders default 3x3 grid when no data provided', () => {
      const options = createTableOptions();
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(3);

      const cells = rows[0].querySelectorAll('[data-blok-table-cell]');
      expect(cells).toHaveLength(3);
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
      expect(firstCell?.textContent).toBe('A');
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

    it('preserves empty rows added by the user', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      // Simulate user clicking "Add Row" — appends an empty row
      const grid = element.firstElementChild as HTMLElement;
      const rows = grid.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(2);

      // Create an empty row manually (same as addRow does)
      const newRow = document.createElement('div');

      newRow.setAttribute('data-blok-table-row', '');

      for (let i = 0; i < 2; i++) {
        const cell = document.createElement('div');

        cell.setAttribute('data-blok-table-cell', '');
        cell.setAttribute('contenteditable', 'true');
        newRow.appendChild(cell);
      }

      grid.appendChild(newRow);

      // Save should preserve the empty row
      const saved = table.save(element);

      expect(saved.content).toHaveLength(3);
      expect(saved.content[2]).toEqual(['', '']);
    });

    it('preserves withHeadings setting', () => {
      const options = createTableOptions({ withHeadings: true, content: [['H1'], ['D1']] });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.withHeadings).toBe(true);
    });
  });

  describe('heading row', () => {
    it('marks first row as heading when withHeadings is true', () => {
      const options = createTableOptions({
        withHeadings: true,
        content: [['H1', 'H2'], ['D1', 'D2']],
      });
      const table = new Table(options);
      const element = table.render();

      const firstRow = element.querySelector('[data-blok-table-row]');
      expect(firstRow?.hasAttribute('data-blok-table-heading')).toBe(true);
    });

    it('does not mark first row as heading when withHeadings is false', () => {
      const options = createTableOptions({
        withHeadings: false,
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const firstRow = element.querySelector('[data-blok-table-row]');
      expect(firstRow?.hasAttribute('data-blok-table-heading')).toBe(false);
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

  describe('keyboard navigation', () => {
    it('moves to next cell on Tab key', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);

      const firstCell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      firstCell.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      firstCell.dispatchEvent(event);

      // Check that event was prevented (navigation handled)
      expect(event.defaultPrevented).toBe(true);

      document.body.removeChild(element);
    });
  });

  describe('column widths', () => {
    it('applies equal widths when no colWidths provided', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C'], ['D', 'E', 'F']],
      });
      const table = new Table(options);
      const element = table.render();

      const firstCell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      expect(firstCell.style.width).toBe('33.33%');
    });

    it('applies custom colWidths from data as pixel values', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [400, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const cells = element.querySelectorAll('[data-blok-table-cell]');

      expect((cells[0] as HTMLElement).style.width).toBe('400px');
      expect((cells[1] as HTMLElement).style.width).toBe('200px');
    });

    it('falls back to equal widths when colWidths length mismatches columns', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C']],
        colWidths: [50, 50],
      });
      const table = new Table(options);
      const element = table.render();

      const firstCell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      expect(firstCell.style.width).toBe('33.33%');
    });
  });

  describe('resize handles', () => {
    it('adds resize handles for each column', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const handles = element.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(3);

      document.body.removeChild(element);
    });

    it('does not add resize handles in readOnly mode', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({ content: [['A', 'B', 'C']] }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const handles = element.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(0);

      document.body.removeChild(element);
    });

    it('shows blue indicator on handle hover', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

      expect(handle.style.background).toContain('rgb(59, 130, 246)');

      handle.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

      expect(handle.style.background).toBe('');

      document.body.removeChild(element);
    });

    it('positions resize handles on the grid element', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle).not.toBeNull();
      expect(handle.style.position).toBe('absolute');
      expect(handle.style.top).toBe('0px');
      expect(handle.style.bottom).toBe('0px');
      expect(handle.style.cursor).toBe('col-resize');

      document.body.removeChild(element);
    });
  });

  describe('add row/column controls', () => {
    it('creates add-row button after rendered()', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addRowBtn = element.querySelector('[data-blok-table-add-row]');

      expect(addRowBtn).not.toBeNull();

      document.body.removeChild(element);
    });

    it('creates add-column button after rendered()', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addColBtn = element.querySelector('[data-blok-table-add-col]');

      expect(addColBtn).not.toBeNull();

      document.body.removeChild(element);
    });

    it('does not create add controls in readOnly mode', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({ content: [['A', 'B']] }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      expect(element.querySelector('[data-blok-table-add-row]')).toBeNull();
      expect(element.querySelector('[data-blok-table-add-col]')).toBeNull();

      document.body.removeChild(element);
    });

    it('clicking add-row appends a new row to the table', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      addRowBtn.click();

      const rows = element.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(3);

      document.body.removeChild(element);
    });

    it('clicking add-column appends a new column to the table', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      addColBtn.click();

      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0].querySelectorAll('[data-blok-table-cell]');

      expect(firstRowCells).toHaveLength(3);

      document.body.removeChild(element);
    });

    it('clicking add-column preserves existing column widths and grows the grid', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C'], ['D', 'E', 'F']],
        colWidths: [200, 200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const gridBefore = element.firstElementChild as HTMLElement;
      const cellsBefore = gridBefore.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');
      const widthsBefore = Array.from(cellsBefore).map(c => (c as HTMLElement).style.width);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      addColBtn.click();

      const gridAfter = element.firstElementChild as HTMLElement;
      const cellsAfter = gridAfter.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Existing columns keep their widths
      expect((cellsAfter[0] as HTMLElement).style.width).toBe(widthsBefore[0]);
      expect((cellsAfter[1] as HTMLElement).style.width).toBe(widthsBefore[1]);
      expect((cellsAfter[2] as HTMLElement).style.width).toBe(widthsBefore[2]);

      // New column added
      expect(cellsAfter).toHaveLength(4);
      expect((cellsAfter[3] as HTMLElement).style.width).toMatch(/px$/);

      // Grid width grew (not same as before)
      const totalAfter = parseFloat(gridAfter.style.width);

      expect(totalAfter).toBeGreaterThan(600);

      document.body.removeChild(element);
    });

    it('clicking add-column creates new column at half the average width', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C'], ['D', 'E', 'F']],
        colWidths: [200, 200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      addColBtn.click();

      const gridAfter = element.firstElementChild as HTMLElement;
      const cellsAfter = gridAfter.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Average of [200, 200, 200] = 200, half = 100
      expect((cellsAfter[3] as HTMLElement).style.width).toBe('100px');

      document.body.removeChild(element);
    });

    it('add-row button width matches grid width on initial render with colWidths', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C'], ['D', 'E', 'F']],
        colWidths: [200, 200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const grid = element.firstElementChild as HTMLElement;
      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      expect(addRowBtn.style.width).toBe(grid.style.width);

      document.body.removeChild(element);
    });

    it('add-row button width matches grid width after adding a column', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      addColBtn.click();

      const grid = element.firstElementChild as HTMLElement;
      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      expect(addRowBtn.style.width).toBe(grid.style.width);

      document.body.removeChild(element);
    });

    it('cleans up add controls on destroy', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      table.destroy();

      expect(element.querySelector('[data-blok-table-add-row]')).toBeNull();
      expect(element.querySelector('[data-blok-table-add-col]')).toBeNull();

      document.body.removeChild(element);
    });

  });

  describe('save with colWidths', () => {
    it('saves colWidths when columns have custom widths', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [400, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.colWidths).toEqual([400, 200]);
    });

    it('omits colWidths when none were explicitly set', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.colWidths).toBeUndefined();
    });

    it('saves colWidths even when all widths are equal', () => {
      const options = createTableOptions({
        content: [['A', 'B', 'C'], ['D', 'E', 'F']],
        colWidths: [200, 200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.colWidths).toEqual([200, 200, 200]);
    });

    it('readonly table with colWidths renders grid with explicit pixel width', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({
          content: [['A', 'B', 'C'], ['D', 'E', 'F']],
          colWidths: [200, 200, 200],
        }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      const grid = element.firstElementChild as HTMLElement;

      expect(grid.style.width).toBe('601px');
    });

    it('grid width includes left border so cell borders meet the top border at the corner', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [400, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const grid = element.firstElementChild as HTMLElement;

      // Grid has a 1px left border with box-sizing: border-box,
      // so width must be sum of colWidths + 1px to avoid cell overflow
      expect(grid.style.width).toBe('601px');
    });
  });

  describe('onPaste', () => {
    it('extracts data from pasted HTML table', () => {
      const options = createTableOptions();
      const table = new Table(options);

      table.render();

      const tableEl = document.createElement('table');

      tableEl.innerHTML = '<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>';

      const event = {
        detail: { data: tableEl },
      } as unknown as CustomEvent;

      table.onPaste(event);

      // After paste, save should return the pasted content
      const saved = table.save(table.render());

      expect(saved.content).toEqual([['A', 'B'], ['C', 'D']]);
    });

    it('detects headings from thead', () => {
      const options = createTableOptions();
      const table = new Table(options);

      table.render();

      const tableEl = document.createElement('table');

      tableEl.innerHTML = '<thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody>';

      const event = {
        detail: { data: tableEl },
      } as unknown as CustomEvent;

      table.onPaste(event);

      const saved = table.save(table.render());

      expect(saved.withHeadings).toBe(true);
      expect(saved.content[0]).toEqual(['H1', 'H2']);
    });
  });
});
