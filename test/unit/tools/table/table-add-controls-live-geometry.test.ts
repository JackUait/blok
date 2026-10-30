import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { I18n } from '../../../../types/api';
import { TableAddControls } from '../../../../src/tools/table/table-add-controls';

const mockShow = vi.fn();

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
  showReadout: (...args: unknown[]): void => { mockShow(...args); },
}));

vi.mock('../../../../src/components/modules/toolbar/tooltip', () => ({
  createTooltipContent: (): HTMLElement => document.createElement('div'),
}));

const i18n = { t: (key: string) => key } as unknown as I18n;

interface Geometry {
  left: number;
  top: number;
  colWidths: number[];
  rowHeights: number[];
  /** Slides the grid left, as a scroll container pinned to its end does. */
  scrollLeft: number;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const rectOf = (x: number, y: number, width: number, height: number): DOMRect =>
  ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });

const buildGrid = (geo: Geometry): { wrapper: HTMLDivElement; grid: HTMLDivElement } => {
  const wrapper = document.createElement('div');
  const grid = document.createElement('div');

  geo.rowHeights.forEach((_, r) => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');
    geo.colWidths.forEach((__, c) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('data-blok-table-cell-row', String(r));
      cell.setAttribute('data-blok-table-cell-col', String(c));
      row.appendChild(cell);
    });
    grid.appendChild(row);
  });

  wrapper.appendChild(grid);
  document.body.appendChild(wrapper);

  return { wrapper, grid };
};

const installGeometry = (wrapper: HTMLElement, grid: HTMLElement, geo: Geometry): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
    const left = geo.left - geo.scrollLeft;
    const width = sum(geo.colWidths);
    const height = sum(geo.rowHeights);

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
        geo.rowHeights[row] ?? 0
      );
    }

    return rectOf(0, 0, 0, 0);
  });
};

/** Drag callbacks that change the DOM and the geometry the way the table does. */
const wireOps = (
  grid: HTMLElement,
  geo: Geometry,
  { newColWidth = 45, newRowHeight = 30, removable = (): boolean => true, pinnedToEnd = false } = {}
): ReturnType<typeof callbacks> => {
  const ops = callbacks();
  const rows = (): HTMLElement[] => Array.from(grid.querySelectorAll<HTMLElement>('[data-blok-table-row]'));
  const syncWidth = (): void => {
    // eslint-disable-next-line no-param-reassign -- the table writes the pixel width on its grid
    grid.style.width = `${sum(geo.colWidths)}px`;
  };

  ops.onDragAddCol.mockImplementation(() => {
    const col = geo.colWidths.length;

    rows().forEach((row, r) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('data-blok-table-cell-row', String(r));
      cell.setAttribute('data-blok-table-cell-col', String(col));
      row.appendChild(cell);
    });
    geo.colWidths.push(newColWidth);
    if (pinnedToEnd) {
      // eslint-disable-next-line no-param-reassign -- the stub scroller moves with the table
      geo.scrollLeft += newColWidth;
    }
    syncWidth();

    return true;
  });

  ops.onDragRemoveCol.mockImplementation(() => {
    if (geo.colWidths.length <= 1 || !removable()) {
      return false;
    }

    rows().forEach(row => row.lastElementChild?.remove());
    const removed = geo.colWidths.pop() ?? 0;

    if (pinnedToEnd) {
      // eslint-disable-next-line no-param-reassign -- the stub scroller moves with the table
      geo.scrollLeft = Math.max(0, geo.scrollLeft - removed);
    }
    syncWidth();

    return true;
  });

  ops.onDragAddRow.mockImplementation(() => {
    const row = document.createElement('div');
    const r = geo.rowHeights.length;

    row.setAttribute('data-blok-table-row', '');
    geo.colWidths.forEach((_, c) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('data-blok-table-cell-row', String(r));
      cell.setAttribute('data-blok-table-cell-col', String(c));
      row.appendChild(cell);
    });
    grid.appendChild(row);
    geo.rowHeights.push(newRowHeight);

    return true;
  });

  ops.onDragRemoveRow.mockImplementation(() => {
    if (geo.rowHeights.length <= 1 || !removable()) {
      return false;
    }

    rows().at(-1)?.remove();
    geo.rowHeights.pop();

    return true;
  });

  syncWidth();

  return ops;
};

const callbacks = (): {
  onDragStart: ReturnType<typeof vi.fn<() => void>>;
  onDragAddRow: ReturnType<typeof vi.fn<() => boolean>>;
  onDragRemoveRow: ReturnType<typeof vi.fn<() => boolean>>;
  onDragAddCol: ReturnType<typeof vi.fn<() => boolean>>;
  onDragRemoveCol: ReturnType<typeof vi.fn<() => boolean>>;
  onDragEnd: ReturnType<typeof vi.fn<() => void>>;
} => ({
  onDragStart: vi.fn<() => void>(),
  onDragAddRow: vi.fn<() => boolean>(() => true),
  onDragRemoveRow: vi.fn<() => boolean>(() => true),
  onDragAddCol: vi.fn<() => boolean>(() => true),
  onDragRemoveCol: vi.fn<() => boolean>(() => true),
  onDragEnd: vi.fn<() => void>(),
});

const mount = (
  wrapper: HTMLElement,
  grid: HTMLElement,
  ops: ReturnType<typeof callbacks>,
  newColWidth: number
): TableAddControls => new TableAddControls({
  wrapper,
  grid,
  i18n,
  onAddRow: vi.fn(),
  onAddColumn: vi.fn(),
  getTableSize: () => ({ rows: grid.querySelectorAll('[data-blok-table-row]').length, cols: grid.querySelector('[data-blok-table-row]')?.children.length ?? 0 }),
  getNewColumnWidth: () => newColWidth,
  ...ops,
});

const pointer = (target: HTMLElement, type: string, axis: 'row' | 'col', pos: number): void => {
  target.dispatchEvent(new PointerEvent(type, {
    clientX: axis === 'col' ? pos : 0,
    clientY: axis === 'row' ? pos : 0,
    pointerId: 1,
    bubbles: true,
  }));
};

const button = (wrapper: HTMLElement, axis: 'row' | 'col'): HTMLElement => {
  const el = wrapper.querySelector<HTMLElement>(axis === 'row' ? '[data-blok-table-add-row]' : '[data-blok-table-add-col]');

  expect(el).not.toBeNull();

  const btn = el as HTMLElement;

  btn.setPointerCapture = vi.fn();
  btn.releasePointerCapture = vi.fn();

  return btn;
};

describe('TableAddControls drag follows the live grid', () => {
  let controls: TableAddControls | undefined;
  let wrapper: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    controls?.destroy();
    controls = undefined;
    wrapper?.remove();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  it('removes one wide column per column width of travel, not per new-column unit', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [90, 90, 90], rowHeights: [30, 30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo);

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'col');

    pointer(btn, 'pointerdown', 'col', 280);
    pointer(btn, 'pointermove', 'col', 180);

    expect(geo.colWidths).toEqual([90, 90]);
    expect(ops.onDragRemoveCol).toHaveBeenCalledTimes(1);
  });

  it('removes nothing when the pointer moves back less than half the last row', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [100], rowHeights: [30, 30, 30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo);

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'row');

    pointer(btn, 'pointerdown', 'row', 110);
    pointer(btn, 'pointermove', 'row', 100);

    expect(geo.rowHeights).toHaveLength(3);
    expect(ops.onDragRemoveRow).not.toHaveBeenCalled();
  });

  it('keeps the grid edge within half a row of the pointer while dragging down and back', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [100], rowHeights: [30, 30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo, { newRowHeight: 30 });

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'row');
    const start = 75;

    pointer(btn, 'pointerdown', 'row', start);

    [20, 47, 80, 133, 96, 41, 8, -30].forEach((travel) => {
      pointer(btn, 'pointermove', 'row', start + travel);

      expect(Math.abs(sum(geo.rowHeights) - (60 + Math.max(travel, -30)))).toBeLessThanOrEqual(15);
    });
  });

  it('counts column travel as width when the scroller is pinned to its end', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [90, 90], rowHeights: [30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo, { newColWidth: 45, pinnedToEnd: true });

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'col');

    pointer(btn, 'pointerdown', 'col', 190);
    pointer(btn, 'pointermove', 'col', 280);

    expect(geo.colWidths).toEqual([90, 90, 45, 45]);

    pointer(btn, 'pointermove', 'col', 235);

    expect(geo.colWidths).toEqual([90, 90, 45]);
  });

  it('stops when the last column refuses to go, and adds no phantom column on the way back', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [100, 100], rowHeights: [30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo, { newColWidth: 100, removable: () => geo.colWidths.length > 2 });

    controls = mount(built.wrapper, built.grid, ops, 100);

    const btn = button(built.wrapper, 'col');

    pointer(btn, 'pointerdown', 'col', 200);
    pointer(btn, 'pointermove', 'col', 400);

    expect(geo.colWidths).toHaveLength(4);

    pointer(btn, 'pointermove', 'col', -100);

    expect(geo.colWidths).toHaveLength(2);

    pointer(btn, 'pointermove', 'col', 200);

    expect(geo.colWidths).toHaveLength(2);
  });

  it('moves the add-column button to the new grid edge during the drag', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [90, 90], rowHeights: [30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo, { newColWidth: 45 });

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'col');
    const before = btn.style.left;

    pointer(btn, 'pointerdown', 'col', 190);
    pointer(btn, 'pointermove', 'col', 280);

    expect(before).toBe('184px');
    expect(btn.style.left).toBe('274px');
  });

  it('shows the size readout after the button has moved', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [90, 90], rowHeights: [30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo, { newColWidth: 45 });

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'col');
    const leftAtReadout: string[] = [];

    mockShow.mockImplementation((target: HTMLElement) => {
      leftAtReadout.push(target.style.left);
    });

    pointer(btn, 'pointerdown', 'col', 190);
    pointer(btn, 'pointermove', 'col', 240);

    expect(leftAtReadout.at(-1)).toBe('229px');
  });

  it('opens the drag before the first column is added', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [90, 90], rowHeights: [30], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = wireOps(built.grid, geo, { newColWidth: 45 });
    const order: string[] = [];

    ops.onDragStart.mockImplementation(() => order.push('start'));
    const add = ops.onDragAddCol.getMockImplementation();

    ops.onDragAddCol.mockImplementation(() => {
      order.push('add');

      return add?.() ?? true;
    });

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'col');

    pointer(btn, 'pointerdown', 'col', 190);
    pointer(btn, 'pointermove', 'col', 240);

    expect(order).toEqual(['start', 'add']);
  });

  it('changes nothing while the grid has no layout', () => {
    const geo: Geometry = { left: 0, top: 0, colWidths: [], rowHeights: [], scrollLeft: 0 };
    const built = buildGrid(geo);

    wrapper = built.wrapper;
    installGeometry(built.wrapper, built.grid, geo);

    const ops = callbacks();

    controls = mount(built.wrapper, built.grid, ops, 45);

    const btn = button(built.wrapper, 'row');

    pointer(btn, 'pointerdown', 'row', 0);
    pointer(btn, 'pointermove', 'row', 300);

    expect(ops.onDragAddRow).not.toHaveBeenCalled();
  });

  // Each measure lays out the whole table: one per row crossed made a fast pull freeze.
  it('measures the grid as often for a pull across ten rows as across two', () => {
    const measuresFor = (rowsCrossed: number, axis: 'row' | 'col'): { measures: number; size: number } => {
      const geo: Geometry = { left: 0, top: 0, colWidths: [100, 100], rowHeights: [30, 30], scrollLeft: 0 };
      const built = buildGrid(geo);

      wrapper?.remove();
      wrapper = built.wrapper;
      installGeometry(built.wrapper, built.grid, geo);

      const ops = wireOps(built.grid, geo, { newRowHeight: 30, newColWidth: 100 });
      const local = mount(built.wrapper, built.grid, ops, 100);
      const btn = button(built.wrapper, axis);
      const start = axis === 'row' ? 60 : 200;
      const unit = axis === 'row' ? 30 : 100;
      const rect = vi.mocked(HTMLElement.prototype.getBoundingClientRect);

      pointer(btn, 'pointerdown', axis, start);
      pointer(btn, 'pointermove', axis, start + 10);

      const before = rect.mock.contexts.filter(context => context === built.grid).length;

      pointer(btn, 'pointermove', axis, start + unit * rowsCrossed);

      const measures = rect.mock.contexts.filter(context => context === built.grid).length - before;
      const size = axis === 'row' ? geo.rowHeights.length : geo.colWidths.length;

      local.destroy();
      vi.restoreAllMocks();

      return { measures, size };
    };

    const rowsFew = measuresFor(2, 'row');
    const rowsMany = measuresFor(10, 'row');
    const colsFew = measuresFor(2, 'col');
    const colsMany = measuresFor(10, 'col');

    expect([rowsFew.size, rowsMany.size, colsFew.size, colsMany.size]).toStrictEqual([4, 12, 4, 12]);
    expect(rowsMany.measures).toBe(rowsFew.measures);
    expect(colsMany.measures).toBe(colsFew.measures);
  });

  // One pull lands where adding one row at a time would. New rows can be taller than the rows above; an estimate from the last old row added one row too many.
  it('adds the rows the one-at-a-time rule would when new rows are taller than the old ones', () => {
    const existing = 30;
    const fresh = 33;
    // The rule before batching: one row per turn, both units read live.
    const oneAtATime = (target: number): number => {
      const rows = [existing, existing];

      Array.from({ length: 200 }).some(() => {
        const size = rows.reduce((total, height) => total + height, 0);
        const last = rows.at(-1) ?? 0;

        if (target - size >= last / 2) {
          rows.push(fresh);

          return false;
        }
        if (size - target > last / 2 && rows.length > 1) {
          rows.pop();

          return false;
        }

        return true;
      });

      return rows.length - 2;
    };
    const pulls = Array.from({ length: 41 }, (_, i) => existing * i / 4);
    const results = pulls.map((pull) => {
      const geo: Geometry = { left: 0, top: 0, colWidths: [100], rowHeights: [existing, existing], scrollLeft: 0 };
      const built = buildGrid(geo);

      wrapper?.remove();
      wrapper = built.wrapper;
      installGeometry(built.wrapper, built.grid, geo);

      const ops = wireOps(built.grid, geo, { newRowHeight: fresh });
      const local = mount(built.wrapper, built.grid, ops, 45);
      const btn = button(built.wrapper, 'row');
      const start = 300;

      pointer(btn, 'pointerdown', 'row', start);
      pointer(btn, 'pointermove', 'row', start + 6);
      pointer(btn, 'pointermove', 'row', start + pull);

      const added = geo.rowHeights.length - 2;

      local.destroy();
      vi.restoreAllMocks();

      return added;
    });

    expect(results).toStrictEqual(pulls.map(pull => oneAtATime(existing * 2 + pull)));
  });
});
