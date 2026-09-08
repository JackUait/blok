import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { TableResize } from '../../../../src/tools/table/table-resize';

const RESIZE_ATTR = 'data-blok-table-resize';

const makeGrid = (columns: number, withColgroup = true): HTMLTableElement => {
  const table = document.createElement('table');

  if (withColgroup) {
    const colgroup = document.createElement('colgroup');

    Array.from({ length: columns }).forEach(() => colgroup.appendChild(document.createElement('col')));
    table.appendChild(colgroup);
  }
  document.body.appendChild(table);

  return table;
};

const handlesOf = (grid: HTMLElement): HTMLElement[] =>
  Array.from(grid.querySelectorAll<HTMLElement>(`[${RESIZE_ATTR}]`));

const press = (handle: HTMLElement, clientX = 300): PointerEvent => {
  const event = new PointerEvent('pointerdown', { clientX, bubbles: true, cancelable: true, pointerId: 7 });

  handle.dispatchEvent(event);

  return event;
};

const move = (clientX: number): void => {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX }));
};

const release = (): void => {
  document.dispatchEvent(new PointerEvent('pointerup', {}));
};

/**
 * Two mutant pairs in this file are MUTUALLY redundant, and neither half can be
 * killed while the other stands: the `isDragging` guards at the top of
 * `onPointerMove` / `onPointerEnd`, and the three `removeEventListener` calls at
 * the end of `onPointerEnd`. The listeners are only attached while a drag is
 * live, and `onPointerEnd` clears the flag before removing them — so a leftover
 * listener finds the flag false, and a missing guard is never reached. The same
 * three removals inside `destroy` ARE killable, because destroy leaves the flag
 * set.
 *
 * The remaining survivors are inert by construction:
 * - `dragColIndex = -1` and `didDrag = false` are overwritten on the press that
 *   first reads them.
 * - `updateHandlePositions()` in the deferred-apply branch recomputes the exact
 *   offsets `createHandle` already wrote from the same widths.
 * - `this.onResetWidths?.()` is only reached when `onResetWidths !== null`.
 * - the `i < colWidths.length` bound in `applyWidths`: an out-of-range index
 *   yields `undefinedpx`, which CSS rejects, so the assignment is a no-op.
 */
describe('TableResize mutants', () => {
  let grid: HTMLTableElement;
  let onChange: Mock<(widths: number[]) => void>;
  let onDragStart: Mock<() => void>;
  let onDrag: Mock<() => void>;
  let onResetWidths: Mock<() => void>;

  const build = (widths: number[], skipInitialApply = false): TableResize =>
    new TableResize(grid, widths, onChange, onDragStart, onDrag, skipInitialApply, onResetWidths);

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();
    onDragStart = vi.fn();
    onDrag = vi.fn();
    onResetWidths = vi.fn();
    grid = makeGrid(2);
  });

  afterEach(() => {
    grid.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('enabled', () => {
    it('starts enabled with its handles clickable', () => {
      const resize = build([100, 200]);

      expect(resize.enabled).toBe(true);
      expect(handlesOf(grid).map((handle) => handle.style.pointerEvents)).toStrictEqual(['', '']);
    });

    it('takes the handles out of the hit path when disabled', () => {
      const resize = build([100, 200]);

      resize.enabled = false;

      expect(resize.enabled).toBe(false);
      expect(handlesOf(grid).map((handle) => handle.style.pointerEvents)).toStrictEqual(['none', 'none']);
    });

    it('puts them back when re-enabled', () => {
      const resize = build([100, 200]);

      resize.enabled = false;
      resize.enabled = true;

      expect(handlesOf(grid).map((handle) => handle.style.pointerEvents)).toStrictEqual(['', '']);
    });
  });

  describe('handle element', () => {
    it('carries the marker, the column index and the whole hit-area style', () => {
      build([100, 200]);

      const [handle] = handlesOf(grid);

      expect(handle.getAttribute(RESIZE_ATTR)).toBe('');
      expect(handle.getAttribute('data-col')).toBe('0');
      expect(handle.getAttribute('contenteditable')).toBe('false');
      expect(handle.style.width).toBe('16px');
      expect(handle.style.cursor).toBe('col-resize');
      expect(handle.style.zIndex).toBe('2');
    });
  });

  describe('press guards', () => {
    it('ignores a press while disabled', () => {
      const resize = build([100, 200]);

      resize.enabled = false;
      press(handlesOf(grid)[0]);

      expect(onDragStart).not.toHaveBeenCalled();
    });

    it('leaves a press that missed a handle alone', () => {
      build([100, 200]);

      const event = new PointerEvent('pointerdown', { clientX: 10, bubbles: true, cancelable: true });

      grid.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(onDragStart).not.toHaveBeenCalled();
    });

    it('takes over the default action on a handle press', () => {
      build([100, 200]);

      expect(press(handlesOf(grid)[0]).defaultPrevented).toBe(true);
    });

    it('ignores a handle that carries no column index', () => {
      build([100, 200]);

      const rogue = document.createElement('div');

      rogue.setAttribute(RESIZE_ATTR, '');
      grid.appendChild(rogue);
      press(rogue);

      expect(onDragStart).not.toHaveBeenCalled();
    });

    it('captures the pointer on the handle it grabbed', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];
      const capture = vi.fn();

      Object.defineProperty(handle, 'setPointerCapture', { value: capture, configurable: true });
      press(handle);

      expect(capture).toHaveBeenCalledWith(7);
    });
  });

  describe('double-click reset', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });

    it('resets on a second press of the same handle inside the window', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];

      press(handle);
      release();
      vi.setSystemTime(100);
      press(handle);

      expect(onResetWidths).toHaveBeenCalledTimes(1);
    });

    // The clock starts at 0 here, so `now - lastClickTime` is inside the window
    // from the very first press — only the untouched column sentinel keeps it
    // from reading as a double-click.
    it('never reads the first press as a double click', () => {
      build([100, 200]);

      press(handlesOf(grid)[1]);

      expect(onResetWidths).not.toHaveBeenCalled();
    });

    it('does not reset when the second press is on another handle', () => {
      build([100, 200]);

      press(handlesOf(grid)[0]);
      release();
      vi.setSystemTime(100);
      press(handlesOf(grid)[1]);

      expect(onResetWidths).not.toHaveBeenCalled();
    });

    it('does not reset once the window has passed', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];

      press(handle);
      release();
      vi.setSystemTime(400);
      press(handle);

      expect(onResetWidths).not.toHaveBeenCalled();
    });

    it('does not reset exactly on the window edge', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];

      press(handle);
      release();
      vi.setSystemTime(300);
      press(handle);

      expect(onResetWidths).not.toHaveBeenCalled();
    });

    it('does not reset when the pointer moved between the presses', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];

      press(handle, 300);
      move(360);
      release();
      vi.setSystemTime(100);
      press(handle, 360);

      expect(onResetWidths).not.toHaveBeenCalled();
    });

    it('does not reset when the move changed nothing', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];

      press(handle, 300);
      move(300);
      release();
      vi.setSystemTime(100);
      press(handle, 300);

      expect(onResetWidths).toHaveBeenCalledTimes(1);
    });

    it('resets once, not twice, on a third quick press', () => {
      build([100, 200]);

      const handle = handlesOf(grid)[0];

      press(handle);
      release();
      vi.setSystemTime(100);
      press(handle);
      vi.setSystemTime(150);
      press(handlesOf(grid)[1]);

      expect(onResetWidths).toHaveBeenCalledTimes(1);
    });

    it('still starts a drag on a repeat press when no reset callback was given', () => {
      const resize = new TableResize(grid, [100, 200], onChange, onDragStart, onDrag);
      const handle = handlesOf(grid)[0];

      press(handle, 300);
      release();
      vi.setSystemTime(100);
      press(handle, 300);
      move(360);
      release();

      expect(onChange).toHaveBeenLastCalledWith([160, 200]);
      resize.destroy();
    });
  });

  describe('drag', () => {
    it('announces the drag and commits the new widths', () => {
      build([100, 200]);

      press(handlesOf(grid)[0], 300);
      move(360);
      release();

      expect(onDragStart).toHaveBeenCalledTimes(1);
      expect(onDrag).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([160, 200]);
    });

    it('keeps the other handles dim while a drag is live', () => {
      build([100, 200]);

      press(handlesOf(grid)[0]);
      handlesOf(grid)[1].dispatchEvent(new MouseEvent('mouseenter'));

      expect(handlesOf(grid)[1].style.opacity).toBe('0');
    });

    it('lets a handle glow again once the drag ends', () => {
      build([100, 200]);

      press(handlesOf(grid)[0], 300);
      move(360);
      release();
      handlesOf(grid)[1].dispatchEvent(new MouseEvent('mouseenter'));

      expect(handlesOf(grid)[1].style.opacity).toBe('1');
    });

    it('survives a grid that has no column group', () => {
      grid.remove();
      grid = makeGrid(2, false);

      expect(() => build([100, 200])).not.toThrow();
    });

    // jsdom routes a throw inside a listener to window's error event instead of
    // to the dispatcher, so `not.toThrow()` here would pass vacuously. The
    // commit at the end of the handler is the observable proof it ran through.
    it('still commits when the grabbed handle has no element', () => {
      build([100, 200]);

      const rogue = document.createElement('div');

      rogue.setAttribute(RESIZE_ATTR, '');
      rogue.setAttribute('data-col', '99');
      grid.appendChild(rogue);
      press(rogue, 300);
      release();

      expect(onChange).toHaveBeenCalledWith([100, 200]);
    });
  });

  describe('applied widths', () => {
    it('clears the fluid-mode minimum width', () => {
      grid.style.minWidth = '500px';
      build([100, 200]);

      expect(grid.style.minWidth).toBe('');
      expect(grid.style.width).toBe('301px');
    });

    it('defers the first apply and then stops re-applying', () => {
      build([100, 200], true);

      expect(grid.style.width).toBe('');

      press(handlesOf(grid)[0]);
      release();

      expect(grid.style.width).toBe('301px');

      grid.style.minWidth = '500px';
      press(handlesOf(grid)[1]);
      release();

      expect(grid.style.minWidth).toBe('500px');
    });
  });

  describe('destroy', () => {
    it('stops a drag in flight from reaching the document', () => {
      const resize = build([100, 200]);

      press(handlesOf(grid)[0], 300);
      resize.destroy();
      move(360);
      document.dispatchEvent(new PointerEvent('pointercancel', {}));
      release();

      expect(onDrag).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('leaves a handle list that can still be walked', () => {
      const resize = build([100, 200]);

      resize.destroy();

      expect(() => {
        resize.enabled = false;
      }).not.toThrow();
      expect(handlesOf(grid)).toStrictEqual([]);
    });
  });
});
