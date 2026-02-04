import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('TableAddControls', () => {
  let wrapper: HTMLDivElement;
  let grid: HTMLDivElement;

  afterEach(() => {
    wrapper?.remove();
  });

  describe('button creation', () => {
    it('creates an add-row button with the correct data attribute', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
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
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addColBtn).not.toBeNull();
    });

    it('add-row button contains a "+" text', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      expect(addRowBtn.textContent).toBe('+');
    });

    it('add-column button contains a "+" text', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.textContent).toBe('+');
    });

    it('both buttons are contenteditable false', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`);
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`);

      expect(addRowBtn?.getAttribute('contenteditable')).toBe('false');
      expect(addColBtn?.getAttribute('contenteditable')).toBe('false');
    });
  });

  describe('visibility', () => {
    it('buttons start hidden (opacity 0)', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('0');
    });

    it('buttons become visible on wrapper mouseenter', () => {
      ({ wrapper, grid } = createGridAndWrapper(2, 2));

      new TableAddControls({
        wrapper,
        grid,
        onAddRow: vi.fn(),
        onAddColumn: vi.fn(),
      });

      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

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
      });

      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

      vi.advanceTimersByTime(200);

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addRowBtn.style.opacity).toBe('0');
      expect(addColBtn.style.opacity).toBe('0');

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
      });

      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;

      addRowBtn.click();

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
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      addColBtn.click();

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
      });

      controls.destroy();

      // Re-create button elements manually to check listeners don't fire
      const addRowBtn = document.createElement('div');

      addRowBtn.setAttribute(ADD_ROW_ATTR, '');
      addRowBtn.style.opacity = '0';
      wrapper.appendChild(addRowBtn);

      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

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
      });

      // Grab references before destroy removes them
      const addRowBtn = wrapper.querySelector(`[${ADD_ROW_ATTR}]`) as HTMLElement;
      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      controls.destroy();

      // Re-add to DOM to dispatch events
      wrapper.appendChild(addRowBtn);
      grid.appendChild(addColBtn);

      addRowBtn.click();
      addColBtn.click();

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
      });

      const addColBtn = grid.querySelector(`[${ADD_COL_ATTR}]`) as HTMLElement;

      expect(addColBtn.style.position).toBe('absolute');
      expect(addColBtn.style.top).toBe('0px');
      expect(addColBtn.style.bottom).toBe('0px');
    });
  });
});
