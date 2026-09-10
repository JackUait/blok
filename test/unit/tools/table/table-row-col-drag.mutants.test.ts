import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCumulativeColEdges, TableRowColDrag } from '../../../../src/tools/table/table-row-col-drag';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const GHOST_SELECTOR = '[data-blok-table-drag-ghost]';
const DRAG_THRESHOLD = 10;

/**
 * Geometry is deliberately asymmetric: a grid pinned away from the viewport
 * origin, rows of unequal height and columns of unequal width. With a grid at
 * (0, 0) and uniform tracks, `clientY - gridRect.top` reads the same as
 * `clientY + gridRect.top`, and every nearest-edge index collapses to the same
 * answer — which is how 281 arithmetic and comparison mutants survived here.
 */
const GRID_LEFT = 200;
const GRID_TOP = 100;
const ROW_HEIGHTS = [40, 60, 50];
const COL_WIDTHS = [100, 150, 200];
const ROW_TOPS = [0, 40, 100];
const COL_LEFTS = [0, 100, 250];
const GRID_WIDTH = 450;
const GRID_HEIGHT = 150;

interface GridOptions {
  /** Rows to build. Fewer than ROW_HEIGHTS.length trims from the end. */
  rows?: number;
  /** Column index whose cell is left out of the LAST row (a merged span). */
  missingColInLastRow?: number;
}

const fixRect = (el: Element, rect: DOMRect): void => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => rect,
    configurable: true,
  });
};

const fixNumber = (el: Element, prop: string, value: number): void => {
  Object.defineProperty(el, prop, { value, configurable: true });
};

const createGrid = (options: GridOptions = {}): HTMLElement => {
  const rowCount = options.rows ?? ROW_HEIGHTS.length;
  const grid = document.createElement('div');

  fixRect(grid, new DOMRect(GRID_LEFT, GRID_TOP, GRID_WIDTH, GRID_HEIGHT));

  Array.from({ length: rowCount }).forEach((_, rowIndex) => {
    const row = document.createElement('div');

    row.setAttribute(ROW_ATTR, '');
    fixNumber(row, 'offsetTop', ROW_TOPS[rowIndex]);
    fixNumber(row, 'offsetHeight', ROW_HEIGHTS[rowIndex]);
    fixRect(row, new DOMRect(GRID_LEFT, GRID_TOP + ROW_TOPS[rowIndex], GRID_WIDTH, ROW_HEIGHTS[rowIndex]));

    COL_WIDTHS.forEach((width, colIndex) => {
      const isLastRow = rowIndex === rowCount - 1;

      if (isLastRow && colIndex === options.missingColInLastRow) {
        return;
      }

      const cell = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, String(colIndex));
      cell.setAttribute('contenteditable', 'true');
      // Distinct text per cell: toHaveBeenCalledWith and DOM equality compare
      // elements structurally, so identical markup would make any two cells
      // interchangeable.
      cell.textContent = `r${rowIndex}c${colIndex}`;
      fixNumber(cell, 'offsetWidth', width);
      fixNumber(cell, 'offsetHeight', ROW_HEIGHTS[rowIndex]);
      fixRect(
        cell,
        new DOMRect(
          GRID_LEFT + COL_LEFTS[colIndex],
          GRID_TOP + ROW_TOPS[rowIndex],
          width,
          ROW_HEIGHTS[rowIndex]
        )
      );
      row.appendChild(cell);
    });

    grid.appendChild(row);
  });

  document.body.appendChild(grid);

  return grid;
};

const move = (clientX: number, clientY: number): void => {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY }));
};

const release = (clientX: number, clientY: number): void => {
  document.dispatchEvent(new PointerEvent('pointerup', { clientX, clientY }));
};

/** The drop indicator is the only child of the grid that is not a row. */
const getIndicator = (grid: HTMLElement): HTMLElement => {
  const found = Array.from(grid.children).find(child => !child.hasAttribute(ROW_ATTR));

  if (!(found instanceof HTMLElement)) {
    throw new Error('no drop indicator was added to the grid');
  }

  return found;
};

const hasIndicator = (grid: HTMLElement): boolean =>
  Array.from(grid.children).some(child => !child.hasAttribute(ROW_ATTR));

const getGhost = (): HTMLElement => {
  const found = document.querySelector(GHOST_SELECTOR);

  if (!(found instanceof HTMLElement)) {
    throw new Error('no drag ghost was added to the body');
  }

  return found;
};

/** Errors thrown inside a pointer listener never reach dispatchEvent. */
const captureWindowErrors = (run: () => void): string[] => {
  const messages: string[] = [];
  const onError = (event: ErrorEvent): void => {
    messages.push(event.message);
  };

  window.addEventListener('error', onError);

  try {
    run();
  } finally {
    window.removeEventListener('error', onError);
  }

  return messages;
};

describe('TableRowColDrag mutation coverage', () => {
  let drag: TableRowColDrag | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    drag?.cleanup();
    drag = null;
    document.body.innerHTML = '';
    document.body.style.cursor = '';
    document.documentElement.removeAttribute('data-blok-theme');
    Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  describe('column edge measurement', () => {
    it('accumulates the first row cell widths into left edges plus a right edge', () => {
      const grid = createGrid();

      expect(getCumulativeColEdges(grid)).toEqual([0, 100, 250, 450]);
    });

    it('returns a single zero edge for a grid with no rows', () => {
      const grid = createGrid({ rows: 0 });

      expect(getCumulativeColEdges(grid)).toEqual([0]);
    });

    it('prefers a col element offsetWidth, then its declared width, then zero', () => {
      const table = document.createElement('table');
      const colgroup = document.createElement('colgroup');
      // A col whose layout width is unmeasurable (offsetWidth 0) still has to
      // contribute its declared width, or every edge after it shifts left.
      const specs = [
        { offsetWidth: 100, declared: '100px' },
        { offsetWidth: 0, declared: '150px' },
        { offsetWidth: 0, declared: '' },
      ];

      specs.forEach(spec => {
        const col = document.createElement('col');

        col.style.width = spec.declared;
        fixNumber(col, 'offsetWidth', spec.offsetWidth);
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);
      document.body.appendChild(table);

      expect(getCumulativeColEdges(table)).toEqual([0, 100, 250, 250]);
    });
  });

  describe('where a dropped row lands', () => {
    it('moves a row dragged past a later row to the slot that row vacated', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);

      // Nearest row edge to relativeY 105 is the top of row 2 (100px).
      expect(getIndicator(grid).style.top).toBe('98.5px');

      release(250, 205);

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith({ type: 'move-row', fromIndex: 0, toIndex: 1 });
    });

    it('moves a row dropped past the last edge to the end of the table', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 255);

      expect(getIndicator(grid).style.top).toBe('148.5px');

      release(250, 255);

      expect(onAction).toHaveBeenCalledWith({ type: 'move-row', fromIndex: 0, toIndex: 2 });
    });

    it('moves a row dragged above every earlier row to index zero', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('row', 2, 250, 220);
      move(250, 105);

      expect(getIndicator(grid).style.top).toBe('-1.5px');

      release(250, 105);

      expect(onAction).toHaveBeenCalledWith({ type: 'move-row', fromIndex: 2, toIndex: 0 });
    });

    it('leaves the table alone when a row is dropped on its own top edge', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 141);

      expect(getIndicator(grid).style.top).toBe('38.5px');

      release(250, 141);

      expect(onAction).not.toHaveBeenCalled();
    });

    it('leaves the table alone when a row is dropped on its own bottom edge', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      release(250, 205);

      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe('where a dropped column lands', () => {
    it('moves a column dragged past a later column to the slot that column vacated', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('col', 0, 250, 150);
      move(450, 150);

      // Nearest column edge to relativeX 250 is the left of column 2.
      expect(getIndicator(grid).style.left).toBe('248.5px');

      release(450, 150);

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith({ type: 'move-col', fromIndex: 0, toIndex: 1 });
    });

    it('moves a column dropped past the last edge to the end of the table', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('col', 0, 250, 150);
      move(655, 150);

      expect(getIndicator(grid).style.left).toBe('448.5px');

      release(655, 150);

      expect(onAction).toHaveBeenCalledWith({ type: 'move-col', fromIndex: 0, toIndex: 2 });
    });

    it('leaves the table alone when a column is dropped on its own left edge', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('col', 1, 350, 150);
      move(301, 150);

      expect(getIndicator(grid).style.left).toBe('98.5px');

      release(301, 150);

      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe('drops that would tear a merge', () => {
    it('hands canDrop the index the model will splice into, not the raw edge', () => {
      const grid = createGrid();
      const canDrop = vi.fn(() => true);

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrop });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);

      expect(canDrop).toHaveBeenCalledWith('row', 0, 1);
    });

    it('refuses the row move when canDrop rejects the target', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction, canDrop: () => false });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);
      release(250, 205);

      expect(onAction).not.toHaveBeenCalled();
    });

    it('refuses the column move when canDrop rejects the target', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction, canDrop: () => false });
      void drag.beginTracking('col', 0, 250, 150);
      move(450, 150);
      release(450, 150);

      expect(onAction).not.toHaveBeenCalled();
    });

    it('hides the indicator and shows a not-allowed cursor over a rejected slot', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrop: () => false });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);

      expect(getIndicator(grid).style.display).toBe('none');
      expect(document.body.style.cursor).toBe('not-allowed');
    });

    it('hides the indicator and shows a not-allowed cursor over a rejected column slot', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrop: () => false });
      void drag.beginTracking('col', 0, 250, 150);
      move(450, 150);

      expect(getIndicator(grid).style.display).toBe('none');
      expect(document.body.style.cursor).toBe('not-allowed');
    });

    it('brings the indicator and the grabbing cursor back on re-entering an allowed slot', () => {
      const grid = createGrid();
      // Landing at index 2 would tear a merge; index 1 is free.
      const canDrop = (type: 'row' | 'col', fromIndex: number, toIndex: number): boolean => toIndex !== 2;

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrop });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 255);

      expect(getIndicator(grid).style.display).toBe('none');

      move(250, 205);

      expect(getIndicator(grid).style.display).toBe('');
      expect(document.body.style.cursor).toBe('grabbing');
    });
  });

  describe('the drag threshold', () => {
    it('treats a move of exactly the threshold in both axes as a click', () => {
      const grid = createGrid();
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), onDragStateChange });
      void drag.beginTracking('row', 1, 250, 170);
      move(250 + DRAG_THRESHOLD, 170 + DRAG_THRESHOLD);

      expect(onDragStateChange).not.toHaveBeenCalled();
      expect(document.querySelector(GHOST_SELECTOR)).toBeNull();
      expect(hasIndicator(grid)).toBe(false);
    });

    it('starts the drag on horizontal movement alone', () => {
      const grid = createGrid();
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), onDragStateChange });
      void drag.beginTracking('row', 1, 250, 170);
      move(250 + DRAG_THRESHOLD + 1, 170);

      expect(onDragStateChange).toHaveBeenCalledWith(true, 'row', 1);
    });

    it('starts the drag on vertical movement alone', () => {
      const grid = createGrid();
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), onDragStateChange });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 170 + DRAG_THRESHOLD + 1);

      expect(onDragStateChange).toHaveBeenCalledWith(true, 'row', 1);
    });

    it('resolves the gesture as a drag once the pointer is released after a move', async () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      const tracking = drag.beginTracking('row', 0, 250, 120);

      move(250, 205);
      release(250, 205);

      await expect(tracking).resolves.toBe(true);
    });
  });

  describe('a row or column locked by a merge', () => {
    it('refuses the gesture with a not-allowed cursor and no drag chrome', () => {
      const grid = createGrid();
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({
        grid,
        onAction: vi.fn(),
        onDragStateChange,
        canDrag: () => false,
      });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 250);

      expect(document.body.style.cursor).toBe('not-allowed');
      expect(document.querySelector(GHOST_SELECTOR)).toBeNull();
      expect(hasIndicator(grid)).toBe(false);
      expect(onDragStateChange).not.toHaveBeenCalled();
    });

    it('leaves the cursor alone until the refused gesture passes the threshold', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrag: () => false });
      void drag.beginTracking('row', 1, 250, 170);
      move(250 + DRAG_THRESHOLD, 170 + DRAG_THRESHOLD);

      expect(document.body.style.cursor).toBe('');
    });

    it('drags normally when canDrag accepts the row', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction, canDrag: () => true });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);

      expect(getGhost().children).toHaveLength(3);

      release(250, 205);

      expect(onAction).toHaveBeenCalledWith({ type: 'move-row', fromIndex: 0, toIndex: 1 });
    });

    it('reports a refused gesture dragged horizontally as a drag, not a click', async () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrag: () => false });

      const tracking = drag.beginTracking('row', 1, 250, 170);

      release(250 + DRAG_THRESHOLD + 20, 170);

      await expect(tracking).resolves.toBe(true);
    });

    it('reports a refused gesture dragged vertically as a drag, not a click', async () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrag: () => false });

      const tracking = drag.beginTracking('row', 1, 250, 170);

      release(250, 170 + DRAG_THRESHOLD + 20);

      await expect(tracking).resolves.toBe(true);
    });

    it('reports a refused gesture released within the threshold as a click', async () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), canDrag: () => false });

      const tracking = drag.beginTracking('row', 1, 250, 170);

      release(250 + DRAG_THRESHOLD, 170 + DRAG_THRESHOLD);

      await expect(tracking).resolves.toBe(false);
    });
  });

  describe('a cancelled or aborted drag', () => {
    it('forgets the drag so the next click on the grip moves nothing', async () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);
      drag.cleanup();

      const secondGesture = drag.beginTracking('row', 0, 250, 120);

      release(250, 120);

      await expect(secondGesture).resolves.toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('stops listening for pointercancel once the drag is cleaned up', () => {
      const grid = createGrid();
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({ grid, onAction: vi.fn(), onDragStateChange });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);
      document.dispatchEvent(new PointerEvent('pointercancel'));
      onDragStateChange.mockClear();

      document.dispatchEvent(new PointerEvent('pointercancel'));

      expect(onDragStateChange).not.toHaveBeenCalled();
    });
  });

  describe('the drop indicator element', () => {
    it('paints a horizontal bar spanning the grid for a row drag', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 0, 250, 120);
      move(250, 205);

      const indicator = getIndicator(grid);

      expect(indicator.style.position).toBe('absolute');
      expect(indicator.style.backgroundColor).toBe('rgb(59, 130, 246)');
      expect(indicator.style.borderRadius).toBe('1.5px');
      expect(indicator.style.zIndex).toBe('5');
      expect(indicator.style.pointerEvents).toBe('none');
      expect(indicator.getAttribute('contenteditable')).toBe('false');
      expect(indicator.style.height).toBe('3px');
      expect(indicator.style.left).toBe('-1px');
      expect(indicator.style.right).toBe('0px');
      expect(indicator.style.transition).toBe('top 100ms ease');
      expect(indicator.style.width).toBe('');
    });

    it('paints a vertical bar spanning every row for a column drag', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('col', 0, 250, 150);
      move(450, 150);

      const indicator = getIndicator(grid);

      expect(indicator.style.width).toBe('3px');
      expect(indicator.style.top).toBe('-1px');
      // Last row bottom (150px) plus the border the bar starts above.
      expect(indicator.style.height).toBe('151px');
      expect(indicator.style.transition).toBe('left 100ms ease');
      expect(indicator.style.right).toBe('');
    });
  });

  describe('the drag ghost', () => {
    it('clones the dragged row cells at their measured widths', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const ghost = getGhost();
      const clones = Array.from(ghost.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

      expect(ghost.style.display).toBe('flex');
      expect(ghost.style.height).toBe('60px');
      expect(clones.map(clone => clone.textContent)).toEqual(['r1c0', 'r1c1', 'r1c2']);
      expect(clones.map(clone => clone.style.width)).toEqual(['100px', '150px', '200px']);
      expect(clones.map(clone => clone.style.flexShrink)).toEqual(['0', '0', '0']);
      expect(clones.map(clone => clone.hasAttribute('contenteditable'))).toEqual([false, false, false]);
    });

    it('clones the dragged column cells stacked at their measured heights', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('col', 1, 350, 150);
      move(450, 150);

      const ghost = getGhost();
      const clones = Array.from(ghost.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

      expect(ghost.style.display).toBe('flex');
      expect(ghost.style.flexDirection).toBe('column');
      expect(clones.map(clone => clone.textContent)).toEqual(['r0c1', 'r1c1', 'r2c1']);
      expect(clones.map(clone => clone.style.width)).toEqual(['150px', '150px', '150px']);
      expect(clones.map(clone => clone.style.height)).toEqual(['40px', '60px', '50px']);
      expect(clones.map(clone => clone.hasAttribute('contenteditable'))).toEqual([false, false, false]);
    });

    it('carries the attributes that scope its cloned cell styles outside the editor', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const ghost = getGhost();

      expect(ghost.getAttribute('data-blok-table-drag-ghost')).toBe('');
      expect(ghost.getAttribute('contenteditable')).toBe('false');
      expect(ghost.getAttribute('data-blok-interface')).toBe('table-drag-ghost');
    });

    it('floats above the page without taking pointer events', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const ghost = getGhost();

      expect(ghost.style.position).toBe('fixed');
      expect(ghost.style.pointerEvents).toBe('none');
      expect(ghost.style.opacity).toBe('0.5');
      expect(ghost.style.zIndex).toBe('50');
      expect(ghost.style.borderRadius).toBe('4px');
      expect(ghost.style.overflow).toBe('hidden');
    });

    it('anchors a row ghost to the row it was lifted from and follows the pointer down', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const ghost = getGhost();

      // Grab offset inside row 1 is 30px, so the ghost trails the pointer by 30.
      expect(ghost.style.left).toBe('200px');
      expect(ghost.style.top).toBe('175px');

      // Sideways pointer travel must not move a row ghost.
      move(400, 305);

      expect(ghost.style.left).toBe('200px');
      expect(ghost.style.top).toBe('275px');
    });

    it('anchors a column ghost to the column it was lifted from and follows the pointer sideways', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('col', 1, 350, 150);
      move(450, 150);

      const ghost = getGhost();

      // Grab offset inside column 1 is 50px, so the ghost trails the pointer by 50.
      expect(ghost.style.top).toBe('100px');
      expect(ghost.style.left).toBe('400px');

      // Downward pointer travel must not move a column ghost.
      move(500, 250);

      expect(ghost.style.top).toBe('100px');
      expect(ghost.style.left).toBe('450px');
    });

    it('shadows the ghost for a dark editor theme', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      expect(getGhost().style.boxShadow)
        .toBe('0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)');
    });

    it('shadows the ghost for a light editor theme even when the OS prefers dark', () => {
      document.documentElement.setAttribute('data-blok-theme', 'light');
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn(() => ({ matches: true })),
        configurable: true,
        writable: true,
      });
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      expect(getGhost().style.boxShadow).toBe('0 4px 12px rgba(0, 0, 0, 0.15)');
    });

    it('falls back to the OS colour scheme when the editor declares no theme', () => {
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn((query: string) => ({ matches: query === '(prefers-color-scheme: dark)' })),
        configurable: true,
        writable: true,
      });
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      expect(getGhost().style.boxShadow)
        .toBe('0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)');
    });

    it('shadows the ghost for light when neither a theme nor matchMedia is available', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      expect(getGhost().style.boxShadow).toBe('0 4px 12px rgba(0, 0, 0, 0.15)');
    });
  });

  describe('source cell tint', () => {
    it('tints the dragged cells with the table drag colour token', () => {
      const grid = createGrid();

      grid.style.setProperty('--blok-table-drag-source-bg', 'rgb(1, 2, 3)');
      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const cells = Array.from(grid.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`))
        .filter(cell => (cell.textContent ?? '').startsWith('r1'));

      expect(cells.map(cell => cell.style.backgroundColor)).toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'rgb(1, 2, 3)']);
      expect(cells.map(cell => cell.style.opacity)).toEqual(['0.7', '0.7', '0.7']);
    });

    it('falls back to a grey tint when the token is unset', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const cell = grid.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`)[3];

      expect(cell.style.backgroundColor).toBe('rgb(243, 244, 246)');
    });

    it('falls back to a grey tint when the token holds only whitespace', () => {
      const grid = createGrid();
      const declaration = document.createElement('div').style;

      // jsdom trims custom properties on the way out, so an untrimmed token can
      // only arrive through the computed-style call itself.
      vi.spyOn(declaration, 'getPropertyValue').mockReturnValue('   ');
      vi.spyOn(window, 'getComputedStyle').mockReturnValue(declaration);
      drag = new TableRowColDrag({ grid, onAction: vi.fn() });
      void drag.beginTracking('row', 1, 250, 170);
      move(250, 205);

      const cell = grid.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`)[3];

      expect(cell.style.backgroundColor).toBe('rgb(243, 244, 246)');
    });
  });

  describe('grids the grip index cannot resolve', () => {
    it('starts a row drag on a stale index without throwing', () => {
      const grid = createGrid();

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      const tracked = drag;
      const errors = captureWindowErrors(() => {
        void tracked.beginTracking('row', 5, 250, 170);
        move(250, 205);
      });

      const ghost = getGhost();

      expect(errors).toEqual([]);
      expect(ghost.children).toHaveLength(0);
      expect(ghost.style.left).toBe('');
    });

    it('starts a column drag when the last row has no cell for that column', () => {
      const grid = createGrid({ missingColInLastRow: 1 });

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      const tracked = drag;
      const errors = captureWindowErrors(() => {
        void tracked.beginTracking('col', 1, 350, 150);
        move(450, 150);
      });

      const ghost = getGhost();

      expect(errors).toEqual([]);
      expect(ghost.children).toHaveLength(2);
      // No source rect without a cell in the last row, so the grab offset is 0.
      expect(ghost.style.left).toBe('450px');
      expect(ghost.style.top).toBe('');
    });

    it('starts a column drag on a grid with no rows without throwing', () => {
      const grid = createGrid({ rows: 0 });

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      const tracked = drag;
      const errors = captureWindowErrors(() => {
        void tracked.beginTracking('col', 0, 250, 150);
        move(450, 150);
      });

      expect(errors).toEqual([]);
      expect(getIndicator(grid).style.left).toBe('-1.5px');
      expect(getIndicator(grid).style.height).toBe('1px');
    });
  });

  describe('a row drag on a grid with no rows', () => {
    /**
     * The drag starts, then the drop math reads a row that is not there. The
     * indicator position throws before the cursor is re-derived, which is the
     * only observable left in that move; the release still runs to completion.
     */
    it('leaves the grabbing cursor from the drag start in place', () => {
      const grid = createGrid({ rows: 0 });

      drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      const tracked = drag;
      captureWindowErrors(() => {
        void tracked.beginTracking('row', 0, 250, 120);
        move(250, 205);
      });

      expect(document.body.style.cursor).toBe('grabbing');
    });

    it('resolves the drop at -1 instead of reading the missing row', () => {
      const grid = createGrid({ rows: 0 });
      const onAction = vi.fn();

      drag = new TableRowColDrag({ grid, onAction });

      const tracked = drag;
      captureWindowErrors(() => {
        void tracked.beginTracking('row', 0, 250, 120);
        move(250, 205);
      });

      captureWindowErrors(() => {
        release(250, 205);
      });

      expect(onAction).toHaveBeenCalledWith({ type: 'move-row', fromIndex: 0, toIndex: -1 });
    });
  });

  describe('a callback that tears the drag down mid-gesture', () => {
    it('leaves the indicator and the ghost alone once canDrop has cleaned up', () => {
      const grid = createGrid();
      const onAction = vi.fn();

      drag = new TableRowColDrag({
        grid,
        onAction,
        // The drop target is refused by tearing the whole gesture down, which
        // nulls the indicator and the ghost before the move finishes with them.
        canDrop: () => {
          drag?.cleanup();

          return true;
        },
      });

      const tracked = drag;
      const moveErrors = captureWindowErrors(() => {
        void tracked.beginTracking('row', 0, 250, 120);
        move(250, 205);
      });

      expect(moveErrors).toEqual([]);
      expect(document.body.style.cursor).toBe('grabbing');

      const releaseErrors = captureWindowErrors(() => {
        release(250, 205);
      });

      expect(releaseErrors).toEqual([]);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('does not call the resolver that cleanup dropped before the drop action ran', () => {
      const grid = createGrid();
      const onAction = vi.fn();
      let canDropCalls = 0;

      drag = new TableRowColDrag({
        grid,
        onAction,
        canDrop: () => {
          canDropCalls += 1;

          // Only the drop itself tears the gesture down; the live feedback of
          // the move must leave it running.
          if (canDropCalls > 1) {
            drag?.cleanup();
          }

          return true;
        },
      });

      const tracked = drag;
      const moveErrors = captureWindowErrors(() => {
        void tracked.beginTracking('row', 0, 250, 120);
        move(250, 205);
      });
      const releaseErrors = captureWindowErrors(() => {
        release(250, 205);
      });

      expect(releaseErrors).toEqual([]);
      expect(moveErrors).toEqual([]);
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('detaches the pointer listeners before the drop action runs', () => {
      const grid = createGrid();
      const onAction = vi.fn(() => {
        throw new Error('consumer blew up');
      });
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({ grid, onAction, onDragStateChange });

      const tracked = drag;
      captureWindowErrors(() => {
        void tracked.beginTracking('row', 0, 250, 120);
        move(250, 205);
      });

      // The action throws, so the release never reaches its cleanup and the
      // gesture stays armed. Only the detach at the top of the handler decides
      // whether the next pointer event still reaches it.
      captureWindowErrors(() => {
        release(250, 205);
      });

      const ghost = getGhost();
      const ghostTop = ghost.style.top;

      captureWindowErrors(() => {
        move(600, 400);
      });

      expect(ghost.style.top).toBe(ghostTop);

      captureWindowErrors(() => {
        release(600, 400);
      });

      expect(onAction).toHaveBeenCalledTimes(1);

      onDragStateChange.mockClear();

      captureWindowErrors(() => {
        document.dispatchEvent(new PointerEvent('pointercancel'));
      });

      expect(onDragStateChange).not.toHaveBeenCalled();
    });
  });

  describe('a gesture re-armed from its own drag-state callback', () => {
    interface ReArmedGesture {
      drag: TableRowColDrag;
      calls: Array<[boolean, 'row' | 'col' | null, number]>;
    }

    /**
     * Runs a whole gesture whose end chains another one from inside the
     * drag-state callback. `cleanup()` keeps going after that callback returns,
     * so the fresh gesture is left with no type, no source index and no
     * resolver — the state a caller can put the drag in without touching a
     * private field.
     */
    const startReArmedGesture = (grid: HTMLElement, onAction: (action: RowColAction) => void): ReArmedGesture => {
      const calls: Array<[boolean, 'row' | 'col' | null, number]> = [];
      let rearmed = false;
      let instance: TableRowColDrag | null = null;

      instance = new TableRowColDrag({
        grid,
        onAction,
        onDragStateChange: (isDragging, dragType, dragIndex) => {
          calls.push([isDragging, dragType, dragIndex]);

          if (!isDragging && !rearmed) {
            rearmed = true;
            void instance?.beginTracking('row', 1, 250, 170);
          }
        },
      });

      const created = instance;

      void created.beginTracking('row', 0, 250, 120);
      move(250, 205);
      release(250, 205);

      return { drag: created, calls };
    };

    it('reports the re-armed gesture with the state the callback left behind', () => {
      const grid = createGrid();
      const armed = startReArmedGesture(grid, vi.fn());

      drag = armed.drag;

      move(250, 250);

      expect(armed.calls).toContainEqual([true, null, -1]);
    });

    it('does not aim the drop indicator at a column for a gesture with no type', () => {
      const grid = createGrid();
      const armed = startReArmedGesture(grid, vi.fn());

      drag = armed.drag;

      move(250, 250);

      expect(getIndicator(grid).style.left).toBe('');
    });

    it('does not move a column for a gesture with no type', () => {
      const grid = createGrid();
      const onAction = vi.fn();
      const armed = startReArmedGesture(grid, onAction);

      drag = armed.drag;

      move(250, 250);
      release(330, 250);

      // Only the row move of the first gesture.
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('does not call a resolver the cleanup already dropped when the pointer is cancelled', () => {
      const grid = createGrid();
      const armed = startReArmedGesture(grid, vi.fn());

      drag = armed.drag;

      const errors = captureWindowErrors(() => {
        document.dispatchEvent(new PointerEvent('pointercancel'));
      });

      expect(errors).toEqual([]);
    });

    it('does not call a resolver the cleanup already dropped when the pointer is released', () => {
      const grid = createGrid();
      const armed = startReArmedGesture(grid, vi.fn());

      drag = armed.drag;

      const errors = captureWindowErrors(() => {
        release(250, 170);
      });

      expect(errors).toEqual([]);
    });
  });

  describe('a drag that never began', () => {
    it('ignores pointer events until a gesture is tracked', () => {
      const grid = createGrid();
      const onAction = vi.fn();
      const onDragStateChange = vi.fn();

      drag = new TableRowColDrag({ grid, onAction, onDragStateChange });

      const errors = captureWindowErrors(() => {
        move(400, 400);
        release(400, 400);
        document.dispatchEvent(new PointerEvent('pointercancel'));
      });

      expect(errors).toEqual([]);
      expect(document.body.style.cursor).toBe('');
      expect(document.querySelector(GHOST_SELECTOR)).toBeNull();
      expect(hasIndicator(grid)).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
      expect(onDragStateChange).not.toHaveBeenCalled();
    });
  });
});
