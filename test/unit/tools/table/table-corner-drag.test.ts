import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableCornerDrag } from '../../../../src/tools/table/table-corner-drag';
import { simulateMouseenter, simulateMouseleave } from '../../../helpers/simulate';

const mockShowTooltip = vi.fn();
const mockHideTooltip = vi.fn();

vi.mock('../../../../src/components/utils/tooltip', () => ({
  show: (...args: unknown[]): void => { mockShowTooltip(...args); },
  hide: (): void => { mockHideTooltip(); },
}));

const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';

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

/**
 * Live geometry model behind the stubbed rects. The corner drag is
 * geometry-driven (Notion-style: the grid's corner follows the pointer), so the
 * tests have to expose real column widths / row heights that change as the
 * handlers add and remove them.
 */
interface Geometry {
  left: number;
  top: number;
  colWidths: number[];
  rowHeights: number[];
}

/** A stubbed scroll container plus a window into its live scroll offset. */
interface ScrollView {
  el: HTMLElement;
  width: number;
  scrollLeft: () => number;
}

const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0);

const rectOf = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

const installGeometry = (
  wrapper: HTMLElement,
  grid: HTMLElement,
  geo: Geometry,
  view?: ScrollView
): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
    const width = sum(geo.colWidths);
    const height = sum(geo.rowHeights);
    // Scrolling the container slides the grid left in viewport coordinates.
    const left = geo.left - (view?.scrollLeft() ?? 0);

    if (view !== undefined && this === view.el) {
      return rectOf(geo.left, geo.top, view.width, height);
    }

    if (this === grid || this === wrapper) {
      return rectOf(left, geo.top, width, height);
    }

    if (this.hasAttribute('data-blok-table-row')) {
      const index = Array.from(grid.querySelectorAll('[data-blok-table-row]')).indexOf(this);

      return rectOf(left, geo.top + sum(geo.rowHeights.slice(0, index)), width, geo.rowHeights[index] ?? 0);
    }

    if (this.hasAttribute('data-blok-table-cell')) {
      const col = Number(this.getAttribute('data-blok-table-cell-col'));
      const row = Number(this.getAttribute('data-blok-table-cell-row'));

      return rectOf(
        left + sum(geo.colWidths.slice(0, col)),
        geo.top + sum(geo.rowHeights.slice(0, row)),
        geo.colWidths[col] ?? 0,
        geo.rowHeights[row] ?? 0,
      );
    }

    return rectOf(0, 0, 0, 0);
  });
};

/**
 * A scroll container whose scrollLeft clamps the way a real one does, so the
 * auto-scroll cannot pretend to scroll further than the content allows.
 */
const createScrollContainer = (visibleWidth: number, contentWidth: () => number): ScrollView => {
  const scroll = { left: 0 };
  const el = document.createElement('div');

  Object.defineProperty(el, 'clientWidth', { get: () => visibleWidth });
  Object.defineProperty(el, 'scrollWidth', { get: contentWidth });
  Object.defineProperty(el, 'scrollLeft', {
    get: () => scroll.left,
    set: (value: number) => {
      scroll.left = Math.max(0, Math.min(value, contentWidth() - visibleWidth));
    },
  });

  return { el,
    width: visibleWidth,
    scrollLeft: () => scroll.left };
};

/**
 * Wire the add/remove callbacks so they mutate both the DOM and the geometry,
 * the way the real table does — otherwise a geometry-driven drag can never
 * settle.
 */
const wireGeometryOps = (
  options: ReturnType<typeof createDefaultOptions>,
  grid: HTMLTableElement,
  geo: Geometry,
  newColWidth = 60,
  newRowHeight = 30
): void => {
  const rows = (): HTMLElement[] => Array.from(grid.querySelectorAll<HTMLElement>('[data-blok-table-row]'));

  options.onAddColumn.mockImplementation(() => {
    const col = geo.colWidths.length;

    rows().forEach((row, r) => {
      const td = document.createElement('td');

      td.setAttribute('data-blok-table-cell', '');
      td.setAttribute('data-blok-table-cell-row', String(r));
      td.setAttribute('data-blok-table-cell-col', String(col));
      row.appendChild(td);
    });
    geo.colWidths.push(newColWidth);
  });

  options.onRemoveLastColumn.mockImplementation(() => {
    rows().forEach(row => row.lastElementChild?.remove());
    geo.colWidths.pop();
  });

  options.onAddRow.mockImplementation(() => {
    const row = document.createElement('tr');
    const r = geo.rowHeights.length;

    row.setAttribute('data-blok-table-row', '');
    geo.colWidths.forEach((_, c) => {
      const td = document.createElement('td');

      td.setAttribute('data-blok-table-cell', '');
      td.setAttribute('data-blok-table-cell-row', String(r));
      td.setAttribute('data-blok-table-cell-col', String(c));
      row.appendChild(td);
    });
    grid.querySelector('tbody')?.appendChild(row);
    geo.rowHeights.push(newRowHeight);
  });

  options.onRemoveLastRow.mockImplementation(() => {
    grid.querySelectorAll('[data-blok-table-row]')[geo.rowHeights.length - 1]?.remove();
    geo.rowHeights.pop();
  });

  options.getTableSize.mockImplementation(() => ({ rows: geo.rowHeights.length,
    cols: geo.colWidths.length }));
};

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
    HTMLElement.prototype.setPointerCapture = vi.fn();
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

    it('does not create an inline tooltip element', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const tooltip = wrapper.querySelector('[data-blok-table-corner-tooltip]');

      expect(tooltip).toBeNull();
    });

    it('does not show tooltip on construction', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      expect(mockShowTooltip).not.toHaveBeenCalled();
    });
  });

  describe('hover tooltip', () => {
    it('shows singleton tooltip with table size on mouseenter', () => {
      const options = createDefaultOptions(wrapper, grid);

      options.getTableSize.mockReturnValue({ rows: 2, cols: 3 });
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      simulateMouseenter(hitZone);

      expect(mockShowTooltip).toHaveBeenCalledWith(
        hitZone,
        '3\u00D72',
        expect.objectContaining({ placement: 'bottom' }),
      );
    });

    it('hides singleton tooltip on mouseleave', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      simulateMouseenter(hitZone);
      simulateMouseleave(hitZone);

      expect(mockHideTooltip).toHaveBeenCalled();
      expect(hitZone.isConnected).toBe(true);
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
    /** 3x2 grid of 100px columns and 30px rows: corner at (300, 60). */
    const defaultGeometry = (): Geometry => ({ left: 0,
      top: 0,
      colWidths: [100, 100, 100],
      rowHeights: [30, 30] });

    it('adds a row as soon as the dragged corner passes the grid bottom edge', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = defaultGeometry();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 75, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 75, pointerId: 1 }));

      expect(options.onAddRow).toHaveBeenCalledOnce();
      expect(options.onAddColumn).not.toHaveBeenCalled();
      expect(options.onDragEnd).toHaveBeenCalledOnce();
    });

    it('adds a column as soon as the dragged corner passes the grid right edge', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = defaultGeometry();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 312, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 312, clientY: 60, pointerId: 1 }));

      expect(options.onAddColumn).toHaveBeenCalledOnce();
      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onDragEnd).toHaveBeenCalledOnce();
    });

    it('keeps adding columns until the grid corner catches up with the pointer', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = defaultGeometry();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 700, clientY: 60, pointerId: 1 }));

      // 300 + 7 x 60 = 720: the first edge at or past the pointer.
      expect(options.onAddColumn).toHaveBeenCalledTimes(7);
      expect(sum(geo.colWidths)).toBe(720);
    });

    it('measures the drag from the corner, not from where inside the handle it was grabbed', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = defaultGeometry();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      // Pressed 16px inside the corner — the same offset must ride along.
      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 284, clientY: 44, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 294, clientY: 44, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 294, clientY: 44, pointerId: 1 }));

      expect(options.onAddColumn).toHaveBeenCalledOnce();
    });

    it('adds both rows and columns on diagonal drag', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = defaultGeometry();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 150, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, clientY: 150, pointerId: 1 }));

      expect(options.onAddColumn).toHaveBeenCalledTimes(2);
      expect(options.onAddRow).toHaveBeenCalledTimes(3);
      expect(options.onDragEnd).toHaveBeenCalledOnce();
      expect(document.body.style.cursor).toBe('');
    });

    it('does not resize while the grid has no layout', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 400, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 400, pointerId: 1 }));

      expect(options.onAddColumn).not.toHaveBeenCalled();
      expect(options.onAddRow).not.toHaveBeenCalled();
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

    it('hides tooltip on pointerup after drag', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const rows = grid.querySelectorAll('[data-blok-table-row]');

      Object.defineProperty(rows[rows.length - 1], 'offsetHeight', { value: 30 });

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 136, pointerId: 1 }));

      mockHideTooltip.mockClear();

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 136, pointerId: 1 }));

      expect(mockHideTooltip).toHaveBeenCalled();
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
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
    /** Last column is 300px wide (user-resized): corner at (500, 60). */
    const wideLastColumn = (): Geometry => ({ left: 0,
      top: 0,
      colWidths: [100, 100, 300],
      rowHeights: [30, 30] });

    it('keeps the last column while the corner is still inside it', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = wideLastColumn();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, clientY: 60, pointerId: 1 }));
      // 120px left: past a nominal column step, but short of this 300px one.
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 380, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 380, clientY: 60, pointerId: 1 }));

      expect(options.onRemoveLastColumn).not.toHaveBeenCalled();
    });

    it('removes the last column once the corner passes its real left edge', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = wideLastColumn();

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 190, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 190, clientY: 60, pointerId: 1 }));

      expect(options.onRemoveLastColumn).toHaveBeenCalledOnce();
      expect(geo.colWidths).toEqual([100, 100]);
    });

    it('removes rows by their real heights rather than a frozen step', () => {
      const options = createDefaultOptions(wrapper, grid);
      // A wrapped last row is taller than the one above it: corner at (300, 120).
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100, 100],
        rowHeights: [30, 90] };

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 120, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 25, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 25, pointerId: 1 }));

      expect(options.onRemoveLastRow).toHaveBeenCalledOnce();
      expect(geo.rowHeights).toEqual([30]);
    });

    it('does not call onRemoveLastRow when canRemoveLastRow returns false', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100, 100],
        rowHeights: [30, 30] };

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      options.canRemoveLastRow.mockReturnValue(false);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 10, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 10, pointerId: 1 }));

      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });

    it('does not call onRemoveLastColumn when canRemoveLastColumn returns false', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100, 100],
        rowHeights: [30, 30] };

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      options.canRemoveLastColumn.mockReturnValue(false);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 60, pointerId: 1 }));

      expect(options.onRemoveLastColumn).not.toHaveBeenCalled();
    });

    it('does not remove below 1×1 minimum size', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100, 100],
        rowHeights: [30, 30, 30] };
      let removeCount = 0;

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      options.canRemoveLastRow.mockImplementation(() => {
        // Allow first removal, block second (simulating 1-row minimum)
        removeCount++;

        return removeCount <= 1;
      });
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 90, pointerId: 1 }));
      // Far enough up to strip every row; the guard must stop it after one.
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 0, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 0, pointerId: 1 }));

      expect(options.onRemoveLastRow).toHaveBeenCalledOnce();
    });
  });

  describe('tooltip updates during drag', () => {
    it('updates singleton tooltip during drag', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100, 100],
        rowHeights: [30, 30] };

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);
      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 75, pointerId: 1 }));

      expect(mockShowTooltip).toHaveBeenCalledWith(
        hitZone,
        '3\u00D73',
        expect.objectContaining({ placement: 'bottom' }),
      );

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 75, pointerId: 1 }));
    });
  });

  describe('setDisplay', () => {
    it('hides the hit zone when visible is false', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.setDisplay(false);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      expect(hitZone.style.display).toBe('none');
    });

    it('shows the hit zone when visible is true', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.setDisplay(false);
      cornerDrag.setDisplay(true);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      expect(hitZone.style.display).toBe('');
    });
  });

  describe('setInteractive', () => {
    it('disables pointer events when interactive is false', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.setInteractive(false);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      expect(hitZone.style.pointerEvents).toBe('none');
    });

    it('restores pointer events when interactive is true', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.setInteractive(false);
      cornerDrag.setInteractive(true);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      expect(hitZone.style.pointerEvents).toBe('auto');
    });
  });

  describe('pointer capture', () => {
    it('captures pointer on pointerdown and releases on pointerup', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;
      const setCapture = vi.spyOn(hitZone, 'setPointerCapture');
      const releaseCapture = vi.spyOn(hitZone, 'releasePointerCapture');

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 42 }));

      expect(setCapture).toHaveBeenCalledWith(42);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 42 }));

      expect(releaseCapture).toHaveBeenCalledWith(42);
    });
  });

  describe('destroy', () => {
    it('removes hit zone from DOM', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.destroy();

      expect(wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`)).toBeNull();
    });

    it('does not call handlers after destroy', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      cornerDrag.destroy();

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));

      expect(options.onAddRow).not.toHaveBeenCalled();
    });

    it('hides tooltip on destroy', () => {
      const options = createDefaultOptions(wrapper, grid);

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      simulateMouseenter(hitZone);
      mockHideTooltip.mockClear();

      cornerDrag.destroy();

      expect(mockHideTooltip).toHaveBeenCalled();
      expect(hitZone.isConnected).toBe(false);
    });
  });

  describe('listener hygiene', () => {
    it('removes the pointercancel listener when a drag ends normally', () => {
      cornerDrag = new TableCornerDrag(createDefaultOptions(wrapper, grid));

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      const removeSpy = vi.spyOn(hitZone, 'removeEventListener');

      hitZone.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }));
      hitZone.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }));

      const removedEvents = removeSpy.mock.calls.map(([eventName]) => eventName);

      expect(removedEvents).toContain('pointercancel');
    });
  });

  describe('corner anchoring', () => {
    const stubRect = (el: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void => {
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({
        x: rect.left,
        y: rect.top,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => ({}),
      }));
    };

    it('follows the grid right edge after a column is added', () => {
      stubRect(wrapper, { left: 100, top: 50, width: 700, height: 100 });
      stubRect(grid, { left: 100, top: 50, width: 700, height: 100 });

      cornerDrag = new TableCornerDrag(createDefaultOptions(wrapper, grid));
      cornerDrag.syncPosition();

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      /*
       * left  = gridRight(800) - wrapperLeft(100) - CORNER_OFFSET(16) = 684
       * top   = gridBottom(150) - wrapperTop(50)  - CORNER_OFFSET(16) =  84
       * The 36px zone therefore straddles the corner rather than sitting
       * wholly outside it, which is what it used to do.
       */
      expect(hitZone.style.left).toBe('684px');
      expect(hitZone.style.top).toBe('84px');

      // The grid widens by 100px; the handle must track it.
      stubRect(grid, { left: 100, top: 50, width: 800, height: 100 });
      cornerDrag.syncPosition();

      expect(hitZone.style.left).toBe('784px');
    });
  });

  describe('auto-scroll past the container edge', () => {
    /**
     * A 5x2 grid of 100px columns inside a 400px container: the grid already
     * overflows, so its corner cannot reach a pointer parked at the container's
     * right edge without scrolling.
     */
    const overflowing = (): Geometry => ({ left: 0,
      top: 0,
      colWidths: [100, 100, 100, 100, 100],
      rowHeights: [30, 30] });

    /** Hand-driven animation frames: deterministic, no timer faking. */
    const captureFrames = (): { run: (frames: number) => void } => {
      const queue: FrameRequestCallback[] = [];
      let now = 1000;

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback): number => {
        queue.push(cb);

        return queue.length;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((): void => {
        queue.length = 0;
      });

      return {
        run: (frames: number): void => {
          for (let i = 0; i < frames; i++) {
            const cb = queue.shift();

            if (cb === undefined) {
              return;
            }
            now += 16;
            cb(now);
          }
        },
      };
    };

    /** Drag the handle out past the container's visible right edge (400) and hold. */
    const startEdgeDrag = (hitZone: HTMLElement): void => {
      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 380, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 405, clientY: 60, pointerId: 1 }));
    };

    it('keeps appending columns and scrolling while the pointer sits at the edge', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = overflowing();
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      installGeometry(wrapper, grid, geo, view);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      startEdgeDrag(hitZone);

      const addedByTheMove = options.onAddColumn.mock.calls.length;

      /*
       * Columns are metered one per 200ms, so 16ms frames buy exactly one by
       * 320ms and three by 640ms. Pinning the count both ways is what catches a
       * throttle that appends per frame instead of per interval.
       */
      frames.run(20);

      expect(options.onAddColumn.mock.calls.length).toBe(addedByTheMove + 1);
      expect(view.scrollLeft()).toBeGreaterThan(0);

      frames.run(20);

      expect(options.onAddColumn.mock.calls.length).toBe(addedByTheMove + 3);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 405, clientY: 60, pointerId: 1 }));
    });

    /** Guard: growing on top of a corner that can already reach the pointer runs away from it. */
    it('does not auto-scroll while the grid still fits its container', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100, 100],
        rowHeights: [30, 30] };
      const view = createScrollContainer(900, () => sum(geo.colWidths));

      installGeometry(wrapper, grid, geo, view);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      // Drag well right but stay inside the container, which the grid never fills.
      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 60, pointerId: 1 }));

      const addedByTheMove = options.onAddColumn.mock.calls.length;

      frames.run(20);

      expect(options.onAddColumn.mock.calls.length).toBe(addedByTheMove);
      expect(view.scrollLeft()).toBe(0);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 600, clientY: 60, pointerId: 1 }));
    });

    it('lets the metered loop own growth while the pointer is outside the container', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = overflowing();
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      installGeometry(wrapper, grid, geo, view);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      startEdgeDrag(hitZone);
      // One frame parks the corner at the edge and re-anchors the grab offset.
      frames.run(1);

      const parked = options.onAddColumn.mock.calls.length;

      /*
       * Travelling further right while already outside must add nothing on its
       * own: with the offset re-anchored to the parked corner, pointer-driven
       * growth would count each of these pixels as a whole column.
       */
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 420, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 440, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 460, clientY: 60, pointerId: 1 }));

      expect(options.onAddColumn.mock.calls.length).toBe(parked);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 460, clientY: 60, pointerId: 1 }));
    });

    it('stops auto-scrolling once the pointer is released', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = overflowing();
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      installGeometry(wrapper, grid, geo, view);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      startEdgeDrag(hitZone);
      frames.run(5);

      // The very first frame reveals the clipped corner, proving the loop runs.
      expect(view.scrollLeft()).toBeGreaterThan(0);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 405, clientY: 60, pointerId: 1 }));

      const settledColumns = options.onAddColumn.mock.calls.length;
      const settledScroll = view.scrollLeft();

      frames.run(30);

      expect(options.onAddColumn.mock.calls.length).toBe(settledColumns);
      expect(view.scrollLeft()).toBe(settledScroll);
    });

    it('shrinks from where the corner ended up when the pointer pulls back', () => {
      const options = createDefaultOptions(wrapper, grid);
      const geo = overflowing();
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      installGeometry(wrapper, grid, geo, view);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);
      cornerDrag.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      startEdgeDrag(hitZone);
      frames.run(20);

      expect(view.scrollLeft()).toBeGreaterThan(0);

      const addedBeforeThePullBack = options.onAddColumn.mock.calls.length;

      /*
       * The auto-scroll parked the corner back at the visible edge (400). Pulling
       * 70px left must clear the 60px last column and remove it — measured from
       * the corner's new position, not from the pixels the scroll travelled,
       * which the pointer would otherwise have to pay back first.
       */
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 325, clientY: 60, pointerId: 1 }));

      expect(options.onRemoveLastColumn).toHaveBeenCalled();
      expect(options.onAddColumn.mock.calls.length).toBe(addedBeforeThePullBack);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 325, clientY: 60, pointerId: 1 }));
    });
  });

  describe('auto-scroll past the viewport bottom', () => {
    const VIEWPORT_HEIGHT = 300;
    const realViewportHeight = window.innerHeight;

    // defineProperty outlives restoreAllMocks, so put the viewport back by hand.
    afterEach(() => {
      Object.defineProperty(window, 'innerHeight', { value: realViewportHeight,
        configurable: true });
    });

    /**
     * A page whose geometry owns its own scroll offset, so scrolling can be fed
     * back into the stubbed rects without writing through a parameter.
     */
    const pageWithRows = (rowHeights: number[]): { geo: Geometry; scrollTop: (by: number) => void } => {
      const geo: Geometry = { left: 0,
        top: 0,
        colWidths: [100, 100],
        rowHeights };

      return { geo,
        // Scrolling the page down moves content up.
        scrollTop: (by: number): void => {
          geo.top -= by;
        } };
    };

    const installPageScroll = (scrollTop: (by: number) => void): ReturnType<typeof vi.fn> => {
      Object.defineProperty(window, 'innerHeight', { value: VIEWPORT_HEIGHT,
        configurable: true });

      return vi.spyOn(window, 'scrollBy').mockImplementation((_x?: unknown, y?: unknown): void => {
        scrollTop(typeof y === 'number' ? y : 0);
      });
    };

    const captureFrames = (): { run: (frames: number) => void } => {
      const queue: FrameRequestCallback[] = [];
      let now = 1000;

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback): number => {
        queue.push(cb);

        return queue.length;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((): void => {
        queue.length = 0;
      });

      return {
        run: (frames: number): void => {
          for (let i = 0; i < frames; i++) {
            const cb = queue.shift();

            if (cb === undefined) {
              return;
            }
            now += 16;
            cb(now);
          }
        },
      };
    };

    it('keeps appending rows and scrolling the page while the pointer sits at the bottom', () => {
      const options = createDefaultOptions(wrapper, grid);
      // Bottom lands at y=290, just inside a 300px viewport.
      const { geo, scrollTop } = pageWithRows([30, 30, 30, 30, 30, 30, 30, 30, 30, 20]);
      const scrollBy = installPageScroll(scrollTop);

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      // Corner is at y=290; drag it down to the very bottom of the viewport.
      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 285, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 298, pointerId: 1 }));

      const addedByTheMove = options.onAddRow.mock.calls.length;

      // Metered at one row per 200ms, same clock as the columns.
      frames.run(20);

      expect(options.onAddRow.mock.calls.length).toBe(addedByTheMove + 1);
      expect(scrollBy).toHaveBeenCalled();

      frames.run(20);

      expect(options.onAddRow.mock.calls.length).toBe(addedByTheMove + 3);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 298, pointerId: 1 }));
    });

    it('survives a reveal scroll that lands the corner a hair above the band', () => {
      const options = createDefaultOptions(wrapper, grid);
      const { geo, scrollTop } = pageWithRows([30, 30, 30, 30, 30, 30, 30, 30, 30, 20]);
      /*
       * Real browsers do not land on the threshold exactly — measured in Chrome,
       * the reveal left the corner at 695.98 against a 696 limit. Over-scrolling
       * by half a pixel reproduces that: re-deriving armed-ness every frame
       * cancels the loop after the first row or two.
       */
      const scrollBy = installPageScroll(by => { scrollTop(by + 0.5); });

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 285, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 298, pointerId: 1 }));

      const addedByTheMove = options.onAddRow.mock.calls.length;

      frames.run(60);

      expect(scrollBy).toHaveBeenCalled();
      // ~960ms of holding: four metered rows, none of them lost to a self-cancel.
      expect(options.onAddRow.mock.calls.length).toBe(addedByTheMove + 4);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 298, pointerId: 1 }));
    });

    it('keeps removing rows and scrolling up while the pointer sits at the top', () => {
      const options = createDefaultOptions(wrapper, grid);
      /*
       * The mirror of the downward case: the page is scrolled so the corner sits
       * in the top band, and the pointer has run out of screen to drag further
       * up with. Shrinking has to keep going and the page has to follow.
       */
      const { geo, scrollTop } = pageWithRows([30, 30, 30]);
      const scrollBy = installPageScroll(scrollTop);

      // Page scrolled down: the table's corner is 20px from the viewport top.
      scrollTop(70);
      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 18, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 4, pointerId: 1 }));

      const removedByTheMove = options.onRemoveLastRow.mock.calls.length;

      frames.run(20);

      expect(options.onRemoveLastRow.mock.calls.length).toBe(removedByTheMove + 1);
      expect(scrollBy.mock.calls.some(([, y]) => typeof y === 'number' && y < 0)).toBe(true);

      frames.run(20);

      expect(options.onRemoveLastRow.mock.calls.length).toBe(removedByTheMove + 3);

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 4, pointerId: 1 }));
    });

    it('does not auto-scroll while the corner is well above the viewport bottom', () => {
      const options = createDefaultOptions(wrapper, grid);
      const { geo, scrollTop } = pageWithRows([30, 30]);
      const scrollBy = installPageScroll(scrollTop);

      installGeometry(wrapper, grid, geo);
      wireGeometryOps(options, grid, geo);

      const frames = captureFrames();

      cornerDrag = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`) as HTMLElement;

      // Drag down, but both corner and pointer stay far from the viewport edge.
      hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 60, pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 120, pointerId: 1 }));

      const addedByTheMove = options.onAddRow.mock.calls.length;

      frames.run(20);

      expect(options.onAddRow.mock.calls.length).toBe(addedByTheMove);
      expect(scrollBy).not.toHaveBeenCalled();

      hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 120, pointerId: 1 }));
    });
  });

  describe('corner grip visual', () => {
    it('renders a grip that is hidden at rest and revealed on proximity', () => {
      cornerDrag = new TableCornerDrag(createDefaultOptions(wrapper, grid));

      const grip = wrapper.querySelector('[data-blok-testid="table-corner-grip"]');

      if (!(grip instanceof HTMLElement)) {
        throw new Error('grip not rendered');
      }

      expect(grip.classList.contains('opacity-0')).toBe(true);

      cornerDrag.setProximity(true);
      expect(grip.classList.contains('opacity-0')).toBe(false);

      cornerDrag.setProximity(false);
      expect(grip.classList.contains('opacity-0')).toBe(true);
    });

    it('keeps the grip non-interactive so the hit zone owns the gesture', () => {
      cornerDrag = new TableCornerDrag(createDefaultOptions(wrapper, grid));

      const grip = wrapper.querySelector('[data-blok-testid="table-corner-grip"]');

      if (!(grip instanceof HTMLElement)) {
        throw new Error('grip not rendered');
      }

      expect(grip.style.pointerEvents).toBe('none');
    });
  });
});
