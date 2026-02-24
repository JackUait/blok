import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { buildClipboardHtml } from '../../../../src/tools/table/table-cell-clipboard';
import { updateHeadingStyles } from '../../../../src/tools/table/table-operations';
import { clearAdditionalRestrictedTools, isRestrictedInTableCell } from '../../../../src/tools/table/table-restrictions';
import type { TableData, TableConfig, TableCellsClipboard } from '../../../../src/tools/table/types';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Simulate pointer entering a cell (mouseover).
 * Wraps dispatchEvent in a semantic helper to express user intent.
 */
const simulateMouseOver = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseover', { bubbles: true });

  element.dispatchEvent(event);
};

/**
 * Simulate a click via pointer events (pointerdown + pointerup at same position).
 * The add buttons use pointer events instead of click events.
 */
const pointerClick = (element: HTMLElement): void => {
  // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
  element.setPointerCapture = vi.fn();
  // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
  element.releasePointerCapture = vi.fn();

  element.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    bubbles: true,
  }));

  element.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    bubbles: true,
  }));
};

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
      getBlockIndex: () => undefined,
      setBlockParent: vi.fn(),
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
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
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

  describe('restrictedTools config', () => {
    afterEach(() => {
      clearAdditionalRestrictedTools();
    });

    it('registers additional restricted tools from config', () => {
      const options = createTableOptions({}, { restrictedTools: ['list', 'checklist'] });

      new Table(options);

      expect(isRestrictedInTableCell('list')).toBe(true);
      expect(isRestrictedInTableCell('checklist')).toBe(true);
    });

    it('does not register when restrictedTools is not set', () => {
      const options = createTableOptions({}, {});

      new Table(options);

      expect(isRestrictedInTableCell('list')).toBe(false);
    });

    it('cleans up registered restricted tools when the table is destroyed', () => {
      const table = new Table(createTableOptions({}, { restrictedTools: ['list'] }));

      expect(isRestrictedInTableCell('list')).toBe(true);

      table.destroy();

      expect(isRestrictedInTableCell('list')).toBe(false);
    });

    it('removes only the destroyed table instance restricted tools', () => {
      const tableA = new Table(createTableOptions({}, { restrictedTools: ['list'] }));
      const _tableB = new Table(createTableOptions({}, { restrictedTools: ['checklist'] }));

      expect(isRestrictedInTableCell('list')).toBe(true);
      expect(isRestrictedInTableCell('checklist')).toBe(true);

      tableA.destroy();

      expect(isRestrictedInTableCell('list')).toBe(false);
      expect(isRestrictedInTableCell('checklist')).toBe(true);
    });

    it('keeps a shared restricted tool active until all owning tables are destroyed', () => {
      const tableA = new Table(createTableOptions({}, { restrictedTools: ['list'] }));
      const tableB = new Table(createTableOptions({}, { restrictedTools: ['list'] }));

      expect(isRestrictedInTableCell('list')).toBe(true);

      tableA.destroy();
      expect(isRestrictedInTableCell('list')).toBe(true);

      tableB.destroy();
      expect(isRestrictedInTableCell('list')).toBe(false);
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

    it('preserves rows from initial data in model snapshot', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      // Save returns model snapshot which reflects data from constructor
      const saved = table.save(element);

      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(2);
      expect(saved.content[1]).toHaveLength(2);
    });

    it('preserves withHeadings setting', () => {
      const options = createTableOptions({ withHeadings: true, content: [['H1'], ['D1']] });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.withHeadings).toBe(true);
    });

    it('saves block references assigned during initializeCells', () => {
      const options = createTableOptions({
        content: [['', '']],
      });
      const table = new Table(options);
      const element = table.render();

      table.rendered();

      // After rendered(), initializeCells converts empty strings to paragraph blocks
      // and the model is synced via replaceAll. save() returns model snapshot.
      const saved = table.save(element);

      // Both cells should have exactly one block from initializeCells
      saved.content[0].forEach(cell => {
        expect(isCellWithBlocks(cell)).toBe(true);
        if (isCellWithBlocks(cell)) {
          expect(cell.blocks).toHaveLength(1);
          expect(cell.blocks[0]).toMatch(/^mock-/);
        }
      });
    });

    it('saves multiple block references when initial data has them', () => {
      const options = createTableOptions({
        content: [[{ blocks: ['list-1', 'list-2', 'list-3'] }]],
      });
      const table = new Table(options);
      const element = table.render();

      // Model is initialized from data in constructor; save returns model snapshot
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

    it('clears stale heading attribute from non-first rows when re-applying heading styles', () => {
      const options = createTableOptions({
        withHeadings: true,
        content: [['H1', 'H2'], ['D1', 'D2'], ['D3', 'D4']],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.firstElementChild as HTMLElement;
      const gridEl = scrollContainer.firstElementChild as HTMLElement;
      const rows = gridEl.querySelectorAll('[data-blok-table-row]');

      // Simulate stale state: heading attr left on row 1 (as if a row was inserted above)
      rows[1].setAttribute('data-blok-table-heading', '');

      // Toggle heading off then on via updateHeadingStyles
      updateHeadingStyles(gridEl, false); // toggle off
      updateHeadingStyles(gridEl, true); // toggle on

      // Only row 0 should have heading
      expect(rows[0]).toHaveAttribute('data-blok-table-heading');
      expect(rows[1]).not.toHaveAttribute('data-blok-table-heading');
      expect(rows[2]).not.toHaveAttribute('data-blok-table-heading');
    });
  });

  describe('heading column', () => {
    it('marks first cell in each row as heading column when withHeadingColumn is true', () => {
      const options = createTableOptions({
        withHeadingColumn: true,
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const firstCell = row.querySelector('[data-blok-table-cell]');

        expect(firstCell?.hasAttribute('data-blok-table-heading-col')).toBe(true);
      });
    });

    it('does not mark first cell as heading column when withHeadingColumn is false', () => {
      const options = createTableOptions({
        withHeadingColumn: false,
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const firstCell = row.querySelector('[data-blok-table-cell]');

        expect(firstCell?.hasAttribute('data-blok-table-heading-col')).toBe(false);
      });
    });

    it('saves withHeadingColumn setting', () => {
      const options = createTableOptions({
        withHeadingColumn: true,
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.withHeadingColumn).toBe(true);
    });

    it('defaults withHeadingColumn to false when not provided', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      const saved = table.save(element);

      expect(saved.withHeadingColumn).toBe(false);
    });
  });

  describe('validate', () => {
    it('returns true for table with content', () => {
      const options = createTableOptions();
      const table = new Table(options);

      expect(table.validate({ withHeadings: false, withHeadingColumn: false, content: [['A']] })).toBe(true);
    });

    it('returns false for table with no content rows', () => {
      const options = createTableOptions();
      const table = new Table(options);

      expect(table.validate({ withHeadings: false, withHeadingColumn: false, content: [] })).toBe(false);
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

    it('shows blue indicator on handle hover via opacity', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.style.opacity).toBe('0');

      const enterEvent = new MouseEvent('mouseenter', { bubbles: true });

      handle.dispatchEvent(enterEvent);

      expect(handle.style.opacity).toBe('1');

      const leaveEvent = new MouseEvent('mouseleave', { bubbles: true });

      handle.dispatchEvent(leaveEvent);

      expect(handle.style.opacity).toBe('0');

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

    it('syncs resized colWidths to model so save() returns updated widths', () => {
      const options = createTableOptions({
        content: [['A', 'B']],
        colWidths: [300, 300],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Simulate a resize drag: pointerdown → pointermove → pointerup
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const saved = table.save(element);

      // The first column should now be 400px in the saved data
      expect(saved.colWidths).toEqual([400, 300]);

      document.body.removeChild(element);
    });

    it('aligns add-row button left with scroll container padding in percent mode', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);

      // In edit mode, the scroll container is created during render() with pl-[9px].
      // Mock getComputedStyle BEFORE rendered() so syncRowButtonWidth sees the padding.
      const scrollContainer = element.firstElementChild as HTMLElement;
      const originalGetComputedStyle = window.getComputedStyle;
      const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        const result = originalGetComputedStyle(el);

        if (el === scrollContainer) {
          return { ...result, paddingLeft: '9px' } as CSSStyleDeclaration;
        }

        return result;
      });

      table.rendered();

      // Grid has no style.width (percent mode) → percent branch of syncRowButtonWidth
      const grid = scrollContainer.firstElementChild as HTMLElement;

      expect(grid.style.width).toBe('');

      // The add-row button should offset by the scroll container's left padding
      // so it aligns with the grid, not the wrapper
      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      expect(addRowBtn.style.left).toBe('9px');

      spy.mockRestore();
      document.body.removeChild(element);
    });

    it('aligns add-row button left with scroll container padding after percent-to-pixel resize', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);

      // Scroll container exists from render() for editable tables.
      // Mock getComputedStyle BEFORE rendered() so syncRowButtonWidth sees the padding.
      const scrollContainer = element.querySelector('[data-blok-table-scroll]') as HTMLElement;
      const originalGetComputedStyle = window.getComputedStyle;
      const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        const result = originalGetComputedStyle(el);

        if (el === scrollContainer) {
          return { ...result, paddingLeft: '9px' } as CSSStyleDeclaration;
        }

        return result;
      });

      table.rendered();

      const grid = scrollContainer.firstElementChild as HTMLElement;

      expect(grid.style.width).toBe('');

      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Simulate a resize drag: percent → pixel mode transition
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      // After resize, the grid should have a pixel width
      expect(grid.style.width).toMatch(/px$/);

      // The add-row button should be aligned with the scroll container's left padding
      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      expect(addRowBtn.style.left).toBe('9px');

      spy.mockRestore();
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

      pointerClick(addRowBtn);

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

      pointerClick(addColBtn);

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

      const scrollContainer = element.firstElementChild as HTMLElement;
      const gridBefore = scrollContainer.firstElementChild as HTMLElement;
      const cellsBefore = gridBefore.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');
      const widthsBefore = Array.from(cellsBefore).map(c => (c as HTMLElement).style.width);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      pointerClick(addColBtn);

      const gridAfter = scrollContainer.firstElementChild as HTMLElement;
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

      pointerClick(addColBtn);

      const scrollContainer = element.firstElementChild as HTMLElement;
      const gridAfter = scrollContainer.firstElementChild as HTMLElement;
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

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;
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

      pointerClick(addColBtn);

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;
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

    it('deletes all cell blocks from BlockManager on destroy', () => {
      const mockDelete = vi.fn();
      let insertCounter = 0;
      const blockIndexMap = new Map<string, number>();
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        return blockIndexMap.get(id);
      });

      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const blockId = `cell-block-${insertCounter}`;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', blockId);
            blockIndexMap.set(blockId, insertCounter - 1);

            return { id: blockId, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: mockGetBlockIndex,
        },
      } as never);

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // 2x2 table = 4 cells, each should have a block
      expect(insertCounter).toBe(4);

      table.destroy();

      // All 4 cell blocks should be deleted
      expect(mockDelete).toHaveBeenCalledTimes(4);

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

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;

      expect(grid.style.width).toBe('601px');
    });

    it('grid width includes left border so cell borders meet the top border at the corner', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [400, 200],
      });
      const table = new Table(options);
      const element = table.render();

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;

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

    it('refreshes grips after clicking add-row', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Initially: 2 columns + 2 rows = 4 grips
      expect(element.querySelectorAll('[data-blok-table-grip]')).toHaveLength(4);

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      pointerClick(addRowBtn);

      // After adding a row: 2 columns + 3 rows = 5 grips
      expect(element.querySelectorAll('[data-blok-table-grip]')).toHaveLength(5);

      document.body.removeChild(element);
    });

    it('refreshes grips after clicking add-column', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Initially: 2 columns + 2 rows = 4 grips
      expect(element.querySelectorAll('[data-blok-table-grip]')).toHaveLength(4);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      pointerClick(addColBtn);

      // After adding a column: 3 columns + 2 rows = 5 grips
      expect(element.querySelectorAll('[data-blok-table-grip]')).toHaveLength(5);

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

    it('hides grips when resize drag starts', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
        colWidths: [200, 200],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Show grips by hovering a cell
      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;
      const event = new MouseEvent('mouseover', { bubbles: true });

      cell.dispatchEvent(event);

      const visibleBefore = element.querySelectorAll('[data-blok-table-grip-visible]');

      expect(visibleBefore.length).toBeGreaterThan(0);

      // Start resize drag
      const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, bubbles: true }));

      // All grips should be hidden
      const visibleAfter = element.querySelectorAll('[data-blok-table-grip-visible]');

      expect(visibleAfter.length).toBe(0);

      // Clean up drag
      document.dispatchEvent(new PointerEvent('pointerup', {}));
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

    it('reinitializes grid paste listener after onPaste so cell-level paste works', () => {
      // Spy on addEventListener before any Table work
      const addEventSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');

      const options = createTableOptions({
        content: [['X', 'Y']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Clear spy to only track calls during onPaste
      addEventSpy.mockClear();

      // Paste a table to trigger onPaste
      const tableEl = document.createElement('table');

      tableEl.innerHTML = '<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>';

      const pasteEvent = {
        detail: { data: tableEl },
      } as unknown as CustomEvent;

      table.onPaste(pasteEvent);

      // After onPaste, initGridPasteListener should attach a 'paste' listener
      // to the new grid element
      const pasteListenerCalls = addEventSpy.mock.calls.filter(
        ([eventName]) => eventName === 'paste'
      );

      expect(pasteListenerCalls.length).toBeGreaterThan(0);

      addEventSpy.mockRestore();

      // onPaste replaces the old element in DOM, so clean up the new one
      const newElement = element.parentNode ? element : document.querySelector('[data-blok-tool="table"]');

      newElement?.parentNode?.removeChild(newElement);
    });

    it('reinitializes cell selection after onPaste so pointerdown handlers are attached', () => {
      // Spy on addEventListener before any Table work
      const addEventSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');

      const options = createTableOptions({
        content: [['X', 'Y']],
      });
      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Clear spy to only track calls during onPaste
      addEventSpy.mockClear();

      // Paste a table to trigger onPaste
      const tableEl = document.createElement('table');

      tableEl.innerHTML = '<tr><td>A</td><td>B</td></tr>';

      const pasteEvent = {
        detail: { data: tableEl },
      } as unknown as CustomEvent;

      table.onPaste(pasteEvent);

      // After onPaste, initCellSelection should attach a 'pointerdown' listener
      // to the new grid element for cell selection
      const pointerdownCalls = addEventSpy.mock.calls.filter(
        ([eventName]) => eventName === 'pointerdown'
      );

      expect(pointerdownCalls.length).toBeGreaterThan(0);

      addEventSpy.mockRestore();

      // onPaste replaces the old element in DOM, so clean up the new one
      const newElement = element.parentNode ? element : document.querySelector('[data-blok-tool="table"]');

      newElement?.parentNode?.removeChild(newElement);
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
        // Return indices for blocks in row 0 (created during initializeCells)
        if (id === 'mock-block-1') {
          return 0;
        }

        if (id === 'mock-block-2') {
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
        data: { withHeadings: false, withHeadingColumn: false, content: [['', ''], ['', '']] },
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
      // Row 0 has mock-block-1 and mock-block-2 from initializeCells
      table.deleteRowWithCleanup(0);

      // Verify getBlockIndex was called with the block IDs from the model
      expect(mockGetBlockIndex).toHaveBeenCalledWith('mock-block-1');
      expect(mockGetBlockIndex).toHaveBeenCalledWith('mock-block-2');

      // Verify delete was called with the indices (sorted descending to avoid index shift)
      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenNthCalledWith(1, 1);
      expect(mockDelete).toHaveBeenNthCalledWith(2, 0);

      document.body.removeChild(element);
    });

    it('should delete nested blocks when deleting a column with block-based cells', () => {
      const mockDelete = vi.fn();
      const mockGetBlockIndex = vi.fn().mockImplementation((id: string) => {
        // Return indices for blocks in column 0 (created during initializeCells)
        // Row 0 col 0 = mock-block-1, Row 1 col 0 = mock-block-3
        if (id === 'mock-block-1') {
          return 0;
        }

        if (id === 'mock-block-3') {
          return 2;
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
        data: { withHeadings: false, withHeadingColumn: false, content: [['', ''], ['', '']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Trigger column deletion via the public method
      // Column 0 has mock-block-1 (row 0) and mock-block-3 (row 1) from initializeCells
      table.deleteColumnWithCleanup(0);

      // Verify getBlockIndex was called for both blocks in column 0
      expect(mockGetBlockIndex).toHaveBeenCalledWith('mock-block-1');
      expect(mockGetBlockIndex).toHaveBeenCalledWith('mock-block-3');

      // Verify delete was called with the indices (sorted descending to avoid index shift)
      // Index 2 should be deleted before index 0
      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenNthCalledWith(1, 2);
      expect(mockDelete).toHaveBeenNthCalledWith(2, 0);

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
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
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
        data: { withHeadings: false, withHeadingColumn: false, content: [['', '']] },
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

      pointerClick(addRowBtn);

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
        data: { withHeadings: false, withHeadingColumn: false, content: [['', ''], ['', '']] },
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

      pointerClick(addColBtn);

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
        data: { withHeadings: false, withHeadingColumn: false, content: [['', '']] },
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

      pointerClick(addRowBtn);

      const insertCallsAfterFirstAdd = mockInsert.mock.calls.length;

      // 2 new inserts for the 2 new cells
      expect(insertCallsAfterFirstAdd - insertCallsBefore).toBe(2);

      // Add another row — 2 more new empty cells, but existing cells should NOT trigger inserts
      pointerClick(addRowBtn);

      const insertCallsAfterSecondAdd = mockInsert.mock.calls.length;

      // Only 2 more inserts (for the 2 new cells), not for the existing ones
      expect(insertCallsAfterSecondAdd - insertCallsAfterFirstAdd).toBe(2);

      document.body.removeChild(element);
    });
  });

  describe('drag-to-remove skips rows/columns with content', () => {
    /**
     * Simulate a pointer drag on an element:
     * pointerdown at startPos, pointermove to endPos, pointerup at endPos.
     */
    const simulateDrag = (
      element: HTMLElement,
      axis: 'row' | 'col',
      startPos: number,
      endPos: number,
    ): void => {
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.setPointerCapture = vi.fn();
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.releasePointerCapture = vi.fn();

      const clientKey = axis === 'row' ? 'clientY' : 'clientX';

      element.dispatchEvent(new PointerEvent('pointerdown', {
        [clientKey]: startPos,
        pointerId: 1,
        bubbles: true,
      }));

      element.dispatchEvent(new PointerEvent('pointermove', {
        [clientKey]: endPos,
        pointerId: 1,
        bubbles: true,
      }));

      element.dispatchEvent(new PointerEvent('pointerup', {
        [clientKey]: endPos,
        pointerId: 1,
        bubbles: true,
      }));
    };

    const createDragRemoveTable = (
      content: string[][]
    ): { table: Table; element: HTMLElement } => {
      let insertCallCount = 0;
      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCallCount}`);

            return { id: `mock-block-${insertCallCount}`, holder };
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          getBlocksCount: vi.fn().mockReturnValue(0),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      return { table, element };
    };

    it('does not remove the last row when it has non-empty text content', () => {
      const { element } = createDragRemoveTable([['A', 'B'], ['C', 'D']]);

      // Put text content in the last row's cells to simulate non-empty cells
      const rows = element.querySelectorAll('[data-blok-table-row]');
      const lastRowCells = rows[1].querySelectorAll('[data-blok-table-cell]');

      lastRowCells.forEach(cell => {
        const container = cell.querySelector('[data-blok-table-cell-blocks]');

        if (container) {
          container.textContent = 'some content';
        }
      });

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      // Drag upward by a large amount to attempt removing the last row
      simulateDrag(addRowBtn, 'row', 200, 100);

      // The row should NOT have been removed because it has content
      expect(element.querySelectorAll('[data-blok-table-row]')).toHaveLength(2);

      document.body.removeChild(element);
    });

    it('removes the last row when all its cells are empty', () => {
      const { element } = createDragRemoveTable([['A', 'B'], ['', '']]);

      // Ensure last row cells are empty (clear any text from block initialization)
      const rows = element.querySelectorAll('[data-blok-table-row]');
      const lastRowCells = rows[1].querySelectorAll('[data-blok-table-cell]');

      lastRowCells.forEach(cell => {
        const container = cell.querySelector('[data-blok-table-cell-blocks]');

        if (container) {
          container.textContent = '';
        }
      });

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      // Drag upward to remove the last row
      simulateDrag(addRowBtn, 'row', 200, 100);

      // The empty row should have been removed
      expect(element.querySelectorAll('[data-blok-table-row]')).toHaveLength(1);

      document.body.removeChild(element);
    });

    it('does not remove the last column when it has non-empty text content', () => {
      const { element } = createDragRemoveTable([['A', 'B'], ['C', 'D']]);

      // Put text content in last column cells
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');
        const lastCell = cells[cells.length - 1];
        const container = lastCell.querySelector('[data-blok-table-cell-blocks]');

        if (container) {
          container.textContent = 'some content';
        }
      });

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Drag leftward to attempt removing the last column
      simulateDrag(addColBtn, 'col', 300, 100);

      // The column should NOT have been removed
      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      expect(firstRowCells).toHaveLength(2);

      document.body.removeChild(element);
    });

    it('removes the last column when all its cells are empty', () => {
      const { element } = createDragRemoveTable([['A', ''], ['C', '']]);

      // Ensure last column cells are empty
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');
        const lastCell = cells[cells.length - 1];
        const container = lastCell.querySelector('[data-blok-table-cell-blocks]');

        if (container) {
          container.textContent = '';
        }
      });

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Drag leftward to remove the last column
      simulateDrag(addColBtn, 'col', 300, 100);

      // The empty column should have been removed
      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      expect(firstRowCells).toHaveLength(1);

      document.body.removeChild(element);
    });
  });

  describe('grid width updates during drag-to-add/remove columns', () => {
    const createDragWidthTable = (
      content: string[][],
      colWidths: number[]
    ): { table: Table; element: HTMLElement } => {
      let insertCallCount = 0;
      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCallCount}`);

            return { id: `mock-block-${insertCallCount}`, holder };
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          getBlocksCount: vi.fn().mockReturnValue(0),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content, colWidths },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      return { table, element };
    };

    /**
     * Simulate only the pointerdown + pointermove part of a drag (no pointerup),
     * so we can check intermediate state before onDragEnd fires.
     */
    const simulateDragStart = (
      element: HTMLElement,
      axis: 'row' | 'col',
      startPos: number,
      endPos: number,
    ): void => {
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.setPointerCapture = vi.fn();
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.releasePointerCapture = vi.fn();

      const clientKey = axis === 'row' ? 'clientY' : 'clientX';

      element.dispatchEvent(new PointerEvent('pointerdown', {
        [clientKey]: startPos,
        pointerId: 1,
        bubbles: true,
      }));

      element.dispatchEvent(new PointerEvent('pointermove', {
        [clientKey]: endPos,
        pointerId: 1,
        bubbles: true,
      }));
    };

    it('updates grid width immediately when drag-adding a column', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;
      const widthBefore = parseFloat(grid.style.width);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Drag right by enough to add one column (unitSize is ~200px for last cell)
      simulateDragStart(addColBtn, 'col', 0, 250);

      // Grid width should have grown immediately during the drag
      const widthAfter = parseFloat(grid.style.width);

      expect(widthAfter).toBeGreaterThan(widthBefore);

      document.body.removeChild(element);
    });

    it('updates grid width immediately when drag-removing a column', () => {
      const { element } = createDragWidthTable(
        [['A', '', ''], ['C', '', '']],
        [200, 200, 200]
      );

      // Clear text from last column so it can be removed
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');
        const lastCell = cells[cells.length - 1];
        const container = lastCell.querySelector('[data-blok-table-cell-blocks]');

        if (container) {
          container.textContent = '';
        }
      });

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;
      const widthBefore = parseFloat(grid.style.width);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Drag left by enough to remove one column
      simulateDragStart(addColBtn, 'col', 300, 50);

      // Grid width should have shrunk immediately during the drag
      const widthAfter = parseFloat(grid.style.width);

      expect(widthAfter).toBeLessThan(widthBefore);

      document.body.removeChild(element);
    });

    it('add-row button width is synced when drag-adding a column', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Drag right to add a column, then release (full drag with pointerup)
      addColBtn.setPointerCapture = vi.fn();
      addColBtn.releasePointerCapture = vi.fn();

      addColBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 0,
        pointerId: 1,
        bubbles: true,
      }));

      addColBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 250,
        pointerId: 1,
        bubbles: true,
      }));

      addColBtn.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 250,
        pointerId: 1,
        bubbles: true,
      }));

      const scrollContainer = element.firstElementChild as HTMLElement;
      const grid = scrollContainer.firstElementChild as HTMLElement;
      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      expect(addRowBtn.style.width).toBe(grid.style.width);

      document.body.removeChild(element);
    });

    it('resize handles match column count during drag-to-add column', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const handlesBefore = element.querySelectorAll('[data-blok-table-resize]');

      expect(handlesBefore).toHaveLength(2);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // jsdom offsetWidth returns 0 → measureUnitSize defaults to 100px.
      // Drag right by 110px to add exactly 1 column (floor(110/100) = 1).
      simulateDragStart(addColBtn, 'col', 0, 110);

      // Resize handles should be rebuilt to match the new 3-column layout
      const handlesAfter = element.querySelectorAll('[data-blok-table-resize]');

      expect(handlesAfter).toHaveLength(3);

      document.body.removeChild(element);
    });

    it('resize handles match column count during drag-to-remove column', () => {
      const { element } = createDragWidthTable(
        [['A', 'B', ''], ['C', 'D', '']],
        [200, 200, 200]
      );

      // Put real text in columns 0 and 1 so only column 2 can be removed.
      // Clear column 2 to ensure it is empty.
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');

        // Set visible text in first two columns
        const container0 = cells[0].querySelector('[data-blok-table-cell-blocks]');

        if (container0) {
          container0.textContent = 'content';
        }

        const container1 = cells[1].querySelector('[data-blok-table-cell-blocks]');

        if (container1) {
          container1.textContent = 'content';
        }

        // Clear last column
        const container2 = cells[2].querySelector('[data-blok-table-cell-blocks]');

        if (container2) {
          container2.textContent = '';
        }
      });

      const handlesBefore = element.querySelectorAll('[data-blok-table-resize]');

      expect(handlesBefore).toHaveLength(3);

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // jsdom offsetWidth returns 0 → measureUnitSize defaults to 100px.
      // Drag left by 110px to remove 1 column (floor(-110/100) = -2, but only 1 empty).
      simulateDragStart(addColBtn, 'col', 200, 90);

      // Resize handles should be rebuilt to match the new 2-column layout
      const handlesAfter = element.querySelectorAll('[data-blok-table-resize]');

      expect(handlesAfter).toHaveLength(2);

      document.body.removeChild(element);
    });

    it('hides resize handles when add-button drag starts', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      // Drag downward past threshold to trigger onDragStart
      simulateDragStart(addRowBtn, 'row', 0, 10);

      const handles = element.querySelectorAll('[data-blok-table-resize]');

      // All resize handles should have pointer-events disabled during drag
      handles.forEach(handle => {
        expect((handle as HTMLElement).style.pointerEvents).toBe('none');
      });

      document.body.removeChild(element);
    });

    it('hides grip handles when add-button drag starts', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      // Drag downward past threshold to trigger onDragStart
      simulateDragStart(addRowBtn, 'row', 0, 10);

      const grips = element.querySelectorAll('[data-blok-table-grip]');

      // All grips should be hidden during drag
      grips.forEach(grip => {
        expect((grip as HTMLElement).style.display).toBe('none');
      });

      document.body.removeChild(element);
    });

    it('restores grip handles after add-button drag ends', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const addRowBtn = element.querySelector('[data-blok-table-add-row]') as HTMLElement;

      addRowBtn.setPointerCapture = vi.fn();
      addRowBtn.releasePointerCapture = vi.fn();

      // Full drag: pointerdown → pointermove → pointerup
      addRowBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientY: 0,
        pointerId: 1,
        bubbles: true,
      }));

      addRowBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }));

      addRowBtn.dispatchEvent(new PointerEvent('pointerup', {
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }));

      const grips = element.querySelectorAll('[data-blok-table-grip]');

      // Grips should no longer be hidden after drag ends
      grips.forEach(grip => {
        expect((grip as HTMLElement).style.display).not.toBe('none');
      });

      document.body.removeChild(element);
    });

    it('closes toolbar when row/column grip drag starts', async () => {
      let insertCallCount = 0;
      const toolbarClose = vi.fn();
      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCallCount}`);

            return { id: `mock-block-${insertCallCount}`, holder };
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          getBlocksCount: vi.fn().mockReturnValue(0),
        },
        toolbar: {
          close: toolbarClose,
          open: vi.fn(),
          toggleBlockSettings: vi.fn(),
          toggleToolbox: vi.fn(),
        },
      } as never);

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']], colWidths: [200, 200] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Show grips by hovering a cell
      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      simulateMouseOver(cell);

      // Grab the visible grip
      const grip = element.querySelector('[data-blok-table-grip-visible]') as HTMLElement;

      expect(grip).not.toBeNull();

      // Simulate grip pointerdown → starts tracking on document
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }));

      // Move past drag threshold (10px) to trigger startDrag → onDragStateChange
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 100,
        clientY: 120,
      }));

      expect(toolbarClose).toHaveBeenCalledWith({ setExplicitlyClosed: false });

      // Clean up
      document.dispatchEvent(new PointerEvent('pointerup', {}));
      document.body.removeChild(element);
    });

    it('scrolls wrapper to the right when drag-adding a column', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const scrollContainer = element.firstElementChild as HTMLElement;

      // Mock scrollWidth since jsdom doesn't compute layout
      Object.defineProperty(scrollContainer, 'scrollWidth', { value: 600, configurable: true });

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Drag right by enough to add one column (unitSize defaults to 100px in jsdom)
      simulateDragStart(addColBtn, 'col', 0, 110);

      expect(scrollContainer.scrollLeft).toBeGreaterThan(0);

      document.body.removeChild(element);
    });

    it('preserves scroll position on drag end when columns were added', () => {
      const { element } = createDragWidthTable(
        [['A', 'B'], ['C', 'D']],
        [200, 200]
      );

      const scrollContainer = element.firstElementChild as HTMLElement;

      Object.defineProperty(scrollContainer, 'scrollWidth', { value: 600, configurable: true });

      const addColBtn = element.querySelector('[data-blok-table-add-col]') as HTMLElement;

      // Full drag (down + move + up) to add a column
      addColBtn.setPointerCapture = vi.fn();
      addColBtn.releasePointerCapture = vi.fn();

      addColBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 0,
        pointerId: 1,
        bubbles: true,
      }));

      addColBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 110,
        pointerId: 1,
        bubbles: true,
      }));

      addColBtn.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 110,
        pointerId: 1,
        bubbles: true,
      }));

      // scrollLeft should NOT be reset to 0 since columns were added
      expect(scrollContainer.scrollLeft).toBeGreaterThan(0);

      document.body.removeChild(element);
    });
  });

  describe('readonly mode preserves content', () => {
    it('save() returns original block references when rendered in readonly mode', () => {
      const blockId1 = 'block-cell-0-0';
      const blockId2 = 'block-cell-0-1';
      const blockId3 = 'block-cell-1-0';
      const blockId4 = 'block-cell-1-1';

      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn().mockImplementation((id: string) => {
            const map: Record<string, number> = {
              [blockId1]: 0,
              [blockId2]: 1,
              [blockId3]: 2,
              [blockId4]: 3,
            };

            return map[id];
          }),
          getBlockByIndex: vi.fn().mockImplementation((index: number) => {
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', [blockId1, blockId2, blockId3, blockId4][index]);

            return { id: [blockId1, blockId2, blockId3, blockId4][index], holder };
          }),
          getBlocksCount: vi.fn().mockReturnValue(4),
        },
      } as never);

      // Simulate what happens during readonly toggle:
      // The editor saves the table data (with block IDs), then re-renders with readOnly=true
      const savedContent: Array<Array<{ blocks: string[] }>> = [
        [{ blocks: [blockId1] }, { blocks: [blockId2] }],
        [{ blocks: [blockId3] }, { blocks: [blockId4] }],
      ];

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: {
          withHeadings: false,
          withHeadingColumn: false,
          content: savedContent,
        } as TableData,
        config: {},
        api: mockApi,
        readOnly: true,
        block: { id: 'table-readonly' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // The critical assertion: save() must return the original block references,
      // not empty arrays. This is what fails before the fix — blocks are never
      // mounted in readonly mode, so getCellContent finds nothing in the DOM.
      const saved = table.save(element);

      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(2);

      saved.content.flat().forEach(cell => {
        expect(isCellWithBlocks(cell)).toBe(true);
        if (isCellWithBlocks(cell)) {
          expect(cell.blocks.length).toBeGreaterThan(0);
        }
      });

      // Verify specific block IDs are preserved
      expect(saved.content[0][0]).toEqual({ blocks: [blockId1] });
      expect(saved.content[0][1]).toEqual({ blocks: [blockId2] });
      expect(saved.content[1][0]).toEqual({ blocks: [blockId3] });
      expect(saved.content[1][1]).toEqual({ blocks: [blockId4] });

      document.body.removeChild(element);
    });

    it('rendered() mounts block holders into cell containers in readonly mode', () => {
      const blockId1 = 'block-ro-0-0';
      const blockId2 = 'block-ro-0-1';

      const holders: Record<string, HTMLElement> = {};

      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn().mockImplementation((id: string) => {
            const map: Record<string, number> = {
              [blockId1]: 0,
              [blockId2]: 1,
            };

            return map[id];
          }),
          getBlockByIndex: vi.fn().mockImplementation((index: number) => {
            const ids = [blockId1, blockId2];
            const id = ids[index];

            if (!holders[id]) {
              holders[id] = document.createElement('div');
              holders[id].setAttribute('data-blok-id', id);
              holders[id].textContent = `Content of ${id}`;
            }

            return { id, holder: holders[id] };
          }),
          getBlocksCount: vi.fn().mockReturnValue(2),
        },
      } as never);

      const savedContent: Array<Array<{ blocks: string[] }>> = [
        [{ blocks: [blockId1] }, { blocks: [blockId2] }],
      ];

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: {
          withHeadings: false,
          withHeadingColumn: false,
          content: savedContent,
        } as TableData,
        config: {},
        api: mockApi,
        readOnly: true,
        block: { id: 'table-readonly-mount' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      // Block holders must be inside the cell blocks containers, not floating elsewhere
      const cellBlockContainers = element.querySelectorAll('[data-blok-table-cell-blocks]');

      expect(cellBlockContainers).toHaveLength(2);
      expect(cellBlockContainers[0].querySelector(`[data-blok-id="${blockId1}"]`)).not.toBeNull();
      expect(cellBlockContainers[1].querySelector(`[data-blok-id="${blockId2}"]`)).not.toBeNull();

      document.body.removeChild(element);
    });
  });

  describe('selection moves to neighbor after row/column deletion', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const SELECTED_ATTR = 'data-blok-table-cell-selected';

    const createDeletionTable = (
      content: string[][],
      colWidths?: number[]
    ): { table: Table; element: HTMLElement } => {
      let insertCallCount = 0;
      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCallCount}`);

            return { id: `mock-block-${insertCallCount}`, holder };
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          getBlocksCount: vi.fn().mockReturnValue(0),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content, colWidths },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      return { table, element };
    };

    /**
     * Simulate a grip click (pointerdown + pointerup without movement = no drag)
     * to open the popover. The drag tracker resolves async so we need to flush
     * microtasks.
     */
    const clickGrip = async (grip: HTMLElement): Promise<void> => {
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }));

      // Pointerup without movement resolves beginTracking with false (= click, not drag)
      document.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }));

      // Flush the microtask queue so the promise chain in beginTracking resolves
      await Promise.resolve();
    };

    /**
     * Find and click the destructive (delete) popover item.
     */
    const clickDeleteItem = (el: HTMLElement): void => {
      const deleteItem = el.ownerDocument.querySelector<HTMLElement>(
        '[data-blok-popover-item-destructive]'
      );

      expect(deleteItem).not.toBeNull();
      deleteItem?.click();
    };

    /**
     * Get all cells that have the selected attribute.
     */
    const getSelectedCells = (element: HTMLElement): HTMLElement[] => {
      return Array.from(element.querySelectorAll(`[${SELECTED_ATTR}]`));
    };

    /**
     * Get the row/col coordinates of selected cells.
     */
    const getSelectedCoords = (element: HTMLElement): Array<{ row: number; col: number }> => {
      const selectedCells = getSelectedCells(element);
      const rows = Array.from(element.querySelectorAll('[data-blok-table-row]'));

      return selectedCells.map(cell => {
        const row = cell.closest('[data-blok-table-row]');
        const rowIndex = rows.indexOf(row as Element);
        const cells = Array.from(row?.querySelectorAll('[data-blok-table-cell]') ?? []);
        const colIndex = cells.indexOf(cell);

        return { row: rowIndex, col: colIndex };
      });
    };

    it('selects the next column after deleting a middle column', async () => {
      const { element } = createDeletionTable([['A', 'B', 'C'], ['D', 'E', 'F']]);

      // Find the column grip for column 1 (middle column)
      const colGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]');

      await clickGrip(colGrips[1]);
      clickDeleteItem(element);

      // Wait for requestAnimationFrame in onGripPopoverClose
      await vi.advanceTimersByTimeAsync(16);

      // After deleting col 1, selection should move to col 1 (which was formerly col 2)
      const selected = getSelectedCoords(element);

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(c => c.col === 1)).toBe(true);

      document.body.removeChild(element);
    });

    it('selects the previous column after deleting the last column', async () => {
      const { element } = createDeletionTable([['A', 'B', 'C'], ['D', 'E', 'F']]);

      // Find the column grip for column 2 (last column)
      const colGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]');

      await clickGrip(colGrips[2]);
      clickDeleteItem(element);

      await vi.advanceTimersByTimeAsync(16);

      // After deleting col 2 (last), selection should move to col 1
      const selected = getSelectedCoords(element);

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(c => c.col === 1)).toBe(true);

      document.body.removeChild(element);
    });

    it('selects the next row after deleting a middle row', async () => {
      const { element } = createDeletionTable([['A', 'B'], ['C', 'D'], ['E', 'F']]);

      // Find the row grip for row 1 (middle row)
      const rowGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-row]');

      await clickGrip(rowGrips[1]);
      clickDeleteItem(element);

      await vi.advanceTimersByTimeAsync(16);

      // After deleting row 1, selection should move to row 1 (which was formerly row 2)
      const selected = getSelectedCoords(element);

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(c => c.row === 1)).toBe(true);

      document.body.removeChild(element);
    });

    it('selects the previous row after deleting the last row', async () => {
      const { element } = createDeletionTable([['A', 'B'], ['C', 'D'], ['E', 'F']]);

      // Find the row grip for row 2 (last row)
      const rowGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-row]');

      await clickGrip(rowGrips[2]);
      clickDeleteItem(element);

      await vi.advanceTimersByTimeAsync(16);

      // After deleting row 2 (last), selection should move to row 1
      const selected = getSelectedCoords(element);

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(c => c.row === 1)).toBe(true);

      document.body.removeChild(element);
    });

    it('updates cell widths to fill the row after deleting a column in percent mode', async () => {
      // No colWidths = percentage mode
      const { element } = createDeletionTable([['A', 'B', 'C'], ['D', 'E', 'F']]);

      const sc = element.firstElementChild as HTMLElement;
      const gridEl = sc.firstElementChild as HTMLElement;
      const firstRow = gridEl.querySelector('[data-blok-table-row]');
      const cellsBefore = firstRow?.querySelectorAll('[data-blok-table-cell]');

      // 3 cells in percent mode, each at ~33.33%
      expect(cellsBefore).toHaveLength(3);

      // Delete the middle column (index 1)
      const colGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]');

      await clickGrip(colGrips[1]);
      clickDeleteItem(element);

      await vi.advanceTimersByTimeAsync(16);

      // After deletion, the 2 remaining cells should have widths summing to 100%
      const cellsAfter = firstRow?.querySelectorAll<HTMLElement>('[data-blok-table-cell]');

      expect(cellsAfter).toHaveLength(2);

      const totalWidth = Array.from(cellsAfter ?? []).reduce(
        (sum, cell) => sum + parseFloat(cell.style.width),
        0,
      );

      expect(totalWidth).toBeCloseTo(100, 0);

      document.body.removeChild(element);
    });

    it('clears selection when clicking outside the table after column deletion', async () => {
      const { element } = createDeletionTable([['A', 'B', 'C'], ['D', 'E', 'F']]);

      const colGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]');

      await clickGrip(colGrips[1]);
      clickDeleteItem(element);

      await vi.advanceTimersByTimeAsync(16);

      // Selection should exist after deletion
      expect(getSelectedCells(element).length).toBeGreaterThan(0);

      // Click outside the table to clear selection
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // Selection should be cleared
      expect(getSelectedCells(element).length).toBe(0);

      document.body.removeChild(element);
    });

    it('clears selection when clicking outside the table after row deletion', async () => {
      const { element } = createDeletionTable([['A', 'B'], ['C', 'D'], ['E', 'F']]);

      const rowGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-row]');

      await clickGrip(rowGrips[1]);
      clickDeleteItem(element);

      await vi.advanceTimersByTimeAsync(16);

      // Selection should exist after deletion
      expect(getSelectedCells(element).length).toBeGreaterThan(0);

      // Click outside the table to clear selection
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // Selection should be cleared
      expect(getSelectedCells(element).length).toBe(0);

      document.body.removeChild(element);
    });

    it('disables delete menu item when only one column remains', async () => {
      const { element } = createDeletionTable([['A'], ['B']]);

      const colGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]');

      await clickGrip(colGrips[0]);

      const deleteItem = element.ownerDocument.querySelector(
        '[data-blok-popover-item-destructive]'
      );

      expect(deleteItem).not.toBeNull();
      expect(deleteItem?.getAttribute('data-blok-disabled')).toBe('true');

      document.body.removeChild(element);
    });

    it('disables delete menu item when only one row remains', async () => {
      const { element } = createDeletionTable([['A', 'B']]);

      const rowGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-row]');

      await clickGrip(rowGrips[0]);

      const deleteItem = element.ownerDocument.querySelector(
        '[data-blok-popover-item-destructive]'
      );

      expect(deleteItem).not.toBeNull();
      expect(deleteItem?.getAttribute('data-blok-disabled')).toBe('true');

      document.body.removeChild(element);
    });
  });

  describe('selection after row/column drag-and-drop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const SELECTED_ATTR = 'data-blok-table-cell-selected';

    const createMoveTable = (
      content: string[][]
    ): { table: Table; element: HTMLElement } => {
      let insertCallCount = 0;
      const mockApi = createMockAPI({
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', `mock-block-${insertCallCount}`);

            return { id: `mock-block-${insertCallCount}`, holder };
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          getBlocksCount: vi.fn().mockReturnValue(0),
        },
      } as never);
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      return { table, element };
    };

    /**
     * Get the row/col coordinates of selected cells.
     */
    const getSelectedCoords = (element: HTMLElement): Array<{ row: number; col: number }> => {
      const selectedCells = Array.from(element.querySelectorAll<HTMLElement>(`[${SELECTED_ATTR}]`));
      const rows = Array.from(element.querySelectorAll('[data-blok-table-row]'));

      return selectedCells.map(cell => {
        const row = cell.closest('[data-blok-table-row]');
        const rowIndex = rows.indexOf(row as Element);
        const cells = Array.from(row?.querySelectorAll('[data-blok-table-cell]') ?? []);
        const colIndex = cells.indexOf(cell);

        return { row: rowIndex, col: colIndex };
      });
    };

    it('selects the moved row after drag-and-drop reorder', async () => {
      // 3 rows x 2 cols
      const { table, element } = createMoveTable([['A', 'B'], ['C', 'D'], ['E', 'F']]);
      const sc = element.firstElementChild as HTMLElement;
      const gridEl = sc.firstElementChild as HTMLElement;

      const action: RowColAction = { type: 'move-row', fromIndex: 0, toIndex: 2 };

      (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
        .handleRowColAction(gridEl, action);

      // Wait for requestAnimationFrame in selection highlight
      await vi.advanceTimersByTimeAsync(16);

      const selected = getSelectedCoords(element);

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(c => c.row === 2)).toBe(true);

      document.body.removeChild(element);
    });

    it('selects the moved column after drag-and-drop reorder', async () => {
      // 2 rows x 3 cols
      const { table, element } = createMoveTable([['A', 'B', 'C'], ['D', 'E', 'F']]);
      const sc = element.firstElementChild as HTMLElement;
      const gridEl = sc.firstElementChild as HTMLElement;

      const action: RowColAction = { type: 'move-col', fromIndex: 0, toIndex: 2 };

      (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
        .handleRowColAction(gridEl, action);

      // Wait for requestAnimationFrame in selection highlight
      await vi.advanceTimersByTimeAsync(16);

      const selected = getSelectedCoords(element);

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.every(c => c.col === 2)).toBe(true);

      document.body.removeChild(element);
    });

    it('shows active grip on the moved row after drag-and-drop', async () => {
      // 3 rows x 2 cols
      const { table, element } = createMoveTable([['A', 'B'], ['C', 'D'], ['E', 'F']]);
      const sc = element.firstElementChild as HTMLElement;
      const gridEl = sc.firstElementChild as HTMLElement;

      const action: RowColAction = { type: 'move-row', fromIndex: 0, toIndex: 2 };

      (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
        .handleRowColAction(gridEl, action);

      // Wait for requestAnimationFrame in setActiveGrip
      await vi.advanceTimersByTimeAsync(16);

      const rowGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-row]');

      expect(rowGrips[2]).toHaveAttribute('data-blok-table-grip-visible');

      document.body.removeChild(element);
    });

    it('shows active grip on the moved column after drag-and-drop', async () => {
      // 2 rows x 3 cols
      const { table, element } = createMoveTable([['A', 'B', 'C'], ['D', 'E', 'F']]);
      const sc = element.firstElementChild as HTMLElement;
      const gridEl = sc.firstElementChild as HTMLElement;

      const action: RowColAction = { type: 'move-col', fromIndex: 0, toIndex: 2 };

      (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
        .handleRowColAction(gridEl, action);

      await vi.advanceTimersByTimeAsync(16);

      const colGrips = element.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]');

      expect(colGrips[2]).toHaveAttribute('data-blok-table-grip-visible');

      document.body.removeChild(element);
    });
  });

  describe('caret placement on new table', () => {
    const createMockApiWithEditableBlocks = (): API => {
      return createMockAPI({
        blocks: {
          insert: () => {
            const holder = document.createElement('div');
            const editable = document.createElement('div');

            editable.setAttribute('contenteditable', 'true');
            holder.appendChild(editable);
            holder.setAttribute('data-blok-id', `mock-${Math.random().toString(36).slice(2, 8)}`);

            return { id: holder.getAttribute('data-blok-id'), holder };
          },
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: () => undefined,
        },
      } as never);
    };

    it('focuses the first cell contenteditable after rendered() for a new table', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [] },
        config: {},
        api: createMockApiWithEditableBlocks(),
        readOnly: false,
        block: { id: 'table-new' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const firstCell = element.querySelector('[data-blok-table-cell]');
      const firstEditable = firstCell?.querySelector('[contenteditable="true"]');

      expect(firstEditable).not.toBeNull();
      expect(firstEditable).toHaveFocus();

      document.body.removeChild(element);
    });

    it('does not focus cell when table has existing content', () => {
      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: createMockApiWithEditableBlocks(),
        readOnly: false,
        block: { id: 'table-existing' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      const firstEditable = element.querySelector('[contenteditable="true"]');

      expect(firstEditable).not.toHaveFocus();

      document.body.removeChild(element);
    });
  });

  describe('grid paste handler', () => {
    /**
     * Create a ClipboardEvent with the given HTML in the clipboard data.
     * jsdom does not support DataTransfer on ClipboardEvent, so we define
     * clipboardData manually.
     */
    const createPasteEvent = (html: string): ClipboardEvent => {
      const dataMap: Record<string, string> = { 'text/html': html };
      const clipboardData = {
        getData: (type: string) => dataMap[type] ?? '',
        setData: (type: string, value: string) => { dataMap[type] = value; },
      } as unknown as DataTransfer;

      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;

      Object.defineProperty(event, 'clipboardData', { value: clipboardData, writable: false });

      return event;
    };

    /**
     * Focus a cell by making it focusable. In jsdom, block holders from mock
     * insert don't have contenteditable, so we add a temporary focusable child.
     */
    const focusCellAt = (gridEl: HTMLElement, rowIndex: number, colIndex: number): void => {
      const rows = gridEl.querySelectorAll('[data-blok-table-row]');
      const row = rows[rowIndex];
      const cells = row.querySelectorAll('[data-blok-table-cell]');
      const cell = cells[colIndex] as HTMLElement;

      let editable = cell.querySelector<HTMLElement>('[contenteditable="true"]');

      if (!editable) {
        editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        cell.appendChild(editable);
      }

      editable.focus();
    };

    /**
     * Build a table + API suitable for paste tests, exposing mock tracking.
     */
    const createPasteTable = (
      content: string[][],
      options?: { colWidths?: number[]; readOnly?: boolean },
    ): {
      table: Table;
      element: HTMLElement;
      mockInsert: ReturnType<typeof vi.fn>;
      mockDelete: ReturnType<typeof vi.fn>;
      mockSetBlockParent: ReturnType<typeof vi.fn>;
    } => {
      let insertCallCount = 0;
      const blockIndexMap = new Map<string, number>();
      const mockInsert = vi.fn().mockImplementation((_type?: string, _data?: unknown) => {
        insertCallCount++;
        const blockId = `paste-block-${insertCallCount}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', blockId);
        blockIndexMap.set(blockId, insertCallCount - 1);

        return { id: blockId, holder };
      });
      const mockDelete = vi.fn();
      const mockSetBlockParent = vi.fn();
      const mockApi = createMockAPI({
        blocks: {
          insert: mockInsert,
          delete: mockDelete,
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
          setBlockParent: mockSetBlockParent,
        },
      } as never);

      const tableOptions: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: {
          withHeadings: false,
          withHeadingColumn: false,
          content,
          ...(options?.colWidths ? { colWidths: options.colWidths } : {}),
        },
        config: {},
        api: mockApi,
        readOnly: options?.readOnly ?? false,
        block: { id: 'table-paste' } as never,
      };

      const table = new Table(tableOptions);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      return { table, element, mockInsert, mockDelete, mockSetBlockParent };
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('ignores paste events with non-table-cell clipboard data', () => {
      const { element } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      const pasteEvent = createPasteEvent('<p>plain text</p>');
      const preventSpy = vi.spyOn(pasteEvent, 'preventDefault');

      gridEl.dispatchEvent(pasteEvent);

      // Should NOT prevent default — let normal paste handling proceed
      expect(preventSpy).not.toHaveBeenCalled();

      document.body.removeChild(element);
    });

    it('intercepts paste events containing table cell clipboard data', () => {
      const { element } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'pasted' } }] }]],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);
      const preventSpy = vi.spyOn(pasteEvent, 'preventDefault');

      gridEl.dispatchEvent(pasteEvent);

      // Should prevent default to handle paste ourselves
      expect(preventSpy).toHaveBeenCalled();

      // The pasted block should be appended to the target cell's container
      const targetCell = gridEl.querySelector('[data-blok-table-row]')
        ?.querySelector('[data-blok-table-cell]');
      const pastedBlock = targetCell?.querySelector('[data-blok-id]');

      expect(pastedBlock).toBeTruthy();

      document.body.removeChild(element);
    });

    it('inserts blocks from clipboard payload into the target cell', () => {
      const { element, mockInsert, mockSetBlockParent } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      const insertsBefore = mockInsert.mock.calls.length;

      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'pasted text' } }] }]],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);

      gridEl.dispatchEvent(pasteEvent);

      // One new block should have been inserted
      const insertsAfter = mockInsert.mock.calls.length;

      expect(insertsAfter - insertsBefore).toBe(1);

      // The inserted block should have the correct tool and data
      const lastCall = mockInsert.mock.calls[mockInsert.mock.calls.length - 1];

      expect(lastCall[0]).toBe('paragraph');
      expect(lastCall[1]).toEqual({ text: 'pasted text' });

      // Block should be parented to the table
      expect(mockSetBlockParent).toHaveBeenCalled();

      document.body.removeChild(element);
    });

    it('pastes a 2x2 payload into a 2x2 table starting from (0,0)', () => {
      const { element, mockInsert } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      const insertsBefore = mockInsert.mock.calls.length;

      const payload: TableCellsClipboard = {
        rows: 2,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'R0C0' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'R0C1' } }] },
          ],
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'R1C0' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'R1C1' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);

      gridEl.dispatchEvent(pasteEvent);

      // 4 new blocks should have been inserted (one per cell)
      const insertsAfter = mockInsert.mock.calls.length;

      expect(insertsAfter - insertsBefore).toBe(4);

      document.body.removeChild(element);
    });

    it('auto-expands rows when payload exceeds current row count', () => {
      const { element } = createPasteTable([['A', 'B']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      // Paste a 2-row payload into a 1-row table
      const payload: TableCellsClipboard = {
        rows: 2,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'R0C0' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'R0C1' } }] },
          ],
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'R1C0' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'R1C1' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);

      gridEl.dispatchEvent(pasteEvent);

      // Table should now have 2 rows
      const rows = gridEl.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(2);

      document.body.removeChild(element);
    });

    it('auto-expands columns when payload exceeds current column count', () => {
      const { element } = createPasteTable([['A'], ['B']], { colWidths: [200] });

      const scrollContainer = element.firstElementChild as HTMLElement;
      const gridEl = scrollContainer.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      // Paste a 2-column payload into a 1-column table
      const payload: TableCellsClipboard = {
        rows: 2,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'R0C0' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'R0C1' } }] },
          ],
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'R1C0' } }] },
            { blocks: [{ tool: 'paragraph', data: { text: 'R1C1' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);

      gridEl.dispatchEvent(pasteEvent);

      // Each row should now have 2 cells
      const rows = gridEl.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');

        expect(cells).toHaveLength(2);
      });

      document.body.removeChild(element);
    });

    it('ignores paste events in read-only mode', () => {
      const { element, mockInsert } = createPasteTable([['A', 'B']], { readOnly: true });

      const gridEl = element.firstElementChild as HTMLElement;
      const insertsBefore = mockInsert.mock.calls.length;

      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'should not paste' } }] }]],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);
      const preventSpy = vi.spyOn(pasteEvent, 'preventDefault');

      gridEl.dispatchEvent(pasteEvent);

      // Should NOT prevent default in read-only mode
      expect(preventSpy).not.toHaveBeenCalled();

      // No new blocks should be inserted
      expect(mockInsert.mock.calls.length).toBe(insertsBefore);

      document.body.removeChild(element);
    });

    it('ignores paste when active element is not inside the grid', () => {
      const { element, mockInsert } = createPasteTable([['A', 'B']]);

      const gridEl = element.firstElementChild as HTMLElement;
      const insertsBefore = mockInsert.mock.calls.length;

      // Focus something outside the grid
      const outsideEl = document.createElement('input');

      document.body.appendChild(outsideEl);
      outsideEl.focus();

      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'should not paste' } }] }]],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);
      const preventSpy = vi.spyOn(pasteEvent, 'preventDefault');

      gridEl.dispatchEvent(pasteEvent);

      // Should NOT prevent default when active element is outside grid
      expect(preventSpy).not.toHaveBeenCalled();

      // No new blocks should be inserted
      expect(mockInsert.mock.calls.length).toBe(insertsBefore);

      document.body.removeChild(outsideEl);
      document.body.removeChild(element);
    });

    it('handles empty clipboard payload cells gracefully', () => {
      const { element } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      // Paste payload where one cell has no blocks
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 2,
        cells: [[
          { blocks: [{ tool: 'paragraph', data: { text: 'has content' } }] },
          { blocks: [] },
        ]],
      };
      const html = buildClipboardHtml(payload);
      const pasteEvent = createPasteEvent(html);

      // Should not throw
      expect(() => {
        gridEl.dispatchEvent(pasteEvent);
      }).not.toThrow();

      document.body.removeChild(element);
    });

    it('distributes generic HTML table cells across the grid', () => {
      const { element, mockInsert } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      const insertsBefore = mockInsert.mock.calls.length;

      // Paste a plain HTML table (no data-blok-table-cells attribute) like from Google Docs
      const html = '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>';
      const pasteEvent = createPasteEvent(html);
      const preventSpy = vi.spyOn(pasteEvent, 'preventDefault');

      gridEl.dispatchEvent(pasteEvent);

      // Should prevent default — we're handling the paste
      expect(preventSpy).toHaveBeenCalled();

      // 4 blocks should have been inserted (one per cell)
      const insertsAfter = mockInsert.mock.calls.length;

      expect(insertsAfter - insertsBefore).toBe(4);

      // Verify the inserted blocks contain the right text
      const newCalls = mockInsert.mock.calls.slice(insertsBefore);

      expect(newCalls[0][0]).toBe('paragraph');
      expect(newCalls[0][1]).toEqual({ text: 'X' });
      expect(newCalls[1][1]).toEqual({ text: 'Y' });
      expect(newCalls[2][1]).toEqual({ text: 'Z' });
      expect(newCalls[3][1]).toEqual({ text: 'W' });

      document.body.removeChild(element);
    });

    it('distributes Google Docs table HTML across the grid', () => {
      const { element, mockInsert } = createPasteTable([['A', 'B'], ['C', 'D']]);

      const gridEl = element.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      const insertsBefore = mockInsert.mock.calls.length;

      // Realistic Google Docs clipboard HTML
      const html = `
        <meta charset="utf-8">
        <b id="docs-internal-guid-abc123" style="font-weight:normal;">
          <div dir="ltr">
            <table style="border:none;">
              <tbody>
                <tr>
                  <td style="padding:5pt;"><p dir="ltr"><span>Hello</span></p></td>
                  <td style="padding:5pt;"><p dir="ltr"><span>World</span></p></td>
                </tr>
              </tbody>
            </table>
          </div>
        </b>`;
      const pasteEvent = createPasteEvent(html);

      gridEl.dispatchEvent(pasteEvent);

      // 2 blocks should have been inserted (one per cell in the 1x2 table)
      const insertsAfter = mockInsert.mock.calls.length;

      expect(insertsAfter - insertsBefore).toBe(2);

      const newCalls = mockInsert.mock.calls.slice(insertsBefore);

      expect(newCalls[0][1]).toEqual({ text: 'Hello' });
      expect(newCalls[1][1]).toEqual({ text: 'World' });

      document.body.removeChild(element);
    });

    it('auto-expands grid when generic HTML table is larger than target', () => {
      const { element } = createPasteTable([['A']]);

      const sc = element.firstElementChild as HTMLElement;
      const gridEl = sc.firstElementChild as HTMLElement;

      focusCellAt(gridEl, 0, 0);

      // Paste a 2x2 generic table into a 1x1 table
      const html = '<table><tr><td>R0C0</td><td>R0C1</td></tr><tr><td>R1C0</td><td>R1C1</td></tr></table>';
      const pasteEvent = createPasteEvent(html);

      gridEl.dispatchEvent(pasteEvent);

      // Table should now have 2 rows with 2 cells each
      const rows = gridEl.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(2);

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');

        expect(cells).toHaveLength(2);
      });

      document.body.removeChild(element);
    });
  });

  describe('read-only cell selection and copy', () => {
    /** Stub for elementFromPoint that returns the target cell */
    let elementFromPointTarget: Element | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      elementFromPointTarget = null;

      // jsdom doesn't define elementFromPoint; provide a stub
      document.elementFromPoint = (_x: number, _y: number) => elementFromPointTarget;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Helper to create a ClipboardEvent-like object that works in jsdom.
     * jsdom doesn't support DataTransfer in ClipboardEvent constructor,
     * so we create a plain Event and add clipboardData manually.
     */
    const createClipboardEvent = (type: 'copy' | 'cut' | 'paste'): {
      event: ClipboardEvent;
      clipboardData: { setData: ReturnType<typeof vi.fn>; getData: ReturnType<typeof vi.fn> };
      preventDefaultSpy: ReturnType<typeof vi.fn>;
    } => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
      const clipboardData = { setData: vi.fn(), getData: vi.fn() };
      const preventDefaultSpy = vi.fn();

      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });

      return { event, clipboardData, preventDefaultSpy };
    };

    /**
     * Create a read-only table with blocks registered in the API,
     * mimicking what happens when the editor renders in read-only mode.
     */
    const createReadOnlyTable = (
      content: string[][],
    ): {
      table: Table;
      element: HTMLElement;
      mockApi: API;
    } => {
      let insertCallCount = 0;
      const blockIndexMap = new Map<string, number>();
      const blockDataMap = new Map<string, { name: string; preservedData: Record<string, unknown>; preservedTunes: Record<string, unknown> }>();

      const mockInsert = vi.fn().mockImplementation((type?: string, data?: Record<string, unknown>) => {
        insertCallCount++;
        const blockId = `ro-block-${insertCallCount}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', blockId);
        blockIndexMap.set(blockId, insertCallCount - 1);
        blockDataMap.set(blockId, {
          name: type ?? 'paragraph',
          preservedData: data ?? {},
          preservedTunes: {},
        });

        return { id: blockId, holder };
      });

      const mockApi = createMockAPI({
        blocks: {
          insert: mockInsert,
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
          getBlockByIndex: vi.fn().mockImplementation((index: number) => {
            for (const [id, idx] of blockIndexMap.entries()) {
              if (idx === index) {
                const meta = blockDataMap.get(id);

                return {
                  id,
                  name: meta?.name ?? 'paragraph',
                  preservedData: meta?.preservedData ?? {},
                  preservedTunes: meta?.preservedTunes ?? {},
                };
              }
            }

            return undefined;
          }),
          setBlockParent: vi.fn(),
        },
        rectangleSelection: {
          cancelActiveSelection: vi.fn(),
        },
      } as never);

      const tableOptions: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: {
          withHeadings: false,
          withHeadingColumn: false,
          content,
        },
        config: {},
        api: mockApi,
        readOnly: true,
        block: { id: 'table-readonly-copy' } as never,
      };

      const table = new Table(tableOptions);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      return { table, element, mockApi };
    };

    /**
     * Simulate a pointer drag from one cell to another within a grid.
     * Sets up elementFromPoint to return the target cell so that
     * TableCellSelection.handlePointerMove resolves the correct cell.
     */
    const simulateCellDrag = (
      gridEl: HTMLElement,
      fromCol: number,
      toCol: number,
    ): void => {
      const rows = gridEl.querySelectorAll('[data-blok-table-row]');
      const startRow = rows[0];

      if (!startRow) {
        return;
      }

      const startCell = startRow.querySelectorAll('[data-blok-table-cell]')[fromCol] as HTMLElement;
      const endCell = startRow.querySelectorAll('[data-blok-table-cell]')[toCol] as HTMLElement;

      if (!startCell || !endCell) {
        return;
      }

      startCell.setPointerCapture = vi.fn();
      startCell.releasePointerCapture = vi.fn();

      // Set the elementFromPoint target before dispatching move events
      elementFromPointTarget = endCell;

      // Pointerdown on start cell
      const downEvent = new PointerEvent('pointerdown', {
        clientX: 50,
        clientY: 20,
        pointerId: 1,
        bubbles: true,
        button: 0,
      });

      Object.defineProperty(downEvent, 'target', { value: startCell, configurable: true });
      gridEl.dispatchEvent(downEvent);

      // Pointermove to end cell
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 150,
        clientY: 20,
        pointerId: 1,
        bubbles: true,
      }));

      // Pointerup
      document.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 150,
        clientY: 20,
        pointerId: 1,
        bubbles: true,
      }));
    };

    it('initializes cell selection in read-only mode', () => {
      const { element, table } = createReadOnlyTable([['Hello', 'World']]);
      const gridEl = element.firstElementChild as HTMLElement;

      // Cell selection sets position: relative on the grid element
      expect(gridEl.style.position).toBe('relative');

      document.body.removeChild(element);
      table.destroy();
    });

    it('supports copy from selected cells in read-only mode', () => {
      const { element, table } = createReadOnlyTable([['CopyMe', 'CopyToo']]);
      const gridEl = element.firstElementChild as HTMLElement;

      expect(gridEl).toHaveTextContent('CopyMe');
      expect(gridEl).toHaveTextContent('CopyToo');

      // Select cells via pointer drag
      simulateCellDrag(gridEl, 0, 1);

      // Now trigger a copy event
      const { event: copyEvent, clipboardData } = createClipboardEvent('copy');

      document.dispatchEvent(copyEvent);

      // If selection was active, clipboard data should have been set
      const calls = clipboardData.setData.mock.calls as Array<[string, string]>;
      const htmlCalls = calls.filter(
        (c) => c[0] === 'text/html'
      );
      const textCalls = calls.filter(
        (c) => c[0] === 'text/plain'
      );

      expect(htmlCalls.length).toBeGreaterThanOrEqual(1);
      expect(textCalls.length).toBeGreaterThanOrEqual(1);

      // Verify the clipboard content contains the cell text
      const plainText = textCalls[0][1];

      expect(plainText).toContain('CopyMe');
      expect(plainText).toContain('CopyToo');

      document.body.removeChild(element);
      table.destroy();
    });

    it('does not support cut in read-only mode', () => {
      const { element, table } = createReadOnlyTable([['NoCut', 'Blocked']]);
      const gridEl = element.firstElementChild as HTMLElement;

      // Select cells via pointer drag
      simulateCellDrag(gridEl, 0, 1);

      // Trigger a cut event
      const { event: cutEvent, clipboardData } = createClipboardEvent('cut');

      document.dispatchEvent(cutEvent);

      // Cut handler should NOT set data on clipboard (no onCut callback wired)
      // The cut event is intercepted by TableCellSelection.handleCut,
      // which calls this.onCut if it exists. In read-only mode, onCut is not provided,
      // so clipboardData.setData should NOT be called with any cell data.
      const cutCalls = clipboardData.setData.mock.calls as Array<[string, string]>;
      const htmlCalls = cutCalls.filter(
        (c) => c[0] === 'text/html'
      );

      expect(htmlCalls.length).toBe(0);

      document.body.removeChild(element);
      table.destroy();
    });

    it('does not support paste in read-only mode', () => {
      const { element, table } = createReadOnlyTable([['A', 'B']]);
      const gridEl = element.firstElementChild as HTMLElement;

      // Verify no paste listener is registered by dispatching a paste event
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'should not paste' } }] }]],
      };
      const html = buildClipboardHtml(payload);

      const { event: pasteEvent, clipboardData, preventDefaultSpy } = createClipboardEvent('paste');

      clipboardData.getData.mockReturnValue(html);

      gridEl.dispatchEvent(pasteEvent);

      // Should NOT prevent default — no paste handler in read-only mode
      expect(preventDefaultSpy).not.toHaveBeenCalled();

      document.body.removeChild(element);
      table.destroy();
    });

    it('does not clear content on Delete/Backspace in read-only mode', () => {
      const { element, table } = createReadOnlyTable([['Keep', 'This']]);
      const gridEl = element.firstElementChild as HTMLElement;

      // Select cells via pointer drag
      simulateCellDrag(gridEl, 0, 1);

      const textBefore = gridEl.textContent;

      // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Cell selection listens on document for keydown; no user-event alternative for document-level listeners
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

      const textAfter = gridEl.textContent;

      // Content should not be cleared (no onClearContent callback)
      expect(textAfter).toBe(textBefore);

      document.body.removeChild(element);
      table.destroy();
    });

    it('cleans up cell selection on destroy in read-only mode', () => {
      const { element, table } = createReadOnlyTable([['A', 'B']]);

      // destroy should not throw
      expect(() => {
        table.destroy();
      }).not.toThrow();

      document.body.removeChild(element);
    });
  });

  describe('setData', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      container.remove();
    });

    it('replaces table DOM with new data in-place', () => {
      const options = createTableOptions({
        content: [['A', 'B'], ['C', 'D']],
      });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Verify initial state: 2 rows
      const initialSc = element.firstElementChild as HTMLElement;
      const initialGrid = initialSc.firstElementChild as HTMLElement;

      expect(initialGrid.querySelectorAll('[data-blok-table-row]')).toHaveLength(2);

      // Call setData with 3 rows and headings enabled
      table.setData({
        content: [['H1', 'H2'], ['X', 'Y'], ['P', 'Q']],
        withHeadings: true,
      });

      // The old element was replaced — find the new element in the container
      const newWrapper = container.firstElementChild as HTMLElement;

      expect(newWrapper).not.toBe(element);

      const newSc = newWrapper.firstElementChild as HTMLElement;
      const newGrid = newSc.firstElementChild as HTMLElement;
      const newRows = newGrid.querySelectorAll('[data-blok-table-row]');

      expect(newRows).toHaveLength(3);

      // First row should have heading attribute
      expect(newRows[0].hasAttribute('data-blok-table-heading')).toBe(true);
      expect(newRows[1].hasAttribute('data-blok-table-heading')).toBe(false);

      // Each cell should be initialized with a paragraph block
      const cells = newGrid.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        const blocksContainer = cell.querySelector('[data-blok-table-cell-blocks]');

        expect(blocksContainer).not.toBeNull();
        // initializeCells inserts a paragraph block per cell
        expect(blocksContainer?.querySelectorAll('[data-blok-id]').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('does nothing when element has no parent node', () => {
      const options = createTableOptions({
        content: [['A']],
      });
      const table = new Table(options);

      // Render but do NOT mount in the DOM
      table.render();
      table.rendered();

      // Should not throw even though element is not in the DOM
      expect(() => {
        table.setData({ content: [['X', 'Y']] });
      }).not.toThrow();
    });

    it('can toggle headings off via setData', () => {
      const options = createTableOptions({
        withHeadings: true,
        content: [['H1', 'H2'], ['D1', 'D2']],
      });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Verify heading is initially on
      const initialRows = element.querySelectorAll('[data-blok-table-row]');

      expect(initialRows[0].hasAttribute('data-blok-table-heading')).toBe(true);

      // Toggle heading off
      table.setData({ withHeadings: false });

      const newWrapper = container.firstElementChild as HTMLElement;
      const newRows = newWrapper.querySelectorAll('[data-blok-table-row]');

      expect(newRows[0].hasAttribute('data-blok-table-heading')).toBe(false);
    });

    it('preserves saved data after setData', () => {
      const options = createTableOptions({
        content: [['A']],
      });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setData({
        content: [['X', 'Y'], ['P', 'Q']],
        withHeadings: true,
      });

      const newWrapper = container.firstElementChild as HTMLElement;
      const saved = table.save(newWrapper);

      expect(saved.withHeadings).toBe(true);
      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(2);
    });

    it('calls deleteAllBlocks during normal setData', () => {
      const mockDelete = vi.fn();
      let insertCounter = 0;
      const blockIndexMap = new Map<string, number>();

      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          isSyncingFromYjs: false,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const blockId = `cell-block-${insertCounter}`;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', blockId);
            blockIndexMap.set(blockId, insertCounter - 1);

            return { id: blockId, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
          setBlockParent: vi.fn(),
        },
      } as never);

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // 4 cell blocks created during render
      expect(insertCounter).toBe(4);
      mockDelete.mockClear();

      // setData should delete old blocks during normal update
      table.setData({ content: [['X', 'Y']], withHeadings: false });

      // All 4 original cell blocks should be deleted
      expect(mockDelete).toHaveBeenCalledTimes(4);
    });

    it('skips deleteAllBlocks during Yjs-driven setData', () => {
      const mockDelete = vi.fn();
      let insertCounter = 0;
      const blockIndexMap = new Map<string, number>();

      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          isSyncingFromYjs: true,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const blockId = `cell-block-${insertCounter}`;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', blockId);
            blockIndexMap.set(blockId, insertCounter - 1);

            return { id: blockId, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
          setBlockParent: vi.fn(),
        },
      } as never);

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // 4 cell blocks created during render
      expect(insertCounter).toBe(4);
      mockDelete.mockClear();

      // setData during Yjs sync should NOT delete cell blocks
      table.setData({ content: [['X', 'Y']], withHeadings: false });

      // Cell blocks should NOT be deleted during Yjs-driven update
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('calls deleteAllBlocks during normal destroy', () => {
      const mockDelete = vi.fn();
      let insertCounter = 0;
      const blockIndexMap = new Map<string, number>();

      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          isSyncingFromYjs: false,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const blockId = `cell-block-${insertCounter}`;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', blockId);
            blockIndexMap.set(blockId, insertCounter - 1);

            return { id: blockId, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        },
      } as never);

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      expect(insertCounter).toBe(4);

      table.destroy();

      // All 4 cell blocks should be deleted during normal destroy
      expect(mockDelete).toHaveBeenCalledTimes(4);

      document.body.removeChild(element);
    });

    it('skips deleteAllBlocks when Yjs sync is in progress', () => {
      const mockDelete = vi.fn();
      let insertCounter = 0;
      const blockIndexMap = new Map<string, number>();

      const mockApi = createMockAPI({
        blocks: {
          delete: mockDelete,
          isSyncingFromYjs: true,
          insert: vi.fn().mockImplementation(() => {
            insertCounter++;
            const blockId = `cell-block-${insertCounter}`;
            const holder = document.createElement('div');

            holder.setAttribute('data-blok-id', blockId);
            blockIndexMap.set(blockId, insertCounter - 1);

            return { id: blockId, holder };
          }),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          getBlocksCount: vi.fn().mockReturnValue(0),
          getBlockIndex: vi.fn().mockImplementation((id: string) => blockIndexMap.get(id)),
        },
      } as never);

      const options: BlockToolConstructorOptions<TableData, TableConfig> = {
        data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
        config: {},
        api: mockApi,
        readOnly: false,
        block: { id: 'table-1' } as never,
      };

      const table = new Table(options);
      const element = table.render();

      document.body.appendChild(element);
      table.rendered();

      expect(insertCounter).toBe(4);

      table.destroy();

      // Cell blocks should NOT be deleted during Yjs-driven removal
      expect(mockDelete).not.toHaveBeenCalled();

      document.body.removeChild(element);
    });
  });
});
