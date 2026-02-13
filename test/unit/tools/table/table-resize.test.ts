import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableResize } from '../../../../src/tools/table/table-resize';

const MIN_COL_WIDTH = 50;

/**
 * Simulate pointer entering an element (hover).
 * Wraps dispatchEvent in a semantic helper to express user intent.
 */
const simulateHover = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseenter');

  element.dispatchEvent(event);
};

/**
 * Simulate pointer leaving an element (unhover).
 * Wraps dispatchEvent in a semantic helper to express user intent.
 */
const simulateUnhover = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseleave');

  element.dispatchEvent(event);
};

/**
 * Creates a grid element with cells at given pixel widths.
 * Mocks getBoundingClientRect on the grid to return the sum.
 */
const createGrid = (colWidthsPx: number[]): HTMLDivElement => {
  const totalWidth = colWidthsPx.reduce((sum, w) => sum + w, 0);
  const container = document.createElement('div');

  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });

  const grid = document.createElement('div');

  const row = document.createElement('div');

  row.setAttribute('data-blok-table-row', '');

  colWidthsPx.forEach((w) => {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell', '');
    cell.style.width = `${w}px`;

    row.appendChild(cell);
  });

  grid.appendChild(row);
  container.appendChild(grid);
  document.body.appendChild(container);

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: totalWidth, left: 0, right: totalWidth, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

const createMultiRowGrid = (rows: number, colWidthsPx: number[]): HTMLDivElement => {
  const totalWidth = colWidthsPx.reduce((sum, w) => sum + w, 0);
  const container = document.createElement('div');

  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) }),
  });

  const grid = document.createElement('div');

  Array.from({ length: rows }).forEach(() => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');

    colWidthsPx.forEach((w) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.style.width = `${w}px`;

      row.appendChild(cell);
    });

    grid.appendChild(row);
  });

  container.appendChild(grid);
  document.body.appendChild(container);

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: totalWidth, left: 0, right: totalWidth, top: 0, bottom: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

describe('TableResize', () => {
  let grid: HTMLDivElement;

  afterEach(() => {
    grid?.parentElement?.remove();
  });

  describe('handle creation', () => {
    it('creates N handles for N columns', () => {
      grid = createGrid([333, 333, 334]);
      new TableResize(grid, [333, 333, 334], vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(3);
    });

    it('does not create handles for single-column grid', () => {
      grid = createGrid([1000]);
      new TableResize(grid, [1000], vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(0);
    });

    it('positions handles as direct children of the grid', () => {
      grid = createGrid([500, 500]);
      new TableResize(grid, [500, 500], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.parentElement).toBe(grid);
    });

    it('handles span full table height including the top border', () => {
      grid = createMultiRowGrid(3, [500, 500]);
      new TableResize(grid, [500, 500], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Negative top offset so the handle covers the grid top border
      expect(handle.style.top).toBe('-1px');
      expect(handle.style.bottom).toBe('0px');
      expect(handle.style.position).toBe('absolute');
    });

    it('sets grid to position relative for handle positioning', () => {
      grid = createGrid([500, 500]);
      new TableResize(grid, [500, 500], vi.fn());

      expect(grid.style.position).toBe('relative');
    });

    it('positions first handle at cumulative pixel offset of first column', () => {
      grid = createGrid([300, 700]);
      new TableResize(grid, [300, 700], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Handle left = column width (300px) minus half handle hit width (8px) = 292px
      expect(handle.style.left).toBe('292px');
    });

    it('sets grid width to sum of column widths plus left border', () => {
      grid = createGrid([300, 400]);
      new TableResize(grid, [300, 400], vi.fn());

      // 300 + 400 = 700, plus 1px for the grid left border
      expect(grid.style.width).toBe('701px');
    });
  });

  describe('single-column drag', () => {
    it('dragging handle changes only the column to its left', () => {
      grid = createGrid([300, 300]);
      const onChange = vi.fn();

      new TableResize(grid, [300, 300], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const newWidths = onChange.mock.calls[0][0] as number[];

      // First column grew by 100px
      expect(newWidths[0]).toBe(400);
      // Second column unchanged
      expect(newWidths[1]).toBe(300);
    });

    it('dragging left shrinks the column and table', () => {
      grid = createGrid([500, 500]);
      const onChange = vi.fn();

      new TableResize(grid, [500, 500], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      // First column shrank by 100px
      expect(newWidths[0]).toBe(400);
      // Second column unchanged
      expect(newWidths[1]).toBe(500);
    });

    it('updates grid width to sum of columns plus left border during drag', () => {
      grid = createGrid([300, 300]);

      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));

      // Grid width should now be 400 + 300 = 700, plus 1px for left border
      expect(grid.style.width).toBe('701px');

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });

    it('updates cell widths in all rows during drag', () => {
      grid = createMultiRowGrid(3, [300, 300]);

      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));

      const rows = grid.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const firstCell = row.querySelector('[data-blok-table-cell]') as HTMLElement;

        expect(firstCell.style.width).toBe('400px');
      });

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });
  });

  describe('clamping', () => {
    it('clamps column to 50px minimum', () => {
      grid = createGrid([100, 500]);
      const onChange = vi.fn();

      new TableResize(grid, [100, 500], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Try to drag left by 200px, would make column -100px
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: -100 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(MIN_COL_WIDTH);
      expect(newWidths[1]).toBe(500);
    });

    it('allows column to exceed container width for horizontal scrolling', () => {
      grid = createGrid([400, 400]);
      const onChange = vi.fn();

      // Container is 1000px, columns total 800px
      new TableResize(grid, [400, 400], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Grow first column by 800px, table becomes 1600px > 1000px container
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 1200 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      // Column should grow to full requested width, no clamping
      expect(newWidths[0]).toBe(1200);
      expect(newWidths[1]).toBe(400);
    });
  });

  describe('three-column table', () => {
    it('dragging middle handle only changes middle column', () => {
      grid = createGrid([200, 300, 200]);
      const onChange = vi.fn();

      new TableResize(grid, [200, 300, 200], onChange);

      // Get second handle (index 1, controls column 1)
      const handles = grid.querySelectorAll('[data-blok-table-resize]');
      const middleHandle = handles[1] as HTMLElement;

      middleHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 550 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(200);  // unchanged
      expect(newWidths[1]).toBe(350);  // grew by 50
      expect(newWidths[2]).toBe(200);  // unchanged
    });

    it('dragging last handle controls last column', () => {
      grid = createGrid([300, 300, 400]);
      const onChange = vi.fn();

      new TableResize(grid, [300, 300, 400], onChange);

      const handles = grid.querySelectorAll('[data-blok-table-resize]');
      const lastHandle = handles[2] as HTMLElement;

      lastHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 900 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(300);  // unchanged
      expect(newWidths[1]).toBe(300);  // unchanged
      expect(newWidths[2]).toBe(300);  // shrank by 100
    });
  });

  describe('handle appear animation', () => {
    it('handles start invisible with transition for smooth animation', () => {
      grid = createGrid([300, 300]);
      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.style.opacity).toBe('0');
      expect(handle.style.transition).toContain('opacity');
    });

    it('handles always have the gradient background set', () => {
      grid = createGrid([300, 300]);
      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.style.background).toContain('linear-gradient');
    });

    it('handle becomes visible on mouseenter', () => {
      grid = createGrid([300, 300]);
      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      simulateHover(handle);

      expect(handle.style.opacity).toBe('1');
    });

    it('handle becomes invisible on mouseleave', () => {
      grid = createGrid([300, 300]);
      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      simulateHover(handle);
      simulateUnhover(handle);

      expect(handle.style.opacity).toBe('0');
    });

    it('handle stays visible during drag even after mouseleave', () => {
      grid = createGrid([300, 300]);
      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      simulateUnhover(handle);

      expect(handle.style.opacity).toBe('1');
    });

    it('handle becomes invisible after drag ends', () => {
      grid = createGrid([300, 300]);
      new TableResize(grid, [300, 300], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(handle.style.opacity).toBe('0');
    });
  });

  describe('onDrag callback', () => {
    it('calls onDrag on each pointermove during drag', () => {
      grid = createGrid([300, 300]);
      const onDrag = vi.fn();

      new TableResize(grid, [300, 300], vi.fn(), undefined, onDrag);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 350 }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));

      expect(onDrag).toHaveBeenCalledTimes(2);

      const firstCell = grid.querySelector('[data-blok-table-cell]') as HTMLElement;

      expect(firstCell.style.width).toBe('400px');

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });

    it('does not call onDrag when not dragging', () => {
      grid = createGrid([300, 300]);
      const onDrag = vi.fn();

      new TableResize(grid, [300, 300], vi.fn(), undefined, onDrag);

      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));

      expect(onDrag).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('removes event listeners on destroy', () => {
      grid = createGrid([300, 300]);
      const onChange = vi.fn();
      const resize = new TableResize(grid, [300, 300], onChange);

      // Grab handle reference before destroy removes it from DOM
      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      resize.destroy();

      // Re-add the handle to the grid to dispatch events on it
      grid.appendChild(handle);

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('removes handle elements from the grid on destroy', () => {
      grid = createGrid([300, 300]);
      const resize = new TableResize(grid, [300, 300], vi.fn());

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(2);

      resize.destroy();

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(0);
    });
  });

  describe('skipInitialApply', () => {
    /**
     * Helper: creates a grid with percentage-width cells (like a newly inserted table).
     */
    const createPercentGrid = (cols: number): HTMLDivElement => {
      const container = document.createElement('div');
      const grid = document.createElement('div');
      const row = document.createElement('div');
      const pctWidth = `${Math.round((100 / cols) * 100) / 100}%`;

      row.setAttribute('data-blok-table-row', '');

      Array.from({ length: cols }).forEach(() => {
        const cell = document.createElement('div');

        cell.setAttribute('data-blok-table-cell', '');
        cell.style.width = pctWidth;
        row.appendChild(cell);
      });

      grid.appendChild(row);
      container.appendChild(grid);
      document.body.appendChild(container);

      return grid;
    };

    it('does not apply pixel widths to cells when skipInitialApply is true', () => {
      grid = createPercentGrid(3);

      new TableResize(grid, [200, 200, 200], vi.fn(), undefined, undefined, true);

      const cells = grid.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.width).toBe('33.33%');
      });
    });

    it('does not set explicit width on grid when skipInitialApply is true', () => {
      grid = createPercentGrid(3);

      new TableResize(grid, [200, 200, 200], vi.fn(), undefined, undefined, true);

      expect(grid.style.width).toBe('');
    });

    it('still creates handles when skipInitialApply is true', () => {
      grid = createPercentGrid(3);

      new TableResize(grid, [200, 200, 200], vi.fn(), undefined, undefined, true);

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(3);
    });

    it('applies pixel widths on first pointer down', () => {
      grid = createPercentGrid(3);

      new TableResize(grid, [200, 200, 200], vi.fn(), undefined, undefined, true);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, bubbles: true }));

      // Grid should now have explicit pixel width: 200+200+200 + 1px border
      expect(grid.style.width).toBe('601px');

      const cells = grid.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.width).toBe('200px');
      });

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });

    it('allows normal drag after initial apply', () => {
      grid = createPercentGrid(2);
      const onChange = vi.fn();

      new TableResize(grid, [300, 300], onChange, undefined, undefined, true);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(400);
      expect(newWidths[1]).toBe(300);
    });
  });

});
