import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRowColDrag } from '../../../../src/tools/table/table-row-col-drag';

const mockHapticTick = vi.fn();
const mockHapticSnap = vi.fn();

vi.mock('../../../../src/tools/table/table-haptics', () => ({
  hapticTick: (): void => { mockHapticTick(); },
  hapticSnap: (): void => { mockHapticSnap(); },
}));

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';

/**
 * Create a grid with rows of equal-height cells for drag testing.
 * Each row is 50px tall, each cell 100px wide.
 */
const createGrid = (rowCount: number, colCount: number): HTMLDivElement => {
  const grid = document.createElement('div');

  grid.style.position = 'relative';

  let topOffset = 0;

  Array.from({ length: rowCount }).forEach(() => {
    const row = document.createElement('div');

    row.setAttribute(ROW_ATTR, '');
    Object.defineProperty(row, 'offsetTop', { value: topOffset, configurable: true });
    Object.defineProperty(row, 'offsetHeight', { value: 50, configurable: true });

    Array.from({ length: colCount }).forEach(() => {
      const cell = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      Object.defineProperty(cell, 'offsetWidth', { value: 100, configurable: true });
      Object.defineProperty(cell, 'offsetHeight', { value: 50, configurable: true });
      row.appendChild(cell);
    });

    grid.appendChild(row);
    topOffset += 50;
  });

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => new DOMRect(0, 0, colCount * 100, rowCount * 50),
    configurable: true,
  });

  document.body.appendChild(grid);

  return grid;
};

describe('TableRowColDrag haptic feedback', () => {
  let grid: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    grid?.remove();
    vi.restoreAllMocks();
  });

  it('triggers hapticSnap when drag starts (threshold crossed)', async () => {
    grid = createGrid(3, 3);
    const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

    const trackingPromise = drag.beginTracking('row', 0, 50, 10);

    // Move past threshold (10px)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 25 }));

    expect(mockHapticSnap).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe('grabbing');

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 25 }));
    await trackingPromise;
  });

  it('triggers hapticSnap when row is dropped at a new position', async () => {
    grid = createGrid(3, 3);
    const onAction = vi.fn();
    const drag = new TableRowColDrag({ grid, onAction });

    const trackingPromise = drag.beginTracking('row', 0, 50, 10);

    // Move past threshold to start drag
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 25 }));
    mockHapticSnap.mockClear();

    // Drop at row index 2 (y relative to grid > row 2 midpoint)
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 120 }));

    expect(mockHapticSnap).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'move-row' }));

    await trackingPromise;
  });

  it('does not trigger hapticSnap on drop if row did not move', async () => {
    grid = createGrid(3, 3);
    const onAction = vi.fn();
    const drag = new TableRowColDrag({ grid, onAction });

    const trackingPromise = drag.beginTracking('row', 0, 50, 10);

    // Move past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 25 }));
    mockHapticSnap.mockClear();

    // Drop back at original position (row 0 area)
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 10 }));

    expect(mockHapticSnap).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();

    await trackingPromise;
  });

  it('triggers hapticTick when drop indicator crosses row boundaries', async () => {
    grid = createGrid(3, 3);
    const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

    const trackingPromise = drag.beginTracking('row', 0, 50, 10);

    // Move past threshold to start drag (enters row 0 zone)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 25 }));
    mockHapticTick.mockClear();

    // Move to row 1 zone (y=75 is past row 1 midpoint at 50)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 75 }));

    expect(mockHapticTick).toHaveBeenCalledTimes(1);

    // Move to row 2 zone
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 125 }));

    expect(mockHapticTick).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 125 }));
    await trackingPromise;
  });

  it('does not trigger hapticTick when staying in same drop zone', async () => {
    grid = createGrid(3, 3);
    const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

    const trackingPromise = drag.beginTracking('row', 0, 50, 10);

    // Move past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 25 }));
    mockHapticTick.mockClear();

    // Multiple moves within same zone (all near y=15, still in row 0 zone)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 15 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 20 }));

    expect(mockHapticTick).not.toHaveBeenCalled();

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 20 }));
    await trackingPromise;
  });

  it('does not trigger haptics on click (no drag)', async () => {
    grid = createGrid(3, 3);
    const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

    const trackingPromise = drag.beginTracking('row', 0, 50, 10);

    // Immediately release without moving
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 10 }));

    const wasDrag = await trackingPromise;

    expect(wasDrag).toBe(false);
    expect(mockHapticSnap).not.toHaveBeenCalled();
    expect(mockHapticTick).not.toHaveBeenCalled();
  });
});
