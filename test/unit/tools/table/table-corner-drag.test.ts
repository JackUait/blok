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

    /* Stub pointer capture APIs not available in jsdom */
    // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
    HTMLElement.prototype.setPointerCapture = vi.fn();
    // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
    HTMLElement.prototype.releasePointerCapture = vi.fn();
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

  describe('hover tooltip', () => {
    it('shows tooltip with table size on mouseenter', () => {
      const options = createDefaultOptions(wrapper, grid);

      options.getTableSize.mockReturnValue({ rows: 2, cols: 3 });
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new MouseEvent('mouseenter'));

      const tooltip = wrapper.querySelector(`[${CORNER_TOOLTIP_ATTR}]`) as HTMLElement;

      expect(tooltip.style.opacity).toBe('1');
      expect(tooltip.textContent).toBe('2×3');
    });

    it('hides tooltip on mouseleave', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new MouseEvent('mouseenter'));
      hitZone.dispatchEvent(new MouseEvent('mouseleave'));

      const tooltip = wrapper.querySelector(`[${CORNER_TOOLTIP_ATTR}]`) as HTMLElement;

      expect(tooltip.style.opacity).toBe('0');
    });
  });

  describe('click (no drag)', () => {
    it('calls onAddRow and onAddColumn once each on click', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1 }));

      expect(options.onAddRow).toHaveBeenCalledOnce();
      expect(options.onAddColumn).toHaveBeenCalledOnce();
    });

    it('does not call onDragStart or onDragEnd on click', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1 }));

      expect(options.onDragStart).not.toHaveBeenCalled();
      expect(options.onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe('drag to add', () => {
    it('calls onAddRow when dragging downward by one unit height', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      const rows = grid.querySelectorAll('[data-blok-table-row]');

      Object.defineProperty(rows[rows.length - 1], 'offsetHeight', { value: 30 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 136, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 130, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 130, pointerId: 1 }));

      expect(options.onAddRow).toHaveBeenCalledOnce();
      expect(options.onAddColumn).not.toHaveBeenCalled();
      expect(options.onDragEnd).toHaveBeenCalledOnce();
    });

    it('calls onAddColumn when dragging rightward by one unit width', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      const firstRow = grid.querySelector('[data-blok-table-row]')!;
      const cells = firstRow.querySelectorAll('[data-blok-table-cell]');

      Object.defineProperty(cells[cells.length - 1], 'offsetWidth', { value: 100 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 206, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 100, pointerId: 1 }));

      expect(options.onAddColumn).toHaveBeenCalledOnce();
      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onDragEnd).toHaveBeenCalledOnce();
    });

    it('adds both rows and columns on diagonal drag', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      const rows = grid.querySelectorAll('[data-blok-table-row]');

      Object.defineProperty(rows[rows.length - 1], 'offsetHeight', { value: 30 });

      const firstRow = grid.querySelector('[data-blok-table-row]')!;
      const cells = firstRow.querySelectorAll('[data-blok-table-cell]');

      Object.defineProperty(cells[cells.length - 1], 'offsetWidth', { value: 100 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 306, clientY: 166, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 160, pointerId: 1 }));

      expect(options.onAddRow).toHaveBeenCalledTimes(2);
      expect(options.onAddColumn).toHaveBeenCalledTimes(2);
    });

    it('fires onDragStart after exceeding threshold', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 103, clientY: 100, pointerId: 1 }));

      expect(options.onDragStart).not.toHaveBeenCalled();

      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 106, clientY: 100, pointerId: 1 }));

      expect(options.onDragStart).toHaveBeenCalledOnce();

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 106, clientY: 100, pointerId: 1 }));
    });

    it('does not trigger drag mode when movement is under threshold', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 103, clientY: 102, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 103, clientY: 102, pointerId: 1 }));

      expect(options.onAddRow).toHaveBeenCalledOnce();
      expect(options.onAddColumn).toHaveBeenCalledOnce();
      expect(options.onDragStart).not.toHaveBeenCalled();
    });
  });

  describe('drag to remove', () => {
    it('calls onRemoveLastRow when dragging upward', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const rows = grid.querySelectorAll('[data-blok-table-row]');

      Object.defineProperty(rows[rows.length - 1], 'offsetHeight', { value: 30 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 64, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 64, pointerId: 1 }));

      expect(options.onRemoveLastRow).toHaveBeenCalledOnce();
    });

    it('calls onRemoveLastColumn when dragging leftward', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const firstRow = grid.querySelector('[data-blok-table-row]')!;
      const cells = firstRow.querySelectorAll('[data-blok-table-cell]');

      Object.defineProperty(cells[cells.length - 1], 'offsetWidth', { value: 100 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: -6, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: -6, clientY: 100, pointerId: 1 }));

      expect(options.onRemoveLastColumn).toHaveBeenCalledOnce();
    });

    it('does not call onRemoveLastRow when canRemoveLastRow returns false', () => {
      const options = createDefaultOptions(wrapper, grid);

      options.canRemoveLastRow.mockReturnValue(false);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const rows = grid.querySelectorAll('[data-blok-table-row]');

      Object.defineProperty(rows[rows.length - 1], 'offsetHeight', { value: 30 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 64, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 64, pointerId: 1 }));

      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });

    it('does not call onRemoveLastColumn when canRemoveLastColumn returns false', () => {
      const options = createDefaultOptions(wrapper, grid);

      options.canRemoveLastColumn.mockReturnValue(false);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const firstRow = grid.querySelector('[data-blok-table-row]')!;
      const cells = firstRow.querySelectorAll('[data-blok-table-cell]');

      Object.defineProperty(cells[cells.length - 1], 'offsetWidth', { value: 100 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: -6, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: -6, clientY: 100, pointerId: 1 }));

      expect(options.onRemoveLastColumn).not.toHaveBeenCalled();
    });
  });

  describe('tooltip updates during drag', () => {
    it('updates tooltip text during drag', () => {
      let currentSize = { rows: 2, cols: 3 };
      const options = createDefaultOptions(wrapper, grid);

      options.getTableSize.mockImplementation(() => currentSize);
      options.onAddRow.mockImplementation(() => { currentSize = { rows: currentSize.rows + 1, cols: currentSize.cols }; });

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const tooltip = wrapper.querySelector(`[${CORNER_TOOLTIP_ATTR}]`) as HTMLElement;
      const rows = grid.querySelectorAll('[data-blok-table-row]');

      Object.defineProperty(rows[rows.length - 1], 'offsetHeight', { value: 30 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 136, pointerId: 1 }));

      expect(tooltip.textContent).toBe('3×3');

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 136, pointerId: 1 }));
    });
  });
});
