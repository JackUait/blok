import { describe, it, expect, vi } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (overrides: Partial<API> = {}): API => {
  const { blocks: blocksOverrides, events: eventsOverrides, ...restOverrides } = overrides as Record<string, unknown>;

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
      ...(blocksOverrides as Record<string, unknown>),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
      ...(eventsOverrides as Record<string, unknown>),
    },
    ...restOverrides,
  } as unknown as API;
};

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

      table.rendered();

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(2);

      // Each cell now has a blocks container with a mounted paragraph block
      const firstCell = element.querySelector('[data-blok-table-cell]');
      const blocksContainer = firstCell?.querySelector('[data-blok-table-cell-blocks]');
      expect(blocksContainer).not.toBeNull();
      expect(blocksContainer?.querySelector('[data-blok-id]')).not.toBeNull();
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
    it('extracts content as block references', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      table.rendered();

      const saved = table.save(element);

      // initializeCells converts string content to paragraph blocks,
      // so each cell now has a block reference
      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(2);
      expect(saved.content[1]).toHaveLength(2);

      // Each cell should have exactly one block
      saved.content.flat().forEach(cell => {
        expect(isCellWithBlocks(cell)).toBe(true);
        if (isCellWithBlocks(cell)) {
          expect(cell.blocks).toHaveLength(1);
          expect(cell.blocks[0]).toMatch(/^mock-/);
        }
      });
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

      // Create an empty row manually (same as addRow does, with blocks container)
      const newRow = document.createElement('div');

      newRow.setAttribute('data-blok-table-row', '');

      for (let i = 0; i < 2; i++) {
        const cell = document.createElement('div');

        cell.setAttribute('data-blok-table-cell', '');

        const blocksContainer = document.createElement('div');

        blocksContainer.setAttribute('data-blok-table-cell-blocks', '');
        cell.appendChild(blocksContainer);
        newRow.appendChild(cell);
      }

      grid.appendChild(newRow);

      // Save should preserve the empty row with block references
      const saved = table.save(element);

      expect(saved.content).toHaveLength(3);
      expect(saved.content[2]).toEqual([{ blocks: [] }, { blocks: [] }]);
    });

    it('preserves withHeadings setting', () => {
      const options = createTableOptions({ withHeadings: true, content: [['H1'], ['D1']] });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.withHeadings).toBe(true);
    });

    it('saves block references for cells with nested blocks', () => {
      const options = createTableOptions({
        content: [['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      table.rendered();

      // Manually set up a block-based cell (simulating what convertCellToBlocks does)
      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      cell.innerHTML = '';

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');

      const block = document.createElement('div');

      block.setAttribute('data-blok-id', 'list-1');
      container.appendChild(block);

      cell.appendChild(container);

      const saved = table.save(element);

      expect(saved.content[0][0]).toEqual({ blocks: ['list-1'] });
      // Second cell has a paragraph block inserted by initializeCells
      const secondCell = saved.content[0][1];

      expect(isCellWithBlocks(secondCell)).toBe(true);
      if (isCellWithBlocks(secondCell)) {
        expect(secondCell.blocks).toHaveLength(1);
        expect(secondCell.blocks[0]).toMatch(/^mock-/);
      }
    });

    it('saves multiple block references in a single cell', () => {
      const options = createTableOptions({
        content: [['']],
      });
      const table = new Table(options);
      const element = table.render();

      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      cell.setAttribute('contenteditable', 'false');
      cell.innerHTML = '';

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');

      ['list-1', 'list-2', 'list-3'].forEach(id => {
        const block = document.createElement('div');

        block.setAttribute('data-blok-id', id);
        container.appendChild(block);
      });

      cell.appendChild(container);

      const saved = table.save(element);

      expect(saved.content[0][0]).toEqual({ blocks: ['list-1', 'list-2', 'list-3'] });
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
      expect(handle.style.top).toBe('-1px');
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

    it('does not add control padding in readOnly mode', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({ content: [['A', 'B']] }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      // In read-only mode, wrapper should mark itself as read-only
      // so that control padding (pr-9, pb-9) is omitted
      expect(element).toHaveAttribute('data-blok-table-readonly');
    });

    it('does not mark wrapper as readOnly in edit mode', () => {
      const options = createTableOptions({ content: [['A', 'B']] });
      const table = new Table(options);
      const element = table.render();

      expect(element).not.toHaveAttribute('data-blok-table-readonly');
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

  describe('row/column controls', () => {
    it('creates grip elements after rendered()', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const grips = element.querySelectorAll('[data-blok-table-grip]');

      // 2 columns + 2 rows = 4 grips
      expect(grips).toHaveLength(4);

      document.body.removeChild(element);
    });

    it('does not create grip elements in readOnly mode', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        ...createTableOptions({ content: [['A', 'B'], ['C', 'D']] }),
        readOnly: true,
      };
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const grips = element.querySelectorAll('[data-blok-table-grip]');

      expect(grips).toHaveLength(0);

      document.body.removeChild(element);
    });

    it('cleans up grip elements on destroy', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      table.destroy();

      const grips = element.querySelectorAll('[data-blok-table-grip]');

      expect(grips).toHaveLength(0);

      document.body.removeChild(element);
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

      // After paste, re-render creates cells with paragraph blocks via initializeCells
      const pastedElement = table.render();

      table.rendered();

      const saved = table.save(pastedElement);

      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(2);

      // Each cell gets a paragraph block from initializeCells
      saved.content.flat().forEach(cell => {
        expect(isCellWithBlocks(cell)).toBe(true);
        if (isCellWithBlocks(cell)) {
          expect(cell.blocks).toHaveLength(1);
          expect(cell.blocks[0]).toMatch(/^mock-/);
        }
      });
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

      const pastedElement = table.render();

      table.rendered();

      const saved = table.save(pastedElement);

      expect(saved.withHeadings).toBe(true);
      // After paste, cells get paragraph blocks from initializeCells
      expect(saved.content[0]).toHaveLength(2);
      saved.content[0].forEach(cell => {
        expect(isCellWithBlocks(cell)).toBe(true);
        if (isCellWithBlocks(cell)) {
          expect(cell.blocks).toHaveLength(1);
          expect(cell.blocks[0]).toMatch(/^mock-/);
        }
      });
    });
  });

  describe('Row/column operations with block cells', () => {
    it('should collect block IDs from cells when getting block IDs in a row', () => {
      const options = createTableOptions({
        content: [['', ''], ['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      // Set up a block-based cell in first row
      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');
      const firstCell = firstRowCells[0] as HTMLElement;

      firstCell.setAttribute('contenteditable', 'false');
      firstCell.innerHTML = '';

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');

      const block = document.createElement('div');

      block.setAttribute('data-blok-id', 'list-block-1');
      container.appendChild(block);

      firstCell.appendChild(container);

      const blockIds = table.getBlockIdsInRow(0);

      expect(blockIds).toContain('list-block-1');
    });

    it('should collect multiple block IDs from different cells in the same row', () => {
      const options = createTableOptions({
        content: [['', ''], ['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      // Set up block-based cells in first row
      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // First cell with one block
      const firstCell = firstRowCells[0] as HTMLElement;

      firstCell.setAttribute('contenteditable', 'false');
      firstCell.innerHTML = '';

      const container1 = document.createElement('div');

      container1.setAttribute('data-blok-table-cell-blocks', '');

      const block1 = document.createElement('div');

      block1.setAttribute('data-blok-id', 'list-block-1');
      container1.appendChild(block1);
      firstCell.appendChild(container1);

      // Second cell with another block
      const secondCell = firstRowCells[1] as HTMLElement;

      secondCell.setAttribute('contenteditable', 'false');
      secondCell.innerHTML = '';

      const container2 = document.createElement('div');

      container2.setAttribute('data-blok-table-cell-blocks', '');

      const block2 = document.createElement('div');

      block2.setAttribute('data-blok-id', 'list-block-2');
      container2.appendChild(block2);
      secondCell.appendChild(container2);

      const blockIds = table.getBlockIdsInRow(0);

      expect(blockIds).toContain('list-block-1');
      expect(blockIds).toContain('list-block-2');
      expect(blockIds).toHaveLength(2);
    });

    it('should return block IDs for row with initialized cells', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);

      table.render();
      table.rendered();

      // With always-blocks, every cell gets a paragraph block during initializeCells
      const blockIds = table.getBlockIdsInRow(0);

      expect(blockIds).toHaveLength(2);
      blockIds.forEach(id => {
        expect(id).toMatch(/^mock-/);
      });
    });

    it('should return empty array for out-of-bounds row index', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);

      table.render();

      const blockIds = table.getBlockIdsInRow(999);

      expect(blockIds).toEqual([]);
    });

    it('should collect block IDs from cells when getting block IDs in a column', () => {
      const options = createTableOptions({
        content: [['', ''], ['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      // Set up a block-based cell in first column, second row
      const rows = element.querySelectorAll('[data-blok-table-row]');
      const secondRowFirstCell = rows[1].querySelectorAll('[data-blok-table-cell]')[0] as HTMLElement;

      secondRowFirstCell.setAttribute('contenteditable', 'false');
      secondRowFirstCell.innerHTML = '';

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');

      const block = document.createElement('div');

      block.setAttribute('data-blok-id', 'list-block-col-1');
      container.appendChild(block);

      secondRowFirstCell.appendChild(container);

      const blockIds = table.getBlockIdsInColumn(0);

      expect(blockIds).toContain('list-block-col-1');
    });

    it('should collect multiple block IDs from different rows in the same column', () => {
      const options = createTableOptions({
        content: [['', ''], ['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');

      // First row, first column
      const cell1 = rows[0].querySelectorAll('[data-blok-table-cell]')[0] as HTMLElement;

      cell1.setAttribute('contenteditable', 'false');
      cell1.innerHTML = '';

      const container1 = document.createElement('div');

      container1.setAttribute('data-blok-table-cell-blocks', '');

      const block1 = document.createElement('div');

      block1.setAttribute('data-blok-id', 'block-row-0');
      container1.appendChild(block1);
      cell1.appendChild(container1);

      // Second row, first column
      const cell2 = rows[1].querySelectorAll('[data-blok-table-cell]')[0] as HTMLElement;

      cell2.setAttribute('contenteditable', 'false');
      cell2.innerHTML = '';

      const container2 = document.createElement('div');

      container2.setAttribute('data-blok-table-cell-blocks', '');

      const block2 = document.createElement('div');

      block2.setAttribute('data-blok-id', 'block-row-1');
      container2.appendChild(block2);
      cell2.appendChild(container2);

      const blockIds = table.getBlockIdsInColumn(0);

      expect(blockIds).toContain('block-row-0');
      expect(blockIds).toContain('block-row-1');
      expect(blockIds).toHaveLength(2);
    });

    it('should return block IDs for column with initialized cells', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);

      table.render();
      table.rendered();

      // With always-blocks, every cell gets a paragraph block during initializeCells
      const blockIds = table.getBlockIdsInColumn(0);

      expect(blockIds).toHaveLength(2);
      blockIds.forEach(id => {
        expect(id).toMatch(/^mock-/);
      });
    });

    it('should return empty array for out-of-bounds column index', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);

      table.render();

      const blockIds = table.getBlockIdsInColumn(999);

      expect(blockIds).toEqual([]);
    });

    it('should collect multiple blocks from a single cell', () => {
      const options = createTableOptions({
        content: [['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      table.rendered();

      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      cell.setAttribute('contenteditable', 'false');
      cell.innerHTML = '';

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');

      ['block-1', 'block-2', 'block-3'].forEach(id => {
        const block = document.createElement('div');

        block.setAttribute('data-blok-id', id);
        container.appendChild(block);
      });

      cell.appendChild(container);

      const blockIds = table.getBlockIdsInRow(0);

      // First cell has 3 manually added blocks, second cell has 1 from initializeCells
      expect(blockIds).toContain('block-1');
      expect(blockIds).toContain('block-2');
      expect(blockIds).toContain('block-3');
      expect(blockIds.slice(0, 3)).toEqual(['block-1', 'block-2', 'block-3']);
      // Second cell also contributes a block from initializeCells
      expect(blockIds).toHaveLength(4);
      expect(blockIds[3]).toMatch(/^mock-/);
    });

    it('should delete nested blocks when deleting a row with block-based cells', () => {
      const mockDelete = vi.fn();
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        // Return index based on block ID for testing
        if (id === 'list-block-to-delete') {
          return 1;
        }

        return undefined;
      });
      let insertCounter = 0;
      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCounter}`);

            return { id: `mock-block-${insertCounter}`, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: mockGetBlockIndex,
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['', ''], ['', '']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Set up a block-based cell in first row
      const firstRowCell = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelector('[data-blok-table-cell]') as HTMLElement;

      firstRowCell.setAttribute('contenteditable', 'false');
      firstRowCell.innerHTML = '';

      const container = document.createElement('div');

      container.setAttribute('data-blok-table-cell-blocks', '');

      const block = document.createElement('div');

      block.setAttribute('data-blok-id', 'list-block-to-delete');
      container.appendChild(block);

      firstRowCell.appendChild(container);

      // Trigger row deletion via the public method
      table.deleteRowWithCleanup(0);

      // Verify getBlockIndex was called with the block ID
      expect(mockGetBlockIndex).toHaveBeenCalledWith('list-block-to-delete');

      // Verify delete was called with the index returned by getBlockIndex
      expect(mockDelete).toHaveBeenCalledWith(1);

      document.body.removeChild(element);
    });

    it('should delete nested blocks when deleting a column with block-based cells', () => {
      const mockDelete = vi.fn();
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        // Return index based on block ID for testing - higher indices for blocks to be deleted last
        if (id === 'col-block-0') {
          return 2;
        }

        if (id === 'col-block-1') {
          return 3;
        }

        return undefined;
      });
      let insertCounter = 0;
      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCounter}`);

            return { id: `mock-block-${insertCounter}`, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: mockGetBlockIndex,
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['', ''], ['', '']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Set up block-based cells in first column
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach((row, rowIndex) => {
        const cell = row.querySelector('[data-blok-table-cell]') as HTMLElement;

        cell.setAttribute('contenteditable', 'false');
        cell.innerHTML = '';

        const container = document.createElement('div');

        container.setAttribute('data-blok-table-cell-blocks', '');

        const block = document.createElement('div');

        block.setAttribute('data-blok-id', `col-block-${rowIndex}`);
        container.appendChild(block);

        cell.appendChild(container);
      });

      // Trigger column deletion via the public method
      table.deleteColumnWithCleanup(0);

      // Verify getBlockIndex was called for both blocks
      expect(mockGetBlockIndex).toHaveBeenCalledWith('col-block-0');
      expect(mockGetBlockIndex).toHaveBeenCalledWith('col-block-1');

      // Verify delete was called with the indices (sorted descending to avoid index shift)
      // Index 3 should be deleted before index 2
      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenNthCalledWith(1, 3);
      expect(mockDelete).toHaveBeenNthCalledWith(2, 2);

      document.body.removeChild(element);
    });

    it('should not call delete when block indices are not found', () => {
      const mockDelete = vi.fn();
      const mockGetBlockIndex = vi.fn().mockReturnValue(undefined);
      let insertCounter = 0;
      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCounter}`);

            return { id: `mock-block-${insertCounter}`, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: mockGetBlockIndex,
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Trigger row deletion via the public method
      table.deleteRowWithCleanup(0);

      // Verify delete was not called (no blocks to delete)
      expect(mockDelete).not.toHaveBeenCalled();

      // Also verify the row was actually deleted
      const rows = element.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(1);

      document.body.removeChild(element);
    });
  });

  describe('new rows and columns get paragraph blocks', () => {
    it('should populate new row cells with paragraph blocks when clicking add-row', () => {
      let insertCallCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        insertCallCount++;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `auto-p-${insertCallCount}`);

        return { id: `auto-p-${insertCallCount}`, holder };
      });
      const mockApi = createMockAPI({
        blocks: {
          insert: mockInsert,
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['', '']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Record insert calls before add-row (initializeCells calls insert for original cells)
      const insertCallsBefore = mockInsert.mock.calls.length;

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      addRowBtn.click();

      // New row should have 2 cells, each needing a paragraph block
      const insertCallsAfter = mockInsert.mock.calls.length;

      expect(insertCallsAfter - insertCallsBefore).toBe(2);

      // Verify the new row's cells have blocks in their containers
      const rows = element.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(2);

      const newRowCells = rows[1].querySelectorAll('[data-blok-table-cell]');

      newRowCells.forEach(cell => {
        const container = cell.querySelector('[data-blok-table-cell-blocks]');

        expect(container).not.toBeNull();
        expect(container?.querySelector('[data-blok-id]')).not.toBeNull();
      });

      document.body.removeChild(element);
    });

    it('should populate new column cells with paragraph blocks when clicking add-column', () => {
      let insertCallCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        insertCallCount++;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `auto-p-${insertCallCount}`);

        return { id: `auto-p-${insertCallCount}`, holder };
      });
      const mockApi = createMockAPI({
        blocks: {
          insert: mockInsert,
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['', ''], ['', '']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const insertCallsBefore = mockInsert.mock.calls.length;

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      addColBtn.click();

      // New column adds one cell per row (2 rows), each needing a paragraph block
      const insertCallsAfter = mockInsert.mock.calls.length;

      expect(insertCallsAfter - insertCallsBefore).toBe(2);

      // Verify each row's last cell (the new column) has a block
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');
        const lastCell = cells[cells.length - 1];
        const container = lastCell.querySelector('[data-blok-table-cell-blocks]');

        expect(container).not.toBeNull();
        expect(container?.querySelector('[data-blok-id]')).not.toBeNull();
      });

      document.body.removeChild(element);
    });

    it('should not insert paragraph blocks for cells that already have blocks', () => {
      let insertCallCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        insertCallCount++;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `auto-p-${insertCallCount}`);

        return { id: `auto-p-${insertCallCount}`, holder };
      });
      const mockApi = createMockAPI({
        blocks: {
          insert: mockInsert,
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, content: [['', '']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // After initialization, all 2 cells should already have blocks
      const insertCallsBefore = mockInsert.mock.calls.length;

      // Add a row — 2 new empty cells
      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      addRowBtn.click();

      const insertCallsAfterFirstAdd = mockInsert.mock.calls.length;

      // 2 new inserts for the 2 new cells
      expect(insertCallsAfterFirstAdd - insertCallsBefore).toBe(2);

      // Add another row — 2 more new empty cells, but existing cells should NOT trigger inserts
      addRowBtn.click();

      const insertCallsAfterSecondAdd = mockInsert.mock.calls.length;

      // Only 2 more inserts (for the 2 new cells), not for the existing ones
      expect(insertCallsAfterSecondAdd - insertCallsAfterFirstAdd).toBe(2);

      document.body.removeChild(element);
    });
  });
});
