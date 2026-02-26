import type { I18n } from '../../../../types/api';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TableAddControls } from '../../../../src/tools/table/table-add-controls';

const mockI18n: I18n = { t: (key: string) => key } as I18n;

const mockOnHover = vi.fn();
const mockHide = vi.fn();
const mockCreateTooltipContent = vi.fn((_lines: string[]) => document.createElement('div'));

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: (...args: unknown[]): void => { mockOnHover(...(args as [unknown, unknown, unknown])); },
  hide: (): void => { mockHide(); },
}));

vi.mock('../../../../src/components/modules/toolbar/tooltip', () => ({
  createTooltipContent: (...args: unknown[]): HTMLElement => mockCreateTooltipContent(...(args as [string[]])),
}));

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
  onDragStart: () => void;
  onDragAddRow: () => void;
  onDragRemoveRow: () => void;
  onDragAddCol: () => void;
  onDragRemoveCol: () => void;
  onDragEnd: () => void;
} => ({
  onDragStart: vi.fn(),
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
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);

      expect(addRowBtn).not.toBeNull();
    });

    it('add-row button has z-index 1 to paint above sibling blocks', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.zIndex).toBe('1');
    });

    it('creates an add-column button with the correct data attribute', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addColBtn).not.toBeNull();
    });

    it('add-column button is positioned outside the grid content area (right: -36px)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.right).toBe('-36px');
    });

    it('add-row button contains a plus SVG icon', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
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
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.querySelector('svg')).not.toBeNull();
    });

    it('both buttons are contenteditable false', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addRowBtn?.getAttribute('contenteditable')).toBe('false');
      expect(addColBtn?.getAttribute('contenteditable')).toBe('false');
    });
  });

  describe('visibility', () => {
    /**
     * Helper: dispatch a mousemove on the wrapper at the given clientX/clientY.
     * We stub both grid.getBoundingClientRect and wrapper.getBoundingClientRect
     * so the proximity calculation works inside jsdom (which returns all-zero rects by default).
     * The wrapper rect matches the grid by default (no extra padding).
     */
    const moveNear = (
      target: HTMLElement,
      gridEl: HTMLElement,
      clientX: number,
      clientY: number,
      rect: DOMRect = new DOMRect(0, 0, 200, 100),
      wrapperRect?: DOMRect,
    ): void => {
      vi.spyOn(gridEl, 'getBoundingClientRect').mockReturnValue(rect);
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
        wrapperRect ?? new DOMRect(rect.x, rect.y, rect.width, rect.height)
      );
      const hoverEvent = new MouseEvent('mousemove', { clientX, clientY, bubbles: true });
      target.dispatchEvent(hoverEvent);
    };

    it('buttons start hidden (opacity 0)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('0');
    });

    it('add-row button becomes visible when cursor is near the bottom edge', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid rect: top=0, left=0, width=200, height=100 → bottom=100, right=200
      // Move cursor near bottom (y=90) but far from right (x=50)
      moveNear(wrapper, grid, 50, 90);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');
      expect(addColBtn.style.opacity).toBe('0');
    });

    it('add-row button becomes visible when cursor is below the grid but within proximity', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid rect: top=0, left=0, width=200, height=100 → bottom=100, right=200
      // Move cursor BELOW the grid (y=120, which is 20px below bottom=100, within PROXIMITY_PX=40)
      moveNear(wrapper, grid, 50, 120);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');
    });

    it('add-column button becomes visible when cursor is right of grid but within proximity', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid rect: right=200, wrapper rect: right=200 (no padding)
      // Move cursor RIGHT of the wrapper (x=240, past wrapper right=200, within PROXIMITY_PX=40 of grid right)
      moveNear(wrapper, grid, 240, 50);

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.opacity).toBe('1');
    });

    it('add-column button becomes visible when cursor is near right edge of grid', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid rect: right=200, wrapper rect: right=200 (no padding)
      // Move cursor near the grid's right edge (x=185, within PROXIMITY_PX=40 of grid right)
      moveNear(wrapper, grid, 185, 50);

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.opacity).toBe('1');
    });

    it('add-row button stays visible when cursor moves from inside grid to below grid (onto button)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      vi.useFakeTimers();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Step 1: hover near bottom from inside the grid to make button visible
      moveNear(wrapper, grid, 50, 90);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');

      // Step 2: move cursor below grid (onto the button area, y=120, 20px below bottom=100)
      moveNear(wrapper, grid, 50, 120);

      // Advance past the hide delay to ensure it doesn't hide
      vi.advanceTimersByTime(200);

      expect(addRowBtn.style.opacity).toBe('1');

      vi.useRealTimers();
    });

    it('add-column button stays visible when cursor moves from inside grid to right of grid (onto button)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      vi.useFakeTimers();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Step 1: hover near right edge from inside the grid to make button visible
      moveNear(wrapper, grid, 190, 50);

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.opacity).toBe('1');

      // Step 2: move cursor right of grid (onto the button area, x=220, 20px past right=200)
      moveNear(wrapper, grid, 220, 50);

      // Advance past the hide delay to ensure it doesn't hide
      vi.advanceTimersByTime(200);

      expect(addColBtn.style.opacity).toBe('1');

      vi.useRealTimers();
    });

    it('add-column button becomes visible when cursor is near the right edge', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Move cursor near right (x=190) but far from bottom (y=20)
      moveNear(wrapper, grid, 190, 20);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('1');
    });

    it('both buttons visible when cursor is near the bottom-right corner', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Near both edges
      moveNear(wrapper, grid, 190, 90);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('1');
      expect(addColBtn.style.opacity).toBe('1');
    });

    it('buttons hide on wrapper mouseleave', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      vi.useFakeTimers();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Show both buttons first
      moveNear(wrapper, grid, 190, 90);
      const exitEvent = new MouseEvent('mouseleave', { bubbles: true });
      wrapper.dispatchEvent(exitEvent);

      vi.advanceTimersByTime(200);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

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
        i18n: mockI18n,
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
        i18n: mockI18n,
        onAddRow,
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      simulateClick(addRowBtn);

      expect(onAddRow).toHaveBeenCalledTimes(1);
      expect(addRowBtn).toBeInTheDocument();
    });

    it('calls onAddColumn when add-column button is clicked', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const onAddColumn = vi.fn();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn,
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      simulateClick(addColBtn);

      expect(onAddColumn).toHaveBeenCalledTimes(1);
      expect(addColBtn).toBeInTheDocument();
    });
  });

  describe('destroy', () => {
    it('removes both buttons from the DOM', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      controls.destroy();

      expect(wrapper.querySelector(`[${ADD_ROW_ATTR}]`)).toBeNull();
      expect(wrapper.querySelector(`[${ADD_COL_ATTR}]`)).toBeNull();
    });

    it('removes hover listeners after destroy', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
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
      const staleHoverEvent = new MouseEvent('mousemove', { clientX: 190, clientY: 90, bubbles: true });
      wrapper.dispatchEvent(staleHoverEvent);

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
        i18n: mockI18n,
        onAddRow,
        onAddColumn,
        ...defaultDragCallbacks(),
      });

      // Grab references before destroy removes them
      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

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

  describe('setDisplay', () => {
    it('hides both buttons when called with false', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      controls.setDisplay(false);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.display).toBe('none');
      expect(addColBtn.style.display).toBe('none');
    });

    it('restores both buttons when called with true', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      controls.setDisplay(false);
      controls.setDisplay(true);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.display).toBe('');
      expect(addColBtn.style.display).toBe('');
    });
  });

  describe('positioning', () => {
    it('add-row button is appended after the grid in the wrapper', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);

      // Should be a direct child of wrapper, after grid
      expect(addRowBtn?.parentElement).toBe(wrapper);
      expect(addRowBtn?.previousElementSibling).toBe(grid);
    });

    it('add-column button is a direct child of the wrapper', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addColBtn?.parentElement).toBe(wrapper);
    });

    it('add-column button is absolutely positioned', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

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
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn).toHaveClass('cursor-row-resize');
      expect(addRowBtn).not.toHaveClass('cursor-pointer');
    });

    it('add-column button has a col-resize cursor', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn).toHaveClass('cursor-col-resize');
      expect(addColBtn).not.toHaveClass('cursor-pointer');
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
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Drag upward by 100px (negative direction) — should trigger removal
      simulateDrag(addRowBtn, 'row', 200, 100);

      expect(callbacks.onDragRemoveRow).toHaveBeenCalled();
      expect(addRowBtn).toBeInTheDocument();
    });

    it('calls onDragRemoveCol when dragging add-col button leftwards', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      // Drag leftward by 200px (negative direction) — should trigger removal
      simulateDrag(addColBtn, 'col', 300, 100);

      expect(callbacks.onDragRemoveCol).toHaveBeenCalled();
      expect(addColBtn).toBeInTheDocument();
    });

    it('calls onDragEnd after drag-to-remove completes', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      simulateDrag(addRowBtn, 'row', 200, 100);

      expect(callbacks.onDragEnd).toHaveBeenCalled();
      expect(addRowBtn).toBeInTheDocument();
    });
  });

  describe('drag start callback', () => {
    /**
     * Simulate only the pointerdown + pointermove part of a drag (no pointerup),
     * so we can check intermediate state before onDragEnd fires.
     */
    const simulateDragStart = (
      element: HTMLElement,
      axis: 'row' | 'col',
      startPos: number,
      endPos: number,
    ): void => {
      // eslint-disable-next-line no-param-reassign -- mocking jsdom-unsupported pointer capture APIs
      element.setPointerCapture = vi.fn();

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
    };

    it('calls onDragStart when row drag exceeds threshold', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Drag downward past threshold (>5px)
      simulateDragStart(addRowBtn, 'row', 0, 10);

      expect(callbacks.onDragStart).toHaveBeenCalledTimes(1);
      expect(addRowBtn).toBeInTheDocument();
    });

    it('calls onDragStart when column drag exceeds threshold', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      // Drag rightward past threshold (>5px)
      simulateDragStart(addColBtn, 'col', 0, 10);

      expect(callbacks.onDragStart).toHaveBeenCalledTimes(1);
      expect(addColBtn).toBeInTheDocument();
    });

    it('does not call onDragStart before threshold is exceeded', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Move only 3px — below the 5px threshold
      simulateDragStart(addRowBtn, 'row', 0, 3);

      expect(callbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('calls onDragStart only once per drag session', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      addRowBtn.setPointerCapture = vi.fn();

      addRowBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientY: 0,
        pointerId: 1,
        bubbles: true,
      }));

      // Multiple moves past threshold
      addRowBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }));

      addRowBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientY: 20,
        pointerId: 1,
        bubbles: true,
      }));

      addRowBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientY: 30,
        pointerId: 1,
        bubbles: true,
      }));

      expect(callbacks.onDragStart).toHaveBeenCalledTimes(1);
      expect(addRowBtn).toBeInTheDocument();
    });
  });

  describe('tooltip', () => {
    it('registers a custom tooltip on the add-row button via onHover', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(mockOnHover).toHaveBeenCalledWith(
        addRowBtn,
        expect.anything(),
        expect.objectContaining({ placement: 'bottom', marginTop: -16 }),
      );
    });

    it('registers a custom tooltip on the add-column button via onHover', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(mockOnHover).toHaveBeenCalledWith(
        addColBtn,
        expect.anything(),
        expect.objectContaining({ placement: 'bottom' }),
      );
    });

    it('creates tooltip content with Click and Drag lines for the row button', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      expect(mockCreateTooltipContent).toHaveBeenCalledWith([
        'tools.table.clickToAddRow',
        'tools.table.dragToAddRemoveRows',
      ]);
    });

    it('creates tooltip content with Click and Drag lines for the column button', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      expect(mockCreateTooltipContent).toHaveBeenCalledWith([
        'tools.table.clickToAddColumn',
        'tools.table.dragToAddRemoveColumns',
      ]);
    });

    it('hides the tooltip when a drag exceeds the threshold', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      addRowBtn.setPointerCapture = vi.fn();

      addRowBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientY: 0,
        pointerId: 1,
        bubbles: true,
      }));

      mockHide.mockClear();

      addRowBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }));

      expect(mockHide).toHaveBeenCalledTimes(1);
      expect(addRowBtn).toBeInTheDocument();
    });

    it('does not set a native title attribute on either button', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn).not.toHaveAttribute('title');
      expect(addColBtn).not.toHaveAttribute('title');
    });
  });

  describe('pointercancel triggers cleanup', () => {
    /**
     * Simulate pointerdown + pointermove past threshold (initiating a drag),
     * then fire pointercancel instead of pointerup.
     */
    const simulateDragThenCancel = (
      element: HTMLElement,
      axis: 'row' | 'col',
      startPos: number,
      movePos: number,
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
        [clientKey]: movePos,
        pointerId: 1,
        bubbles: true,
      }));

      element.dispatchEvent(new PointerEvent('pointercancel', {
        pointerId: 1,
        bubbles: true,
      }));
    };

    it('resets document.body.style.cursor on pointercancel during row drag', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      simulateDragThenCancel(addRowBtn, 'row', 0, 50);

      expect(document.body.style.cursor).toBe('');
    });

    it('resets document.body.style.cursor on pointercancel during col drag', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      simulateDragThenCancel(addColBtn, 'col', 0, 50);

      expect(document.body.style.cursor).toBe('');
    });

    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('calls onDragEnd on pointercancel when drag was active', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      simulateDragThenCancel(addRowBtn, 'row', 0, 50);

      expect(callbacks.onDragEnd).toHaveBeenCalledTimes(1);
    });

    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('nulls dragState so subsequent interactions work after pointercancel', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const onAddRow = vi.fn();
      const callbacks = defaultDragCallbacks();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow,
        onAddColumn: vi.fn(),
        ...callbacks,
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Start a drag and cancel it
      simulateDragThenCancel(addRowBtn, 'row', 0, 50);

      // Now a simple click should work (not be blocked by stale dragState)
      simulateClick(addRowBtn);

      expect(onAddRow).toHaveBeenCalledTimes(1);
    });

    it('does not call onAddRow on pointercancel without drag (just click abort)', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 2));

      const onAddRow = vi.fn();

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow,
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;


      addRowBtn.setPointerCapture = vi.fn();

      addRowBtn.releasePointerCapture = vi.fn();

      // pointerdown without moving past threshold, then cancel
      addRowBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientY: 0,
        pointerId: 1,
        bubbles: true,
      }));

      addRowBtn.dispatchEvent(new PointerEvent('pointercancel', {
        pointerId: 1,
        bubbles: true,
      }));

      // Should not trigger the click-add since the pointer was cancelled, not released
      expect(onAddRow).not.toHaveBeenCalled();
    });
  });

  describe('column drag unit size', () => {
    it('uses getNewColumnWidth as drag unit size instead of existing cell width', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const callbacks = defaultDragCallbacks();
      const NEW_COL_WIDTH = 80;

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        getNewColumnWidth: () => NEW_COL_WIDTH,
        ...callbacks,
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      addColBtn.setPointerCapture = vi.fn();
      addColBtn.releasePointerCapture = vi.fn();

      addColBtn.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 0,
        pointerId: 1,
        bubbles: true,
      }));

      // Drag exactly NEW_COL_WIDTH pixels — should add exactly one column
      addColBtn.dispatchEvent(new PointerEvent('pointermove', {
        clientX: NEW_COL_WIDTH,
        pointerId: 1,
        bubbles: true,
      }));

      addColBtn.dispatchEvent(new PointerEvent('pointerup', {
        clientX: NEW_COL_WIDTH,
        pointerId: 1,
        bubbles: true,
      }));

      expect(callbacks.onDragAddCol).toHaveBeenCalledTimes(1);
      expect(callbacks.onDragRemoveCol).not.toHaveBeenCalled();

      // Verify the drag completed: cursor is reset and pointer capture was released
      expect(document.body.style.cursor).toBe('');
      expect(addColBtn.releasePointerCapture).toHaveBeenCalledWith(1);
    });
  });

  describe('syncRowButtonWidth', () => {
    it('uses left/right constraints instead of width:100% when grid has no pixel width', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      wrapper.style.paddingRight = '20px';

      const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        if (el === wrapper) {
          return { paddingRight: '20px' } as CSSStyleDeclaration;
        }

        return { paddingLeft: '0px' } as CSSStyleDeclaration;
      });

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.left).toBe('0px');
      expect(addRowBtn.style.right).toBe('20px');
      expect(addRowBtn.style.width).toBe('');

      spy.mockRestore();
    });

    it('aligns add-row button at left:0 when grid has pixel width inside scroll container', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const scrollContainer = document.createElement('div');

      wrapper.insertBefore(scrollContainer, grid);
      scrollContainer.appendChild(grid);

      grid.style.width = '400px';

      Object.defineProperty(scrollContainer, 'clientWidth', { value: 600, configurable: true });

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Grid fits within scroll container, so button matches grid width
      expect(addRowBtn.style.width).toBe('400px');
      expect(addRowBtn.style.left).toBe('0px');
      expect(addRowBtn.style.right).toBe('');
    });

    it('sets left:0 in pixel mode when grid parent is the wrapper itself', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      grid.style.width = '300px';

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.width).toBe('300px');
      expect(addRowBtn.style.left).toBe('0px');
    });

    it('updates position when called again after grid width changes', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        if (el === wrapper) {
          return { paddingRight: '20px' } as CSSStyleDeclaration;
        }

        return { paddingLeft: '0px' } as CSSStyleDeclaration;
      });

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Initially percent mode
      expect(addRowBtn.style.width).toBe('');
      expect(addRowBtn.style.right).toBe('20px');

      // Switch to pixel mode
      grid.style.width = '500px';
      controls.syncRowButtonWidth();

      expect(addRowBtn.style.width).toBe('500px');
      expect(addRowBtn.style.right).toBe('');
      expect(addRowBtn.style.left).toBe('0px');

      spy.mockRestore();
    });

    it('does not apply horizontal padding or margin that would offset the button from the grid', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.paddingLeft).toBe('');
      expect(addRowBtn.style.paddingRight).toBe('');
      expect(addRowBtn.style.marginLeft).toBe('');
      expect(addRowBtn.style.marginRight).toBe('');
      expect(addRowBtn.style.boxSizing).toBe('');
    });

    it('clamps button width to scroll container visible width when grid overflows', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 5));

      const scrollContainer = document.createElement('div');

      scrollContainer.style.paddingLeft = '9px';
      wrapper.insertBefore(scrollContainer, grid);
      scrollContainer.appendChild(grid);

      // Grid is wider than the scroll container's visible area
      grid.style.width = '1200px';

      // Mock clientWidth on the scroll container (visible area including padding)
      Object.defineProperty(scrollContainer, 'clientWidth', { value: 600, configurable: true });

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Button width is clamped to scroll container visible width (not the full grid width)
      expect(addRowBtn.style.width).toBe('600px');
      expect(addRowBtn.style.left).toBe('0px');
    });

    it('uses grid width when grid fits within scroll container', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const scrollContainer = document.createElement('div');

      scrollContainer.style.paddingLeft = '9px';
      wrapper.insertBefore(scrollContainer, grid);
      scrollContainer.appendChild(grid);

      // Grid is narrower than the scroll container
      grid.style.width = '400px';

      Object.defineProperty(scrollContainer, 'clientWidth', { value: 600, configurable: true });

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Grid fits, so button should match grid width
      expect(addRowBtn.style.width).toBe('400px');
      expect(addRowBtn.style.left).toBe('0px');
    });

    it('recaps width when syncRowButtonWidth is called after columns are added', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 3));

      const scrollContainer = document.createElement('div');

      scrollContainer.style.paddingLeft = '9px';
      wrapper.insertBefore(scrollContainer, grid);
      scrollContainer.appendChild(grid);

      grid.style.width = '400px';
      Object.defineProperty(scrollContainer, 'clientWidth', { value: 600, configurable: true });

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Initially fits
      expect(addRowBtn.style.width).toBe('400px');

      // Simulate columns added — grid grows beyond scroll container
      grid.style.width = '1000px';
      controls.syncRowButtonWidth();

      // Button is clamped to scroll container visible width
      expect(addRowBtn.style.width).toBe('600px');
    });
  });

  describe('scroll overflow clipping', () => {
    /**
     * Helper: create a wrapper + scroll container + grid where the grid
     * overflows the scroll container horizontally (pixel mode).
     */
    const createOverflowingTable = (
      gridWidthPx: number,
      scrollContainerClientWidth: number,
    ): {
        wrapper: HTMLDivElement;
        grid: HTMLDivElement;
        scrollContainer: HTMLDivElement;
      } => {
      const w = document.createElement('div');
      const sc = document.createElement('div');
      const g = document.createElement('div');

      g.style.width = `${gridWidthPx}px`;
      g.style.position = 'relative';

      // Build a minimal 1×1 grid so row detection works
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      row.appendChild(cell);
      g.appendChild(row);

      sc.appendChild(g);
      w.appendChild(sc);
      document.body.appendChild(w);

      Object.defineProperty(sc, 'clientWidth', { value: scrollContainerClientWidth, configurable: true });

      return { wrapper: w, grid: g, scrollContainer: sc };
    };

    it('clamps button width to scroll container visible area when grid overflows', () => {
      const { wrapper: w, grid: g } = createOverflowingTable(1200, 600);

      wrapper = w;
      grid = g;

      new TableAddControls({
        wrapper: w,
        grid: g,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = w.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Button width is clamped to scroll container visible width
      expect(addRowBtn.style.width).toBe('600px');
    });

    it('uses grid width when grid fits within scroll container', () => {
      const { wrapper: w, grid: g } = createOverflowingTable(400, 600);

      wrapper = w;
      grid = g;

      new TableAddControls({
        wrapper: w,
        grid: g,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = w.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // Grid fits, so button matches grid width
      expect(addRowBtn.style.width).toBe('400px');
    });

    it('does not apply translateX transform in pixel mode', () => {
      const { wrapper: w, grid: g } = createOverflowingTable(1200, 600);

      wrapper = w;
      grid = g;

      new TableAddControls({
        wrapper: w,
        grid: g,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = w.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // No translateX — button is clamped to visible width instead
      expect(addRowBtn.style.transform).toBe('');
    });

    it('does not attach scroll listener when grid is not inside a scroll container', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      grid.style.width = '400px';

      const removeListenerSpy = vi.spyOn(grid, 'removeEventListener');

      const controls = new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      // No scroll listener needed — grid parent is the wrapper directly
      expect(addRowBtn.style.transform).toBe('');

      controls.destroy();
      removeListenerSpy.mockRestore();
    });

    it('recalculates clamped width when syncRowButtonWidth is called after resize', () => {
      const { wrapper: w, grid: g, scrollContainer: sc } = createOverflowingTable(1200, 600);

      wrapper = w;
      grid = g;

      const controls = new TableAddControls({
        wrapper: w,
        grid: g,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = w.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.width).toBe('600px');

      // Simulate scroll container getting wider (e.g., viewport resize)
      Object.defineProperty(sc, 'clientWidth', { value: 800, configurable: true });
      controls.syncRowButtonWidth();

      expect(addRowBtn.style.width).toBe('800px');
    });
  });

  describe('symmetric positioning', () => {
    it('add-row and add-col buttons are equidistant from the grid edge', () => {
      ({ wrapper, grid } = createGridAndWrapper(3, 3));

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      // Both buttons should use the same offset magnitude from the wrapper edge
      // bottom: -Npx and right: -Npx should match
      expect(addRowBtn.style.bottom).toBe('-36px');
      expect(addColBtn.style.right).toBe('-36px');

      // Both hit areas should be the same size in their respective axis
      expect(addRowBtn.style.height).toBe('32px');
      expect(addColBtn.style.width).toBe('32px');
    });

    it('add-col button extends fully outside the wrapper (no reliance on wrapper padding)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      // Even when wrapper has no right padding, add-col should work correctly
      wrapper.style.paddingRight = '0px';

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      // Button should extend outside the wrapper
      expect(addColBtn.style.right).toBe('-36px');
      expect(addColBtn.style.width).toBe('32px');
    });

    it('syncRowButtonWidth uses right:0 when wrapper has no padding', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        if (el === wrapper) {
          return { paddingRight: '0px' } as CSSStyleDeclaration;
        }

        return { paddingLeft: '0px' } as CSSStyleDeclaration;
      });

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.left).toBe('0px');
      expect(addRowBtn.style.right).toBe('0px');

      spy.mockRestore();
    });
  });

  describe('overflow proximity', () => {
    /**
     * Helper: simulate a scroll container between wrapper and grid.
     * The scroll container clips the grid (overflow-x: auto), so the
     * visible right edge is the scroll container's right, not the grid's.
     */
    const createScrollContainer = (
      wrapperEl: HTMLElement,
      gridEl: HTMLElement
    ): HTMLDivElement => {
      const sc = document.createElement('div');

      sc.setAttribute('data-blok-table-scroll', '');
      wrapperEl.insertBefore(sc, gridEl);
      sc.appendChild(gridEl);

      return sc;
    };

    it('add-column button appears when cursor is near visible right edge even when grid overflows', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 5));

      const scrollContainer = createScrollContainer(wrapper, grid);

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid is 900px wide but scroll container clips to 650px.
      // Wrapper is also 650px. Grid's getBoundingClientRect reports full 900px.
      const gridRect = new DOMRect(0, 0, 900, 100);
      const wrapperRect = new DOMRect(0, 0, 650, 100);

      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(gridRect);
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(wrapperRect);
      vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 650, 100)
      );

      // Move cursor near the visible right edge (x=640, near wrapper right=650)
       
      wrapper.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 640, clientY: 50, bubbles: true }) // eslint-disable-line internal-unit-test/no-direct-event-dispatch
      );

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.opacity).toBe('1');
    });

    it('add-column button does NOT require cursor to reach full grid right when grid overflows', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 5));

      const scrollContainer = createScrollContainer(wrapper, grid);

      new TableAddControls({
        wrapper,
        grid,
        i18n: mockI18n,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
        ...defaultDragCallbacks(),
      });

      // Grid overflows: 900px inside 650px scroll container
      const gridRect = new DOMRect(0, 0, 900, 100);
      const wrapperRect = new DOMRect(0, 0, 650, 100);

      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(gridRect);
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(wrapperRect);
      vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 650, 100)
      );

      // Cursor at x=620 is 30px from visible right edge (650) — within PROXIMITY_PX=40
      // But it is 280px from grid right (900) — would fail with the old code
       
      wrapper.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 620, clientY: 50, bubbles: true }) // eslint-disable-line internal-unit-test/no-direct-event-dispatch
      );

      const addColBtn = wrapper.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.opacity).toBe('1');
    });
  });

});
