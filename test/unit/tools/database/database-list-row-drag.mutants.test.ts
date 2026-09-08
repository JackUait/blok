import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { DatabaseListRowDrag } from '../../../../src/tools/database/database-list-row-drag';
import type { ListRowDragResult } from '../../../../src/tools/database/database-list-row-drag';

/*
 * Mutation-focused companion suite for `database-list-row-drag.ts`.
 *
 * PROVEN EQUIVALENT (kept here as evidence, not as a to-do list). Each one was
 * also checked empirically: the mutated source was driven through 15 gesture
 * scenarios (sourced and source-less rows, sub-threshold, midpoint boundary,
 * past-the-end, single row, empty row id, escape, cancel, restart, destroy,
 * late event replay) and produced a byte-identical trace of ghost markup, row
 * style attributes, onDrop payloads and thrown errors.
 *
 * - `private isDragging = false` (field initializer) -> `true`
 * - `private rowId = ''` (field initializer) -> `"Stryker was here!"`
 *   Neither field is read before `beginTracking()` runs, because no document
 *   listener exists until `beginTracking()` adds one, and `beginTracking()`
 *   overwrites both fields (via `cleanup()` and then directly) before it adds
 *   any listener. The constructor value can therefore never be observed.
 *
 * - `return { beforeEl: null }` -> `return {}`
 *   Every consumer reads `position.beforeEl` in a boolean context only
 *   (`if (beforeEl)`, `position.beforeEl ? a : b`), and `undefined` and `null`
 *   are both falsy, so the two objects drive identical branches everywhere.
 *
 * - `const beforeIndex = position.beforeEl ? rows.indexOf(...) : -1` -> `: +1`
 *   The `-1` arm is only produced when `position.beforeEl` is falsy, and
 *   `resolveAfterRowId` then takes its `if (beforeEl)`-false path, which never
 *   reads `beforeIndex`. The mutated value is dead.
 *
 * - `createGhost`: `style.top = `${e.clientY - this.ghostOffsetY}px`` with the
 *   subtraction flipped to an addition.
 * - `createGhost`: `style.top = `${e.clientY}px`` (the source-less branch)
 *   blanked to an empty template.
 *   `handlePointerMove` calls `updateGhostPosition(e)` on the very same event
 *   that just set `isDragging`, and that method writes the same `top` from the
 *   same `e` and the same `ghostOffsetY`, so createGhost's value never reaches
 *   an observer. `ghostOffsetY` is provably 0 whenever `sourceRow` is null —
 *   only `startActiveDrag`'s `if (this.sourceRow)` branch assigns it, and the
 *   only writer of `sourceRow = null` is `cleanup()`, which zeroes
 *   `ghostOffsetY` before it returns — so the source-less literal computes the
 *   identical string too. Blanking the SOURCED write is a different matter: it
 *   removes `top` from the declaration and `updateGhostPosition` re-appends it
 *   after `width`, which is why the exact `cssText` (ordered) is asserted below
 *   and the unordered property map is not enough.
 */

const ROW_HEIGHT = 40;
const ROW_LEFT = 24;
const ROW_WIDTH = 376;

/**
 * The seven unconditional declarations `createGhost` writes before it looks at
 * the source row. Asserted as a whole so a blanked literal (which cssstyle
 * drops from the declaration entirely) cannot hide.
 */
const GHOST_BASE_STYLE: Record<string, string> = {
  position: 'fixed',
  'pointer-events': 'none',
  opacity: '0.85',
  'z-index': '50',
  'box-shadow': '0 12px 28px rgba(0, 0, 0, 0.2), 0 4px 10px rgba(0, 0, 0, 0.1)',
  'border-radius': '8px',
  overflow: 'hidden',
};

/**
 * The same seven declarations in source order. cssText is asserted as well as
 * the map because a blanked `top` in `createGhost` is re-added by
 * `updateGhostPosition` with an identical value — only the position of `top`
 * within the declaration moves.
 */
const GHOST_BASE_CSS =
  'position: fixed; pointer-events: none; opacity: 0.85; z-index: 50; ' +
  'box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2), 0 4px 10px rgba(0, 0, 0, 0.1); ' +
  'border-radius: 8px; overflow: hidden;';

/**
 * jsdom performs no layout, so every rect is all-zeros unless it is stubbed.
 * The fixture uses distinct non-zero left/width so a blanked `left`/`width`
 * literal is distinguishable from a legitimately computed `0px`.
 */
const stubRect = (element: HTMLElement, left: number, top: number, width: number, height: number): void => {
  const rect = new DOMRect(left, top, width, height);

  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => rect,
    configurable: true,
  });
};

/**
 * Builds a list wrapper whose rows are stacked 40px apart starting at y=0.
 */
const createWrapper = (rowIds: string[]): HTMLElement => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-database-list', '');

  rowIds.forEach((rowId, index) => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-database-list-row', '');
    row.setAttribute('data-row-id', rowId);
    stubRect(row, ROW_LEFT, index * ROW_HEIGHT, ROW_WIDTH, ROW_HEIGHT);
    wrapper.appendChild(row);
  });

  document.body.appendChild(wrapper);

  return wrapper;
};

/**
 * Fails loudly instead of narrowing with `!`.
 */
const requireRow = (wrapper: HTMLElement, rowId: string): HTMLElement => {
  const row = wrapper.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`);

  if (row === null) {
    throw new Error(`fixture is missing the row "${rowId}"`);
  }

  return row;
};

const ghostCount = (): number => document.querySelectorAll('[data-blok-database-ghost]').length;

const requireGhost = (): HTMLElement => {
  const ghost = document.querySelector<HTMLElement>('[data-blok-database-ghost]');

  if (ghost === null) {
    throw new Error('expected a drag ghost to be in the document');
  }

  return ghost;
};

/**
 * Marker attributes are written with an EMPTY value, so a presence check cannot
 * see one re-valued. Read them all back and compare the whole map instead.
 * `style` is excluded because it is asserted separately, property by property.
 */
const readAttributes = (element: Element): Record<string, string> => {
  const attributes: Record<string, string> = {};

  Array.from(element.attributes).forEach((attribute) => {
    if (attribute.name !== 'style') {
      attributes[attribute.name] = attribute.value;
    }
  });

  return attributes;
};

/**
 * The declaration as cssstyle stores it: a value cssstyle rejects, or a blank
 * assignment, drops the property, so the map shrinks rather than changing.
 */
const readStyle = (element: HTMLElement): Record<string, string> => {
  const declarations: Record<string, string> = {};

  for (let index = 0; index < element.style.length; index++) {
    const name = element.style.item(index);

    declarations[name] = element.style.getPropertyValue(name);
  }

  return declarations;
};

const readMarginTops = (wrapper: HTMLElement): Record<string, string> => {
  const margins: Record<string, string> = {};

  wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]').forEach((row) => {
    margins[row.getAttribute('data-row-id') ?? '?'] = row.style.marginTop;
  });

  return margins;
};

const readOpacities = (wrapper: HTMLElement): Record<string, string> => {
  const opacities: Record<string, string> = {};

  wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]').forEach((row) => {
    opacities[row.getAttribute('data-row-id') ?? '?'] = row.style.opacity;
  });

  return opacities;
};

/**
 * Records every `marginTop` write on one row. An idempotent re-write is
 * invisible in the resulting value, so the write list is the only witness.
 */
const recordMarginTopWrites = (row: HTMLElement): string[] => {
  const writes: string[] = [];
  let current = row.style.marginTop;

  Object.defineProperty(row.style, 'marginTop', {
    get: () => current,
    set: (value: string) => {
      current = value;
      writes.push(value);
    },
    configurable: true,
  });

  return writes;
};

/**
 * Runs `onBlank` the first time the row's opacity is blanked. `cleanup()` does
 * that AFTER it has removed its document listeners but BEFORE it resets
 * `isDragging`/`rowId`, which is the only window in which those two resets are
 * observable from outside the class.
 */
const onOpacityBlanked = (row: HTMLElement, onBlank: () => void): void => {
  let current = row.style.opacity;
  let fired = false;

  Object.defineProperty(row.style, 'opacity', {
    get: () => current,
    set: (value: string) => {
      current = value;

      if (value === '' && !fired) {
        fired = true;
        onBlank();
      }
    },
    configurable: true,
  });
};

const move = (clientY: number): void => {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY }));
};

const up = (clientY: number): void => {
  document.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY }));
};

const cancelPointer = (): void => {
  document.dispatchEvent(new PointerEvent('pointercancel'));
};

const pressKey = (key: string): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key }));
};

describe('DatabaseListRowDrag — mutation coverage', () => {
  let wrapper: HTMLElement;
  let onDrop: Mock<(result: ListRowDragResult) => void>;
  let drag: DatabaseListRowDrag;
  let errorMessages: string[];

  /**
   * jsdom routes a throw inside an event listener to window's `error` event,
   * never back to the dispatcher, so `expect(dispatch).not.toThrow()` would
   * pass vacuously. Capturing (and default-preventing) the event is what makes
   * a mutant-induced throw assertable.
   */
  const handleWindowError = (event: ErrorEvent): void => {
    errorMessages.push(event.message);
    event.preventDefault();
  };

  const drainErrors = (): string[] => errorMessages.splice(0, errorMessages.length);

  beforeEach(() => {
    vi.clearAllMocks();
    errorMessages = [];
    window.addEventListener('error', handleWindowError);
    onDrop = vi.fn<(result: ListRowDragResult) => void>();
    wrapper = createWrapper(['row-0', 'row-1', 'row-2', 'row-3']);
    drag = new DatabaseListRowDrag({ wrapper, onDrop });
  });

  afterEach(() => {
    drag.destroy();
    wrapper.remove();
    document.querySelectorAll('[data-blok-database-ghost]').forEach((ghost) => {
      ghost.remove();
    });
    window.removeEventListener('error', handleWindowError);
    vi.restoreAllMocks();

    expect(errorMessages).toEqual([]);
  });

  describe('lifecycle', () => {
    it('tears the previous gesture down when tracking restarts', () => {
      drag.beginTracking('row-0', 0, 0);
      move(60);

      expect(ghostCount()).toBe(1);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '40px',
        'row-3': '',
      });

      drag.beginTracking('row-1', 0, 40);

      expect(ghostCount()).toBe(0);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(readOpacities(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
    });

    it('ends the gesture on pointercancel', () => {
      drag.beginTracking('row-0', 0, 0);
      move(60);

      expect(ghostCount()).toBe(1);

      cancelPointer();

      expect(ghostCount()).toBe(0);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(readOpacities(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(onDrop).not.toHaveBeenCalled();
    });

    it('adds and removes exactly the four document listeners it owns', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const expected = ['pointermove', 'pointerup', 'pointercancel', 'keydown'];

      drag.beginTracking('row-0', 0, 0);

      expect(removeSpy.mock.calls.map((call) => String(call[0]))).toEqual(expected);
      expect(addSpy.mock.calls.map((call) => String(call[0]))).toEqual(expected);

      removeSpy.mockClear();
      drag.cleanup();

      expect(removeSpy.mock.calls.map((call) => String(call[0]))).toEqual(expected);
    });

    it('destroy() ends a live gesture', () => {
      drag.beginTracking('row-0', 0, 0);
      move(60);

      expect(ghostCount()).toBe(1);

      drag.destroy();

      expect(ghostCount()).toBe(0);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(readOpacities(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
    });

    it('dims the source row while dragging and restores it on drop', () => {
      drag.beginTracking('row-0', 0, 0);
      move(60);

      expect(readOpacities(wrapper)).toEqual({
        'row-0': '0.4',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });

      up(60);

      expect(readOpacities(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
    });

    it('resets isDragging even when the host restarts tracking from inside cleanup', () => {
      const sourceRow = requireRow(wrapper, 'row-0');
      let restarted = false;

      onOpacityBlanked(sourceRow, () => {
        restarted = true;
        // cleanup() has already removed its listeners at this point, so the
        // listeners this call adds outlive the reset that follows it.
        drag.beginTracking('row-1', 0, 40);
      });

      drag.beginTracking('row-0', 0, 0);
      move(60);
      up(60);

      expect(restarted).toBe(true);

      // 5px from the restarted startY: below the drag threshold, so a drag that
      // is still marked active is the only thing that can displace a row.
      move(45);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
    });
  });

  describe('threshold', () => {
    it('measures the distance from startY, not the sum', () => {
      drag.beginTracking('row-2', 0, 100);
      move(95);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(ghostCount()).toBe(0);

      up(95);

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('does not start a drag at exactly 10px of movement', () => {
      drag.beginTracking('row-0', 0, 0);
      move(10);

      expect(ghostCount()).toBe(0);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });

      up(10);

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('leaves rows untouched while the gesture is still below the threshold', () => {
      drag.beginTracking('row-0', 0, 0);
      move(5);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(ghostCount()).toBe(0);
    });
  });

  describe('ghost', () => {
    it('follows every later pointer move', () => {
      drag.beginTracking('row-0', 0, 0);
      move(50);

      expect(requireGhost().style.top).toBe('50px');

      move(90);

      expect(requireGhost().style.top).toBe('90px');
    });

    it('keeps the grab offset inside the row', () => {
      // row-2 spans 80..120 and the pointer went down at 100, so the ghost sits
      // 20px above the pointer for the whole gesture.
      drag.beginTracking('row-2', 0, 100);
      move(150);

      expect(requireGhost().style.top).toBe('130px');

      move(200);

      expect(requireGhost().style.top).toBe('180px');
    });

    it('carries the complete marker attribute set, style declaration and row clone', () => {
      drag.beginTracking('row-2', 0, 100);
      move(150);

      const ghost = requireGhost();

      expect(readAttributes(ghost)).toEqual({
        'data-blok-database-ghost': '',
        contenteditable: 'false',
      });
      expect(readStyle(ghost)).toEqual({
        ...GHOST_BASE_STYLE,
        left: '24px',
        top: '130px',
        width: '376px',
      });
      expect(ghost.style.cssText).toBe(`${GHOST_BASE_CSS} left: 24px; top: 130px; width: 376px;`);
      expect(ghost.children).toHaveLength(1);

      const clone = ghost.querySelector<HTMLElement>('[data-row-id="row-2"]');

      expect(clone).not.toBeNull();
      expect(readStyle(clone ?? ghost)).toEqual({});
    });

    it('anchors to the bare pointer when the row is not in the wrapper', () => {
      drag.beginTracking('missing-row', 0, 0);
      move(50);

      const ghost = requireGhost();

      expect(readStyle(ghost)).toEqual({
        ...GHOST_BASE_STYLE,
        left: '0px',
        top: '50px',
      });
      expect(ghost.style.cssText).toBe(`${GHOST_BASE_CSS} left: 0px; top: 50px;`);
      expect(ghost.children).toHaveLength(0);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '0px',
        'row-2': '',
        'row-3': '',
      });
    });

    it('skips the position update when the gesture never produced a ghost', () => {
      const sourceRow = requireRow(wrapper, 'row-0');

      // startActiveDrag() throws before createGhost() runs, which leaves the
      // gesture marked active with a null ghost — the only state in which the
      // `if (!this.ghostEl) return` guard is reachable.
      Object.defineProperty(sourceRow, 'getBoundingClientRect', {
        value: () => {
          throw new Error('no layout');
        },
        configurable: true,
      });

      drag.beginTracking('row-0', 0, 0);
      move(50);

      expect(drainErrors()).toHaveLength(1);
      expect(ghostCount()).toBe(0);

      move(90);

      expect(drainErrors()).toEqual([]);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '0px',
        'row-3': '',
      });
    });
  });

  describe('keyboard', () => {
    it('cancels on Escape only', () => {
      drag.beginTracking('row-0', 0, 0);
      move(60);
      pressKey('a');

      expect(ghostCount()).toBe(1);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '40px',
        'row-3': '',
      });

      pressKey('Escape');

      expect(ghostCount()).toBe(0);
      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(onDrop).not.toHaveBeenCalled();
    });
  });

  describe('drop indicator', () => {
    it('does not rewrite the gap when the target has not changed', () => {
      drag.beginTracking('row-0', 0, 0);
      move(85);

      const row2 = requireRow(wrapper, 'row-2');
      const writes = recordMarginTopWrites(row2);

      move(90);

      expect(writes).toEqual([]);
      expect(row2.style.marginTop).toBe('40px');

      Reflect.deleteProperty(row2.style, 'marginTop');
    });

    it('moves the gap from one row to the next', () => {
      drag.beginTracking('row-0', 0, 0);
      move(50);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '40px',
        'row-2': '',
        'row-3': '',
      });

      move(90);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '40px',
        'row-3': '',
      });
    });

    it('clears the gap once the pointer passes the last row', () => {
      drag.beginTracking('row-0', 0, 0);
      move(90);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '40px',
        'row-3': '',
      });

      move(500);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '',
        'row-3': '',
      });
      expect(drainErrors()).toEqual([]);
    });

    it('never treats the dragged row as its own drop target', () => {
      // Without the filter the pointer at 55 would sit above row-1's own
      // midpoint (60) and the dragged row would displace itself.
      drag.beginTracking('row-1', 0, 40);
      move(55);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '40px',
        'row-3': '',
      });
    });

    it('needs the pointer strictly past a midpoint to drop before that row', () => {
      // 60 is exactly row-1's midpoint.
      drag.beginTracking('row-0', 0, 0);
      move(60);

      expect(readMarginTops(wrapper)).toEqual({
        'row-0': '',
        'row-1': '',
        'row-2': '40px',
        'row-3': '',
      });

      up(60);

      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith({
        rowId: 'row-0',
        beforeRowId: 'row-2',
        afterRowId: 'row-1',
      });
    });
  });

  describe('drop result', () => {
    it('resolves the row above from the list without the dragged row', () => {
      drag.beginTracking('row-1', 0, 40);
      move(55);
      up(55);

      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith({
        rowId: 'row-1',
        beforeRowId: 'row-2',
        afterRowId: 'row-0',
      });
    });

    it('reports no neighbours when the dragged row is the only row', () => {
      const soloWrapper = createWrapper(['solo']);
      const soloDrop = vi.fn<(result: ListRowDragResult) => void>();
      const soloDrag = new DatabaseListRowDrag({ wrapper: soloWrapper, onDrop: soloDrop });

      try {
        soloDrag.beginTracking('solo', 0, 0);
        move(500);
        up(500);

        expect(soloDrop).toHaveBeenCalledTimes(1);
        expect(soloDrop).toHaveBeenCalledWith({
          rowId: 'solo',
          beforeRowId: null,
          afterRowId: null,
        });
      } finally {
        soloDrag.destroy();
        soloWrapper.remove();
      }
    });

    it('resets rowId even when the host restarts tracking from inside cleanup', () => {
      wrapper.remove();
      wrapper = createWrapper(['row-a', '', 'row-c', 'row-d']);
      drag = new DatabaseListRowDrag({ wrapper, onDrop });

      const sourceRow = requireRow(wrapper, 'row-a');
      let restarted = false;

      onOpacityBlanked(sourceRow, () => {
        restarted = true;
        drag.beginTracking('row-d', 0, 40);
      });

      drag.beginTracking('row-a', 0, 0);
      move(60);
      up(60);

      expect(restarted).toBe(true);

      // The empty-id row is only excluded from the drop scan while rowId is
      // back at its reset value of ''.
      move(55);

      expect(readMarginTops(wrapper)).toEqual({
        'row-a': '',
        '': '',
        'row-c': '0px',
        'row-d': '',
      });
    });
  });
});
