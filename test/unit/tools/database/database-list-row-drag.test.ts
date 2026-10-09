import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseListRowDrag } from '../../../../src/tools/database/database-list-row-drag';
import type { ListRowDragResult } from '../../../../src/tools/database/database-list-row-drag';

/**
 * Creates a wrapper with list rows for testing.
 * Each row has data-blok-database-list-row and data-row-id.
 * Each row is 40px tall, stacked vertically.
 */
const createWrapper = (rowCount: number): HTMLDivElement => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-database-list', '');

  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement('div');

    row.setAttribute('data-blok-database-list-row', '');
    row.setAttribute('data-row-id', `row-${i}`);

    const top = i * 40;
    const bottom = top + 40;

    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        right: 400,
        top,
        bottom,
        width: 400,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }),
      configurable: true,
    });

    wrapper.appendChild(row);
  }

  document.body.appendChild(wrapper);

  return wrapper;
};

describe('DatabaseListRowDrag', () => {
  let wrapper: HTMLDivElement;
  let onDrop: ReturnType<typeof vi.fn<(result: ListRowDragResult) => void>>;
  let drag: DatabaseListRowDrag;

  beforeEach(() => {
    vi.clearAllMocks();
    onDrop = vi.fn<(result: ListRowDragResult) => void>();
    wrapper = createWrapper(4);
    drag = new DatabaseListRowDrag({ wrapper, onDrop });
  });

  afterEach(() => {
    drag.destroy();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('does not call onDrop when movement is below 10px threshold', () => {
    drag.beginTracking('row-0', 0, 0);

    // Move only 5px vertically — below threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 5 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 5 }));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('creates ghost element after exceeding threshold', () => {
    drag.beginTracking('row-0', 0, 0);

    // Move 20px vertically — past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 20 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();
  });

  it('removes ghost element on pointerup', () => {
    drag.beginTracking('row-0', 0, 0);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 20 }));
    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 20 }));
    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
  });

  it('marks the source row and leaves it at full opacity during drag', () => {
    drag.beginTracking('row-0', 0, 0);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 20 }));

    const sourceRow = wrapper.querySelector('[data-row-id="row-0"]') as HTMLElement;

    expect(sourceRow.hasAttribute('data-blok-database-drag-source')).toBe(true);
    expect(sourceRow.style.opacity).toBe('');
  });

  it('calls onDrop with correct result for downward move (row-0 dragged between row-1 and row-2)', () => {
    // Rows: row-0 (0–40), row-1 (40–80), row-2 (80–120), row-3 (120–160)
    // Drag row-0 downward so it lands between row-1 and row-2
    // With row-0 filtered out, remaining rows: row-1 (40–80), row-2 (80–120), row-3 (120–160)
    // Drop at clientY=85: > row-1 mid(60), < row-2 mid(100) → beforeEl = row-2
    // beforeIndex=1, afterRowId = rows[0] = row-1
    drag.beginTracking('row-0', 0, 0);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 85 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 85 }));

    expect(onDrop).toHaveBeenCalledWith({
      rowId: 'row-0',
      beforeRowId: 'row-2',
      afterRowId: 'row-1',
    });
  });

  it('calls onDrop with null beforeRowId when dropped at end', () => {
    // Drop row-0 past the last row (row-3 ends at 160, midpoint=140)
    // clientY=200 > all midpoints → beforeEl = null
    // afterRowId = last row = row-3
    drag.beginTracking('row-0', 0, 0);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 200 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 200 }));

    expect(onDrop).toHaveBeenCalledWith({
      rowId: 'row-0',
      beforeRowId: null,
      afterRowId: 'row-3',
    });
  });

  it('cancels drag on Escape key', () => {
    drag.beginTracking('row-0', 0, 0);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 20 }));
    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

     
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('shows a drop line on the row-1 | row-2 seam and never displaces a row', () => {
    // Drag row-1; clientY=85 lands before row-2, whose top edge is at 80.
    drag.beginTracking('row-1', 0, 40);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 85 }));

    const row2 = wrapper.querySelector('[data-row-id="row-2"]') as HTMLElement;
    const line = document.querySelector<HTMLElement>('[data-blok-database-drop-line]');

    expect(line?.style.top).toBe('78px');
    expect(row2.style.marginTop).toBe('');
  });

  it('fades the drop line out after pointerup', () => {
    drag.beginTracking('row-1', 0, 40);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 85 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 85 }));

    const lines = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-database-drop-line]'));

    expect(lines.every((line) => line.style.opacity === '0')).toBe(true);
  });
});
