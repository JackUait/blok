import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableResize } from '../../../../src/tools/table/table-resize';

const MIN_COL_WIDTH = 10;

const createGrid = (colWidths: number[]): HTMLDivElement => {
  const grid = document.createElement('div');

  grid.style.borderTop = '1px solid #d1d5db';
  grid.style.borderLeft = '1px solid #d1d5db';

  const row = document.createElement('div');

  row.setAttribute('data-blok-table-row', '');

  colWidths.forEach((w, i) => {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell', '');
    cell.style.width = `${w}%`;
    cell.style.position = 'relative';
    cell.style.borderRight = '1px solid #d1d5db';
    cell.style.borderBottom = '1px solid #d1d5db';

    if (i < colWidths.length - 1) {
      const handle = document.createElement('div');

      handle.setAttribute('data-blok-table-resize', '');
      handle.style.position = 'absolute';
      handle.style.right = '0px';
      handle.style.top = '0px';
      handle.style.bottom = '0px';
      handle.style.width = '6px';
      handle.style.cursor = 'col-resize';
      cell.appendChild(handle);
    }

    row.appendChild(cell);
  });

  grid.appendChild(row);
  document.body.appendChild(grid);

  // Fake getBoundingClientRect for the grid
  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

describe('TableResize', () => {
  let grid: HTMLDivElement;

  afterEach(() => {
    grid?.remove();
  });

  describe('pointer drag', () => {
    it('calls onChange with updated widths after drag', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      new TableResize(grid, [50, 50], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Simulate drag: pointerdown, pointermove, pointerup
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const newWidths = onChange.mock.calls[0][0] as number[];

      // Dragged right 100px on 1000px table = 10% increase to left column
      expect(newWidths[0]).toBeCloseTo(60, 0);
      expect(newWidths[1]).toBeCloseTo(40, 0);
    });

    it('clamps columns to minimum width', () => {
      grid = createGrid([15, 85]);
      const onChange = vi.fn();

      new TableResize(grid, [15, 85], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Drag left 100px = -10%, would make left column 5% (below minimum)
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 150, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(MIN_COL_WIDTH);
      expect(newWidths[1]).toBe(90);
    });
  });

  describe('destroy', () => {
    it('removes event listeners on destroy', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();
      const resize = new TableResize(grid, [50, 50], onChange);

      resize.destroy();

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
