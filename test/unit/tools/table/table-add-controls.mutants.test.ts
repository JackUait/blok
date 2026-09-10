import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { I18n } from '../../../../types/api';
import { TableAddControls } from '../../../../src/tools/table/table-add-controls';
import { simulateMousemove, simulateMouseleave } from '../../../helpers/simulate';

const mockOnHover = vi.fn();
const mockHide = vi.fn();
const mockShow = vi.fn();

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: (...args: unknown[]): void => { mockOnHover(...args); },
  hide: (): void => { mockHide(); },
  show: (...args: unknown[]): void => { mockShow(...args); },
}));

vi.mock('../../../../src/components/modules/toolbar/tooltip', () => ({
  createTooltipContent: (): HTMLElement => document.createElement('div'),
}));

const ADD_ROW_ATTR = 'data-blok-table-add-row';
const ADD_COL_ATTR = 'data-blok-table-add-col';

/** Mirrors PROXIMITY_PX in the source; the reveal boundary is asserted at exactly this distance. */
const PROXIMITY_PX = 40;
/** Mirrors HIDE_DELAY_MS; timers are advanced past it to let a scheduled hide land. */
const HIDE_DELAY_MS = 150;
/** Mirrors DRAG_THRESHOLD; the drag must NOT start at exactly this delta. */
const DRAG_THRESHOLD = 5;

/**
 * Every box below is off-origin, non-square and distinct from every other box.
 * A fixture sitting at the origin with equal rows and columns makes the whole
 * arithmetic of this file unobservable: subtracting the wrapper offset reads the
 * same as adding it, and every edge distance collapses onto the same number.
 */
const GRID_BOX = { left: 100, top: 200, right: 900, bottom: 500 };
const WRAPPER_BOX = { left: 60, top: 170, right: 660, bottom: 600 };
const SCROLL_BOX = { left: 90, top: 190, right: 520, bottom: 570 };
const ZERO_BOX = { left: 0, top: 0, right: 0, bottom: 0 };

const GRID_PIXEL_WIDTH = 800;
/** min(grid.right, scroll.right) - wrapper.left */
const CLAMPED_WIDTH = 460;
/** min(grid.right, wrapper.right) - wrapper.left, i.e. what a wrapper-as-scroller would give. */
const WRAPPER_CLAMPED_WIDTH = 600;
/** grid.bottom - wrapper.top, plus the 4px gap. */
const ROW_BUTTON_TOP = 334;
const GRID_HEIGHT = GRID_BOX.bottom - GRID_BOX.top;

/** Distinct per row/column so a wrong index is a different number, not the same one. */
const ROW_HEIGHTS = [22, 31, 44];
const CELL_WIDTHS = [70, 85, 60];
const LAST_ROW_HEIGHT = 44;
const LAST_CELL_WIDTH = 60;
const NO_ROW_FALLBACK_HEIGHT = 30;
const NO_CELL_FALLBACK_WIDTH = 100;

const POINTER_ID = 7;

const i18nEcho: I18n = { t: (key: string): string => key } as I18n;

interface Box { left: number; top: number; right: number; bottom: number }

interface ControlCallbacks {
  onAddRow: Mock<() => void>;
  onAddColumn: Mock<() => void>;
  onDragStart: Mock<() => void>;
  onDragAddRow: Mock<() => boolean>;
  onDragRemoveRow: Mock<() => boolean>;
  onDragAddCol: Mock<() => boolean>;
  onDragRemoveCol: Mock<() => boolean>;
  onDragEnd: Mock<() => void>;
  getTableSize: Mock<() => { rows: number; cols: number }>;
}

/** Captures the observer callback so a resize can be replayed without layout. */
class FakeResizeObserver implements ResizeObserver {
  public static instances: FakeResizeObserver[] = [];

  public readonly callback: ResizeObserverCallback;
  public readonly observed: Element[] = [];

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.observed.push(target);
  }

  public unobserve(): void {
    // no-op
  }

  public disconnect(): void {
    // no-op
  }
}

const toDomRect = (box: Box): DOMRect => {
  const value = {
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
  };

  return { ...value, toJSON: (): unknown => value };
};

const stubRect = (element: Element, box: Box): Mock<() => DOMRect> => {
  const spy = vi.spyOn(element, 'getBoundingClientRect');

  spy.mockReturnValue(toDomRect(box));

  return spy;
};

const buildGrid = (rowHeights: readonly number[], cellWidths: readonly number[]): HTMLDivElement => {
  const grid = document.createElement('div');

  rowHeights.forEach((height, rowIndex) => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');
    row.textContent = `row-${rowIndex}`;
    Object.defineProperty(row, 'offsetHeight', { value: height, configurable: true });

    cellWidths.forEach((width, cellIndex) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.textContent = `cell-${rowIndex}-${cellIndex}`;
      Object.defineProperty(cell, 'offsetWidth', { value: width, configurable: true });
      row.appendChild(cell);
    });

    grid.appendChild(row);
  });

  return grid;
};

const makeCallbacks = (): ControlCallbacks => ({
  onAddRow: vi.fn(),
  onAddColumn: vi.fn(),
  onDragStart: vi.fn(),
  onDragAddRow: vi.fn((): boolean => true),
  onDragRemoveRow: vi.fn((): boolean => true),
  onDragAddCol: vi.fn((): boolean => true),
  onDragRemoveCol: vi.fn((): boolean => true),
  onDragEnd: vi.fn(),
  getTableSize: vi.fn(() => ({ rows: 3, cols: 3 })),
});

const requireElement = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);

  if (found === null) {
    throw new Error(`fixture is missing ${selector}`);
  }

  return found;
};

const pointerEvent = (type: string, x: number, y: number): PointerEvent =>
  new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: POINTER_ID,
    bubbles: true,
    cancelable: true,
  });

/** jsdom implements neither capture API; both are needed before any pointerdown. */
const stubPointerCapture = (element: HTMLElement): Mock<(pointerId: number) => void> => {
  const capture = vi.fn();

  Object.defineProperty(element, 'setPointerCapture', { value: capture, configurable: true });
  Object.defineProperty(element, 'releasePointerCapture', { value: vi.fn(), configurable: true });

  return capture;
};

const pressKey = (element: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  element.dispatchEvent(event);

  return event;
};

/**
 * jsdom reports an exception thrown inside an event listener to window's
 * `error` event; it never leaves `dispatchEvent`. A bare try/catch therefore
 * cannot see it, and the test would pass while the listener blew up.
 */
const recordWindowErrors = (): (() => string[]) => {
  const messages: string[] = [];
  const listener = (event: ErrorEvent): void => { messages.push(event.message); };

  window.addEventListener('error', listener);

  return (): string[] => {
    window.removeEventListener('error', listener);

    return messages;
  };
};

/** Geometry of an affordance at the moment it is handed to the tooltip. */
interface AffordanceGeometry {
  left: string;
  right: string;
  bottom: string;
}

/**
 * Snapshots each affordance as the tooltip is attached to it. `onHover` fires
 * inside the button factories, before the constructor's geometry sync runs, so
 * this is the only point where the constructed geometry is still readable — the
 * sync overwrites every one of these values immediately afterwards.
 */
const captureAffordancesAtTooltip = (): AffordanceGeometry[] => {
  const seen: AffordanceGeometry[] = [];

  mockOnHover.mockImplementation((...args: unknown[]): void => {
    const btn = args[0] as HTMLElement;

    seen.push({ left: btn.style.left, right: btn.style.right, bottom: btn.style.bottom });
  });

  return seen;
};

describe('TableAddControls — surviving-mutant coverage', () => {
  let created: TableAddControls[] = [];
  let wrapper: HTMLDivElement;
  let grid: HTMLDivElement;
  let scroller: HTMLDivElement;
  let callbacks: ControlCallbacks;

  const build = (options: Partial<{ getNewColumnWidth: () => number }> = {}): TableAddControls => {
    const controls = new TableAddControls({
      wrapper,
      grid,
      i18n: i18nEcho,
      ...callbacks,
      ...options,
    });

    created.push(controls);

    return controls;
  };

  const rowButton = (): HTMLElement => requireElement(wrapper, `[${ADD_ROW_ATTR}]`);
  const colButton = (): HTMLElement => requireElement(wrapper, `[${ADD_COL_ATTR}]`);

  /** Places the cursor at the grid's bottom-right corner, which reveals both buttons. */
  const revealBoth = (): void => {
    simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.bottom });
  };

  const moveAwayFromBothEdges = (): void => {
    simulateMousemove(wrapper, { clientX: GRID_BOX.left + 10, clientY: GRID_BOX.top + 10 });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    FakeResizeObserver.instances = [];
    callbacks = makeCallbacks();
    wrapper = document.createElement('div');
    grid = buildGrid(ROW_HEIGHTS, CELL_WIDTHS);
    scroller = document.createElement('div');
    wrapper.appendChild(grid);
    document.body.appendChild(wrapper);
  });

  afterEach(() => {
    created.forEach((controls) => { controls.destroy(); });
    created = [];
    document.body.innerHTML = '';
    document.body.style.cursor = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('edge proximity', () => {
    it('reveals the add-row affordance at exactly the proximity limit below the grid', () => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      build();

      simulateMousemove(wrapper, {
        clientX: GRID_BOX.left + 200,
        clientY: GRID_BOX.bottom + PROXIMITY_PX,
      });

      expect(rowButton().style.opacity).toBe('1');
    });

    it('measures the column edge from the grid itself when the wrapper is the grid parent', () => {
      // The wrapper is narrower than the grid here. Treating it as a scroll
      // container would move the reveal edge 240px left of the real grid edge.
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.top + 100 });

      expect(colButton().style.opacity).toBe('1');
    });

    it('reveals the add-row affordance when the grid has no parent at all', () => {
      grid.remove();
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.bottom });

      expect(rowButton().style.opacity).toBe('1');
    });

    it('hides the column affordance when the cursor leaves the right edge', () => {
      vi.useFakeTimers();
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.top + 100 });
      expect(colButton().style.opacity).toBe('1');

      simulateMousemove(wrapper, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.top + 100 });
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(colButton().style.opacity).toBe('0');
    });
  });

  describe('document-level proximity box', () => {
    beforeEach(() => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
    });

    it('reveals the row affordance at the left edge of the proximity box', () => {
      build();

      simulateMousemove(document.body, {
        clientX: GRID_BOX.left - PROXIMITY_PX,
        clientY: GRID_BOX.bottom,
      });

      expect(rowButton().style.opacity).toBe('1');
    });

    it('reveals the column affordance at the top edge of the proximity box', () => {
      build();

      simulateMousemove(document.body, {
        clientX: GRID_BOX.right,
        clientY: GRID_BOX.top - PROXIMITY_PX,
      });

      expect(colButton().style.opacity).toBe('1');
    });

    it('reveals both affordances at the right edge of the proximity box', () => {
      build();

      simulateMousemove(document.body, {
        clientX: GRID_BOX.right + PROXIMITY_PX,
        clientY: GRID_BOX.bottom,
      });

      expect(colButton().style.opacity).toBe('1');
      expect(rowButton().style.opacity).toBe('1');
    });

    it('reveals the column affordance at the bottom edge of the proximity box', () => {
      build();

      simulateMousemove(document.body, {
        clientX: GRID_BOX.right,
        clientY: GRID_BOX.bottom + PROXIMITY_PX,
      });

      expect(colButton().style.opacity).toBe('1');
    });

    it('ignores a cursor left of the proximity box even when level with the bottom edge', () => {
      build();

      simulateMousemove(document.body, { clientX: GRID_BOX.left - 200, clientY: GRID_BOX.bottom });

      expect(rowButton().style.opacity).toBe('0');
    });

    it('ignores a cursor right of the proximity box even when level with the bottom edge', () => {
      build();

      simulateMousemove(document.body, { clientX: GRID_BOX.right + 200, clientY: GRID_BOX.bottom });

      expect(rowButton().style.opacity).toBe('0');
    });

    it('ignores a cursor above the proximity box even when level with the right edge', () => {
      build();

      simulateMousemove(document.body, { clientX: GRID_BOX.right, clientY: GRID_BOX.top - 200 });

      expect(colButton().style.opacity).toBe('0');
    });

    it('ignores a cursor below the proximity box even when level with the right edge', () => {
      build();

      simulateMousemove(document.body, { clientX: GRID_BOX.right, clientY: GRID_BOX.bottom + 200 });

      expect(colButton().style.opacity).toBe('0');
    });

    it('leaves a move whose target is inside the wrapper to the wrapper handler alone', () => {
      // The point is level with the bottom edge (so the wrapper handler reveals
      // the row) but far outside the proximity box in X. If the document handler
      // also ran, it would immediately schedule the hide it just revealed.
      vi.useFakeTimers();
      build();

      simulateMousemove(grid, { clientX: GRID_BOX.left - 1000, clientY: GRID_BOX.bottom });
      expect(rowButton().style.opacity).toBe('1');

      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(rowButton().style.opacity).toBe('1');
    });

    it('hides the column affordance when a document-level move goes far from the grid', () => {
      vi.useFakeTimers();
      build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.top + 100 });
      expect(colButton().style.opacity).toBe('1');

      simulateMousemove(document.body, { clientX: GRID_BOX.right + 900, clientY: GRID_BOX.bottom + 900 });
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(colButton().style.opacity).toBe('0');
    });
  });

  describe('pixel-mode width sync', () => {
    it('uses the grid pixel width when the grid is a direct child of the wrapper', () => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      const controls = build();

      controls.syncRowButtonWidth();

      expect(rowButton().style.width).toBe(`${GRID_PIXEL_WIDTH}px`);
      expect(rowButton().style.width).not.toBe(`${WRAPPER_CLAMPED_WIDTH}px`);
    });

    it('clamps the add-row button to the visible right edge of the scroll container', () => {
      grid.remove();
      scroller.appendChild(grid);
      wrapper.appendChild(scroller);
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      stubRect(scroller, SCROLL_BOX);
      // Deliberately different from the rect-derived width, so falling back to
      // clientWidth is a different number rather than the same one.
      Object.defineProperty(scroller, 'clientWidth', { value: 333, configurable: true });
      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      const controls = build();

      controls.syncRowButtonWidth();

      expect(rowButton().style.width).toBe(`${CLAMPED_WIDTH}px`);
      expect(colButton().style.left).toBe(`${CLAMPED_WIDTH + 4}px`);
    });

    it('keeps the full grid width when the scroll container reports no layout', () => {
      grid.remove();
      scroller.appendChild(grid);
      wrapper.appendChild(scroller);
      Object.defineProperty(scroller, 'clientWidth', { value: 0, configurable: true });
      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      const controls = build();

      controls.syncRowButtonWidth();

      expect(rowButton().style.width).toBe(`${GRID_PIXEL_WIDTH}px`);
    });

    it('keeps the full grid width when the grid has been detached from the wrapper', () => {
      // No parent at all: there is no scroll container to clamp against, so the
      // grid width must pass through untouched.
      grid.remove();
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      const controls = build();

      controls.syncRowButtonWidth();

      expect(rowButton().style.width).toBe(`${GRID_PIXEL_WIDTH}px`);
    });

    it('treats a percentage grid width as auto-size mode', () => {
      grid.style.width = '50%';
      const controls = build();

      controls.syncRowButtonWidth();

      expect(rowButton().style.width).toBe('');
    });

    it('clears the pixel-mode width and column offset when the grid switches to a percentage', () => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      const controls = build();

      controls.syncRowButtonWidth();
      expect(rowButton().style.width).toBe(`${GRID_PIXEL_WIDTH}px`);

      grid.style.width = '';
      controls.syncRowButtonWidth();

      expect(rowButton().style.width).toBe('');
      expect(colButton().style.left).toBe('');
    });

    it('clears the percent-mode column offset when the grid switches to a pixel width', () => {
      const controls = build();

      controls.syncRowButtonWidth();
      expect(colButton().style.right).toBe('-36px');

      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      controls.syncRowButtonWidth();

      expect(colButton().style.right).toBe('');
    });
  });

  describe('vertical pinning to the grid rect', () => {
    it('pins the column button to the grid height and the row button below the grid', () => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      const controls = build();

      controls.syncRowButtonWidth();

      expect(colButton().style.height).toBe(`${GRID_HEIGHT}px`);
      expect(colButton().style.bottom).toBe('');
      expect(rowButton().style.top).toBe(`${ROW_BUTTON_TOP}px`);
      expect(rowButton().style.bottom).toBe('');
    });

    it('restores the pre-layout fallback when the grid stops reporting a height', () => {
      const gridRect = stubRect(grid, GRID_BOX);
      const wrapperRect = stubRect(wrapper, WRAPPER_BOX);
      const controls = build();

      controls.syncRowButtonWidth();
      expect(colButton().style.height).toBe(`${GRID_HEIGHT}px`);

      gridRect.mockReturnValue(toDomRect(ZERO_BOX));
      wrapperRect.mockReturnValue(toDomRect(ZERO_BOX));
      controls.syncRowButtonWidth();

      expect(colButton().style.height).toBe('');
      expect(colButton().style.bottom).toBe('0px');
      expect(rowButton().style.top).toBe('');
      expect(rowButton().style.bottom).toBe('-36px');
    });
  });

  describe('drag unit size', () => {
    const dragBy = (button: HTMLElement, axis: 'x' | 'y', distance: number): void => {
      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent(
        'pointermove',
        axis === 'x' ? distance : 0,
        axis === 'y' ? distance : 0
      ));
    };

    it('uses the last row height as the row drag unit', () => {
      build();

      dragBy(rowButton(), 'y', LAST_ROW_HEIGHT * 2);

      expect(callbacks.onDragAddRow).toHaveBeenCalledTimes(2);
    });

    it('falls back to a 30px row unit when the grid has no rows', () => {
      grid.replaceChildren();
      build();

      dragBy(rowButton(), 'y', NO_ROW_FALLBACK_HEIGHT * 2);

      expect(callbacks.onDragAddRow).toHaveBeenCalledTimes(2);
    });

    it('uses the last cell width as the column drag unit', () => {
      build();

      dragBy(colButton(), 'x', LAST_CELL_WIDTH);

      expect(callbacks.onDragAddCol).toHaveBeenCalledTimes(1);
    });

    it('falls back to a 100px column unit when the grid has no rows', () => {
      grid.replaceChildren();
      build();

      dragBy(colButton(), 'x', NO_CELL_FALLBACK_WIDTH);

      expect(callbacks.onDragAddCol).toHaveBeenCalledTimes(1);
    });

    it('falls back to a 100px column unit when the first row has no cells', () => {
      grid.replaceChildren();
      const emptyRow = document.createElement('div');

      emptyRow.setAttribute('data-blok-table-row', '');
      grid.appendChild(emptyRow);
      build();

      dragBy(colButton(), 'x', NO_CELL_FALLBACK_WIDTH);

      expect(callbacks.onDragAddCol).toHaveBeenCalledTimes(1);
    });

    it('prefers the explicit new-column width over the measured cell width', () => {
      build({ getNewColumnWidth: (): number => 25 });

      dragBy(colButton(), 'x', 75);

      expect(callbacks.onDragAddCol).toHaveBeenCalledTimes(3);
    });
  });

  describe('drag add and remove loops', () => {
    const startRowDrag = (): HTMLElement => {
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));

      return button;
    };

    beforeEach(() => {
      grid.replaceChildren();
    });

    it('stops adding rows as soon as the add is refused', () => {
      callbacks.onDragAddRow
        .mockImplementationOnce((): boolean => true)
        .mockImplementation((): boolean => false);
      build();

      const button = startRowDrag();

      button.dispatchEvent(pointerEvent('pointermove', 0, NO_ROW_FALLBACK_HEIGHT * 3));

      expect(callbacks.onDragAddRow).toHaveBeenCalledTimes(2);
    });

    it('stops removing rows as soon as the remove is refused', () => {
      callbacks.onDragRemoveRow
        .mockImplementationOnce((): boolean => true)
        .mockImplementation((): boolean => false);
      build();

      const button = startRowDrag();

      button.dispatchEvent(pointerEvent('pointermove', 0, NO_ROW_FALLBACK_HEIGHT * 3));
      expect(callbacks.onDragAddRow).toHaveBeenCalledTimes(3);

      button.dispatchEvent(pointerEvent('pointermove', 0, 0));

      expect(callbacks.onDragRemoveRow).toHaveBeenCalledTimes(2);
    });

    it('does not start a drag at exactly the threshold distance', () => {
      build();

      const button = startRowDrag();

      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD));

      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('sets a row-resize body cursor for a row drag', () => {
      build();

      const button = startRowDrag();

      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD + 15));

      expect(document.body.style.cursor).toBe('row-resize');
    });

    it('sets a col-resize body cursor for a column drag', () => {
      build();
      const button = colButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', DRAG_THRESHOLD + 15, 0));

      expect(document.body.style.cursor).toBe('col-resize');
    });

    it('prevents the default action of the pointerdown that starts a drag', () => {
      build();
      const button = rowButton();

      stubPointerCapture(button);
      const event = pointerEvent('pointerdown', 0, 0);

      button.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('captures the pointer on the button that starts the drag', () => {
      build();
      const button = rowButton();
      const capture = stubPointerCapture(button);

      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));

      expect(capture).toHaveBeenCalledWith(POINTER_ID);
    });
  });

  describe('dimension tooltip', () => {
    beforeEach(() => {
      grid.replaceChildren();
    });

    it('does not show a dimension tooltip before the drag threshold', () => {
      build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD - 3));

      expect(mockShow).not.toHaveBeenCalled();
    });

    it('refreshes the dimension tooltip on every move once the drag has started', () => {
      // The move handler carries two identical didDrag guards, so a post-threshold
      // move refreshes twice. Pinning the count catches either guard being dropped.
      build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD + 15));
      expect(mockShow).toHaveBeenCalledTimes(1);

      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD + 20));

      expect(mockShow).toHaveBeenCalledTimes(3);
    });

    it('anchors the column dimension tooltip without a top margin', () => {
      build();
      const button = colButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', DRAG_THRESHOLD + 15, 0));

      expect(mockShow.mock.calls[0][2]).toStrictEqual({ placement: 'bottom' });
    });

    it('anchors the row dimension tooltip above the row button', () => {
      build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD + 15));

      expect(mockShow.mock.calls[0][2]).toStrictEqual({ placement: 'bottom', marginTop: -16 });
    });
  });

  describe('pointer release cleanup', () => {
    beforeEach(() => {
      grid.replaceChildren();
    });

    it('detaches the drag listeners from the row button on pointer up', () => {
      build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD + 15));
      const removals = vi.spyOn(button, 'removeEventListener');

      button.dispatchEvent(pointerEvent('pointerup', 0, DRAG_THRESHOLD + 15));

      expect(removals).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    it('detaches the drag listeners from the row button on pointer cancel', () => {
      build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      const removals = vi.spyOn(button, 'removeEventListener');

      button.dispatchEvent(pointerEvent('pointercancel', 0, 0));

      expect(removals).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    it('detaches the drag listeners from the column button on pointer cancel', () => {
      build();
      const button = colButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      const removals = vi.spyOn(button, 'removeEventListener');

      button.dispatchEvent(pointerEvent('pointercancel', 0, 0));

      expect(removals).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    it('does not commit a drag that was cancelled before it started', () => {
      build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointercancel', 0, 0));

      expect(callbacks.onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
    });

    it('stops responding to wrapper mouse moves', () => {
      const controls = build();
      const button = rowButton();

      controls.destroy();
      simulateMousemove(wrapper, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.bottom });

      expect(button.style.opacity).toBe('0');
    });

    it('stops responding to a wrapper mouse leave', () => {
      vi.useFakeTimers();
      const controls = build();
      const button = rowButton();

      simulateMousemove(wrapper, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.bottom });
      expect(button.style.opacity).toBe('1');

      controls.destroy();
      simulateMouseleave(wrapper);
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(button.style.opacity).toBe('1');
    });

    it('stops responding to document mouse moves', () => {
      const controls = build();
      const button = rowButton();

      controls.destroy();
      simulateMousemove(document.body, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.bottom });

      expect(button.style.opacity).toBe('0');
    });

    it('cancels the pending hide timers for both buttons', () => {
      vi.useFakeTimers();
      const controls = build();
      const row = rowButton();
      const col = colButton();

      revealBoth();
      moveAwayFromBothEdges();
      controls.destroy();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(row.style.opacity).toBe('1');
      expect(col.style.opacity).toBe('1');
    });

    it('releases the row drag listeners and the body cursor when destroyed mid-drag', () => {
      const controls = build();
      const button = rowButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', 0, DRAG_THRESHOLD + 15));
      expect(document.body.style.cursor).toBe('row-resize');

      const removals = vi.spyOn(button, 'removeEventListener');

      controls.destroy();

      expect(document.body.style.cursor).toBe('');
      expect(removals).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });

    it('releases the column drag listeners when destroyed mid-drag', () => {
      const controls = build();
      const button = colButton();

      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      button.dispatchEvent(pointerEvent('pointermove', DRAG_THRESHOLD + 15, 0));
      const removals = vi.spyOn(button, 'removeEventListener');

      controls.destroy();

      expect(removals).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removals).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    });
  });

  describe('interactivity', () => {
    beforeEach(() => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
    });

    it('blocks pointer events on both revealed buttons when interactivity is switched off', () => {
      const controls = build();

      revealBoth();
      expect(rowButton().style.pointerEvents).toBe('');

      controls.setInteractive(false);

      expect(rowButton().style.pointerEvents).toBe('none');
      expect(colButton().style.pointerEvents).toBe('none');
    });

    it('restores pointer events only on the revealed row button', () => {
      const controls = build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.bottom });
      controls.setInteractive(false);
      controls.setInteractive(true);

      expect(rowButton().style.pointerEvents).toBe('');
      expect(colButton().style.pointerEvents).toBe('none');
    });

    it('restores pointer events only on the revealed column button', () => {
      const controls = build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.top + 100 });
      controls.setInteractive(false);
      controls.setInteractive(true);

      expect(colButton().style.pointerEvents).toBe('');
      expect(rowButton().style.pointerEvents).toBe('none');
    });

    it('reveals interactive buttons by default', () => {
      build();

      revealBoth();

      expect(rowButton().style.pointerEvents).toBe('');
      expect(colButton().style.pointerEvents).toBe('');
    });

    it('reveals inert buttons while interactivity is off', () => {
      const controls = build();

      controls.setInteractive(false);
      revealBoth();

      expect(rowButton().style.pointerEvents).toBe('none');
      expect(colButton().style.pointerEvents).toBe('none');
    });
  });

  describe('reveal and hide state machine', () => {
    beforeEach(() => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
    });

    it('does not repaint a button that is already revealed', () => {
      build();

      revealBoth();
      rowButton().style.opacity = '0.42';
      colButton().style.opacity = '0.42';
      revealBoth();

      expect(rowButton().style.opacity).toBe('0.42');
      expect(colButton().style.opacity).toBe('0.42');
    });

    it('makes a hidden button inert again', () => {
      vi.useFakeTimers();
      build();

      revealBoth();
      moveAwayFromBothEdges();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(rowButton().style.pointerEvents).toBe('none');
      expect(colButton().style.pointerEvents).toBe('none');
    });

    it('re-reveals a button that has already been hidden once', () => {
      vi.useFakeTimers();
      build();

      revealBoth();
      moveAwayFromBothEdges();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);
      expect(rowButton().style.opacity).toBe('0');

      revealBoth();

      expect(rowButton().style.opacity).toBe('1');
      expect(colButton().style.opacity).toBe('1');
    });

    it('cancels a pending column hide when the cursor comes back', () => {
      vi.useFakeTimers();
      build();

      simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.top + 100 });
      simulateMousemove(wrapper, { clientX: GRID_BOX.left + 200, clientY: GRID_BOX.top + 100 });
      vi.advanceTimersByTime(HIDE_DELAY_MS - 50);
      simulateMousemove(wrapper, { clientX: GRID_BOX.right, clientY: GRID_BOX.top + 100 });
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(colButton().style.opacity).toBe('1');
    });

    it('schedules no hide timer while both buttons are already hidden', () => {
      vi.useFakeTimers();
      build();

      simulateMouseleave(wrapper);

      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not stack hide timers when the cursor lingers away from the edges', () => {
      // A second schedule while one is pending must be refused. Otherwise the
      // first timer is orphaned, survives the "cursor came back" reset, and
      // hides a button the cursor is sitting on.
      vi.useFakeTimers();
      build();

      revealBoth();
      moveAwayFromBothEdges();
      vi.advanceTimersByTime(HIDE_DELAY_MS - 50);
      moveAwayFromBothEdges();
      revealBoth();
      vi.advanceTimersByTime(HIDE_DELAY_MS * 2);

      expect(rowButton().style.opacity).toBe('1');
      expect(colButton().style.opacity).toBe('1');
    });

    it('keeps the row affordance visible for the whole of a row drag', () => {
      vi.useFakeTimers();
      build();
      const button = rowButton();

      revealBoth();
      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      moveAwayFromBothEdges();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(button.style.opacity).toBe('1');
    });

    it('keeps the column affordance visible for the whole of a column drag', () => {
      vi.useFakeTimers();
      build();
      const button = colButton();

      revealBoth();
      stubPointerCapture(button);
      button.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      moveAwayFromBothEdges();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(button.style.opacity).toBe('1');
    });
  });

  describe('keyboard affordance', () => {
    it('adds a row when Enter is pressed on the add-row affordance', () => {
      build();

      pressKey(rowButton(), 'Enter');

      expect(callbacks.onAddRow).toHaveBeenCalledTimes(1);
      expect(callbacks.onAddColumn).not.toHaveBeenCalled();
    });

    it('adds a column when Space is pressed on the add-column affordance', () => {
      build();

      pressKey(colButton(), ' ');

      expect(callbacks.onAddColumn).toHaveBeenCalledTimes(1);
      expect(callbacks.onAddRow).not.toHaveBeenCalled();
    });

    it('ignores any other key on the affordance', () => {
      build();

      const event = pressKey(rowButton(), 'a');

      expect(callbacks.onAddRow).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('swallows the key so the surrounding contenteditable never sees it', () => {
      build();
      const bubbled = vi.fn();

      wrapper.addEventListener('keydown', bubbled);

      const event = pressKey(rowButton(), 'Enter');

      expect(event.defaultPrevented).toBe(true);
      expect(bubbled).not.toHaveBeenCalled();
    });

    it('still swallows the key while interactivity is off, without adding anything', () => {
      const controls = build();

      controls.setInteractive(false);

      const event = pressKey(rowButton(), 'Enter');

      expect(callbacks.onAddRow).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('labels each affordance for assistive tech', () => {
      build();

      expect(rowButton().getAttribute('role')).toBe('button');
      expect(rowButton().getAttribute('tabindex')).toBe('0');
      expect(rowButton().getAttribute('aria-label')).toBe('tools.table.clickToAddRow');
      expect(colButton().getAttribute('aria-label')).toBe('tools.table.clickToAddColumn');
    });

    it('reveals the matching affordance when it takes focus', () => {
      build();

      rowButton().focus();
      expect(rowButton().style.opacity).toBe('1');
      expect(colButton().style.opacity).toBe('0');

      colButton().focus();
      expect(colButton().style.opacity).toBe('1');
    });

    it('schedules a hide for the matching affordance when it loses focus', () => {
      vi.useFakeTimers();
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      build();

      revealBoth();
      colButton().focus();
      colButton().blur();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(colButton().style.opacity).toBe('0');
      expect(rowButton().style.opacity).toBe('1');
    });

    it('schedules a hide for the row affordance when it loses focus', () => {
      vi.useFakeTimers();
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      build();

      revealBoth();
      rowButton().focus();
      rowButton().blur();
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      expect(rowButton().style.opacity).toBe('0');
      expect(colButton().style.opacity).toBe('1');
    });
  });

  describe('button chrome', () => {
    it('gives the row button the hover-group and top-aligned hit area classes', () => {
      build();

      expect(rowButton().classList.contains('group/add')).toBe(true);
      expect(rowButton().classList.contains('items-start')).toBe(true);
    });

    it('gives the column button the hover-group and start-aligned hit area classes', () => {
      build();

      expect(colButton().classList.contains('group/add')).toBe(true);
      expect(colButton().classList.contains('justify-start')).toBe(true);
    });

    it('marks both buttons with an empty locator attribute', () => {
      build();

      expect(rowButton().getAttribute(ADD_ROW_ATTR)).toBe('');
      expect(colButton().getAttribute(ADD_COL_ATTR)).toBe('');
    });

    it('starts both buttons inert and absolutely positioned', () => {
      build();

      expect(rowButton().style.pointerEvents).toBe('none');
      expect(rowButton().style.position).toBe('absolute');
      expect(colButton().style.pointerEvents).toBe('none');
    });

    it('leaves no transform on the row button after a pixel-mode sync', () => {
      stubRect(grid, GRID_BOX);
      stubRect(wrapper, WRAPPER_BOX);
      grid.style.width = `${GRID_PIXEL_WIDTH}px`;
      const controls = build();

      controls.syncRowButtonWidth();

      expect(rowButton().style.transform).toBe('');
    });

    it('stretches the row visual across the width and the column visual down the height', () => {
      build();

      const rowVisual = requireElement(rowButton(), 'div');
      const colVisual = requireElement(colButton(), 'div');

      expect(rowVisual.style.width).toBe('100%');
      expect(rowVisual.style.height).toBe('16px');
      expect(colVisual.style.width).toBe('16px');
      expect(colVisual.style.height).toBe('100%');
    });

    it('rescales the plus icon to the control size', () => {
      build();

      const svg = rowButton().querySelector('svg');

      if (svg === null) {
        throw new Error('plus icon missing');
      }

      expect(svg.getAttribute('width')).toBe('12');
      expect(svg.getAttribute('height')).toBe('12');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.classList.contains('text-gray-500')).toBe(true);
    });
  });

  describe('scroll container', () => {
    beforeEach(() => {
      grid.remove();
      scroller.appendChild(grid);
      wrapper.appendChild(scroller);
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    it('re-syncs the button geometry when the scroll container scrolls', () => {
      const controls = build();

      controls.attachScrollContainer(scroller);
      const sync = vi.spyOn(controls, 'syncRowButtonWidth');

      scroller.dispatchEvent(new Event('scroll'));

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('stops listening to the previous scroll container when a new one is attached', () => {
      const other = document.createElement('div');

      wrapper.appendChild(other);
      const controls = build();

      controls.attachScrollContainer(scroller);
      controls.attachScrollContainer(other);
      const sync = vi.spyOn(controls, 'syncRowButtonWidth');

      scroller.dispatchEvent(new Event('scroll'));

      expect(sync).not.toHaveBeenCalled();
    });

    it('re-syncs the button geometry when the scroll container is resized', () => {
      const controls = build();

      controls.attachScrollContainer(scroller);
      const observer = FakeResizeObserver.instances[0];

      expect(observer.observed[0]).toBe(scroller);

      const sync = vi.spyOn(controls, 'syncRowButtonWidth');

      observer.callback([], observer);

      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('registers the scroll listener as passive', () => {
      const controls = build();
      const listen = vi.spyOn(scroller, 'addEventListener');

      controls.attachScrollContainer(scroller);

      expect(listen).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    });

    it('stops re-syncing on scroll after destroy', () => {
      const controls = build();

      controls.attachScrollContainer(scroller);
      controls.destroy();
      const sync = vi.spyOn(controls, 'syncRowButtonWidth');

      scroller.dispatchEvent(new Event('scroll'));

      expect(sync).not.toHaveBeenCalled();
    });
  });

  describe('drag listener lifetime', () => {
    /**
     * Ends a drag on the column button while leaving the row button's handlers
     * attached: both pointerdowns register the SAME bound handlers, and the
     * column button's pointerup only detaches its own. The row button is then
     * listening for a drag that no longer exists.
     */
    const strandRowDragListeners = (): HTMLElement => {
      const row = rowButton();
      const col = colButton();

      stubPointerCapture(row);
      stubPointerCapture(col);
      row.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      col.dispatchEvent(pointerEvent('pointerdown', 0, 0));
      col.dispatchEvent(pointerEvent('pointerup', 0, 0));

      return row;
    };

    it('ignores a pointer move that arrives after its drag state is gone', () => {
      const errors = recordWindowErrors();

      build();
      const stale = strandRowDragListeners();

      stale.dispatchEvent(pointerEvent('pointermove', 0, 90));

      expect(errors()).toStrictEqual([]);
    });

    it('ignores a pointer up that arrives after its drag state is gone', () => {
      const errors = recordWindowErrors();

      build();
      const stale = strandRowDragListeners();

      stale.dispatchEvent(pointerEvent('pointerup', 0, 90));

      expect(errors()).toStrictEqual([]);
    });

    it('ignores a pointer cancel that arrives after its drag state is gone', () => {
      const errors = recordWindowErrors();

      build();
      const stale = strandRowDragListeners();

      stale.dispatchEvent(pointerEvent('pointercancel', 0, 0));

      expect(errors()).toStrictEqual([]);
    });

    it('leaves the drag callbacks alone when no drag is in flight', () => {
      const errors = recordWindowErrors();

      build();
      const stale = strandRowDragListeners();

      stale.dispatchEvent(pointerEvent('pointerup', 0, 90));

      expect({ errors: errors(), dragEnd: callbacks.onDragEnd.mock.calls.length })
        .toStrictEqual({ errors: [], dragEnd: 0 });
    });
  });

  describe('dimension tooltip without a drag', () => {
    it('does nothing when asked for the table size with no drag in flight', () => {
      const controls = build();
      const internals = controls as unknown as { showDimensionTooltip: () => void };

      expect(() => { internals.showDimensionTooltip(); }).not.toThrow();
    });

    it('asks for no table size when it has no drag to describe', () => {
      const controls = build();
      const internals = controls as unknown as { showDimensionTooltip: () => void };

      internals.showDimensionTooltip();

      expect(callbacks.getTableSize).not.toHaveBeenCalled();
    });
  });

  describe('constructed affordance geometry', () => {
    it('hands the add-row affordance to the tooltip at the grid left edge', () => {
      const seen = captureAffordancesAtTooltip();

      build();

      // cssstyle serialises the source's `'0'` back as `'0px'`.
      expect(seen[0].left).toBe('0px');
    });

    it('hands the add-row affordance to the tooltip hanging 36px below the grid', () => {
      const seen = captureAffordancesAtTooltip();

      build();

      expect(seen[0].bottom).toBe('-36px');
    });

    it('hands the add-column affordance to the tooltip 36px right of the grid', () => {
      const seen = captureAffordancesAtTooltip();

      build();

      expect(seen[1].right).toBe('-36px');
    });

    it('hands the add-column affordance to the tooltip flush with the grid top', () => {
      const seen = captureAffordancesAtTooltip();

      build();

      expect(seen[1].bottom).toBe('0px');
    });
  });
});
