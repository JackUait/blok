import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';
import type { ColumnDragResult } from '../../../../src/tools/database/database-column-drag';

/**
 * Creates a wrapper with columns for testing column drag.
 * Each column has data-blok-database-column and data-column-id.
 * Columns are arranged horizontally.
 */
const createWrapper = (columnCount: number): HTMLDivElement => {
  const wrapper = document.createElement('div');

  for (let c = 0; c < columnCount; c++) {
    const column = document.createElement('div');

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-column-id', `col-${c}`);

    const left = c * 200;
    const right = left + 200;

    Object.defineProperty(column, 'getBoundingClientRect', {
      value: () => ({
        left,
        right,
        top: 0,
        bottom: 400,
        width: 200,
        height: 400,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });

    wrapper.appendChild(column);
  }

  document.body.appendChild(wrapper);

  return wrapper;
};

describe('DatabaseColumnDrag', () => {
  let wrapper: HTMLDivElement;
  let onDrop: ReturnType<typeof vi.fn<(result: ColumnDragResult) => void>>;
  let drag: DatabaseColumnDrag;

  beforeEach(() => {
    vi.clearAllMocks();
    onDrop = vi.fn<(result: ColumnDragResult) => void>();
    wrapper = createWrapper(3);
    drag = new DatabaseColumnDrag({ wrapper, onDrop });
  });

  afterEach(() => {
    drag.destroy();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('does not start drag below 10px horizontal threshold', () => {
    drag.beginTracking('col-0', 50, 50);

    // Move only 5px horizontally — below threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 55, clientY: 50 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 55, clientY: 50 }));

    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();
  });

  it('cleans up previous tracking session when beginTracking is called again', () => {
    drag.beginTracking('col-0', 50, 50);

    // Move past threshold to create ghost for first session
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    // Start a second tracking session without explicit cleanup
    drag.beginTracking('col-1', 250, 50);

    // The ghost from the first session should be removed
    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();

    // Move past threshold to start drag for the second session
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 270, clientY: 50 }));

    // Verify second session is active — ghost exists
    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    // Drop the second column
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 270, clientY: 50 }));

    // onDrop should be called with col-1, not col-0
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ columnId: 'col-1' })
    );
  });

  it('cleans up ghost on pointerup — no [data-blok-database-column-ghost] in DOM', () => {
    drag.beginTracking('col-0', 50, 50);

    // Move 20px horizontally — past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();
  });

  it('calls onDrop with correct data when moving column left to right', () => {
    // Columns: col-0 [0-200], col-1 [200-400], col-2 [400-600]
    // Drag col-0 starting at x=50, move past col-1's midpoint (300)
    drag.beginTracking('col-0', 50, 50);

    // Move past drag threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    // Drop at x=350 — past col-1 midpoint (300), before col-2 midpoint (500)
    // col-0 is excluded from position calc; remaining: col-1 [200-400], col-2 [400-600]
    // x=350 < col-2 midpoint (500), so beforeColumn=col-2, afterColumn=col-1
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 350, clientY: 50 }));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith({
      columnId: 'col-0',
      beforeColumnId: 'col-2',
      afterColumnId: 'col-1',
    });
  });

  it('calls onDrop with correct data when moving column to end', () => {
    // Columns: col-0 [0-200], col-1 [200-400], col-2 [400-600]
    // Drag col-0 past all columns — drop at x=650 (beyond col-2)
    drag.beginTracking('col-0', 50, 50);

    // Move past drag threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    // Drop at x=650 — past all column midpoints
    // col-0 excluded; remaining: col-1 [200-400], col-2 [400-600]
    // x=650 > col-2 midpoint (500), so we fall through the loop
    // beforeColumn=null, afterColumn=col-2
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 650, clientY: 50 }));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith({
      columnId: 'col-0',
      beforeColumnId: null,
      afterColumnId: 'col-2',
    });
  });
});
