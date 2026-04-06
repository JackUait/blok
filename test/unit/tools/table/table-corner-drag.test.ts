import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableCornerDrag } from '../../../../src/tools/table/table-corner-drag';

const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';
const CORNER_TOOLTIP_ATTR = 'data-blok-table-corner-tooltip';

const createWrapper = (): HTMLDivElement => {
  const wrapper = document.createElement('div');

  wrapper.style.position = 'relative';
  document.body.appendChild(wrapper);

  return wrapper;
};

const createGrid = (rows: number, cols: number): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  Array.from({ length: cols }).forEach(() => {
    const col = document.createElement('col');

    col.style.width = '100px';
    colgroup.appendChild(col);
  });

  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  Array.from({ length: rows }).forEach((_, r) => {
    const row = document.createElement('tr');

    row.setAttribute('data-blok-table-row', '');

    Array.from({ length: cols }).forEach((__, c) => {
      const td = document.createElement('td');

      td.setAttribute('data-blok-table-cell', '');
      td.setAttribute('data-blok-table-cell-row', String(r));
      td.setAttribute('data-blok-table-cell-col', String(c));
      row.appendChild(td);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  return table;
};

const createDefaultOptions = (wrapper: HTMLElement, gridEl: HTMLElement) => ({
  wrapper,
  gridEl,
  onAddRow: vi.fn(),
  onAddColumn: vi.fn(),
  onRemoveLastRow: vi.fn(),
  onRemoveLastColumn: vi.fn(),
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
  getTableSize: vi.fn(() => ({ rows: 2, cols: 3 })),
  canRemoveLastRow: vi.fn(() => true),
  canRemoveLastColumn: vi.fn(() => true),
});

describe('TableCornerDrag', () => {
  let wrapper: HTMLDivElement;
  let grid: HTMLTableElement;
  let cornerDrag: TableCornerDrag;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    grid = createGrid(2, 3);
    wrapper.appendChild(grid);
  });

  afterEach(() => {
    cornerDrag?.destroy();
    wrapper?.remove();
    vi.restoreAllMocks();
  });

  describe('construction and DOM', () => {
    it('creates a hit zone element with the correct attribute', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      expect(hitZone).not.toBeNull();
    });

    it('positions hit zone absolutely at the bottom-right corner', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      expect(hitZone.style.position).toBe('absolute');
      expect(hitZone.style.cursor).toBe('nwse-resize');
      expect(hitZone.getAttribute('contenteditable')).toBe('false');
    });

    it('creates a tooltip element', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const tooltip = wrapper.querySelector(`[${CORNER_TOOLTIP_ATTR}]`);

      expect(tooltip).not.toBeNull();
    });

    it('tooltip is hidden by default', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const tooltip = wrapper.querySelector(`[${CORNER_TOOLTIP_ATTR}]`) as HTMLElement;

      expect(tooltip.style.opacity).toBe('0');
    });
  });
});
