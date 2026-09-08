import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import {
  resizeColumnGrow,
  buildColumnResizers,
  rebuildColumnListResizers,
  unwrapColumnListIfCollapsed,
  COLUMNS_ATTR,
  COLUMN_ATTR,
  COLUMN_RESIZER_ATTR,
} from '../../../src/tools/columns-shared';
import type { API } from '../../../types';

type ColumnStub = {
  id: string;
  holder: HTMLElement;
  dispatchChange: Mock<() => void>;
};

/** jsdom runs no layout, so every holder carries a stubbed width. */
const makeHolder = (grow: string, width: number): HTMLElement => {
  const el = document.createElement('div');

  el.setAttribute(COLUMN_ATTR, '');
  el.style.flexGrow = grow;
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({ width, height: 10, top: 0, left: 0, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  });

  return el;
};

const makeApi = (columns: ColumnStub[], readOnly = false): API =>
  ({
    blocks: { getChildren: vi.fn().mockReturnValue(columns) },
    i18n: { t: (key: string): string => `i18n:${key}` },
    readOnly: { isEnabled: readOnly },
  }) as unknown as API;

/** Row layout as labels, so a stray/missing separator shows up as a shape change. */
const shape = (row: HTMLElement, left: HTMLElement, right: HTMLElement): string[] =>
  Array.from(row.children).map(child => {
    if (child === left) {
      return 'left';
    }
    if (child === right) {
      return 'right';
    }

    return child.hasAttribute(COLUMN_RESIZER_ATTR) ? 'resizer' : 'other';
  });

// `cancelable` is load-bearing: preventDefault() on a non-cancelable event is a
// silent no-op, so defaultPrevented would read false for the original too.
const pointer = (type: string, clientX: number, init: PointerEventInit = {}): PointerEvent =>
  new PointerEvent(type, { pointerId: 7, clientX, bubbles: true, cancelable: true, ...init });

const keydown = (key: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

type Scene = {
  container: HTMLElement;
  resizer: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  columns: ColumnStub[];
  setPointerCapture: Mock<(pointerId: number) => void>;
  releasePointerCapture: Mock<(pointerId: number) => void>;
};

/**
 * A two-column row whose grows (3 and 2) and widths (300px and 200px) are all
 * distinct and non-zero, so every arithmetic and short-circuit variation in the
 * resize maths lands on a different number than the real one.
 *
 * `bystander` prepends a third column that owns no resized holder — the only
 * shape that tells "flush the matching column" apart from "flush a different
 * one", since a two-column list flushes both either way.
 */
const buildScene = (options: { bystander?: boolean } = {}): Scene => {
  const left = makeHolder('3', 300);
  const right = makeHolder('2', 200);
  const container = document.createElement('div');

  container.setAttribute(COLUMNS_ATTR, '');
  container.append(left, right);
  document.body.append(container);

  const holders = options.bystander === true ? [ makeHolder('1', 100), left, right ] : [ left, right ];
  const columns: ColumnStub[] = holders.map((holder, index) => ({
    id: `col-${index}`,
    holder,
    dispatchChange: vi.fn(),
  }));

  buildColumnResizers(container, [ left, right ], false, makeApi(columns), 'cl-1');

  const resizer = container.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

  if (!(resizer instanceof HTMLElement)) {
    throw new Error('resizer not built');
  }

  // jsdom implements neither pointer-capture method.
  const setPointerCapture: Mock<(pointerId: number) => void> = vi.fn();
  const releasePointerCapture: Mock<(pointerId: number) => void> = vi.fn();

  Object.defineProperty(resizer, 'setPointerCapture', { configurable: true, value: setPointerCapture });
  Object.defineProperty(resizer, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });

  return { container, resizer, left, right, columns, setPointerCapture, releasePointerCapture };
};

const flushCounts = (columns: ColumnStub[]): number[] =>
  columns.map(column => column.dispatchChange.mock.calls.length);

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

describe('resizeColumnGrow degenerate pairs', () => {
  it('hands back the untouched grows when the pair has no width at all', () => {
    // pairWidth is exactly 0 while the grow sum is healthy: the only fixture
    // that separates `<= 0` from `< 0` and `||` from `&&` on the guard.
    expect(
      resizeColumnGrow({ leftWidth: 0, rightWidth: 0, leftGrow: 3, rightGrow: 2, delta: 24, minWidth: 0 })
    ).toStrictEqual({ leftGrow: 3, rightGrow: 2 });
  });

  it('hands back the untouched grows when the pair grow sum is exactly zero', () => {
    // A negative grow is the only way to reach a zero sum, and a zero sum is
    // the only point where `growSum <= 0` and `growSum < 0` disagree. Dividing
    // by this pair would hand both columns a flat 0 instead of their own grows.
    expect(
      resizeColumnGrow({ leftWidth: 300, rightWidth: 200, leftGrow: 2, rightGrow: -2, delta: 24, minWidth: 0 })
    ).toStrictEqual({ leftGrow: 2, rightGrow: -2 });
  });
});

describe('column resizer element contract', () => {
  it('stamps every separator attribute, including the i18n key it asks for', () => {
    const { resizer } = buildScene();

    expect(resizer.getAttribute(COLUMN_RESIZER_ATTR)).toBe('');
    expect(resizer.getAttribute('data-blok-testid')).toBe('column-resizer');
    expect(resizer.getAttribute('role')).toBe('separator');
    expect(resizer.getAttribute('aria-orientation')).toBe('vertical');
    expect(resizer.getAttribute('tabindex')).toBe('0');
    expect(resizer.getAttribute('aria-label')).toBe('i18n:tools.columns.resizeAriaLabel');
    expect(resizer.getAttribute('aria-valuemin')).toBe('0');
    expect(resizer.getAttribute('aria-valuemax')).toBe('100');
    // 3 of a grow sum of 5 → 60%, a value only the real sum and ratio produce.
    expect(resizer.getAttribute('aria-valuenow')).toBe('60');
  });

  it('sits between the two columns it separates', () => {
    const { container, left, right } = buildScene();

    expect(shape(container, left, right)).toStrictEqual([ 'left', 'resizer', 'right' ]);
  });
});

describe('keyboard resize', () => {
  it('consumes the key and moves the pair by one exact step', () => {
    const { resizer, left, right } = buildScene();
    const event = keydown('ArrowRight');

    resizer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    // 500px pair, grow sum 5, one 16px step → 316px / 184px.
    expect(left.style.flexGrow).toBe('3.16');
    expect(right.style.flexGrow).toBe('1.84');
    expect(resizer.getAttribute('aria-valuenow')).toBe('63');
  });

  it('flushes the two resized columns and never a bystander column', () => {
    const { resizer, columns } = buildScene({ bystander: true });

    resizer.dispatchEvent(keydown('ArrowRight'));

    expect(flushCounts(columns)).toStrictEqual([ 0, 1, 1 ]);
  });
});

describe('pointer drag resize', () => {
  it('ignores a pointerdown from a non-primary button', () => {
    const { resizer, left, right, setPointerCapture } = buildScene();
    const down = pointer('pointerdown', 200, { button: 2 });

    resizer.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(resizer.hasAttribute('data-dragging')).toBe(false);

    resizer.dispatchEvent(pointer('pointermove', 320));

    expect(left.style.flexGrow).toBe('3');
    expect(right.style.flexGrow).toBe('2');
  });

  it('captures the pointer, marks itself dragging and redistributes by the pointer delta', () => {
    const { resizer, left, right, setPointerCapture } = buildScene();
    const down = pointer('pointerdown', 200);

    resizer.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(resizer.getAttribute('data-dragging')).toBe('');

    resizer.dispatchEvent(pointer('pointermove', 240));

    // Separator moved +40 of a 500px pair with grow sum 5 → 340px / 160px.
    expect(left.style.flexGrow).toBe('3.4');
    expect(right.style.flexGrow).toBe('1.6');
    expect(resizer.getAttribute('aria-valuenow')).toBe('68');
  });

  it('pointerup releases the capture, unwires the gesture and flushes exactly once', () => {
    const { resizer, left, right, columns, releasePointerCapture } = buildScene();

    resizer.dispatchEvent(pointer('pointerdown', 200));
    resizer.dispatchEvent(pointer('pointermove', 240));
    resizer.dispatchEvent(pointer('pointerup', 240));

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(resizer.hasAttribute('data-dragging')).toBe(false);
    expect(flushCounts(columns)).toStrictEqual([ 1, 1 ]);

    // Every drag listener is gone, so late events move nothing and flush nothing.
    resizer.dispatchEvent(pointer('pointermove', 400));
    resizer.dispatchEvent(pointer('pointerup', 400));
    resizer.dispatchEvent(pointer('pointercancel', 400));

    expect(left.style.flexGrow).toBe('3.4');
    expect(right.style.flexGrow).toBe('1.6');
    expect(releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(flushCounts(columns)).toStrictEqual([ 1, 1 ]);
  });

  it('pointercancel ends the drag exactly like pointerup', () => {
    const { resizer, columns, releasePointerCapture } = buildScene();

    resizer.dispatchEvent(pointer('pointerdown', 200));
    resizer.dispatchEvent(pointer('pointermove', 240));
    resizer.dispatchEvent(pointer('pointercancel', 240));

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(resizer.hasAttribute('data-dragging')).toBe(false);
    expect(flushCounts(columns)).toStrictEqual([ 1, 1 ]);
  });
});

describe('buildColumnResizers', () => {
  const makeRow = (): { container: HTMLElement; left: HTMLElement; right: HTMLElement } => {
    const left = makeHolder('3', 300);
    const right = makeHolder('2', 200);
    const container = document.createElement('div');

    container.setAttribute(COLUMNS_ATTR, '');
    container.append(left, right);
    document.body.append(container);

    return { container, left, right };
  };

  it('builds no separators at all in read-only mode', () => {
    const { container, left, right } = makeRow();

    buildColumnResizers(container, [ left, right ], true, makeApi([]), 'cl-1');

    expect(shape(container, left, right)).toStrictEqual([ 'left', 'right' ]);
  });

  it('replaces the previous separators instead of stacking a second one', () => {
    const { container, left, right } = makeRow();
    const api = makeApi([]);

    buildColumnResizers(container, [ left, right ], false, api, 'cl-1');
    buildColumnResizers(container, [ left, right ], false, api, 'cl-1');

    expect(shape(container, left, right)).toStrictEqual([ 'left', 'resizer', 'right' ]);
  });
});

describe('rebuildColumnListResizers', () => {
  const makeLiveRow = (): {
    row: HTMLElement;
    left: HTMLElement;
    right: HTMLElement;
    columns: ColumnStub[];
  } => {
    const left = makeHolder('3', 300);
    const right = makeHolder('2', 200);
    const row = document.createElement('div');

    row.setAttribute(COLUMNS_ATTR, '');
    row.append(left, right);
    document.body.append(row);

    // The stray LEADING bar a removed column leaves behind: it is what a rebuild
    // has to clear, and its position makes "did nothing" distinguishable from
    // "rebuilt", which a bare separator count cannot do.
    const stale = document.createElement('div');

    stale.setAttribute(COLUMN_RESIZER_ATTR, '');
    row.prepend(stale);

    const columns: ColumnStub[] = [ left, right ].map((holder, index) => ({
      id: `col-${index}`,
      holder,
      dispatchChange: vi.fn(),
    }));

    return { row, left, right, columns };
  };

  it('clears the stray separator and rebuilds a live one between the columns', () => {
    const { row, left, right, columns } = makeLiveRow();

    rebuildColumnListResizers(makeApi(columns), 'cl-1');

    expect(shape(row, left, right)).toStrictEqual([ 'left', 'resizer', 'right' ]);

    const resizer = row.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('resizer not rebuilt');
    }

    expect(resizer.getAttribute('aria-valuenow')).toBe('60');
  });

  it('rebuilds nothing in read-only mode', () => {
    const { row, left, right, columns } = makeLiveRow();

    rebuildColumnListResizers(makeApi(columns, true), 'cl-1');

    expect(shape(row, left, right)).toStrictEqual([ 'resizer', 'left', 'right' ]);
  });

  it('no-ops when the list has no live holder left', () => {
    const { row, left, right } = makeLiveRow();

    rebuildColumnListResizers(makeApi([]), 'cl-1');

    expect(shape(row, left, right)).toStrictEqual([ 'resizer', 'left', 'right' ]);
  });
});

describe('unwrapColumnListIfCollapsed delete resolution', () => {
  it('skips a delete whose id no longer resolves to an index', async () => {
    const getChildren = vi.fn()
      .mockReturnValueOnce([ { id: 'colA' } ])
      .mockReturnValueOnce([ { id: 'p1' } ]);
    // colA has already left the flat array; only the list is still addressable.
    const getBlockIndex = vi.fn((id: string) => (id === 'colA' ? undefined : 7));
    const remove = vi.fn().mockResolvedValue(undefined);
    const api = {
      blocks: {
        getChildren,
        getBlockIndex,
        getById: vi.fn().mockReturnValue({ parentId: null }),
        setBlockParent: vi.fn(),
        delete: remove,
      },
    } as unknown as API;

    await unwrapColumnListIfCollapsed(api, 'cl-1');

    expect(remove.mock.calls).toStrictEqual([ [ 7 ] ]);
  });

  it('promotes survivors to root when the column_list itself no longer resolves', async () => {
    const getChildren = vi.fn()
      .mockReturnValueOnce([ { id: 'colA' } ])
      .mockReturnValueOnce([ { id: 'p1' } ]);
    const setBlockParent = vi.fn();
    const api = {
      blocks: {
        getChildren,
        getBlockIndex: vi.fn().mockReturnValue(undefined),
        // The list is gone from the index, so its parent is unreadable — the
        // promotion target falls back to root rather than throwing.
        getById: vi.fn().mockReturnValue(undefined),
        setBlockParent,
        delete: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as API;

    await expect(unwrapColumnListIfCollapsed(api, 'cl-1')).resolves.toBe(true);
    expect(setBlockParent.mock.calls).toStrictEqual([ [ 'p1', null ], [ 'colA', null ] ]);
  });
});

/*
 * Mutants proven equivalent, not left unkilled:
 *
 * - columns-shared.ts:96 (`growSum > 0` → `true`, and → `growSum >= 0`). Both
 *   terms of the sum are `Number(holder.style.flexGrow) || 1`. CSS declares
 *   flex-grow as `<number [0,∞]>`, so the CSSOM refuses a negative value: jsdom
 *   stores '' for `style.flexGrow = '-3'`, `setProperty('flex-grow', '-3')` and
 *   `setAttribute('style', 'flex-grow: -3')` alike. The `|| 1` then turns 0 and
 *   NaN into 1, so each term is > 0 and the sum can never be <= 0. Even the one
 *   code path that computes a negative grow (minWidth > pairWidth makes
 *   rightWidth negative in resizeColumnGrow) is swallowed by the same rejection
 *   when it is written back, so `style.flexGrow` never holds it. The `: 50`
 *   branch is unreachable.
 *
 * - columns-shared.ts:145 (`?? []` → `?? ["Stryker was here"]`). The fallback
 *   array is consumed only by line 148's `column.holder === holder`, and every
 *   `holder` reaching persistColumnWidths comes from a real element pair. A
 *   string's `.holder` is undefined, so `find` returns undefined for the
 *   injected element exactly as it does for an empty array.
 *
 * - columns-shared.ts:396 (`excludeId !== undefined` → `true`). Taking the
 *   filter branch unconditionally runs `allColumns.filter(c => c.id !== undefined)`,
 *   and BlockAPI declares `readonly id: string` (types/api/block.d.ts:64), so
 *   the predicate is always true: same length, same first element, same result.
 */
