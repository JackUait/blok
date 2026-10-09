import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';
import type { GroupDragResult } from '../../../../src/tools/database/database-column-drag';

/**
 * Creates a wrapper with columns for testing column drag.
 * Each column has data-blok-database-column and data-option-id.
 * Columns are arranged horizontally.
 */
const createWrapper = (columnCount: number, dir: 'ltr' | 'rtl' = 'ltr'): HTMLDivElement => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('dir', dir);

  for (let c = 0; c < columnCount; c++) {
    const column = document.createElement('div');

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-option-id', `opt-${c}`);

    // RTL lays column 0 out on the right.
    const left = dir === 'rtl' ? (columnCount - 1 - c) * 200 : c * 200;
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
  let onDrop: ReturnType<typeof vi.fn<(result: GroupDragResult) => void>>;
  let drag: DatabaseColumnDrag;

  beforeEach(() => {
    vi.clearAllMocks();
    onDrop = vi.fn<(result: GroupDragResult) => void>();
    wrapper = createWrapper(3);
    drag = new DatabaseColumnDrag({ wrapper, onDrop });
  });

  afterEach(() => {
    drag.destroy();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('drops a column after the no-value column, which is a drop neighbour like any other', () => {
    wrapper.querySelector('[data-option-id="opt-2"]')?.setAttribute('data-blok-database-no-value-group', '');

    drag.beginTracking('opt-0', 50, 50);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 590, clientY: 50 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 590, clientY: 50 }));

    expect(onDrop).toHaveBeenCalledWith({ optionId: 'opt-0', beforeOptionId: null, afterOptionId: 'opt-2' });
  });

  it('does not start drag below 10px horizontal threshold', () => {
    drag.beginTracking('opt-0', 50, 50);

    // Move only 5px horizontally — below threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 55, clientY: 50 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 55, clientY: 50 }));

    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();
  });

  it('cleans up previous tracking session when beginTracking is called again', () => {
    drag.beginTracking('opt-0', 50, 50);

    // Move past threshold to create ghost for first session
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    // Start a second tracking session without explicit cleanup
    drag.beginTracking('opt-1', 250, 50);

    // The ghost from the first session should be removed
    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();

    // Move past threshold to start drag for the second session
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 270, clientY: 50 }));

    // Verify second session is active — ghost exists
    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    // Drop the second column
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 270, clientY: 50 }));

    // onDrop should be called with opt-1, not opt-0
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ optionId: 'opt-1' })
    );
  });

  it('cleans up ghost on pointerup — no [data-blok-database-column-ghost] in DOM', () => {
    drag.beginTracking('opt-0', 50, 50);

    // Move 20px horizontally — past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).not.toBeNull();

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 70, clientY: 50 }));

    expect(document.querySelector('[data-blok-database-column-ghost]')).toBeNull();
  });

  it('calls onDrop with correct data when moving column left to right', () => {
    // Columns: opt-0 [0-200], opt-1 [200-400], opt-2 [400-600]
    // Drag opt-0 starting at x=50, move past opt-1's midpoint (300)
    drag.beginTracking('opt-0', 50, 50);

    // Move past drag threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    // Drop at x=350 — past opt-1 midpoint (300), before opt-2 midpoint (500)
    // opt-0 is excluded from position calc; remaining: opt-1 [200-400], opt-2 [400-600]
    // x=350 < opt-2 midpoint (500), so beforeColumn=opt-2, afterColumn=opt-1
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 350, clientY: 50 }));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith({
      optionId: 'opt-0',
      beforeOptionId: 'opt-2',
      afterOptionId: 'opt-1',
    });
  });

  it('calls onDrop with correct data when moving column to end', () => {
    // Columns: opt-0 [0-200], opt-1 [200-400], opt-2 [400-600]
    // Drag opt-0 past all columns — drop at x=650 (beyond opt-2)
    drag.beginTracking('opt-0', 50, 50);

    // Move past drag threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 50 }));

    // Drop at x=650 — past all column midpoints
    // opt-0 excluded; remaining: opt-1 [200-400], opt-2 [400-600]
    // x=650 > opt-2 midpoint (500), so we fall through the loop
    // beforeColumn=null, afterColumn=opt-2
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 650, clientY: 50 }));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith({
      optionId: 'opt-0',
      beforeOptionId: null,
      afterOptionId: 'opt-2',
    });
  });

  describe('in RTL', () => {
    beforeEach(() => {
      drag.destroy();
      wrapper.remove();
      // opt-0 [400-600], opt-1 [200-400], opt-2 [0-200]
      wrapper = createWrapper(3, 'rtl');
      drag = new DatabaseColumnDrag({ wrapper, onDrop });
    });

    it('drops past a column\'s middle toward the inline end (left)', () => {
      drag.beginTracking('opt-0', 550, 50);
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 530, clientY: 50 }));
      // x=250 is left of opt-1's middle (300), right of opt-2's middle (100).
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 250, clientY: 50 }));

      expect(onDrop).toHaveBeenCalledWith({
        optionId: 'opt-0',
        beforeOptionId: 'opt-2',
        afterOptionId: 'opt-1',
      });
    });

    it('drops at the end when the pointer passes the last column on the left', () => {
      drag.beginTracking('opt-0', 550, 50);
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 530, clientY: 50 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50 }));

      expect(onDrop).toHaveBeenCalledWith({
        optionId: 'opt-0',
        beforeOptionId: null,
        afterOptionId: 'opt-2',
      });
    });

    it('opens the gap on the inline-start side of the target column', () => {
      drag.beginTracking('opt-0', 550, 50);
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 250, clientY: 50 }));

      const target = wrapper.querySelector<HTMLElement>('[data-option-id="opt-2"]');

      expect(target?.style.marginInlineStart).not.toBe('');
      expect(target?.style.marginLeft).toBe('');
    });
  });
});
