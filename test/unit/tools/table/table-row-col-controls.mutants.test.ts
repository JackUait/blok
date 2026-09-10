import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GRIP_DRAG_DISABLED_ATTR, TableRowColControls } from '../../../../src/tools/table/table-row-col-controls';
import type { TableRowColControlsOptions } from '../../../../src/tools/table/table-row-col-controls';

const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const GRIP_VISIBLE_ATTR = 'data-blok-table-grip-visible';
const HIDE_DELAY_MS = 150;
/** GRIP_HOVER_SIZE from table-grip-visuals. */
const HOVER_SIZE_PX = '16px';
/** COL_PILL_HEIGHT / ROW_PILL_WIDTH (4) plus the 12px hit-area padding. */
const IDLE_PILL_PX = '16px';
const CELL_WIDTH = 100;

const mockI18n = {
  t: vi.fn((key: string) => key),
  has: vi.fn(() => false),
  getEnglishTranslation: vi.fn((key: string) => key),
  getLocale: vi.fn(() => 'en'),
};

/**
 * Grid whose cells report a fixed offsetWidth, so getCumulativeColEdges()
 * returns real non-zero edges — arithmetic on them is then observable.
 */
const createGrid = (rows: number, cols: number): HTMLElement => {
  const grid = document.createElement('div');

  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');

    row.setAttribute(ROW_ATTR, '');
    Object.defineProperty(row, 'offsetTop', { value: r * 40, configurable: true });
    Object.defineProperty(row, 'offsetHeight', { value: 40, configurable: true });

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, String(c));
      cell.setAttribute(CELL_ROW_ATTR, String(r));
      Object.defineProperty(cell, 'offsetWidth', { value: CELL_WIDTH, configurable: true });
      row.appendChild(cell);
    }

    grid.appendChild(row);
  }

  document.body.appendChild(grid);

  return grid;
};

const getCell = (grid: HTMLElement, row: number, col: number): HTMLElement => {
  const cell = grid.querySelector<HTMLElement>(
    `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
  );

  if (cell === null) {
    throw new Error(`No cell at ${row},${col}`);
  }

  return cell;
};

const gripsIn = (host: HTMLElement, attr: string): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>(`[${attr}]`));

const baseOptions = (grid: HTMLElement, rows: number, cols: number): TableRowColControlsOptions => ({
  grid,
  getColumnCount: () => cols,
  getRowCount: () => rows,
  isHeadingRow: () => false,
  isHeadingColumn: () => false,
  onAction: vi.fn(),
  onClearContents: vi.fn(),
  onColorChange: vi.fn(),
  i18n: mockI18n,
});

const mouseOver = (element: HTMLElement): void => {
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
};

const pressKey = (element: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  element.dispatchEvent(event);

  return event;
};

describe('TableRowColControls — geometry and grip state', () => {
  let grid: HTMLElement;
  let controls: TableRowColControls | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    controls?.destroy();
    controls = undefined;
    grid?.remove();
    document.querySelectorAll('[data-blok-table-scroller]').forEach(el => el.remove());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('column grip anchoring', () => {
    it('centres each column grip between its own two column edges', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls(baseOptions(grid, 2, 3));

      const colGrips = gripsIn(grid, GRIP_COL_ATTR);

      // Edges are 0/100/200/300, so centres are 50/150/250. Any arithmetic
      // change (sum→difference, ÷2→×2, edge index shift) moves the grip off
      // its column and the insert/delete it opens lands on the wrong one.
      expect(colGrips.map(g => g.style.left)).toEqual(['50px', '150px', '250px']);
      expect(colGrips.map(g => g.style.top)).toEqual(['-0.5px', '-0.5px', '-0.5px']);
    });

    it('leaves a grip unpositioned when its column no longer has edges', () => {
      grid = createGrid(2, 3);
      // Column count still claims 4 while the DOM already dropped to 3.
      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 3),
        getColumnCount: () => 4,
      });

      const colGrips = gripsIn(grid, GRIP_COL_ATTR);

      expect(colGrips).toHaveLength(4);
      // The surplus grip must be skipped entirely, not anchored to a NaN edge.
      expect(colGrips[3].style.top).toBe('');
      expect(colGrips[3].style.left).toBe('');
      expect(colGrips[2].style.left).toBe('250px');
    });
  });

  describe('row grip anchoring', () => {
    it('skips a row grip whose row has been removed from the DOM', () => {
      grid = createGrid(2, 2);

      // Row count claims 3 rows; the DOM has 2. Reading rows[2] would throw.
      expect(() => {
        controls = new TableRowColControls({
          ...baseOptions(grid, 2, 2),
          getRowCount: () => 3,
        });
      }).not.toThrow();

      const rowGrips = gripsIn(grid, GRIP_ROW_ATTR);

      expect(rowGrips).toHaveLength(3);
      expect(rowGrips[2].style.top).toBe('');
      expect(rowGrips[1].style.top).toBe('60px');
    });
  });

  describe('horizontally scrolled tables', () => {
    const createScrolled = (scrollLeft: number): { overlay: HTMLElement; scroller: HTMLElement } => {
      const scroller = document.createElement('div');
      const overlay = document.createElement('div');

      scroller.setAttribute('data-blok-table-scroller', '');
      Object.defineProperty(scroller, 'scrollLeft', { value: scrollLeft, writable: true, configurable: true });
      Object.defineProperty(scroller, 'clientWidth', { value: 100, configurable: true });
      scroller.appendChild(grid);
      scroller.appendChild(overlay);
      document.body.appendChild(scroller);

      return { overlay, scroller };
    };

    it('offsets grips by the scroll position and hides the ones scrolled out of view', () => {
      grid = createGrid(2, 3);

      const { overlay } = createScrolled(50);

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 3),
        overlay,
        scrollContainer: overlay.parentElement ?? undefined,
      });

      const colGrips = gripsIn(overlay, GRIP_COL_ATTR);

      // Centres 50/150/250 minus scrollLeft 50 → 0/100/200.
      expect(colGrips.map(g => g.style.left)).toEqual(['0px', '100px', '200px']);
      // Visible range is [0, clientWidth] inclusive: only the third is out.
      expect(colGrips.map(g => g.style.visibility)).toEqual(['', '', 'hidden']);
    });

    it('repositions grips when the scroll container scrolls', () => {
      grid = createGrid(2, 3);

      const { overlay, scroller } = createScrolled(0);

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 3),
        overlay,
        scrollContainer: scroller,
      });

      const colGrips = gripsIn(overlay, GRIP_COL_ATTR);

      expect(colGrips.map(g => g.style.left)).toEqual(['50px', '150px', '250px']);

      Object.defineProperty(scroller, 'scrollLeft', { value: 150, writable: true, configurable: true });
      scroller.dispatchEvent(new Event('scroll'));

      // Without the scroll listener the grips stay behind the table body.
      expect(colGrips.map(g => g.style.left)).toEqual(['-100px', '0px', '100px']);
      expect(colGrips[0].style.visibility).toBe('hidden');
    });
  });

  describe('restoreVisibleGrips index guards', () => {
    it('restores index 0, which a "> 0" guard would silently drop', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.restoreVisibleGrips(0, 0);

      expect(gripsIn(grid, GRIP_COL_ATTR)[0].hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(gripsIn(grid, GRIP_ROW_ATTR)[0].hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });

    it('ignores negative indices instead of indexing past the start of the grip list', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(() => controls?.restoreVisibleGrips(-1, -1)).not.toThrow();
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('reports a column-only restore with the row index left at -1', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.restoreVisibleGrips(0, -1);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: -1 });
    });

    it('reports a row-only restore with the column index left at -1', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.restoreVisibleGrips(-1, 0);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: -1, row: 0 });
    });

    it('reports no visible grips after hideAllGrips resets both indices', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.restoreVisibleGrips(1, 1);
      controls.hideAllGrips();

      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('hideAllGrips is safe when no grip is showing', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(() => controls?.hideAllGrips()).not.toThrow();
    });
  });

  describe('keyboard activation of a grip', () => {
    const setup = (): { onGripClick: ReturnType<typeof vi.fn>; bubbled: ReturnType<typeof vi.fn> } => {
      grid = createGrid(2, 2);

      const onGripClick = vi.fn();
      const bubbled = vi.fn();

      controls = new TableRowColControls({ ...baseOptions(grid, 2, 2), onGripClick });
      grid.addEventListener('keydown', bubbled);

      return { onGripClick, bubbled };
    };

    it('opens the menu for the grip the key was pressed on and swallows the key', () => {
      const { onGripClick, bubbled } = setup();

      expect(controls?.isPopoverOpen).toBe(false);

      const event = pressKey(gripsIn(grid, GRIP_COL_ATTR)[1], 'Enter');

      expect(controls?.isPopoverOpen).toBe(true);
      expect(onGripClick).toHaveBeenCalledWith('col', 1);
      expect(event.defaultPrevented).toBe(true);
      // The grip lives in the block's contenteditable: an escaping Enter splits it.
      expect(bubbled).not.toHaveBeenCalled();
    });

    it('opens the menu on Space too', () => {
      const { onGripClick } = setup();

      pressKey(gripsIn(grid, GRIP_ROW_ATTR)[0], ' ');

      expect(controls?.isPopoverOpen).toBe(true);
      expect(onGripClick).toHaveBeenCalledWith('row', 0);
    });

    it('lets every other key through untouched', () => {
      const { onGripClick, bubbled } = setup();

      const event = pressKey(gripsIn(grid, GRIP_COL_ATTR)[1], 'a');

      expect(controls?.isPopoverOpen).toBe(false);
      expect(onGripClick).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(bubbled).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard focus reveals the right grip', () => {
    it('reveals the focused column grip only', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls(baseOptions(grid, 2, 3));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[1];

      grip.dispatchEvent(new FocusEvent('focus'));

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 1, row: -1 });
      // expandGrip() ran: the grip grew and swapped to the hover background.
      expect(grip.style.height).toBe(HOVER_SIZE_PX);
      expect(grip.classList.contains('bg-gray-200')).toBe(true);
    });

    it('reveals the focused row grip only', () => {
      grid = createGrid(3, 2);
      controls = new TableRowColControls(baseOptions(grid, 3, 2));

      const grip = gripsIn(grid, GRIP_ROW_ATTR)[2];

      grip.dispatchEvent(new FocusEvent('focus'));

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: -1, row: 2 });
      expect(grip.style.width).toBe(HOVER_SIZE_PX);
    });

    it('hides the grip again after blur once the hide delay elapses', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];

      grip.dispatchEvent(new FocusEvent('focus'));
      grip.dispatchEvent(new FocusEvent('blur'));

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: -1 });

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toBeNull();
      expect(grip.classList.contains('bg-gray-300')).toBe(true);
    });

    it('cancels a pending hide when focus arrives', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      grid.dispatchEvent(new MouseEvent('mouseleave'));

      gripsIn(grid, GRIP_COL_ATTR)[1].dispatchEvent(new FocusEvent('focus'));
      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 1, row: 0 });
    });
  });

  describe('grips locked out of dragging', () => {
    it('marks only the locked grip and gives it a click-only label', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 2),
        canDrag: (type, index) => !(type === 'col' && index === 0),
      });

      const [locked, free] = gripsIn(grid, GRIP_COL_ATTR);

      expect(locked.hasAttribute(GRIP_DRAG_DISABLED_ATTR)).toBe(true);
      expect(locked.getAttribute(GRIP_DRAG_DISABLED_ATTR)).toBe('');
      expect(locked.style.cursor).toBe('not-allowed');
      expect(locked.getAttribute('aria-label')).toBe('blockSettings.clickToOpenMenu');

      expect(free.hasAttribute(GRIP_DRAG_DISABLED_ATTR)).toBe(false);
      expect(free.style.cursor).toBe('');
      expect(free.getAttribute('aria-label'))
        .toBe('blockSettings.dragToMove. blockSettings.clickToOpenMenu');
      expect(free.getAttribute(GRIP_ATTR)).toBe('');
    });

    it('leaves every grip draggable when no canDrag predicate is supplied', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grips = [...gripsIn(grid, GRIP_COL_ATTR), ...gripsIn(grid, GRIP_ROW_ATTR)];

      expect(grips.some(g => g.hasAttribute(GRIP_DRAG_DISABLED_ATTR))).toBe(false);
    });
  });

  describe('setActiveGrip', () => {
    it('grows a column grip vertically and a row grip horizontally', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 1);

      const colGrip = gripsIn(grid, GRIP_COL_ATTR)[1];

      expect(colGrip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(colGrip.classList.contains('bg-blue-500')).toBe(true);
      expect(colGrip.style.height).toBe(HOVER_SIZE_PX);
      expect(gripsIn(grid, GRIP_ROW_ATTR)[1].hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
    });

    it('activates the row grip, not the column grip, for type "row"', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('row', 1);

      const rowGrip = gripsIn(grid, GRIP_ROW_ATTR)[1];

      expect(rowGrip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(rowGrip.classList.contains('bg-blue-500')).toBe(true);
      expect(rowGrip.style.width).toBe(HOVER_SIZE_PX);
      expect(gripsIn(grid, GRIP_COL_ATTR)[1].hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
    });

    it('does nothing for an index past the end of the grip list', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(() => controls?.setActiveGrip('col', 99)).not.toThrow();
      expect(gripsIn(grid, GRIP_COL_ATTR).some(g => g.hasAttribute(GRIP_VISIBLE_ATTR))).toBe(false);
    });

    it('hides the grips revealed by hover, and returns them to their idle pill size', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 1, 1));

      const hoveredCol = gripsIn(grid, GRIP_COL_ATTR)[1];
      const hoveredRow = gripsIn(grid, GRIP_ROW_ATTR)[1];

      expect(hoveredCol.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);

      controls.setActiveGrip('col', 0);

      expect(hoveredCol.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
      expect(hoveredRow.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
      expect(gripsIn(grid, GRIP_COL_ATTR)[0].hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      // Idle pill keeps the 12px hit-area padding, otherwise the grip is unhoverable.
      expect(hoveredCol.style.height).toBe(IDLE_PILL_PX);
      expect(hoveredRow.style.width).toBe(IDLE_PILL_PX);
    });

    it('blocks hover from stealing the grip while a grip is held active', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 1);
      mouseOver(getCell(grid, 0, 0));

      expect(controls.getVisibleGripIndices()).toBeNull();
      expect(gripsIn(grid, GRIP_COL_ATTR)[1].classList.contains('bg-blue-500')).toBe(true);
    });

    it('blocks hover from stealing the grip while a grip menu is open', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      pressKey(gripsIn(grid, GRIP_COL_ATTR)[1], 'Enter');
      mouseOver(getCell(grid, 0, 0));

      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('re-reveals nothing when the released pointerdown lands on an unreadable cell', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const cell = getCell(grid, 1, 1);

      const raised: string[] = [];
      const record = (e: ErrorEvent): void => {
        raised.push(e.message);
      };

      cell.setAttribute(CELL_COL_ATTR, 'not-a-number');
      controls.setActiveGrip('col', 0);
      window.addEventListener('error', record);
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      window.removeEventListener('error', record);

      // A listener that throws is swallowed by dispatchEvent, so assert on the
      // reported error rather than on the dispatch call.
      expect(raised).toEqual([]);
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('releases the hold on the next pointerdown and re-reveals the hovered cell grips', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);

      const cell = getCell(grid, 1, 1);

      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 1, row: 1 });
      expect(gripsIn(grid, GRIP_COL_ATTR)[0].classList.contains('bg-blue-500')).toBe(false);
    });
  });

  describe('refresh after a structural change', () => {
    it('is a no-op beyond rebuilding grips when no menu is open', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(() => controls?.refresh()).not.toThrow();
      expect(gripsIn(grid, GRIP_COL_ATTR)).toHaveLength(2);
    });

    it('re-activates the rebuilt row grip on the same axis it had before', () => {
      grid = createGrid(3, 2);
      controls = new TableRowColControls(baseOptions(grid, 3, 2));

      pressKey(gripsIn(grid, GRIP_ROW_ATTR)[2], 'Enter');
      controls.refresh();

      const rebuilt = gripsIn(grid, GRIP_ROW_ATTR)[2];

      expect(rebuilt.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(rebuilt.classList.contains('bg-blue-500')).toBe(true);
      // Row grips grow horizontally; growing the height instead leaves a 4px sliver.
      expect(rebuilt.style.width).toBe(HOVER_SIZE_PX);
      expect(gripsIn(grid, GRIP_COL_ATTR)[1].classList.contains('bg-blue-500')).toBe(false);
    });

    it('re-activates the rebuilt column grip on the column axis', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls(baseOptions(grid, 2, 3));

      pressKey(gripsIn(grid, GRIP_COL_ATTR)[2], 'Enter');
      controls.refresh();

      const rebuilt = gripsIn(grid, GRIP_COL_ATTR)[2];

      expect(rebuilt.classList.contains('bg-blue-500')).toBe(true);
      expect(rebuilt.style.height).toBe(HOVER_SIZE_PX);
    });

    it('survives a refresh that drops the column the open menu belonged to', () => {
      grid = createGrid(2, 3);

      let cols = 3;

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 3),
        getColumnCount: () => cols,
      });

      pressKey(gripsIn(grid, GRIP_COL_ATTR)[2], 'Enter');
      cols = 2;

      expect(() => controls?.refresh()).not.toThrow();
      expect(gripsIn(grid, GRIP_COL_ATTR)).toHaveLength(2);
    });
  });

  describe('cell position parsing', () => {
    it('ignores a cell whose column index is not a number', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const cell = getCell(grid, 1, 1);

      cell.setAttribute(CELL_COL_ATTR, 'not-a-number');

      expect(() => mouseOver(cell)).not.toThrow();
      expect(controls.getVisibleGripIndices()).toBeNull();
    });
  });

  describe('hover hide scheduling', () => {
    it('cancels the scheduled hide when the grips are hidden outright', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      grid.dispatchEvent(new MouseEvent('mouseleave'));
      controls.hideAllGrips();
      controls.restoreVisibleGrips(1, 1);

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      // Hiding the grips outright must drop the pending timer, or a restore
      // made a moment later is undone behind the caller's back.
      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 1, row: 1 });
    });

    it('cancels the pending hide when the pointer returns to the table', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      grid.dispatchEvent(new MouseEvent('mouseleave'));
      mouseOver(getCell(grid, 0, 0));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });
  });

  describe('pointer activation reads the grip identity from the DOM', () => {
    it('opens the menu for the row grip that was pressed', async () => {
      vi.useRealTimers();
      grid = createGrid(3, 2);

      const onGripClick = vi.fn();

      controls = new TableRowColControls({ ...baseOptions(grid, 3, 2), onGripClick });

      gripsIn(grid, GRIP_ROW_ATTR)[2].dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 80 })
      );
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      await vi.waitFor(() => {
        expect(onGripClick).toHaveBeenCalledWith('row', 2);
      });
    });
  });

  describe('skipping the reveal transition', () => {
    /**
     * applyVisibleClasses/applyIdleClasses suppress the CSS transition by
     * writing transition:none and then reading offsetHeight (jsdom cannot
     * observe the transition; the read is the only proof the table treats
     * itself as entered).
     */
    const countReflowReads = (element: HTMLElement): { count: () => number } => {
      let reads = 0;

      Object.defineProperty(element, 'offsetHeight', {
        configurable: true,
        get: () => {
          reads += 1;

          return 0;
        },
      });

      return { count: () => reads };
    };

    const hover = (gridEl: HTMLElement, row: number, col: number): void => {
      mouseOver(getCell(gridEl, row, col));
    };

    it('does not force a reflow read or an inline transition on the first reveal', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      hover(grid, 0, 0);

      expect(grip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      // The pointer only just entered: there is no transition to skip yet, so
      // the reveal must not force a layout flush or leave a transition behind.
      expect(reads.count()).toBe(0);
      expect(grip.style.transition).toBe('');
    });

    it('does not force a reflow read when re-revealing after hideAllGrips', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      hover(grid, 0, 0);
      controls.hideAllGrips();

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      hover(grid, 1, 1);

      // Reaching for another column returns this one to idle, outside the
      // table: that must not flush layout either.
      expect(grip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
      expect(reads.count()).toBe(0);
      expect(grip.style.transition).toBe('');
    });

    it('marks the table as entered when a released hold re-reveals the hovered cell', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);
      getCell(grid, 1, 1).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      hover(grid, 0, 0);

      // The released pointerdown already re-entered the table, so this reveal
      // is a hop between grips and must skip the transition.
      expect(reads.count()).toBe(1);
    });

    it('marks the table as entered before a column-only restore reveals its grip', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      controls.restoreVisibleGrips(0, -1);

      expect(grip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(reads.count()).toBe(1);
    });

    it('marks the table as entered before a row-only restore reveals its grip', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_ROW_ATTR)[0];
      const reads = countReflowReads(grip);

      controls.restoreVisibleGrips(-1, 0);

      expect(grip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(reads.count()).toBe(1);
    });

    it('leaves the table unentered when a restore shows nothing', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.restoreVisibleGrips(-1, -1);

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      hover(grid, 0, 0);

      // Nothing was restored, so this is still a first entry and must animate.
      expect(reads.count()).toBe(0);
      expect(grip.style.transition).toBe('');
    });

    it('ignores indices below -1 instead of indexing past the start of the grip list', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(() => controls?.restoreVisibleGrips(-2, -1)).not.toThrow();
      expect(controls.getVisibleGripIndices()).toBeNull();
      expect(() => controls?.restoreVisibleGrips(-1, -2)).not.toThrow();
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('leaves an already shown grip untouched when the same cell is hovered again', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      hover(grid, 0, 0);

      const colGrip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const rowGrip = gripsIn(grid, GRIP_ROW_ATTR)[0];
      const colReads = countReflowReads(colGrip);
      const rowReads = countReflowReads(rowGrip);

      hover(grid, 0, 0);

      // Both grips are already visible: re-applying the visible state would
      // redo the pill sizing and the layout flush for no reason.
      expect(colGrip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(rowGrip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
      expect(colReads.count()).toBe(0);
      expect(rowReads.count()).toBe(0);
    });

    it('leaves the table unentered after hideAllGrips', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      hover(grid, 0, 0);
      controls.hideAllGrips();

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      hover(grid, 0, 0);

      // Hiding the grips is leaving the table, so the next reveal animates.
      expect(reads.count()).toBe(0);
      expect(grip.style.transition).toBe('');
    });

    it('leaves the table unentered after a refresh rebuilds the grips', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      hover(grid, 0, 0);
      controls.refresh();

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];
      const reads = countReflowReads(grip);

      hover(grid, 0, 0);

      expect(reads.count()).toBe(0);
      expect(grip.style.transition).toBe('');
    });

    it('reports no visible grip after a refresh rebuilds them', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      hover(grid, 0, 0);
      controls.refresh();

      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('does not force a reflow read or a lingering transition when idling a grip outside the table', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[1];
      const reads = countReflowReads(grip);

      controls.setActiveGrip('col', 0);

      expect(grip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
      expect(reads.count()).toBe(0);
      expect(grip.style.transition).toBe('');
    });
  });

  describe('grip teardown', () => {
    it('removes every grip from the grid on destroy', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(gripsIn(grid, GRIP_COL_ATTR)).toHaveLength(2);
      expect(gripsIn(grid, GRIP_ROW_ATTR)).toHaveLength(2);

      controls.destroy();
      controls = undefined;

      expect(gripsIn(grid, GRIP_COL_ATTR)).toHaveLength(0);
      expect(gripsIn(grid, GRIP_ROW_ATTR)).toHaveLength(0);
    });

    it('restores the page cursor and text selection when destroyed mid-drag', () => {
      vi.useRealTimers();
      grid = createGrid(3, 3);
      controls = new TableRowColControls(baseOptions(grid, 3, 3));

      gripsIn(grid, GRIP_COL_ATTR)[1].dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 0 })
      );
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140, clientY: 0 }));

      expect(document.body.style.cursor).toBe('grabbing');
      expect(grid.style.userSelect).toBe('none');

      controls.destroy();
      controls = undefined;

      // A drag abandoned by destroy must not leave the page unable to select text.
      expect(document.body.style.cursor).toBe('');
      expect(grid.style.userSelect).toBe('');
    });

    it('removes the row grips it rebuilt on refresh', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.refresh();

      expect(gripsIn(grid, GRIP_ROW_ATTR)).toHaveLength(2);
      expect(gripsIn(grid, GRIP_COL_ATTR)).toHaveLength(2);
    });

    it('is safe to destroy twice', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.destroy();

      expect(() => controls?.destroy()).not.toThrow();
    });

    it('watches every row so height changes reposition the grips', () => {
      const observed: unknown[] = [];

      class FakeResizeObserver {
        public constructor(public readonly callback: ResizeObserverCallback) {}

        public observe = (target: Element): void => {
          observed.push(target);
        };
        public unobserve = (): void => undefined;
        public disconnect = (): void => undefined;
      }

      vi.stubGlobal('ResizeObserver', FakeResizeObserver);

      try {
        grid = createGrid(3, 2);
        controls = new TableRowColControls(baseOptions(grid, 3, 2));

        const rows = Array.from(grid.querySelectorAll(`[${ROW_ATTR}]`));

        expect(observed).toEqual(rows);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('repositions the grips when a watched row changes height', () => {
      const observers: ResizeObserverCallback[] = [];

      class FakeResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }

        public observe = (): void => undefined;
        public unobserve = (): void => undefined;
        public disconnect = (): void => undefined;
      }

      vi.stubGlobal('ResizeObserver', FakeResizeObserver);

      try {
        grid = createGrid(2, 2);
        controls = new TableRowColControls(baseOptions(grid, 2, 2));

        const rowGrip = gripsIn(grid, GRIP_ROW_ATTR)[0];

        expect(rowGrip.style.top).toBe('20px');

        const firstRow = grid.querySelector(`[${ROW_ATTR}]`);

        if (firstRow === null) {
          throw new Error('missing row');
        }

        Object.defineProperty(firstRow, 'offsetTop', { value: 100, configurable: true });
        observers.forEach(callback => callback([], {} as ResizeObserver));

        // A row that grew under a merged cell moves its grip with it.
        expect(rowGrip.style.top).toBe('120px');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('grip element contract', () => {
    it('exposes each grip as a menu button outside the editable content', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];

      expect(grip.getAttribute('contenteditable')).toBe('false');
      expect(grip.getAttribute('role')).toBe('button');
      expect(grip.getAttribute('tabindex')).toBe('0');
      expect(grip.getAttribute('aria-haspopup')).toBe('menu');
    });

    it('draws a horizontal dot grid on a column grip and a vertical one on a row grip', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const colSvg = gripsIn(grid, GRIP_COL_ATTR)[0].querySelector('svg');
      const rowSvg = gripsIn(grid, GRIP_ROW_ATTR)[0].querySelector('svg');

      expect(colSvg?.getAttribute('width')).toBe('14');
      expect(colSvg?.getAttribute('height')).toBe('10');
      expect(colSvg?.querySelector('circle')?.getAttribute('transform')).toBe('rotate(90 10 10)');

      expect(rowSvg?.getAttribute('width')).toBe('10');
      expect(rowSvg?.getAttribute('height')).toBe('14');
      expect(rowSvg?.querySelector('circle')?.hasAttribute('transform')).toBe(false);
    });

    it('outlines the grip so it reads over a painted cell', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      expect(gripsIn(grid, GRIP_COL_ATTR)[0].style.outline)
        .toBe('2px solid var(--blok-table-grip-outline, transparent)');
    });

    it('returns a revealed column grip to its pill height on the vertical axis', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];

      grip.dispatchEvent(new MouseEvent('mouseenter'));

      expect(grip.style.height).toBe(HOVER_SIZE_PX);

      mouseOver(getCell(grid, 0, 0));

      // The revealed pill is 4px tall; a width write would leave the hover
      // sliver in place and the grip would cover its column.
      expect(grip.style.height).toBe('4px');
    });

    it('marks a grip visible with an empty-valued attribute', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const colGrip = gripsIn(grid, GRIP_COL_ATTR)[0];

      mouseOver(getCell(grid, 0, 0));

      // The attribute is a flag: its value is read by nothing and asserted by tests.
      expect(colGrip.getAttribute(GRIP_VISIBLE_ATTR)).toBe('');

      const activeGrip = gripsIn(grid, GRIP_COL_ATTR)[1];

      controls.setActiveGrip('col', 1);

      expect(activeGrip.getAttribute(GRIP_VISIBLE_ATTR)).toBe('');
    });

    it('restores the dot grid to its faint colours when the grip is revealed', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);

      const svg = gripsIn(grid, GRIP_COL_ATTR)[0].querySelector('svg');

      expect(svg?.classList.contains('text-white')).toBe(true);

      controls.restoreVisibleGrips(0, -1);

      expect(svg?.classList.contains('text-white')).toBe(false);
      expect(svg?.classList.contains('text-gray-400')).toBe(true);
    });

    it('paints the dot grid white when the grip is held active', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));

      const svg = gripsIn(grid, GRIP_COL_ATTR)[0].querySelector('svg');

      expect(svg?.classList.contains('opacity-0')).toBe(true);

      controls.setActiveGrip('col', 0);

      expect(svg?.classList.contains('text-white')).toBe(true);
      expect(svg?.classList.contains('opacity-0')).toBe(false);
    });

    it('fades the dot grid back when the grip is hidden', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      controls.setActiveGrip('col', 0);

      const svg = gripsIn(grid, GRIP_COL_ATTR)[0].querySelector('svg');

      expect(svg?.classList.contains('opacity-100')).toBe(true);

      controls.hideAllGrips();

      expect(svg?.classList.contains('opacity-100')).toBe(false);
      expect(svg?.classList.contains('opacity-0')).toBe(true);
    });
  });

  describe('grip hover and focus', () => {
    const createOverlay = (): { overlay: HTMLElement; scroller: HTMLElement } => {
      const scroller = document.createElement('div');
      const overlay = document.createElement('div');

      scroller.setAttribute('data-blok-table-scroller', '');
      scroller.appendChild(grid);
      scroller.appendChild(overlay);
      document.body.appendChild(scroller);

      return { overlay, scroller };
    };

    it('cancels a pending hide when the pointer enters the grip', () => {
      grid = createGrid(2, 2);

      const { overlay, scroller } = createOverlay();

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 2),
        overlay,
        scrollContainer: scroller,
      });

      mouseOver(getCell(grid, 0, 0));

      const grip = gripsIn(overlay, GRIP_COL_ATTR)[0];

      grip.dispatchEvent(new MouseEvent('mouseleave'));
      grip.dispatchEvent(new MouseEvent('mouseenter'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      // The pointer never left the grip, so the scheduled hide must be off.
      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });

    it('hides the grips when the pointer leaves a grip', () => {
      grid = createGrid(2, 2);

      const { overlay, scroller } = createOverlay();

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 2),
        overlay,
        scrollContainer: scroller,
      });

      mouseOver(getCell(grid, 0, 0));
      gripsIn(overlay, GRIP_COL_ATTR)[0].dispatchEvent(new MouseEvent('mouseleave'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('keeps the grips visible when the pointer leaves a grip while another is held', () => {
      grid = createGrid(2, 2);

      const { overlay, scroller } = createOverlay();

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 2),
        overlay,
        scrollContainer: scroller,
      });

      mouseOver(getCell(grid, 0, 0));
      controls.setActiveGrip('col', 0);

      gripsIn(overlay, GRIP_COL_ATTR)[1].dispatchEvent(new MouseEvent('mouseleave'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      // A held grip owns the table: a stray mouseleave must not schedule a hide.
      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });

    it('does not expand a grip the pointer merely passes while the table is locked', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);

      const grip = gripsIn(grid, GRIP_COL_ATTR)[1];

      grip.dispatchEvent(new MouseEvent('mouseenter'));

      // The idle pill and the hover pill are both 16px tall, so the hover
      // background is what tells an expand apart from an idle reset.
      expect(grip.classList.contains('bg-gray-200')).toBe(false);
      expect(grip.classList.contains('bg-gray-300')).toBe(true);
    });

    it('does not expand the focused grip while another is held', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);

      const grip = gripsIn(grid, GRIP_COL_ATTR)[1];

      grip.dispatchEvent(new FocusEvent('focus'));

      expect(grip.style.height).toBe('4px');
    });

    it('collapses the focused grip on blur', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];

      grip.dispatchEvent(new FocusEvent('focus'));
      expect(grip.style.height).toBe(HOVER_SIZE_PX);
      expect(grip.classList.contains('bg-gray-200')).toBe(true);

      grip.dispatchEvent(new FocusEvent('blur'));

      expect(grip.style.height).toBe('4px');
      expect(grip.classList.contains('bg-gray-300')).toBe(true);
    });

    it('keeps the grips visible when the focused grip blurs while another is held', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      controls.setActiveGrip('col', 0);

      gripsIn(grid, GRIP_COL_ATTR)[1].dispatchEvent(new FocusEvent('blur'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });

    it('ignores grip-local hover when the grips are hosted by the grid itself', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];

      grip.dispatchEvent(new FocusEvent('focus'));
      grip.dispatchEvent(new FocusEvent('blur'));
      grip.dispatchEvent(new MouseEvent('mouseenter'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      // Without an overlay the grips live inside the table, so hiding is the
      // table's mouseleave to schedule, not the grip's own hover.
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('does not hide the grips when the pointer leaves a grip inside the table', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      gripsIn(grid, GRIP_COL_ATTR)[0].dispatchEvent(new MouseEvent('mouseleave'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      // The pointer is still over the table; only leaving the table hides them.
      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });
  });

  describe('hover and pointer guards on the table itself', () => {
    it('ignores a mouseover that does not land on a table cell', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const raised: string[] = [];
      const record = (e: ErrorEvent): void => {
        raised.push(e.message);
      };

      window.addEventListener('error', record);
      mouseOver(grid);
      window.removeEventListener('error', record);

      expect(raised).toEqual([]);
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('ignores a mouseover on a cell whose column index is not a number', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const cell = getCell(grid, 1, 1);

      cell.setAttribute(CELL_COL_ATTR, 'not-a-number');

      const raised: string[] = [];
      const record = (e: ErrorEvent): void => {
        raised.push(e.message);
      };

      window.addEventListener('error', record);
      mouseOver(cell);
      window.removeEventListener('error', record);

      expect(raised).toEqual([]);
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('does not schedule a hide when the table is left while a grip is held', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      controls.setActiveGrip('col', 0);

      grid.dispatchEvent(new MouseEvent('mouseleave'));

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });
  });

  describe('pointer press on a grip', () => {
    it('swallows the press so the editor never sees it', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const onGridPointerDown = vi.fn();

      grid.addEventListener('pointerdown', onGridPointerDown);

      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });

      gripsIn(grid, GRIP_COL_ATTR)[0].dispatchEvent(event);

      // An unswallowed press starts a native drag/selection inside the block.
      expect(event.defaultPrevented).toBe(true);
      expect(onGridPointerDown).not.toHaveBeenCalled();
    });

    it('ignores a press on a grip that carries no axis', () => {
      vi.useRealTimers();
      grid = createGrid(2, 2);

      const onGripClick = vi.fn();

      controls = new TableRowColControls({ ...baseOptions(grid, 2, 2), onGripClick });

      const raised: string[] = [];
      const record = (e: ErrorEvent): void => {
        raised.push(e.message);
      };

      const grip = gripsIn(grid, GRIP_COL_ATTR)[1];

      grip.removeAttribute(GRIP_COL_ATTR);
      window.addEventListener('error', record);
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      window.removeEventListener('error', record);

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(raised).toEqual([]);
          expect(onGripClick).not.toHaveBeenCalled();
          resolve();
        }, 20);
      });
    });

    it('opens the menu only for a press that did not drag', () => {
      vi.useRealTimers();
      grid = createGrid(3, 3);

      const onGripClick = vi.fn();

      controls = new TableRowColControls({ ...baseOptions(grid, 3, 3), onGripClick });

      const grip = gripsIn(grid, GRIP_COL_ATTR)[1];

      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140, clientY: 0 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 140, clientY: 0 }));

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(controls?.isPopoverOpen).toBe(false);
          expect(onGripClick).not.toHaveBeenCalled();
          resolve();
        }, 20);
      });
    });
  });

  describe('hold release and teardown listeners', () => {
    it('releases the hold on the next pointerdown and re-reveals the hovered cell grips', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);

      getCell(grid, 1, 1).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      controls.hideAllGrips();

      getCell(grid, 1, 1).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // The release listener fires once: a second press must not re-reveal.
      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('stops listening for the hold release once destroyed', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.setActiveGrip('col', 0);
      controls.destroy();
      controls = undefined;

      const raised: string[] = [];
      const record = (e: ErrorEvent): void => {
        raised.push(e.message);
      };

      window.addEventListener('error', record);
      getCell(grid, 0, 0).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      window.removeEventListener('error', record);

      expect(raised).toEqual([]);
    });

    it('stops revealing grips on hover once destroyed', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.destroy();
      controls = undefined;

      const raised: string[] = [];
      const record = (e: ErrorEvent): void => {
        raised.push(e.message);
      };

      window.addEventListener('error', record);
      mouseOver(getCell(grid, 0, 0));
      grid.dispatchEvent(new MouseEvent('mouseleave'));
      window.removeEventListener('error', record);

      expect(raised).toEqual([]);
    });

    it('stops scheduling a hide once destroyed', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      controls.destroy();
      controls = undefined;

      expect(vi.getTimerCount()).toBe(0);

      grid.dispatchEvent(new MouseEvent('mouseleave'));

      // A destroyed control must not leave work on the timer queue.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops repositioning the grips on scroll once destroyed', () => {
      grid = createGrid(2, 3);

      const scroller = document.createElement('div');
      const overlay = document.createElement('div');

      scroller.setAttribute('data-blok-table-scroller', '');
      Object.defineProperty(scroller, 'scrollLeft', { value: 0, writable: true, configurable: true });
      Object.defineProperty(scroller, 'clientWidth', { value: 100, configurable: true });
      scroller.appendChild(grid);
      scroller.appendChild(overlay);
      document.body.appendChild(scroller);

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 3),
        overlay,
        scrollContainer: scroller,
      });

      const positionGrips = vi.spyOn(controls, 'positionGrips');

      scroller.dispatchEvent(new Event('scroll'));
      expect(positionGrips).toHaveBeenCalledTimes(1);

      controls.destroy();
      controls = undefined;

      scroller.dispatchEvent(new Event('scroll'));
      expect(positionGrips).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending hide when a grip is held', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      grid.dispatchEvent(new MouseEvent('mouseleave'));

      controls.setActiveGrip('col', 0);

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
      expect(gripsIn(grid, GRIP_COL_ATTR)[0].classList.contains('bg-blue-500')).toBe(true);
    });

    it('returns the rebuilt grips to idle when refresh re-activates one of them', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls(baseOptions(grid, 2, 3));

      pressKey(gripsIn(grid, GRIP_COL_ATTR)[2], 'Enter');
      controls.refresh();

      const colGrips = gripsIn(grid, GRIP_COL_ATTR);

      expect(colGrips[2].classList.contains('bg-blue-500')).toBe(true);
      // Rebuilt grips start at the bare 4px pill; every other grip must be
      // padded out to its hoverable hit area, not left as a sliver.
      expect(colGrips[0].style.height).toBe(IDLE_PILL_PX);
      expect(colGrips[1].style.height).toBe(IDLE_PILL_PX);
    });
  });

  describe('grip menu callbacks', () => {
    const activateMenuItem = async (title: string): Promise<void> => {
      const item = Array.from(document.querySelectorAll<HTMLElement>('*')).find(
        element => element.children.length === 0 && element.textContent === title
      );

      if (item === undefined) {
        throw new Error(`No menu item titled ${title}`);
      }

      item.click();
      // The menu emits Closed only once its exit animation settles.
      await new Promise<void>(resolve => {
        setTimeout(resolve, 500);
      });
    };

    const clickMenuItem = (title: string): void => {
      const item = Array.from(document.querySelectorAll<HTMLElement>('*')).find(
        element => element.children.length === 0 && element.textContent === title
      );

      if (item === undefined) {
        throw new Error(`No menu item titled ${title}`);
      }

      item.click();
    };

    it('clears the pending hide when the menu opens', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      grid.dispatchEvent(new MouseEvent('mouseleave'));
      pressKey(gripsIn(grid, GRIP_COL_ATTR)[1], 'Enter');

      vi.advanceTimersByTime(HIDE_DELAY_MS);

      // Opening the menu pins the grips; a hide scheduled before it must be dropped.
      expect(controls.getVisibleGripIndices()).toStrictEqual({ col: 0, row: 0 });
    });

    it('idles the other grips when a menu opens', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 1, 1));

      const rowGrip = gripsIn(grid, GRIP_ROW_ATTR)[1];

      expect(rowGrip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);

      pressKey(gripsIn(grid, GRIP_COL_ATTR)[1], 'Enter');

      // Only the grip with the open menu stays highlighted.
      expect(rowGrip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(false);
      expect(rowGrip.style.width).toBe(IDLE_PILL_PX);
    });

    it('returns the grip to its unheld state when the menu closes', async () => {
      vi.useRealTimers();
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grip = gripsIn(grid, GRIP_COL_ATTR)[0];

      pressKey(grip, 'Enter');
      expect(grip.classList.contains('bg-blue-500')).toBe(true);

      await activateMenuItem('tools.table.duplicateColumn');

      expect(controls.isPopoverOpen).toBe(false);
      // A closed menu must not leave its grip reading as the active one.
      expect(grip.classList.contains('bg-blue-500')).toBe(false);
      expect(grip.hasAttribute(GRIP_VISIBLE_ATTR)).toBe(true);
    });

    it('hides the grips once the menu closes', async () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      mouseOver(getCell(grid, 0, 0));
      pressKey(gripsIn(grid, GRIP_COL_ATTR)[0], 'Enter');

      clickMenuItem('tools.table.duplicateColumn');

      // The menu reports closed once its exit animation settles.
      for (let step = 0; step < 40 && controls.isPopoverOpen; step++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      expect(controls.isPopoverOpen).toBe(false);

      await vi.advanceTimersByTimeAsync(HIDE_DELAY_MS);

      expect(controls.getVisibleGripIndices()).toBeNull();
    });

    it('replaces the open menu when another grip is opened', async () => {
      vi.useRealTimers();
      grid = createGrid(2, 2);
      controls = new TableRowColControls(baseOptions(grid, 2, 2));

      const grips = gripsIn(grid, GRIP_COL_ATTR);

      pressKey(grips[0], 'Enter');
      pressKey(grips[1], 'Enter');

      await new Promise<void>(resolve => {
        setTimeout(resolve, 600);
      });

      // Two menus at once would both keep a grip pinned.
      expect(document.querySelectorAll('[data-blok-popover]')).toHaveLength(1);
      expect(controls.isPopoverOpen).toBe(true);
    });

    it('opens nothing when the menu is requested for a grip that no longer exists', async () => {
      vi.useRealTimers();
      grid = createGrid(2, 3);

      let cols = 3;
      const onGripClick = vi.fn();

      controls = new TableRowColControls({
        ...baseOptions(grid, 2, 3),
        getColumnCount: () => cols,
        onGripClick,
      });

      gripsIn(grid, GRIP_COL_ATTR)[2].dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 })
      );

      cols = 2;
      controls.refresh();

      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      await new Promise<void>(resolve => {
        setTimeout(resolve, 20);
      });

      // The press resolves against a grip the rebuild removed: no menu opens,
      // and the click is still reported to the editor.
      expect(controls.isPopoverOpen).toBe(false);
      expect(onGripClick).toHaveBeenCalledWith('col', 2);
    });
  });

  describe('merge-aware row grip anchoring', () => {
    /**
     * One row of cells, each with a rowSpan and its own rendered rect, so the
     * grip's top names the cell the anchor logic picked.
     */
    const createMergedRow = (
      cells: { rowSpan: number; top: number; height: number }[]
    ): HTMLElement => {
      const merged = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute(ROW_ATTR, '');
      Object.defineProperty(row, 'offsetTop', { value: 400, configurable: true });
      Object.defineProperty(row, 'offsetHeight', { value: 40, configurable: true });

      cells.forEach((spec, index) => {
        const cell = document.createElement('div');

        cell.setAttribute(CELL_ATTR, '');
        cell.setAttribute(CELL_COL_ATTR, String(index));
        cell.setAttribute(CELL_ROW_ATTR, '0');
        Object.defineProperty(cell, 'offsetWidth', { value: CELL_WIDTH, configurable: true });
        Object.defineProperty(cell, 'rowSpan', { value: spec.rowSpan, configurable: true });
        Object.defineProperty(cell, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({ top: spec.top, height: spec.height, left: 0, right: 0, bottom: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
        });
        row.appendChild(cell);
      });

      merged.appendChild(row);
      document.body.appendChild(merged);

      return merged;
    };

    it('skips a row grip whose row has no cells left', () => {
      grid = createGrid(2, 2);

      const secondRow = grid.querySelectorAll(`[${ROW_ATTR}]`)[1];

      secondRow?.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => cell.remove());

      expect(() => {
        controls = new TableRowColControls(baseOptions(grid, 2, 2));
      }).not.toThrow();
      expect(gripsIn(grid, GRIP_ROW_ATTR)).toHaveLength(2);
    });

    it('anchors a merged row grip to the origin cell rect', () => {
      grid = createMergedRow([
        { rowSpan: 2, top: 100, height: 60 },
        { rowSpan: 1, top: 0, height: 20 },
      ]);
      controls = new TableRowColControls(baseOptions(grid, 1, 2));

      const rowGrip = gripsIn(grid, GRIP_ROW_ATTR)[0];

      // Centre of the merged cell: 100 + 60/2, and the grip hugs the border.
      expect(rowGrip.style.top).toBe('130px');
      expect(rowGrip.style.left).toBe('-0.5px');
    });

    it('anchors a merged row grip to the widest merge', () => {
      grid = createMergedRow([
        { rowSpan: 3, top: 10, height: 20 },
        { rowSpan: 1, top: 200, height: 20 },
        { rowSpan: 2, top: 300, height: 20 },
      ]);
      controls = new TableRowColControls(baseOptions(grid, 1, 3));

      // The 3-row merge is the tallest origin: 10 + 10, not the row's own top.
      expect(gripsIn(grid, GRIP_ROW_ATTR)[0].style.top).toBe('20px');
    });

    it('anchors a merged row grip to the rowSpan the cell reports', () => {
      grid = createMergedRow([
        { rowSpan: 1, top: 10, height: 20 },
        { rowSpan: 2, top: 300, height: 20 },
      ]);
      controls = new TableRowColControls(baseOptions(grid, 1, 2));

      // The second cell spans two rows, so it is the origin — 300 + 10.
      expect(gripsIn(grid, GRIP_ROW_ATTR)[0].style.top).toBe('310px');
    });

    it('prefers the first cell when two merges tie', () => {
      grid = createMergedRow([
        { rowSpan: 2, top: 10, height: 20 },
        { rowSpan: 2, top: 300, height: 20 },
      ]);
      controls = new TableRowColControls(baseOptions(grid, 1, 2));

      expect(gripsIn(grid, GRIP_ROW_ATTR)[0].style.top).toBe('20px');
    });
  });
});
