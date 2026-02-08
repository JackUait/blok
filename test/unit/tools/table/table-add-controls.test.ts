import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TableAddControls } from '../../../../src/tools/table/table-add-controls';

const ADD_ROW_ATTR = 'data-blok-table-add-row';
const ADD_COL_ATTR = 'data-blok-table-add-col';

const createGridAndWrapper = (rows: number, cols: number): { wrapper: HTMLDivElement; grid: HTMLDivElement } => {
  const wrapper = document.createElement('div');
  const grid = document.createElement('div');

  grid.style.position = 'relative';

  Array.from({ length: rows }).forEach(() => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');

    Array.from({ length: cols }).forEach(() => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      row.appendChild(cell);
    });

    grid.appendChild(row);
  });

  wrapper.appendChild(grid);
  document.body.appendChild(wrapper);

  return { wrapper, grid };
};

const defaultDragCallbacks = (): {
  onDragAddRow: () => void;
  onDragRemoveRow: () => void;
  onDragAddCol: () => void;
  onDragRemoveCol: () => void;
  onDragEnd: () => void;
} => ({
  onDragAddRow: vi.fn(),
  onDragRemoveRow: vi.fn(),
  onDragAddCol: vi.fn(),
  onDragRemoveCol: vi.fn(),
  onDragEnd: vi.fn(),
});

/**
 * Simulate a click via pointer events (pointerdown + pointerup at same position).
 * Mocks setPointerCapture and releasePointerCapture for jsdom compatibility.
 */
const simulateClick = (element: HTMLElement): void => {
  // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
  element.setPointerCapture = vi.fn();
  // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
  element.releasePointerCapture = vi.fn();

  element.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    bubbles: true,
  }));

  element.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    bubbles: true,
  }));
};

describe('TableAddControls', () => {
  let wrapper: HTMLDivElement;
  let grid: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.remove();
    vi.restoreAllMocks();
  });

  describe('button creation', () => {
    it('creates an add-row button with the correct data attribute', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);

      expect(addRowBtn).not.toBeNull();
    });

    it('creates an add-column button with the correct data attribute', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addColBtn).not.toBeNull();
    });

    it('add-row button contains a plus SVG icon', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.querySelector('svg')).not.toBeNull();
    });

    it('add-column button contains a plus SVG icon', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.querySelector('svg')).not.toBeNull();
    });

    it('both buttons are contenteditable false', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addRowBtn?.getAttribute('contenteditable')).toBe('false');
      expect(addColBtn?.getAttribute('contenteditable')).toBe('false');
    });
  });

  describe('visibility', () => {
    /**
     * Helper: dispatch a mousemove on the wrapper at the given clientX/clientY.
     * We also stub grid.getBoundingClientRect so the proximity calculation works
     * inside jsdom (which returns all-zero rects by default).
     */
    const moveNear = (
      target: HTMLElement,
      gridEl: HTMLElement,
      clientX: number,
      clientY: number,
      rect: DOMRect = new DOMRect(0, 0, 200, 100),
    ): void => {
      vi.spyOn(gridEl, 'getBoundingClientRect').mockReturnValue(rect);
      target.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }));
    };

    it('buttons start hidden (opacity 0)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('0');
    });

    it('add-row button becomes visible when cursor is near the bottom edge', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid rect: top=0, left=0, width=200, height=100 → bottom=100, right=200
      // Move cursor near bottom (y=90) but far from right (x=50)
      moveNear(wrapper, grid, 50, 90);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');
      expect(addColBtn.style.opacity).toBe('0');
    });

    it('add-column button becomes visible when cursor is near the right edge', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Move cursor near right (x=190) but far from bottom (y=20)
      moveNear(wrapper, grid, 190, 20);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('1');
    });

    it('both buttons visible when cursor is near the bottom-right corner', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Near both edges
      moveNear(wrapper, grid, 190, 90);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');
      expect(addColBtn.style.opacity).toBe('1');
    });

    it('buttons hide on wrapper mouseleave', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      vi.useFakeTimers();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Show both buttons first
      moveNear(wrapper, grid, 190, 90);
      wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

      vi.advanceTimersByTime(200);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('0');

      vi.useRealTimers();
    });

    it('button hides when cursor moves away from its edge', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      vi.useFakeTimers();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Show add-row by moving near bottom
      moveNear(wrapper, grid, 50, 90);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');

      // Move away from bottom
      moveNear(wrapper, grid, 50, 20);
      vi.advanceTimersByTime(200);

      expect(addRowBtn.style.opacity).toBe('0');

      vi.useRealTimers();
    });
  });

  describe('click handlers', () => {
    it('calls onAddRow when add-row button is clicked', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const onAddRow = vi.fn();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow,
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      simulateClick(addRowBtn);

      expect(onAddRow).toHaveBeenCalledTimes(1);
    });

    it('calls onAddColumn when add-column button is clicked', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const onAddColumn = vi.fn();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn,
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      simulateClick(addColBtn);

      expect(onAddColumn).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('removes both buttons from the DOM', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const controls = new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      controls.destroy();

      expect(wrapper.querySelector(`[${ADD_ROW_ATTR}]`)).toBeNull();
      expect(grid.querySelector(`[${ADD_COL_ATTR}]`)).toBeNull();
    });

    it('removes hover listeners after destroy', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const controls = new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      controls.destroy();

      // Re-create button elements manually to check listeners don't fire
      const addRowBtn = document.createElement('div');

      addRowBtn.setAttribute(ADD_ROW_ATTR, '');
      addRowBtn.style.opacity = '0';
      wrapper.appendChild(addRowBtn);

      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
      wrapper.dispatchEvent(new MouseEvent('mousemove', { clientX: 190, clientY: 90, bubbles: true }));

      // The manually-added element should stay at opacity 0 since listeners were removed
      expect(addRowBtn.style.opacity).toBe('0');
    });

    it('does not fire click callbacks after destroy', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const onAddRow = vi.fn();
      const onAddColumn = vi.fn();

      const controls = new TableAddControls({
        wrapper,
        grid,
        onAddRow,
        onAddColumn,
        ...defaultDragCallbacks(),
      });

      // Grab references before destroy removes them
      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      controls.destroy();

      // Re-add to DOM to dispatch events
      wrapper.appendChild(addRowBtn);
      grid.appendChild(addColBtn);

      addRowBtn.setPointerCapture = vi.fn();
      addRowBtn.releasePointerCapture = vi.fn();
      addColBtn.setPointerCapture = vi.fn();
      addColBtn.releasePointerCapture = vi.fn();

      simulateClick(addRowBtn);
      simulateClick(addColBtn);

      expect(onAddRow).not.toHaveBeenCalled();
      expect(onAddColumn).not.toHaveBeenCalled();
    });
  });

  describe('positioning', () => {
    it('add-row button is appended after the grid in the wrapper', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);

      // Should be a direct child of wrapper, after grid
      expect(addRowBtn?.parentElement).toBe(wrapper);
      expect(addRowBtn?.previousElementSibling).toBe(grid);
    });

    it('add-column button is inside the grid element', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addColBtn?.parentElement).toBe(grid);
    });

    it('add-column button is absolutely positioned', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.position).toBe('absolute');
      expect(addColBtn.style.top).toBe('0px');
      expect(addColBtn.style.bottom).toBe('0px');
    });
  });

  describe('cursor', () => {
    it('add-row button has a row-resize cursor', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.className).toContain('cursor-row-resize');
      expect(addRowBtn.className).not.toContain('cursor-pointer');
    });

    it('add-column button has a col-resize cursor', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.className).toContain('cursor-col-resize');
      expect(addColBtn.className).not.toContain('cursor-pointer');
    });
  });

  describe('drag to remove', () => {
    /**
     * Simulate a pointer drag on an element:
     * pointerdown at startPos, pointermove to endPos, pointerup at endPos.
     */
    const simulateDrag = (
      element: HTMLElement,
      axis: 'row' | 'col',
      startPos: number,
      endPos: number,
    ): void => {
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.setPointerCapture = vi.fn();
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.releasePointerCapture = vi.fn();

      const clientKey = axis === 'row' ? 'clientY' : 'clientX';

      element.dispatchEvent(new PointerEvent('pointerdown', {
        [clientKey]: startPos,
        pointerId: 1,
        bubbles: true,
      }));

      element.dispatchEvent(new PointerEvent('pointermove', {
        [clientKey]: endPos,
        pointerId: 1,
        bubbles: true,
      }));

      element.dispatchEvent(new PointerEvent('pointerup', {
        [clientKey]: endPos,
        pointerId: 1,
        bubbles: true,
      }));
    };

    it('calls onDragRemoveRow when dragging add-row button upwards', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Drag upward by 100px (negative direction) — should trigger removal
      simulateDrag(addRowBtn, 'row', 200, 100);

      expect(callbacks.onDragRemoveRow).toHaveBeenCalled();
    });

    it('calls onDragRemoveCol when dragging add-col button leftwards', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      // Drag leftward by 200px (negative direction) — should trigger removal
      simulateDrag(addColBtn, 'col', 300, 100);

      expect(callbacks.onDragRemoveCol).toHaveBeenCalled();
    });

    it('calls onDragEnd after drag-to-remove completes', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      simulateDrag(addRowBtn, 'row', 200, 100);

      expect(callbacks.onDragEnd).toHaveBeenCalled();
    });
  });

  describe('tooltip', () => {
    it('add-row button has a title attribute for tooltip', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.getAttribute('title')).toContain('row');
    });

    it('add-column button has a title attribute for tooltip', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.getAttribute('title')).toContain('column');
    });
  });
});
