import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRowColDrag } from '../../../../src/tools/table/table-row-col-drag';

const DRAG_THRESHOLD = 10;
const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';

const setLayout = (el: HTMLElement, layout: { offsetTop?: number; offsetHeight?: number; offsetWidth?: number }): void => {
  Object.entries(layout).forEach(([key, value]) => {
    Object.defineProperty(el, key, { value, configurable: true });
  });
};

/**
 * A <table> shaped like table-core's grid: colgroup + tbody > tr > td.
 * Rows are 100px tall and start at 0, 100, 200...
 */
const buildTable = (rows: number, cols: number, label: string): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  Array.from({ length: cols }).forEach(() => {
    const col = document.createElement('col');

    setLayout(col, { offsetWidth: 100 });
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  Array.from({ length: rows }).forEach((_, r) => {
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');
    tr.setAttribute('data-label', `${label}${r}`);

    Array.from({ length: cols }).forEach((__, c) => {
      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute('data-blok-table-cell-row', String(r));
      td.setAttribute('data-blok-table-cell-col', String(c));
      td.setAttribute('data-label', `${label}${r}-${c}`);
      setLayout(td, { offsetWidth: 100, offsetHeight: 100 });
      tr.appendChild(td);
    });

    setLayout(tr, { offsetTop: r * 100, offsetHeight: 100 });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
};

/**
 * Outer 3x2 table whose cell (0,0) holds an inner 3x2 table.
 * Inner rows sit at 0/30/60 within their own table.
 */
const buildNestedGrid = (): { outer: HTMLTableElement; inner: HTMLTableElement } => {
  const outer = buildTable(3, 2, 'outer');
  const inner = buildTable(3, 2, 'inner');

  inner.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`).forEach((row, i) => {
    setLayout(row, { offsetTop: i * 30, offsetHeight: 30 });
  });

  const blocksContainer = document.createElement('div');

  blocksContainer.appendChild(inner);
  outer.querySelector(`[${CELL_ATTR}]`)?.appendChild(blocksContainer);

  Object.defineProperty(outer, 'getBoundingClientRect', {
    value: () => new DOMRect(0, 0, 200, 300),
  });

  document.body.appendChild(outer);

  return { outer, inner };
};

const startDrag = (drag: TableRowColDrag, type: 'row' | 'col', index: number, x: number, y: number): void => {
  void drag.beginTracking(type, index, x, y);
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: x + DRAG_THRESHOLD + 1,
    clientY: y + DRAG_THRESHOLD + 1,
  }));
};

const release = (x: number, y: number): void => {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  document.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }));
};

const highlighted = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`))
    .filter(cell => cell.style.opacity === '0.7')
    .map(cell => cell.dataset.label ?? '');

const ghostLabels = (): string[] => {
  const ghost = document.querySelector('[data-blok-table-drag-ghost]');

  return Array.from(ghost?.children ?? []).map(el => (el as HTMLElement).dataset.label ?? '');
};

describe('TableRowColDrag with a nested table in the first outer row', () => {
  let outer: HTMLTableElement;
  let inner: HTMLTableElement;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ outer, inner } = buildNestedGrid());
  });

  afterEach(() => {
    outer.remove();
    document.querySelectorAll('[data-blok-table-drag-ghost]').forEach(el => el.remove());
    vi.restoreAllMocks();
  });

  it('moves outer row 2 to index 1 when dropped on the outer 0|1 border', () => {
    const onAction = vi.fn();
    const drag = new TableRowColDrag({ grid: outer, onAction });

    startDrag(drag, 'row', 2, 10, 250);
    release(10, 100);

    expect(onAction).toHaveBeenCalledWith({ type: 'move-row', fromIndex: 2, toIndex: 1 });
  });

  it('highlights and ghosts only the dragged outer row, never inner rows', () => {
    const drag = new TableRowColDrag({ grid: outer, onAction: vi.fn() });

    startDrag(drag, 'row', 2, 10, 250);

    expect(highlighted(inner)).toEqual([]);
    expect(highlighted(outer)).toEqual(['outer2-0', 'outer2-1']);
    expect(ghostLabels()).toEqual(['outer2-0', 'outer2-1']);

    drag.cleanup();
  });

  it('highlights and ghosts only outer cells of the dragged column', () => {
    const drag = new TableRowColDrag({ grid: outer, onAction: vi.fn() });

    startDrag(drag, 'col', 1, 150, 10);

    expect(highlighted(inner)).toEqual([]);
    expect(highlighted(outer)).toEqual(['outer0-1', 'outer1-1', 'outer2-1']);
    expect(ghostLabels()).toEqual(['outer0-1', 'outer1-1', 'outer2-1']);

    drag.cleanup();
  });
});
