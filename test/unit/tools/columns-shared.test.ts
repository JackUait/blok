import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  unwrapColumnListIfCollapsed,
  resizeColumnGrow,
  resetColumnsToEvenWidth,
  buildColumnResizers,
  COLUMN_RESIZER_ATTR,
} from '../../../src/tools/columns-shared';
import type { API } from '../../../types';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('unwrapColumnListIfCollapsed', () => {
  it('promotes the surviving column blocks and deletes both wrappers when 1 column remains', async () => {
    const survivingChild = { id: 'p1' };
    const remainingColumn = { id: 'colA' };

    const getChildren = vi.fn()
      .mockReturnValueOnce([remainingColumn])        // column_list has 1 column
      .mockReturnValueOnce([survivingChild]);        // that column has 1 paragraph
    // delete() is index-based; resolve ids to indices on demand
    const indexById: Record<string, number> = { colA: 8, 'cl-1': 7 };
    const getBlockIndex = vi.fn().mockImplementation((id: string) => indexById[id]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    // Top-level list: its own parent is root → survivors promote to null.
    const getById = vi.fn().mockReturnValue({ parentId: null });

    const api = {
      blocks: { getChildren, getBlockIndex, getById, setBlockParent, delete: remove },
    } as unknown as API;

    const didUnwrap = await unwrapColumnListIfCollapsed(api, 'cl-1');

    expect(didUnwrap).toBe(true);
    // surviving paragraph promoted to root (null parent)
    expect(setBlockParent).toHaveBeenCalledWith('p1', null);
    // surviving column is also detached from the list BEFORE deletion, so its
    // own removed() hook sees parentId=null and does not recurse into unwrap
    expect(setBlockParent).toHaveBeenCalledWith('colA', null);
    // exactly two reparents: the child, then the surviving column
    expect(setBlockParent).toHaveBeenCalledTimes(2);
    // both wrappers deleted by id-resolved index, column FIRST then list (order
    // matters: deleting the column shifts the list's index, which is re-read)
    expect(remove).toHaveBeenNthCalledWith(1, 8);
    expect(remove).toHaveBeenNthCalledWith(2, 7);
  });

  it('promotes survivors into the ENCLOSING column when the collapsing list is nested', async () => {
    // A nested column_list (cl-1) lives inside an outer column "outerCol". When
    // it collapses, its surviving child must be promoted into outerCol, NOT to
    // the document root.
    const survivingChild = { id: 'np1' };
    const getChildren = vi.fn()
      .mockReturnValueOnce([{ id: 'ncolA' }])  // nested list has 1 column left
      .mockReturnValueOnce([survivingChild]);  // that column's child
    const indexById: Record<string, number> = { ncolA: 5, 'cl-1': 4 };
    const getBlockIndex = vi.fn().mockImplementation((id: string) => indexById[id]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    // The nested list's own parent is the enclosing outer column.
    const getById = vi.fn().mockReturnValue({ parentId: 'outerCol' });

    const api = {
      blocks: { getChildren, getBlockIndex, getById, setBlockParent, delete: remove },
    } as unknown as API;

    await unwrapColumnListIfCollapsed(api, 'cl-1');

    // Survivor goes into the enclosing column, not root.
    expect(setBlockParent).toHaveBeenCalledWith('np1', 'outerCol');
    // The surviving column itself is still detached to root before deletion.
    expect(setBlockParent).toHaveBeenCalledWith('ncolA', null);
  });

  it('re-resolves the list index by id AFTER the column delete (delete-by-id, not stale index)', async () => {
    // Deleting the column shifts the flat array, so the list's index must be
    // read again from its id — a stale captured index would target a sibling.
    const getChildren = vi.fn()
      .mockReturnValueOnce([{ id: 'colA' }])
      .mockReturnValueOnce([{ id: 'p1' }]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const getById = vi.fn().mockReturnValue({ parentId: null });
    // colA initially at 8; after it is deleted the list shifts from 7 → 6.
    const getBlockIndex = vi.fn()
      .mockReturnValueOnce(8)  // colA
      .mockReturnValueOnce(6); // cl-1, re-read post column delete

    const api = {
      blocks: { getChildren, getBlockIndex, getById, setBlockParent, delete: remove },
    } as unknown as API;

    await unwrapColumnListIfCollapsed(api, 'cl-1');

    expect(remove).toHaveBeenNthCalledWith(1, 8);
    expect(remove).toHaveBeenNthCalledWith(2, 6);
  });

  it('excludes the being-removed block from the column count (excludeId)', async () => {
    // removed() fires BEFORE the flat-array splice, so getChildren still
    // returns the block being deleted; excludeId filters it out for the
    // 1-column threshold check.
    const survivingChild = { id: 'p1' };
    const getChildren = vi.fn()
      .mockReturnValueOnce([{ id: 'colA' }, { id: 'colB' }]) // colB is being removed
      .mockReturnValueOnce([survivingChild]);                // colA's child
    const indexById: Record<string, number> = { colA: 8, 'cl-1': 7 };
    const getBlockIndex = vi.fn().mockImplementation((id: string) => indexById[id]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const getById = vi.fn().mockReturnValue({ parentId: null });
    const api = {
      blocks: { getChildren, getBlockIndex, getById, setBlockParent, delete: remove },
    } as unknown as API;

    const didUnwrap = await unwrapColumnListIfCollapsed(api, 'cl-1', 'colB');

    // After excluding colB, only colA remains → unwrap proceeds
    expect(didUnwrap).toBe(true);
    expect(setBlockParent).toHaveBeenCalledWith('p1', null);
    expect(setBlockParent).toHaveBeenCalledWith('colA', null);
  });

  it('does NOT unwrap when excludeId still leaves 2+ columns', async () => {
    const getChildren = vi.fn().mockReturnValue([{ id: 'colA' }, { id: 'colB' }, { id: 'colC' }]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const api = {
      blocks: { getChildren, getBlockIndex: vi.fn(), setBlockParent, delete: remove },
    } as unknown as API;

    // Removing colC still leaves colA + colB → no unwrap
    expect(await unwrapColumnListIfCollapsed(api, 'cl-1', 'colC')).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('does nothing when 2+ columns remain', async () => {
    const getChildren = vi.fn().mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const api = {
      blocks: { getChildren, getBlockIndex: vi.fn(), setBlockParent, delete: remove },
    } as unknown as API;

    expect(await unwrapColumnListIfCollapsed(api, 'cl-1')).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('resizeColumnGrow', () => {
  it('leaves the grow split unchanged for a zero delta', () => {
    const next = resizeColumnGrow({
      leftWidth: 200,
      rightWidth: 200,
      leftGrow: 1,
      rightGrow: 1,
      delta: 0,
      minWidth: 40,
    });

    expect(next.leftGrow).toBeCloseTo(1);
    expect(next.rightGrow).toBeCloseTo(1);
  });

  it('grows the left and shrinks the right while preserving the pair grow sum', () => {
    const next = resizeColumnGrow({
      leftWidth: 200,
      rightWidth: 200,
      leftGrow: 1,
      rightGrow: 1,
      delta: 50, // left 200->250, right 200->150 of a 400px pair
      minWidth: 40,
    });

    // grows redistribute by width fraction: 2 * 250/400 and 2 * 150/400
    expect(next.leftGrow).toBeCloseTo(1.25);
    expect(next.rightGrow).toBeCloseTo(0.75);
    // the pair's total grow is unchanged so other columns are unaffected
    expect(next.leftGrow + next.rightGrow).toBeCloseTo(2);
  });

  it('clamps so neither column drops below minWidth', () => {
    const next = resizeColumnGrow({
      leftWidth: 200,
      rightWidth: 200,
      leftGrow: 1,
      rightGrow: 1,
      delta: 1000, // would push right column to negative width
      minWidth: 40,
    });

    // left capped at pairWidth - minWidth = 360, right floored at 40
    expect(next.leftGrow).toBeCloseTo(2 * 360 / 400);
    expect(next.rightGrow).toBeCloseTo(2 * 40 / 400);
  });

  it('lets a column collapse fully when minWidth is 0 (no min-width restriction)', () => {
    const next = resizeColumnGrow({
      leftWidth: 200,
      rightWidth: 200,
      leftGrow: 1,
      rightGrow: 1,
      delta: -1000, // drag hard left, past any floor
      minWidth: 0,
    });

    // left collapses to 0 grow, right takes the whole pair grow sum
    expect(next.leftGrow).toBeCloseTo(0);
    expect(next.rightGrow).toBeCloseTo(2);
  });

  it('preserves an uneven starting grow ratio', () => {
    const next = resizeColumnGrow({
      leftWidth: 300,
      rightWidth: 150,
      leftGrow: 2,
      rightGrow: 1,
      delta: 0,
      minWidth: 40,
    });

    // sum stays 3, split by current widths
    expect(next.leftGrow + next.rightGrow).toBeCloseTo(3);
    expect(next.leftGrow).toBeCloseTo(3 * 300 / 450);
    expect(next.rightGrow).toBeCloseTo(3 * 150 / 450);
  });
});

describe('resetColumnsToEvenWidth', () => {
  const makeColumn = (id: string, grow: string) => {
    const holder = document.createElement('div');

    holder.style.flexGrow = grow;

    return { id, holder };
  };

  it('resets every column holder flex-grow to 1 so the row splits evenly', () => {
    const columns = [
      makeColumn('c1', '2'),
      makeColumn('c2', '0.5'),
      makeColumn('c3', ''),
    ];
    const getChildren = vi.fn().mockReturnValue(columns);
    const api = { blocks: { getChildren } } as unknown as API;

    resetColumnsToEvenWidth(api, 'cl');

    expect(getChildren).toHaveBeenCalledWith('cl');
    expect(columns.map(c => c.holder.style.flexGrow)).toEqual(['1', '1', '1']);
  });

  it('no-ops for a list with no columns', () => {
    const getChildren = vi.fn().mockReturnValue([]);
    const api = { blocks: { getChildren } } as unknown as API;

    expect(() => resetColumnsToEvenWidth(api, 'cl')).not.toThrow();
  });
});

describe('column resizer keyboard resize + aria', () => {
  // jsdom returns 0 for getBoundingClientRect; stub equal widths so the resize
  // math (width-fraction based) has a non-degenerate pair to redistribute.
  const stubWidth = (el: HTMLElement, width: number): void => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({ width, height: 10, top: 0, left: 0, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    });
  };

  const build = (): { resizer: HTMLElement; left: HTMLElement; right: HTMLElement } => {
    const left = document.createElement('div');
    const right = document.createElement('div');

    left.style.flexGrow = '1';
    right.style.flexGrow = '1';
    stubWidth(left, 200);
    stubWidth(right, 200);

    const container = document.createElement('div');

    container.append(left, right);

    const i18n = { t: vi.fn().mockReturnValue('Resize columns') };
    const api = { blocks: { getChildren: vi.fn() }, i18n } as unknown as API;

    buildColumnResizers(container, [left, right], false, api, 'cl-1');

    const resizer = container.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('resizer not built');
    }

    return { resizer, left, right };
  };

  it('exposes an i18n aria-label, slider value bounds, and is focusable', () => {
    const { resizer } = build();

    expect(resizer.getAttribute('aria-label')).toBe('Resize columns');
    expect(resizer.getAttribute('tabindex')).toBe('0');
    expect(resizer.getAttribute('aria-valuemin')).toBe('0');
    expect(resizer.getAttribute('aria-valuemax')).toBe('100');
    expect(resizer.getAttribute('aria-valuenow')).toBe('50');
  });

  it('ArrowRight grows the left column and updates aria-valuenow', () => {
    const { resizer, left, right } = build();

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(Number(left.style.flexGrow)).toBeGreaterThan(1);
    expect(Number(right.style.flexGrow)).toBeLessThan(1);
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  });

  it('ArrowLeft shrinks the left column', () => {
    const { resizer, left } = build();

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    expect(Number(left.style.flexGrow)).toBeLessThan(1);
  });
});

describe('column resize persists widthRatio to Yjs (dispatchChange)', () => {
  // The resizer mutates each column holder's flex-grow directly. The holder
  // lives OUTSIDE the column tool's observed subtree, so the MutationObserver
  // never fires — the new width must be flushed to Yjs explicitly via the
  // column block's dispatchChange (Column.save reads flex-grow back). Without
  // this the resize is not undoable and not propagated to collaborators.
  const stubWidth = (el: HTMLElement, width: number): void => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({ width, height: 10, top: 0, left: 0, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    });
  };

  const buildWithColumns = (): {
    resizer: HTMLElement;
    left: HTMLElement;
    right: HTMLElement;
    columns: Array<{ id: string; holder: HTMLElement; dispatchChange: ReturnType<typeof vi.fn> }>;
  } => {
    const left = document.createElement('div');
    const right = document.createElement('div');

    left.style.flexGrow = '1';
    right.style.flexGrow = '1';
    stubWidth(left, 200);
    stubWidth(right, 200);

    // jsdom does not implement pointer capture — stub so the drag handlers run.
    const noop = (): void => {};

    const container = document.createElement('div');

    container.append(left, right);

    const columns = [left, right].map((holder, i) => ({
      id: `c${i}`,
      holder,
      dispatchChange: vi.fn(),
    }));
    const getChildren = vi.fn().mockReturnValue(columns);
    const i18n = { t: vi.fn().mockReturnValue('Resize columns') };
    const api = { blocks: { getChildren }, i18n } as unknown as API;

    buildColumnResizers(container, [left, right], false, api, 'cl-1');

    const resizer = container.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('resizer not built');
    }

    Object.defineProperty(resizer, 'setPointerCapture', { configurable: true, value: noop });
    Object.defineProperty(resizer, 'releasePointerCapture', { configurable: true, value: noop });

    return { resizer, left, right, columns };
  };

  it('flushes both columns to Yjs when a keyboard resize commits', () => {
    const { resizer, columns } = buildWithColumns();

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(columns[0].dispatchChange).toHaveBeenCalledTimes(1);
    expect(columns[1].dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('does NOT flush on a no-op keyboard key', () => {
    const { resizer, columns } = buildWithColumns();

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(columns[0].dispatchChange).not.toHaveBeenCalled();
    expect(columns[1].dispatchChange).not.toHaveBeenCalled();
  });

  it('flushes both columns to Yjs when a pointer drag-resize ends', () => {
    const { resizer, columns } = buildWithColumns();

    resizer.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }));
    resizer.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, bubbles: true }));
    resizer.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, bubbles: true }));

    expect(columns[0].dispatchChange).toHaveBeenCalledTimes(1);
    expect(columns[1].dispatchChange).toHaveBeenCalledTimes(1);
  });
});

describe('column resizer dblclick equalizes widths', () => {
  const makeHolder = (grow: string): HTMLElement => {
    const el = document.createElement('div');

    el.style.flexGrow = grow;

    return el;
  };

  it('double-clicking a resizer resets all sibling columns to even width', () => {
    const left = makeHolder('3');
    const right = makeHolder('1');
    const container = document.createElement('div');

    container.append(left, right);

    const columns = [left, right].map((holder, i) => ({ id: `c${i}`, holder, dispatchChange: vi.fn() }));
    const getChildren = vi.fn().mockReturnValue(columns);
    const i18n = { t: vi.fn().mockReturnValue('Resize columns') };
    const api = { blocks: { getChildren }, i18n } as unknown as API;

    buildColumnResizers(container, [left, right], false, api, 'cl-1');

    const resizer = container.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('resizer not built');
    }

    resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(getChildren).toHaveBeenCalledWith('cl-1');
    expect(left.style.flexGrow).toBe('1');
    expect(right.style.flexGrow).toBe('1');
  });
});
