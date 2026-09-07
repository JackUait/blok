/*
 * Corner-drag defects that survive the main suite: a resize that lands on the
 * wrong row or column, a step budget that runs past its cap, a merged cell
 * reported as the last column, and a cancelled gesture that leaves the table
 * changed.
 *
 * Every fixture gives the grid a real client position with columns of unequal
 * width and rows of unequal height. A grid parked at the origin with uniform
 * cells makes the arithmetic unfalsifiable: subtracting the container offset
 * reads the same as adding it, and every nearest-edge walk collapses onto the
 * same index.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { TableCornerDrag } from '../../../../src/tools/table/table-corner-drag';
import type { TableCornerDragOptions } from '../../../../src/tools/table/table-corner-drag';
import type { I18n } from '../../../../types/api';

const mockShowTooltip = vi.fn();
const mockHideTooltip = vi.fn();

vi.mock('../../../../src/components/utils/tooltip', () => ({
  show: (...args: unknown[]): void => { mockShowTooltip(...args); },
  hide: (): void => { mockHideTooltip(); },
}));

/*
 * The step-budget tests walk the 200-step cap over a 200-cell grid, which runs
 * for seconds on a loaded machine. At the 5s default they fail on timing alone,
 * and a mutation sweep reads that as a kill no assertion ever made.
 */
vi.setConfig({ testTimeout: 30000 });

const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';
const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_SPAN_ATTR = 'data-blok-table-cell-span';

/** Mirrors the module's own constants; a drift here silently voids the boundary tests. */
const CORNER_OFFSET = 16;
const VIEWPORT_BAND = 24;
const VIEWPORT_HEIGHT = 300;
const LOWER_BAND_EDGE = VIEWPORT_HEIGHT - VIEWPORT_BAND;

/** How far the wrapper box sits outside the grid; it scrolls with the grid. */
const WRAPPER_INSET_X = 50;
const WRAPPER_INSET_Y = 20;

interface Geometry {
  left: number;
  top: number;
  colWidths: number[];
  rowHeights: number[];
  /** Width the grid box carries beyond its cells (border, padding, scroll gutter). */
  gridPad: number;
  /** Rows whose two trailing columns are covered by one merged cell. */
  mergedTailRows: number[];
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const prefixCache = new WeakMap<number[], number[]>();

/**
 * Running total of `values` up to `count`, memoised per array.
 *
 * The memo is invalidated by length alone, which is sound only because the
 * fixtures grow and shrink these arrays with push/pop. Assigning into one in
 * place would hand back stale sums.
 */
const sumTo = (values: number[], count: number): number => {
  const cached = prefixCache.get(values);
  const prefix = cached !== undefined && cached.length === values.length + 1
    ? cached
    : values.reduce<number[]>((totals, value) => [...totals, totals[totals.length - 1] + value], [0]);

  if (prefix !== cached) {
    prefixCache.set(values, prefix);
  }

  return prefix[Math.min(count, values.length)] ?? 0;
};

const geometry = (patch: Partial<Geometry> = {}): Geometry => ({
  left: 250,
  top: 120,
  colWidths: [120, 80, 60],
  rowHeights: [40, 24, 56],
  gridPad: 0,
  mergedTailRows: [],
  ...patch,
});

const gridWidth = (geo: Geometry): number => sum(geo.colWidths) + geo.gridPad;
const gridRight = (geo: Geometry): number => geo.left + gridWidth(geo);
const gridBottom = (geo: Geometry): number => geo.top + sum(geo.rowHeights);

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

const createWrapper = (): HTMLDivElement => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  return wrapper;
};

const createGrid = (geo: Geometry): HTMLTableElement => {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  const cols = geo.colWidths.length;

  geo.rowHeights.forEach((_, r) => {
    const row = document.createElement('tr');

    row.setAttribute(ROW_ATTR, '');

    const merged = geo.mergedTailRows.includes(r) && cols >= 2;

    for (let c = 0; c < cols; c++) {
      if (merged && c === cols - 1) {
        break;
      }

      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute(CELL_ROW_ATTR, String(r));
      td.setAttribute(CELL_COL_ATTR, String(c));
      td.setAttribute(CELL_SPAN_ATTR, merged && c === cols - 2 ? '2' : '1');
      row.appendChild(td);
    }

    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  return table;
};

interface ScrollView {
  el: HTMLElement;
  width: number;
  scrollLeft: () => number;
}

/**
 * A scroll container whose scrollLeft clamps the way a real one does, so the
 * auto-scroll cannot pretend to scroll past the end of the content.
 */
const createScrollContainer = (
  visibleWidth: number,
  contentWidth: () => number,
  override?: { clientWidth?: number; scrollWidth?: number }
): ScrollView => {
  const scroll = { left: 0 };
  const el = document.createElement('div');
  const client = override?.clientWidth ?? visibleWidth;

  Object.defineProperty(el, 'clientWidth', { get: () => client });
  Object.defineProperty(el, 'scrollWidth', { get: () => override?.scrollWidth ?? contentWidth() });
  Object.defineProperty(el, 'scrollLeft', {
    get: () => scroll.left,
    set: (value: number) => {
      scroll.left = Math.max(0, Math.min(value, (override?.scrollWidth ?? contentWidth()) - client));
    },
  });

  return { el,
    width: visibleWidth,
    scrollLeft: () => scroll.left };
};

const nativeGetRect = HTMLElement.prototype.getBoundingClientRect;

/** Undoes installGeometry; the override is a plain assignment, not a spy. */
const restoreGeometry = (): void => {
  HTMLElement.prototype.getBoundingClientRect = nativeGetRect;
};

/*
 * Overwrites the prototype method rather than spying on it. The step-budget tests
 * measure every cell 200 times over; a spy records all ~40k calls and the test
 * then outruns its timeout, which the sweep reads as a mutant kill nobody asserted.
 */
const installGeometry = (
  wrapper: HTMLElement,
  grid: HTMLElement,
  geo: Geometry,
  view?: ScrollView
): void => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const scrolled = view?.scrollLeft() ?? 0;
    const left = geo.left - scrolled;

    if (view !== undefined && this === view.el) {
      return rectOf(geo.left, geo.top, view.width, sum(geo.rowHeights));
    }

    if (this === grid) {
      return rectOf(left, geo.top, gridWidth(geo), sum(geo.rowHeights));
    }

    if (this === wrapper) {
      return rectOf(left - WRAPPER_INSET_X, geo.top - WRAPPER_INSET_Y, gridWidth(geo), sum(geo.rowHeights));
    }

    if (this.hasAttribute(ROW_ATTR)) {
      const index = Array.from(grid.querySelectorAll(`[${ROW_ATTR}]`)).indexOf(this);

      return rectOf(left, geo.top + sumTo(geo.rowHeights, index), gridWidth(geo), geo.rowHeights[index] ?? 0);
    }

    if (this.hasAttribute(CELL_ATTR)) {
      const col = Number(this.getAttribute(CELL_COL_ATTR));
      const row = Number(this.getAttribute(CELL_ROW_ATTR));
      const span = Number(this.getAttribute(CELL_SPAN_ATTR) ?? '1');

      return rectOf(
        left + sumTo(geo.colWidths, col),
        geo.top + sumTo(geo.rowHeights, row),
        sumTo(geo.colWidths, col + span) - sumTo(geo.colWidths, col),
        geo.rowHeights[row] ?? 0,
      );
    }

    return rectOf(0, 0, 0, 0);
  };
};

/** Where syncPosition must land the handle, computed the way the module does. */
const expectedLeft = (geo: Geometry, view?: ScrollView): string => {
  const scrolled = view?.scrollLeft() ?? 0;
  const right = gridRight(geo) - scrolled;
  const visible = view === undefined ? right : Math.min(right, geo.left + view.width);

  return `${visible - (geo.left - scrolled - WRAPPER_INSET_X) - CORNER_OFFSET}px`;
};

const expectedTop = (geo: Geometry): string =>
  `${gridBottom(geo) - (geo.top - WRAPPER_INSET_Y) - CORNER_OFFSET}px`;

const DRAG_HINT_KEY = 'tools.table.dragToAddRemoveRowsColumns';

const createI18nStub = (): I18n => ({
  t: (key: string) => key,
  has: (key: string) => key === DRAG_HINT_KEY,
  getEnglishTranslation: (key: string) => key,
  getLocale: () => 'en',
});

type VoidCallback = () => void;
type GuardCallback = () => boolean;
type SizeCallback = () => { rows: number; cols: number };
type ScrollByCallback = (x: number, y: number) => void;

interface Options extends TableCornerDragOptions {
  onAddRow: Mock<VoidCallback>;
  onAddColumn: Mock<VoidCallback>;
  onRemoveLastRow: Mock<VoidCallback>;
  onRemoveLastColumn: Mock<VoidCallback>;
  onDragStart: Mock<VoidCallback>;
  onDragEnd: Mock<VoidCallback>;
  getTableSize: Mock<SizeCallback>;
  canRemoveLastRow: Mock<GuardCallback>;
  canRemoveLastColumn: Mock<GuardCallback>;
}

const createOptions = (wrapper: HTMLElement, gridEl: HTMLElement): Options => ({
  wrapper,
  gridEl,
  i18n: createI18nStub(),
  onAddRow: vi.fn<VoidCallback>(),
  onAddColumn: vi.fn<VoidCallback>(),
  onRemoveLastRow: vi.fn<VoidCallback>(),
  onRemoveLastColumn: vi.fn<VoidCallback>(),
  onDragStart: vi.fn<VoidCallback>(),
  onDragEnd: vi.fn<VoidCallback>(),
  getTableSize: vi.fn<SizeCallback>(() => ({ rows: 3,
    cols: 3 })),
  canRemoveLastRow: vi.fn<GuardCallback>(() => true),
  canRemoveLastColumn: vi.fn<GuardCallback>(() => true),
});

/**
 * Wire the callbacks so they move both the DOM and the stubbed geometry, the
 * way the real table does. A geometry that never follows makes every walk stop
 * after one step, which hides the loops entirely.
 */
const wireOps = (
  options: Options,
  grid: HTMLTableElement,
  geo: Geometry,
  step: { colWidth?: number; rowHeight?: number } = {}
): void => {
  const newColWidth = step.colWidth ?? 60;
  const newRowHeight = step.rowHeight ?? 30;
  const rows = (): HTMLElement[] => Array.from(grid.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`));

  options.onAddColumn.mockImplementation(() => {
    const col = geo.colWidths.length;

    rows().forEach((row, r) => {
      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute(CELL_ROW_ATTR, String(r));
      td.setAttribute(CELL_COL_ATTR, String(col));
      td.setAttribute(CELL_SPAN_ATTR, '1');
      row.appendChild(td);
    });
    geo.colWidths.push(newColWidth);
  });

  options.onRemoveLastColumn.mockImplementation(() => {
    rows().forEach(row => {
      const last = row.lastElementChild;

      if (!(last instanceof HTMLElement)) {
        return;
      }

      const span = Number(last.getAttribute(CELL_SPAN_ATTR) ?? '1');

      if (span > 1) {
        last.setAttribute(CELL_SPAN_ATTR, String(span - 1));
      } else {
        last.remove();
      }
    });
    geo.colWidths.pop();
  });

  options.onAddRow.mockImplementation(() => {
    const row = document.createElement('tr');
    const r = geo.rowHeights.length;

    row.setAttribute(ROW_ATTR, '');
    geo.colWidths.forEach((_, c) => {
      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute(CELL_ROW_ATTR, String(r));
      td.setAttribute(CELL_COL_ATTR, String(c));
      td.setAttribute(CELL_SPAN_ATTR, '1');
      row.appendChild(td);
    });
    grid.querySelector('tbody')?.appendChild(row);
    geo.rowHeights.push(newRowHeight);
  });

  options.onRemoveLastRow.mockImplementation(() => {
    rows()[geo.rowHeights.length - 1]?.remove();
    geo.rowHeights.pop();
  });

  options.getTableSize.mockImplementation(() => ({ rows: geo.rowHeights.length,
    cols: geo.colWidths.length }));
};

interface Frames {
  /** Runs the next queued frame at an explicit timestamp; false when none is queued. */
  step: (timestamp: number) => boolean;
  requested: () => number;
  cancelled: () => number[];
  pending: () => number;
}

/**
 * Hand-driven animation frames with explicit timestamps. The budget is
 * `overshoot * gain * elapsed`, so the boundary mutants are only reachable when
 * the test picks the elapsed time rather than a faked clock.
 */
const captureFrames = (options: { clearOnCancel?: boolean } = {}): Frames => {
  const queue: FrameRequestCallback[] = [];
  const cancelled: number[] = [];
  let requested = 0;

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback): number => {
    queue.push(cb);
    requested += 1;

    return requested;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number): void => {
    cancelled.push(id);
    if (options.clearOnCancel !== false) {
      queue.length = 0;
    }
  });

  return {
    step: (timestamp: number): boolean => {
      const cb = queue.shift();

      if (cb === undefined) {
        return false;
      }
      cb(timestamp);

      return true;
    },
    requested: () => requested,
    cancelled: () => cancelled,
    pending: () => queue.length,
  };
};

/**
 * Errors thrown inside a dispatched listener. jsdom hands them to window's error
 * event instead of to the caller, so a geometry walk that blows up mid-drag
 * leaves every assertion in the test passing.
 */
const uncaughtDuring = (run: () => void): string[] => {
  const seen: string[] = [];
  const onError = (event: ErrorEvent): void => { seen.push(event.message); };

  window.addEventListener('error', onError);
  try {
    run();
  } finally {
    window.removeEventListener('error', onError);
  }

  return seen;
};

const down = (el: HTMLElement, x: number, y: number): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x,
    clientY: y,
    pointerId: 1 }));
};
const move = (el: HTMLElement, x: number, y: number): void => {
  el.dispatchEvent(new PointerEvent('pointermove', { clientX: x,
    clientY: y,
    pointerId: 1 }));
};
const up = (el: HTMLElement, x: number, y: number): void => {
  el.dispatchEvent(new PointerEvent('pointerup', { clientX: x,
    clientY: y,
    pointerId: 1 }));
};
const cancel = (el: HTMLElement): void => {
  el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
};

describe('TableCornerDrag — surviving-mutant coverage', () => {
  let wrapper: HTMLDivElement;
  let grid: HTMLTableElement;
  let corner: TableCornerDrag | null = null;
  const realInnerHeight = window.innerHeight;
  const setPointerCapture = vi.fn((_id: number): void => {});
  const releasePointerCapture = vi.fn((_id: number): void => {});

  const build = (geo: Geometry): { options: Options; hitZone: HTMLElement } => {
    grid = createGrid(geo);
    wrapper.appendChild(grid);

    const options = createOptions(wrapper, grid);

    wireOps(options, grid, geo);
    installGeometry(wrapper, grid, geo);

    corner = new TableCornerDrag(options);

    const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

    if (!(hitZone instanceof HTMLElement)) {
      throw new Error('hit zone not rendered');
    }

    return { options,
      hitZone };
  };

  const setViewportHeight = (height: number): void => {
    Object.defineProperty(window, 'innerHeight', { value: height,
      configurable: true });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    HTMLElement.prototype.setPointerCapture = setPointerCapture;
    HTMLElement.prototype.releasePointerCapture = releasePointerCapture;
  });

  afterEach(() => {
    corner?.destroy();
    corner = null;
    wrapper.remove();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setViewportHeight(realInnerHeight);
    restoreGeometry();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('the handle box', () => {
    it('keeps its own size, layer and static offsets while the grid has no layout', () => {
      const geo = geometry();

      grid = createGrid(geo);
      wrapper.appendChild(grid);
      corner = new TableCornerDrag(createOptions(wrapper, grid));

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      expect(hitZone.getAttribute(CORNER_DRAG_ATTR)).toBe('');
      expect(hitZone.style.width).toBe('36px');
      expect(hitZone.style.height).toBe('36px');
      expect(hitZone.style.zIndex).toBe('2');
      expect(hitZone.style.pointerEvents).toBe('auto');
      // An unmeasurable grid must leave the static corner offsets standing.
      expect(hitZone.style.bottom).toBe('-36px');
      expect(hitZone.style.right).toBe('-16px');
      expect(hitZone.style.left).toBe('');
      expect(hitZone.style.top).toBe('');
    });

    it('pins itself to the grid corner as soon as the grid has layout', () => {
      const geo = geometry();
      const { hitZone } = build(geo);

      expect(hitZone.style.left).toBe(expectedLeft(geo));
      expect(hitZone.style.top).toBe(expectedTop(geo));
      // The static offsets have to be dropped, or they fight the computed ones.
      expect(hitZone.style.bottom).toBe('');
      expect(hitZone.style.right).toBe('');
    });

    it('pins a grid that has width but no height', () => {
      const geo = geometry({ rowHeights: [],
        colWidths: [120, 80] });
      const { hitZone } = build(geo);

      expect(hitZone.style.left).toBe(expectedLeft(geo));
      expect(hitZone.style.bottom).toBe('');
    });

    it('pins a grid that has height but no width', () => {
      const geo = geometry({ colWidths: [],
        rowHeights: [40, 60] });
      const { hitZone } = build(geo);

      expect(hitZone.style.top).toBe(expectedTop(geo));
      expect(hitZone.style.bottom).toBe('');
    });

    it('clamps the handle to the container edge when the grid overflows it', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);
      corner.syncPosition();

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      const containerRight = geo.left + view.width;

      expect(containerRight).toBeLessThan(gridRight(geo));
      expect(hitZone.style.left).toBe(expectedLeft(geo, view));
    });
  });

  describe('the scroll container it is attached to', () => {
    class RecordingResizeObserver implements ResizeObserver {
      public static callbacks: ResizeObserverCallback[] = [];
      public static instances: ResizeObserver[] = [];
      public static observed: Element[] = [];

      public constructor(cb: ResizeObserverCallback) {
        RecordingResizeObserver.callbacks.push(cb);
        RecordingResizeObserver.instances.push(this);
      }

      public observe(target: Element): void {
        RecordingResizeObserver.observed.push(target);
      }

      public unobserve(): void {}

      public disconnect(): void {}
    }

    beforeEach(() => {
      RecordingResizeObserver.callbacks = [];
      RecordingResizeObserver.instances = [];
      RecordingResizeObserver.observed = [];
      vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
    });

    it('re-pins the handle when the container scrolls', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(900, () => sum(geo.colWidths));

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      corner.syncPosition();

      const before = hitZone.style.left;

      geo.colWidths.push(180);
      view.el.dispatchEvent(new Event('scroll'));

      expect(hitZone.style.left).not.toBe(before);
    });

    it('registers the scroll listener as passive', () => {
      const geo = geometry();

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(900, () => sum(geo.colWidths));
      const addSpy = vi.spyOn(view.el, 'addEventListener');

      installGeometry(wrapper, grid, geo, view);
      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    });

    it('observes the container it was handed', () => {
      const geo = geometry();

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const view = createScrollContainer(900, () => sum(geo.colWidths));

      installGeometry(wrapper, grid, geo, view);
      corner = new TableCornerDrag(createOptions(wrapper, grid));
      corner.attachScrollContainer(view.el);

      // Identity, not structural equality: two bare divs compare equal.
      expect(RecordingResizeObserver.observed[0]).toBe(view.el);
    });

    it('re-pins the handle when the container resizes', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(900, () => sum(geo.colWidths));

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      corner.syncPosition();

      const before = hitZone.style.left;

      geo.colWidths.push(180);
      const observer = RecordingResizeObserver.instances[0];

      if (observer === undefined) {
        throw new Error('no resize observer created');
      }

      RecordingResizeObserver.callbacks[0]?.([], observer);

      expect(hitZone.style.left).not.toBe(before);
    });

    it('drops the old container when a second one is attached', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const first = createScrollContainer(900, () => sum(geo.colWidths));
      const second = createScrollContainer(900, () => sum(geo.colWidths));

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, second);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(first.el);
      corner.attachScrollContainer(second.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      corner.syncPosition();

      const before = hitZone.style.left;

      geo.colWidths.push(180);
      first.el.dispatchEvent(new Event('scroll'));

      expect(hitZone.style.left).toBe(before);

      second.el.dispatchEvent(new Event('scroll'));

      expect(hitZone.style.left).not.toBe(before);
    });

    it('stops following a container it was destroyed with', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(900, () => sum(geo.colWidths));

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);
      corner.syncPosition();

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      const before = hitZone.style.left;

      corner.destroy();
      corner = null;

      geo.colWidths.push(180);
      view.el.dispatchEvent(new Event('scroll'));

      expect(hitZone.style.left).toBe(before);
    });
  });

  describe('hover while the pointer is down', () => {
    it('keeps the size readout when the pointer leaves the handle mid-drag', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), gridBottom(geo) - 20);
      mockHideTooltip.mockClear();

      hitZone.dispatchEvent(new MouseEvent('mouseleave'));

      expect(mockHideTooltip).not.toHaveBeenCalled();
    });

    it('shows the size readout the moment the pointer goes down', () => {
      const geo = geometry();
      const { hitZone } = build(geo);

      mockShowTooltip.mockClear();
      down(hitZone, gridRight(geo), gridBottom(geo));

      expect(mockShowTooltip).toHaveBeenCalledWith(hitZone, '3×3', { placement: 'bottom' });
    });
  });

  describe('a tap that never became a drag', () => {
    it('routes the tap to onClickAdd when the host supplies one', () => {
      const geo = geometry();

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const onClickAdd = vi.fn();

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo);
      corner = new TableCornerDrag({ ...options,
        onClickAdd });

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      down(hitZone, gridRight(geo), gridBottom(geo));
      up(hitZone, gridRight(geo), gridBottom(geo));

      expect(onClickAdd).toHaveBeenCalledTimes(1);
      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onAddColumn).not.toHaveBeenCalled();
    });
  });

  describe('the drag threshold', () => {
    it('ignores a move whose vertical leg is longer than its horizontal one', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      down(hitZone, gridRight(geo), gridBottom(geo));
      // 2,4 is 4.47px away: under the threshold whichever leg is longer.
      move(hitZone, gridRight(geo) + 2, gridBottom(geo) + 4);

      expect(options.onDragStart).not.toHaveBeenCalled();
      expect(document.body.style.cursor).toBe('');
    });

    it('starts the drag at exactly the threshold distance', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      down(hitZone, gridRight(geo), gridBottom(geo));
      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);
      // 3,4 is exactly 5px: the threshold is exclusive.
      move(hitZone, gridRight(geo) - 3, gridBottom(geo) - 4);

      expect(options.onDragStart).toHaveBeenCalledTimes(1);
      expect(document.body.style.cursor).toBe('nwse-resize');
      expect(document.body.style.userSelect).toBe('none');
    });

    it('announces the drag start only once across several moves', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo));
      move(hitZone, gridRight(geo) - 40, gridBottom(geo));

      expect(options.onDragStart).toHaveBeenCalledTimes(1);
    });
  });

  describe('a gesture the browser takes away', () => {
    it('tears the drag down without adding a row or a column', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);

      expect(document.body.style.cursor).toBe('nwse-resize');
      mockHideTooltip.mockClear();

      cancel(hitZone);

      expect(options.onDragEnd).toHaveBeenCalledTimes(1);
      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onAddColumn).not.toHaveBeenCalled();
      // A nonsense value would be rejected by the parser and leave the override standing.
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
      expect(mockHideTooltip).toHaveBeenCalled();
      expect(releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('does not treat a cancel before the threshold as a tap', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      down(hitZone, gridRight(geo), gridBottom(geo));
      cancel(hitZone);

      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onAddColumn).not.toHaveBeenCalled();
      expect(options.onDragEnd).not.toHaveBeenCalled();
    });

    it('drops every drag listener when the gesture is cancelled', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);

      const removeSpy = vi.spyOn(hitZone, 'removeEventListener');

      cancel(hitZone);

      const removed = removeSpy.mock.calls.map(([type]) => type);

      expect(removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
    });

    it('drops every drag listener when the pointer is released', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);

      const removeSpy = vi.spyOn(hitZone, 'removeEventListener');

      up(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);

      const removed = removeSpy.mock.calls.map(([type]) => type);

      expect(removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
    });

    it('binds the cancel listener on every pointerdown', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      up(hitZone, gridRight(geo), gridBottom(geo));

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);
      cancel(hitZone);

      expect(options.onDragEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('the corner is measured from the grid, not the grab point', () => {
    it('adds the row the grabbed corner asks for, not the one the pointer sits on', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      // Grabbed 8px above the corner: the offset is added back, never subtracted.
      down(hitZone, right, bottom - 8);
      move(hitZone, right, bottom);

      expect(options.onAddRow).toHaveBeenCalledTimes(1);
      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });

    it('never asks whether the last column may go during a purely vertical drag', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right, bottom - 60);

      expect(options.canRemoveLastColumn).not.toHaveBeenCalled();
      expect(options.onRemoveLastColumn).not.toHaveBeenCalled();
    });

    it('never asks whether the last row may go during a purely horizontal drag', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right - 70, bottom);

      expect(options.canRemoveLastRow).not.toHaveBeenCalled();
      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });
  });

  describe('the per-move step budget', () => {
    it('stops adding columns at the cap', () => {
      const geo = geometry({ colWidths: [120, 80, 60] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo, { colWidth: 1 });
      installGeometry(wrapper, grid, geo);
      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) + 400, gridBottom(geo));

      expect(options.onAddColumn).toHaveBeenCalledTimes(200);
    });

    it('stops removing columns at the cap', () => {
      const geo = geometry({ colWidths: Array.from({ length: 210 }, () => 1),
        rowHeights: [40] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo);
      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 205, gridBottom(geo));

      expect(options.onRemoveLastColumn).toHaveBeenCalledTimes(200);
    });

    it('stops adding rows at the cap', () => {
      const geo = geometry();

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo, { rowHeight: 1 });
      installGeometry(wrapper, grid, geo);
      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), gridBottom(geo) + 400);

      expect(options.onAddRow).toHaveBeenCalledTimes(200);
    });

    it('stops removing rows at the cap', () => {
      const geo = geometry({ colWidths: [120],
        rowHeights: Array.from({ length: 210 }, () => 1) });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo);
      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), gridBottom(geo) - 205);

      expect(options.onRemoveLastRow).toHaveBeenCalledTimes(200);
    });
  });

  describe('a grid that refuses to follow', () => {
    it('stops adding columns once the grid stops widening', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      // A rejected insert leaves the geometry where it was.
      options.onAddColumn.mockImplementation(() => {});

      const errors = uncaughtDuring(() => {
        down(hitZone, gridRight(geo), gridBottom(geo));
        move(hitZone, gridRight(geo) + 200, gridBottom(geo));
      });

      // Walking on with a null rect throws where no assertion would see it.
      expect(errors).toEqual([]);
      expect(options.onAddColumn).toHaveBeenCalledTimes(1);
    });

    it('stops removing columns once the grid stops narrowing', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.onRemoveLastColumn.mockImplementation(() => {});

      const errors = uncaughtDuring(() => {
        down(hitZone, gridRight(geo), gridBottom(geo));
        move(hitZone, gridRight(geo) - 200, gridBottom(geo));
      });

      expect(errors).toEqual([]);
      expect(options.onRemoveLastColumn).toHaveBeenCalledTimes(1);
    });

    it('stops adding rows once the grid stops growing', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.onAddRow.mockImplementation(() => {});

      const errors = uncaughtDuring(() => {
        down(hitZone, gridRight(geo), gridBottom(geo));
        move(hitZone, gridRight(geo), gridBottom(geo) + 200);
      });

      expect(errors).toEqual([]);
      expect(options.onAddRow).toHaveBeenCalledTimes(1);
    });

    it('stops removing rows once the grid stops shrinking', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.onRemoveLastRow.mockImplementation(() => {});

      const errors = uncaughtDuring(() => {
        down(hitZone, gridRight(geo), gridBottom(geo));
        move(hitZone, gridRight(geo), gridBottom(geo) - 200);
      });

      expect(errors).toEqual([]);
      expect(options.onRemoveLastRow).toHaveBeenCalledTimes(1);
    });

    it('keeps removing columns while the corner is still clear of them', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      // 365 clears the 60px and the 80px column, then stops inside the 120px one.
      down(hitZone, right, bottom);
      move(hitZone, 365, bottom);

      expect(options.onRemoveLastColumn).toHaveBeenCalledTimes(2);
    });

    it('keeps removing rows while the corner is still above them', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      // 155 clears the 56px row and the 24px one, then stops inside the 40px row.
      down(hitZone, right, bottom);
      move(hitZone, right, 155);

      expect(options.onRemoveLastRow).toHaveBeenCalledTimes(2);
    });
  });

  describe('measuring the trailing column', () => {
    it('measures the split column, not a cell merged across the last two', () => {
      const geo = geometry({ mergedTailRows: [2] });
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);
      const lastColumnLeft = right - 60;

      down(hitZone, right, bottom);
      move(hitZone, lastColumnLeft - 1, bottom);

      // Reading the 140px merged cell as the last column would refuse this.
      expect(options.onRemoveLastColumn).toHaveBeenCalledTimes(1);
    });

    it('refuses to remove a column when no cell reaches the grid edge', () => {
      const geo = geometry({ gridPad: 10 });
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right - 75, bottom);

      expect(options.canRemoveLastColumn).toHaveBeenCalled();
      expect(options.onRemoveLastColumn).not.toHaveBeenCalled();
    });

    it('measures a column whose cells stop one pixel short of the grid edge', () => {
      const geo = geometry({ gridPad: 1 });
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right - 62, bottom);

      expect(options.onRemoveLastColumn).toHaveBeenCalledTimes(1);
    });
  });

  describe('where the shrink stops', () => {
    it('keeps the last column while the corner is still inside it', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right - 50, bottom);

      expect(options.canRemoveLastColumn).toHaveBeenCalled();
      expect(options.onRemoveLastColumn).not.toHaveBeenCalled();
    });

    it('removes the column when the corner lands exactly on its left edge', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right - 60, bottom);

      expect(options.onRemoveLastColumn).toHaveBeenCalledTimes(1);
    });

    it('keeps the last row while the corner is still inside it', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right, bottom - 40);

      expect(options.canRemoveLastRow).toHaveBeenCalled();
      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });

    it('removes the row when the corner lands exactly on its top edge', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right, bottom - 56);

      expect(options.onRemoveLastRow).toHaveBeenCalledTimes(1);
    });

    it('refuses to remove a trailing row that measures no height', () => {
      const geo = geometry({ rowHeights: [40, 24, 0] });
      const { options, hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right, bottom - 30);

      expect(options.canRemoveLastRow).toHaveBeenCalled();
      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });
  });

  describe('a grid box that is only half empty', () => {
    it('grows a grid that has width but no height', () => {
      const geo = geometry({ colWidths: [120, 80],
        rowHeights: [] });
      const { options, hitZone } = build(geo);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), gridBottom(geo) + 60);

      expect(options.onAddRow).toHaveBeenCalledTimes(2);
    });

    it('grows a grid that has height but no width', () => {
      const geo = geometry({ colWidths: [],
        rowHeights: [40, 60] });
      const { options, hitZone } = build(geo);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) + 120, gridBottom(geo));

      expect(options.onAddColumn).toHaveBeenCalledTimes(2);
    });
  });

  describe('the handle follows what the drag committed', () => {
    it('re-pins the handle after a move added a column', () => {
      const geo = geometry();
      const { hitZone } = build(geo);
      const right = gridRight(geo);
      const bottom = gridBottom(geo);

      down(hitZone, right, bottom);
      move(hitZone, right + 30, bottom);

      expect(hitZone.style.left).toBe(expectedLeft(geo));
      expect(gridRight(geo)).toBeGreaterThan(right);
    });
  });

  describe('arming the horizontal auto-scroll', () => {
    const armedFixture = (
      geo: Geometry,
      override?: { clientWidth?: number; scrollWidth?: number }
    ): { options: Options; hitZone: HTMLElement; view: ScrollView } => {
      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(400, () => sum(geo.colWidths), override);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      return { options,
        hitZone,
        view };
    };

    it('does not arm while the grid still fits its container', () => {
      const geo = geometry();
      const frames = captureFrames();
      const { options, hitZone, view } = armedFixture(geo);

      options.onAddColumn.mockImplementation(() => {});

      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 30, gridBottom(geo));

      expect(frames.requested()).toBe(0);
    });

    it('does not arm when the content is one pixel wider than the box', () => {
      const geo = geometry();
      const frames = captureFrames();
      const { options, hitZone, view } = armedFixture(geo, { clientWidth: 400,
        scrollWidth: 401 });

      options.onAddColumn.mockImplementation(() => {});

      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 30, gridBottom(geo));

      expect(frames.requested()).toBe(0);
    });

    it('does not arm when the content exactly fills the box', () => {
      const geo = geometry();
      const frames = captureFrames();
      const { options, hitZone, view } = armedFixture(geo, { clientWidth: 400,
        scrollWidth: 400 });

      options.onAddColumn.mockImplementation(() => {});

      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 30, gridBottom(geo));

      expect(frames.requested()).toBe(0);
    });

    it('does not arm while the pointer sits exactly on the container edge', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames();
      const { options, hitZone, view } = armedFixture(geo);

      options.onAddColumn.mockImplementation(() => {});
      options.onRemoveLastColumn.mockImplementation(() => {});

      const containerRight = geo.left + view.width;

      down(hitZone, containerRight + 20, gridBottom(geo));
      move(hitZone, containerRight, gridBottom(geo));

      expect(frames.requested()).toBe(0);
    });

    it('queues one frame at a time while the pointer is held past the edge', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames();
      const { hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));
      move(hitZone, containerRight + 50, gridBottom(geo));

      expect(frames.requested()).toBe(1);
    });

    it('stops the loop as soon as the pointer comes back inside', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames();
      const { options, hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));

      expect(frames.requested()).toBe(1);

      options.canRemoveLastColumn.mockReturnValue(false);
      move(hitZone, containerRight - 40, gridBottom(geo));

      expect(frames.cancelled()).toEqual([1]);
      expect(frames.pending()).toBe(0);
    });

    it('cancels the pending frame when the pointer is released', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames();
      const { hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));
      up(hitZone, containerRight + 40, gridBottom(geo));

      expect(frames.cancelled()).toEqual([1]);
    });

    it('cancels the pending frame when the gesture is taken away', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames();
      const { hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));
      cancel(hitZone);

      expect(frames.cancelled()).toEqual([1]);
    });

    it('cancels the pending frame when the editor tears the handle down', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames();
      const { hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));
      corner?.destroy();
      corner = null;

      expect(frames.cancelled()).toEqual([1]);
    });

    it('never cancels a frame that was never queued', () => {
      const geo = geometry();
      const frames = captureFrames();
      const { hitZone } = armedFixture(geo);

      down(hitZone, gridRight(geo), gridBottom(geo));
      up(hitZone, gridRight(geo), gridBottom(geo));

      expect(frames.cancelled()).toEqual([]);
    });

    it('a frame that fires after the release changes nothing', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames({ clearOnCancel: false });
      const { options, hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));
      up(hitZone, containerRight + 40, gridBottom(geo));

      const added = options.onAddColumn.mock.calls.length;

      expect(frames.step(1000)).toBe(true);
      expect(options.onAddColumn).toHaveBeenCalledTimes(added);
    });

    it('a frame that fires after the pointer came back inside reschedules nothing', () => {
      const geo = geometry({ colWidths: [180, 180, 180] });
      const frames = captureFrames({ clearOnCancel: false });
      const { options, hitZone, view } = armedFixture(geo);
      const containerRight = geo.left + view.width;

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 40, gridBottom(geo));
      options.canRemoveLastColumn.mockReturnValue(false);
      move(hitZone, containerRight - 40, gridBottom(geo));

      const requested = frames.requested();

      expect(frames.step(1000)).toBe(true);
      expect(frames.requested()).toBe(requested);
    });
  });

  describe('spending the horizontal auto-scroll budget', () => {
    /*
     * A 64px trailing column with the pointer held exactly 64px past the edge,
     * measured over exactly 125ms: budget = 64 * 8 * 0.125 = 64, which is the
     * step to the pixel. Every quantity here is a power of two, so the two
     * comparison mutants split on a value floating point can represent.
     */
    const meteredFixture = (): {
      options: Options;
      hitZone: HTMLElement;
      geo: Geometry;
      view: ScrollView;
      pointerX: number;
    } => {
      const geo = geometry({ colWidths: [180, 180, 64] });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      wireOps(options, grid, geo, { colWidth: 128 });
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      return { options,
        hitZone,
        geo,
        view,
        pointerX: geo.left + view.width + 64 };
    };

    it('the first frame only starts the clock', () => {
      const frames = captureFrames();
      const { options, hitZone, geo, pointerX } = meteredFixture();

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, pointerX, gridBottom(geo));

      const added = options.onAddColumn.mock.calls.length;

      frames.step(1000);

      expect(options.onAddColumn).toHaveBeenCalledTimes(added);
    });

    it('appends the column the moment the budget reaches its width', () => {
      const frames = captureFrames();
      const { options, hitZone, geo, pointerX } = meteredFixture();

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, pointerX, gridBottom(geo));

      const added = options.onAddColumn.mock.calls.length;

      frames.step(1000);
      frames.step(1125);

      expect(options.onAddColumn).toHaveBeenCalledTimes(added + 1);
    });

    it('carries the leftover budget forward instead of doubling it', () => {
      const frames = captureFrames();
      const { options, hitZone, geo, pointerX } = meteredFixture();

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, pointerX, gridBottom(geo));

      const added = options.onAddColumn.mock.calls.length;

      frames.step(1000);
      frames.step(1125);
      // A budget that grew instead of shrinking clears the 128px column at once.
      frames.step(1250);

      expect(options.onAddColumn).toHaveBeenCalledTimes(added + 1);
    });

    it('spends nothing while the trailing column cannot be measured', () => {
      const geo = geometry({ colWidths: [180, 180, 180],
        gridPad: 10 });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(400, () => sum(geo.colWidths));

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      const frames = captureFrames();

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, geo.left + view.width + 200, gridBottom(geo));

      const added = options.onAddColumn.mock.calls.length;

      frames.step(1000);
      frames.step(2000);
      frames.step(3000);

      expect(options.onAddColumn).toHaveBeenCalledTimes(added);
    });

    it('keeps the corner and the readout up to date across frames', () => {
      const frames = captureFrames();
      const { options, hitZone, geo, pointerX } = meteredFixture();

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, pointerX, gridBottom(geo));
      frames.step(1000);

      const left = hitZone.style.left;

      mockShowTooltip.mockClear();
      frames.step(1125);

      expect(options.onAddColumn).toHaveBeenCalled();
      expect(hitZone.style.left).not.toBe(left);
      expect(mockShowTooltip).toHaveBeenCalledWith(hitZone, `${geo.colWidths.length}×${geo.rowHeights.length}`, { placement: 'bottom' });
    });
  });

  describe('arming the vertical auto-scroll', () => {
    /**
     * A page 300px tall, so the lower band starts at 276. The grid's bottom and
     * the pointer are placed against that number rather than against zero.
     */
    const pageFixture = (
      rowHeights: number[],
      patch: Partial<Geometry> = {}
    ): { options: Options; hitZone: HTMLElement; geo: Geometry; scrollBy: Mock<ScrollByCallback> } => {
      setViewportHeight(VIEWPORT_HEIGHT);

      const geo = geometry({ rowHeights,
        ...patch });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo);

      // Scrolling the page down moves the grid up in client coordinates.
      const scrollBy = vi.fn<ScrollByCallback>((_x: number, y: number): void => {
        geo.top -= y;
      });

      vi.spyOn(window, 'scrollBy').mockImplementation((x?: unknown, y?: unknown): void => {
        scrollBy(typeof x === 'number' ? x : 0, typeof y === 'number' ? y : 0);
      });

      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      return { options,
        hitZone,
        geo,
        scrollBy };
    };

    /** Rows that put the grid's bottom exactly `at` in client coordinates. */
    const rowsEndingAt = (at: number, top = 120): number[] => [40, 24, 56, at - top - 120];

    it('does not arm while the corner stays well above the band', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture([40, 24, 56]);

      // A grid that cannot grow keeps its corner out of the band for good.
      options.onAddRow.mockImplementation(() => {});

      expect(gridBottom(geo)).toBeLessThan(LOWER_BAND_EDGE);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 4);

      expect(gridBottom(geo)).toBeLessThan(LOWER_BAND_EDGE);
      expect(frames.requested()).toBe(0);
    });

    it('arms when the pointer and the corner are both inside the band', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsEndingAt(LOWER_BAND_EDGE + 14));

      // Grabbed above the corner, so an unarmed walk would append a row here.
      down(hitZone, gridRight(geo), gridBottom(geo) - 16);
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 4);

      // Armed, the walk targets the grid's own edge, so the move commits nothing.
      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
      expect(frames.requested()).toBe(1);
    });

    it('arms with the pointer exactly on the band edge', () => {
      const frames = captureFrames();
      const { hitZone, geo } = pageFixture(rowsEndingAt(LOWER_BAND_EDGE + 14));

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE);

      expect(frames.requested()).toBe(1);
    });

    it('arms with the corner exactly on the band edge', () => {
      const frames = captureFrames();
      const { hitZone, geo } = pageFixture(rowsEndingAt(LOWER_BAND_EDGE));

      expect(gridBottom(geo)).toBe(LOWER_BAND_EDGE);

      // Grabbed below the corner: unarmed, the walk would pull inward, never past the edge.
      down(hitZone, gridRight(geo), gridBottom(geo) + 20);
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 2);

      expect(gridBottom(geo)).toBe(LOWER_BAND_EDGE);
      expect(frames.requested()).toBe(1);
    });

    it('re-checks arming after the walk grew the grid into the band', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture([40, 24, 56]);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 4);

      expect(options.onAddRow).toHaveBeenCalled();
      expect(gridBottom(geo)).toBeGreaterThanOrEqual(LOWER_BAND_EDGE);
      expect(frames.requested()).toBe(1);
    });

    it('stays armed when the page scroll lifts the corner back out of the band', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsEndingAt(LOWER_BAND_EDGE + 14));

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 4);

      expect(frames.requested()).toBe(1);

      // The reveal scroll parks the corner a hair above the threshold.
      geo.top -= 20;
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 5);

      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(frames.cancelled()).toEqual([]);
      expect(frames.pending()).toBe(1);
    });
  });

  describe('spending the vertical auto-scroll budget', () => {
    const pageFixture = (
      rowHeights: number[]
    ): { options: Options; hitZone: HTMLElement; geo: Geometry; scrollBy: Mock<ScrollByCallback> } => {
      setViewportHeight(VIEWPORT_HEIGHT);

      const geo = geometry({ rowHeights });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo);

      const scrollBy = vi.fn<ScrollByCallback>((_x: number, y: number): void => {
        geo.top -= y;
      });

      vi.spyOn(window, 'scrollBy').mockImplementation((x?: unknown, y?: unknown): void => {
        scrollBy(typeof x === 'number' ? x : 0, typeof y === 'number' ? y : 0);
      });

      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      return { options,
        hitZone,
        geo,
        scrollBy };
    };

    /** Rows summing to `height`, with an unequal tail so the last one is measurable. */
    const rowsTotalling = (height: number): number[] => [40, 24, 56, height - 120];

    it('the first vertical frame only starts the clock', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsTotalling(170));

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 40);
      frames.step(1000);

      expect(options.onAddRow).not.toHaveBeenCalled();
    });

    it('appends a row the moment the budget reaches its height', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsTotalling(170));

      // 50px trailing row, pointer 50px past the edge, 125ms: budget = 50.
      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 50);
      frames.step(1000);
      frames.step(1125);

      expect(options.onAddRow).toHaveBeenCalledTimes(1);
    });

    it('appends nothing while the pointer rests exactly on the band edge', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsTotalling(170));

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE);
      frames.step(1000);
      frames.step(3000);
      frames.step(5000);

      expect(options.onAddRow).not.toHaveBeenCalled();
    });

    it('spends nothing while the trailing row measures no height', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture([40, 24, 56, 50, 0]);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 50);
      frames.step(1000);
      frames.step(3000);
      frames.step(5000);

      expect(options.onAddRow).not.toHaveBeenCalled();
    });

    it('scrolls the page by exactly how far the corner is past the band', () => {
      const frames = captureFrames();
      const { hitZone, geo, scrollBy } = pageFixture(rowsTotalling(170));

      expect(gridBottom(geo) - LOWER_BAND_EDGE).toBe(14);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 4);
      frames.step(1000);

      expect(scrollBy).toHaveBeenCalledWith(0, 14);
    });

    it('does not scroll the page when the corner already sits on the band edge', () => {
      const frames = captureFrames();
      const { hitZone, geo, scrollBy } = pageFixture(rowsTotalling(156));

      expect(gridBottom(geo)).toBe(LOWER_BAND_EDGE);

      // Grabbed below the corner: without the offset this move is 4px, under the
      // drag threshold, and the whole test passes without a drag ever starting.
      down(hitZone, gridRight(geo), gridBottom(geo) + 16);
      move(hitZone, gridRight(geo), LOWER_BAND_EDGE + 4);

      // The loop has to be live, or "no scroll" is true for the wrong reason.
      expect(frames.requested()).toBe(1);

      frames.step(1000);

      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('shrinks from where the auto-scroll left the corner, not from the grab point', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsTotalling(170));
      const right = gridRight(geo);

      // Grabbed 50px above the corner: the offset must be re-anchored by the loop.
      down(hitZone, right, gridBottom(geo) - 50);
      move(hitZone, right, LOWER_BAND_EDGE + 4);
      frames.step(1000);
      frames.step(3000);

      expect(options.onAddRow).toHaveBeenCalledTimes(1);

      const addedRows = options.onAddRow.mock.calls.length;

      move(hitZone, right, 240);

      expect(options.onRemoveLastRow).toHaveBeenCalled();
      expect(options.onAddRow).toHaveBeenCalledTimes(addedRows);
    });

    it('keeps the horizontal grab offset across a vertical auto-scroll', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = pageFixture(rowsTotalling(170));
      const right = gridRight(geo);

      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, right - 60, gridBottom(geo));
      move(hitZone, right - 110, LOWER_BAND_EDGE + 4);
      frames.step(1000);
      frames.step(3000);

      const addedColumns = options.onAddColumn.mock.calls.length;

      move(hitZone, right - 60, LOWER_BAND_EDGE + 4);

      expect(options.onAddColumn).toHaveBeenCalledTimes(addedColumns);
    });
  });

  describe('the two auto-scroll axes stay out of each other\'s way', () => {
    const bothFixture = (
      rowHeights: number[],
      top: number,
      override?: { clientWidth?: number; scrollWidth?: number }
    ): { options: Options; hitZone: HTMLElement; geo: Geometry; view: ScrollView; scrollBy: Mock<ScrollByCallback> } => {
      setViewportHeight(VIEWPORT_HEIGHT);

      const geo = geometry({ colWidths: [180, 180, 180],
        rowHeights,
        top });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);
      const view = createScrollContainer(400, () => sum(geo.colWidths), override);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo, view);

      const scrollBy = vi.fn<ScrollByCallback>((_x: number, y: number): void => {
        geo.top -= y;
      });

      vi.spyOn(window, 'scrollBy').mockImplementation((x?: unknown, y?: unknown): void => {
        scrollBy(typeof x === 'number' ? x : 0, typeof y === 'number' ? y : 0);
      });

      corner = new TableCornerDrag(options);
      corner.attachScrollContainer(view.el);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      return { options,
        hitZone,
        geo,
        view,
        scrollBy };
    };

    it('a horizontal auto-scroll never scrolls the page down', () => {
      const frames = captureFrames();
      // Corner at y=400, well below the band, with the pointer mid-screen.
      const { hitZone, geo, view, scrollBy } = bothFixture([40, 24, 56, 160], 120);
      const containerRight = geo.left + view.width;

      expect(gridBottom(geo)).toBeGreaterThan(LOWER_BAND_EDGE);

      down(hitZone, gridRight(geo), 150);
      move(hitZone, containerRight + 40, 150);
      frames.step(1000);
      frames.step(2000);

      expect(view.scrollLeft()).toBeGreaterThan(0);
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('a horizontal auto-scroll never scrolls the page up', () => {
      const frames = captureFrames();
      // Corner at y=10, above the top band, with the pointer mid-screen.
      const { hitZone, geo, view, scrollBy } = bothFixture([4, 3, 3], 0);
      const containerRight = geo.left + view.width;

      expect(gridBottom(geo)).toBeLessThan(VIEWPORT_BAND);

      down(hitZone, gridRight(geo), 150);
      move(hitZone, containerRight + 40, 150);
      frames.step(1000);
      frames.step(2000);

      expect(view.scrollLeft()).toBeGreaterThan(0);
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('a pointer near the top of the page does not shed rows while columns grow', () => {
      const frames = captureFrames();
      const { options, hitZone, geo, view } = bothFixture([40, 24, 56, 160], 120);
      const containerRight = geo.left + view.width;

      // The move itself pulls the corner up; only the frame loop is under test.
      options.canRemoveLastRow.mockReturnValue(false);
      down(hitZone, gridRight(geo), 30);
      move(hitZone, containerRight + 40, 10);
      options.canRemoveLastRow.mockReturnValue(true);

      frames.step(1000);
      frames.step(2000);
      frames.step(3000);

      expect(view.scrollLeft()).toBeGreaterThan(0);
      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });

    it('a vertical auto-scroll never scrolls the container sideways', () => {
      const frames = captureFrames();
      const { hitZone, geo, view } = bothFixture([40, 24, 56, 170], 120);
      const containerRight = geo.left + view.width;

      expect(gridBottom(geo)).toBeGreaterThan(LOWER_BAND_EDGE);

      down(hitZone, containerRight - 40, gridBottom(geo));
      move(hitZone, containerRight - 40, LOWER_BAND_EDGE + 4);
      frames.step(1000);
      frames.step(2000);

      expect(view.scrollLeft()).toBe(0);
    });

    it('does not bank a vertical budget while only the columns are growing', () => {
      const frames = captureFrames();
      // 160px trailing row, corner at y=400: below the lower band, so only the
      // horizontal loop is armed while the pointer sits near the top of the page.
      const { options, hitZone, geo, view } = bothFixture([40, 24, 56, 160], 120);
      const containerRight = geo.left + view.width;

      options.canRemoveLastRow.mockReturnValue(false);
      down(hitZone, gridRight(geo), 30);
      move(hitZone, containerRight + 40, 4);
      options.canRemoveLastRow.mockReturnValue(true);

      // 20px above the top band for 0.9s: 144px of budget, if it were being banked.
      frames.step(1000);
      frames.step(1900);

      expect(options.onAddRow).not.toHaveBeenCalled();

      // Now arm downward and hand the loop 32px, a fifth of the row.
      move(hitZone, containerRight + 40, LOWER_BAND_EDGE + 4);
      frames.step(2900);

      expect(options.onAddRow).not.toHaveBeenCalled();
    });

    it('a vertical auto-scroll appends no columns while the container has nothing to reveal', () => {
      const frames = captureFrames();
      // The container does not overflow, so the pointer past its edge buys nothing.
      const { options, hitZone, geo, view } = bothFixture([40, 24, 56, 170], 120, { clientWidth: 400,
        scrollWidth: 400 });
      const containerRight = geo.left + view.width;

      options.onAddColumn.mockImplementation(() => {});

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, containerRight + 50, LOWER_BAND_EDGE + 4);

      const added = options.onAddColumn.mock.calls.length;

      // A 170px trailing row needs a long hold before the vertical budget fires.
      frames.step(1000);
      frames.step(8000);
      frames.step(9000);

      expect(options.onAddRow).toHaveBeenCalled();
      expect(options.onAddColumn).toHaveBeenCalledTimes(added);
    });

    it('keeps the vertical grab offset across a horizontal auto-scroll', () => {
      const frames = captureFrames();
      const { options, hitZone, geo, view } = bothFixture([40, 24, 56], 120);
      const containerRight = geo.left + view.width;
      const bottom = gridBottom(geo);

      // The move itself would shed the trailing row; the loop is what is under test.
      options.canRemoveLastRow.mockReturnValue(false);
      down(hitZone, gridRight(geo), bottom);
      move(hitZone, containerRight + 40, bottom - 60);
      frames.step(1000);
      frames.step(2000);
      options.canRemoveLastRow.mockReturnValue(true);

      move(hitZone, containerRight + 40, bottom - 60);

      expect(options.onRemoveLastRow).toHaveBeenCalledTimes(1);
    });
  });

  describe('dragging the corner back up the page', () => {
    const topFixture = (
      rowHeights: number[],
      top: number
    ): { options: Options; hitZone: HTMLElement; geo: Geometry; scrollBy: Mock<ScrollByCallback> } => {
      setViewportHeight(VIEWPORT_HEIGHT);

      const geo = geometry({ rowHeights,
        top });

      grid = createGrid(geo);
      wrapper.appendChild(grid);

      const options = createOptions(wrapper, grid);

      wireOps(options, grid, geo);
      installGeometry(wrapper, grid, geo);

      const scrollBy = vi.fn<ScrollByCallback>((_x: number, y: number): void => {
        geo.top -= y;
      });

      vi.spyOn(window, 'scrollBy').mockImplementation((x?: unknown, y?: unknown): void => {
        scrollBy(typeof x === 'number' ? x : 0, typeof y === 'number' ? y : 0);
      });

      corner = new TableCornerDrag(options);

      const hitZone = wrapper.querySelector(`[${CORNER_DRAG_ATTR}]`);

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('hit zone not rendered');
      }

      return { options,
        hitZone,
        geo,
        scrollBy };
    };

    it('arms with the pointer exactly on the top band edge', () => {
      const frames = captureFrames();
      // Grid bottom at 20, inside the top band.
      const { hitZone, geo } = topFixture([6, 4, 10], 0);

      expect(gridBottom(geo)).toBeLessThan(VIEWPORT_BAND);

      down(hitZone, gridRight(geo), 40);
      move(hitZone, gridRight(geo), VIEWPORT_BAND);

      expect(frames.requested()).toBe(1);
    });

    it('arms with the corner exactly on the top band edge', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = topFixture([6, 4, 14], 0);

      expect(gridBottom(geo)).toBe(VIEWPORT_BAND);

      options.canRemoveLastRow.mockReturnValue(false);
      down(hitZone, gridRight(geo), 40);
      move(hitZone, gridRight(geo), 10);

      expect(gridBottom(geo)).toBe(VIEWPORT_BAND);
      expect(frames.requested()).toBe(1);
    });

    it('removes nothing while the pointer rests exactly on the top band edge', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = topFixture([6, 4, 10], 0);

      down(hitZone, gridRight(geo), 40);
      move(hitZone, gridRight(geo), VIEWPORT_BAND);
      frames.step(1000);
      frames.step(3000);
      frames.step(5000);

      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
    });

    it('does not scroll the page when the corner already sits on the top band edge', () => {
      const frames = captureFrames();
      const { hitZone, geo, scrollBy } = topFixture([6, 4, 14], 0);

      down(hitZone, gridRight(geo), 10);
      move(hitZone, gridRight(geo), 4);
      frames.step(1000);

      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('stays armed when the page scroll drops the corner back out of the top band', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = topFixture([6, 4, 10], 0);

      down(hitZone, gridRight(geo), 20);
      move(hitZone, gridRight(geo), 10);

      expect(frames.requested()).toBe(1);

      geo.top += 20;
      move(hitZone, gridRight(geo), 8);

      expect(options.onRemoveLastRow).not.toHaveBeenCalled();
      expect(frames.cancelled()).toEqual([]);
      expect(frames.pending()).toBe(1);
    });

    it('stops shedding rows once the pointer leaves the top band', () => {
      const frames = captureFrames();
      const { options, hitZone, geo } = topFixture([6, 4, 10], 0);

      down(hitZone, gridRight(geo), 20);
      move(hitZone, gridRight(geo), 4);
      frames.step(1000);
      frames.step(4000);

      const removed = options.onRemoveLastRow.mock.calls.length;

      expect(removed).toBeGreaterThan(0);

      move(hitZone, gridRight(geo), 150);
      frames.step(6000);
      frames.step(8000);

      expect(options.onRemoveLastRow).toHaveBeenCalledTimes(removed);
    });
  });

  describe('tearing the handle down', () => {
    it('stops answering hover and pointer events after destroy', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      corner?.destroy();
      corner = null;
      mockShowTooltip.mockClear();
      mockHideTooltip.mockClear();

      hitZone.dispatchEvent(new MouseEvent('mouseenter'));
      hitZone.dispatchEvent(new MouseEvent('mouseleave'));
      down(hitZone, gridRight(geo), gridBottom(geo));
      up(hitZone, gridRight(geo), gridBottom(geo));

      expect(mockShowTooltip).not.toHaveBeenCalled();
      expect(mockHideTooltip).not.toHaveBeenCalled();
      expect(options.onAddRow).not.toHaveBeenCalled();
      expect(options.onAddColumn).not.toHaveBeenCalled();
    });

    it('drops the drag listeners when destroyed mid-drag', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);

      const removeSpy = vi.spyOn(hitZone, 'removeEventListener');

      corner?.destroy();
      corner = null;

      const removed = removeSpy.mock.calls.map(([type]) => type);

      expect(removed).toEqual(expect.arrayContaining([
        'mouseenter', 'mouseleave', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
      ]));
    });

    it('clears the page overrides when destroyed mid-drag', () => {
      const geo = geometry();
      const { options, hitZone } = build(geo);

      options.canRemoveLastRow.mockReturnValue(false);
      options.canRemoveLastColumn.mockReturnValue(false);

      down(hitZone, gridRight(geo), gridBottom(geo));
      move(hitZone, gridRight(geo) - 20, gridBottom(geo) - 20);

      expect(document.body.style.cursor).toBe('nwse-resize');

      corner?.destroy();
      corner = null;

      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
    });

    it('leaves the page cursor alone when destroyed without a drag', () => {
      document.body.style.cursor = 'wait';

      const geo = geometry();

      build(geo);
      corner?.destroy();
      corner = null;

      expect(document.body.style.cursor).toBe('wait');
    });
  });
});
