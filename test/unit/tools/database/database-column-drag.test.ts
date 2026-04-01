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

  it('cleans up ghost on pointerup — no [data-blok-database-column-ghost] in DOM', () => {
    drag.beginTracking('col-0', 50, 50);

    // Move 20px horizontally — past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();
  });
});
