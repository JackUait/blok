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
});
