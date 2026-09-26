import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableResize } from '../../../../src/tools/table/table-resize';
import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent } from '../../../../src/tools/table/types';

const ROW_HEIGHT = 40;
const HIT_WIDTH = 16;

const cell = (extra: Partial<CellContent> = {}): CellContent => ({ blocks: [], ...extra });

const flat3x3 = (): CellContent[][] => Array.from({ length: 3 }, () => [cell(), cell(), cell()]);

/** Rows 0-1, columns 0-1 merged: border 0 is hidden in rows 0 and 1 only. */
const topLeft2x2 = (): CellContent[][] => [
  [cell({ colspan: 2, rowspan: 2 }), cell({ mergedInto: [0, 0] }), cell()],
  [cell({ mergedInto: [0, 0] }), cell({ mergedInto: [0, 0] }), cell()],
  [cell(), cell(), cell()],
];

/** Columns 1-2 merged in every row: border 1 is hidden everywhere. */
const rightColumnsMerged = (): CellContent[][] => [
  [cell(), cell({ colspan: 2, rowspan: 3 }), cell({ mergedInto: [0, 1] })],
  [cell(), cell({ mergedInto: [0, 1] }), cell({ mergedInto: [0, 1] })],
  [cell(), cell({ mergedInto: [0, 1] }), cell({ mergedInto: [0, 1] })],
];

const buildTable = (content: CellContent[][]): HTMLTableElement => {
  const model = new TableModel({ content, withHeadings: false, withHeadingColumn: false });

  return new TableGrid({ readOnly: false }).createGridFromModel(model);
};

const rect = (top: number, height: number): DOMRect => ({
  top, height, bottom: top + height, left: 0, right: HIT_WIDTH, width: HIT_WIDTH, x: 0, y: top, toJSON: () => ({}),
});

/**
 * Layout: the grid's padding box starts at y=0, every row is ROW_HEIGHT tall,
 * and a handle starts 1px above the grid (it covers the top border).
 */
const mockLayout = (): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-blok-table-row')) {
      const index = Array.from(this.parentElement?.children ?? []).indexOf(this);

      return rect(index * ROW_HEIGHT, ROW_HEIGHT);
    }

    if (this.hasAttribute('data-blok-table-resize')) {
      return rect(-1, 3 * ROW_HEIGHT + 1);
    }

    return rect(0, 3 * ROW_HEIGHT);
  });
};

/** Reports once after observe(), as a browser's ResizeObserver does for rendered rows. */
class FakeResizeObserver {
  private pending = false;
  private live = true;

  constructor(private readonly callback: () => void) {}

  public observe(): void {
    if (this.pending) {
      return;
    }
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;

      if (this.live) {
        this.callback();
      }
    });
  }

  public unobserve(): void {}

  public disconnect(): void {
    this.live = false;
  }
}

/** Let the MutationObserver and the ResizeObserver report. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const handleAt = (grid: HTMLElement, col: number): HTMLElement => {
  const handle = grid.querySelector<HTMLElement>(`[data-blok-table-resize][data-col="${col}"]`);

  if (handle === null) {
    throw new Error(`no handle for column ${col}`);
  }

  return handle;
};

describe('TableResize on a merged grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The unit setup's ResizeObserver never reports; a browser's does.
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    mockLayout();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a border hidden inside a merged cell takes no pointer there, only in the rows where it shows', async () => {
    const grid = buildTable(topLeft2x2());

    document.body.appendChild(grid);
    new TableResize(grid, [100, 100, 100], vi.fn());
    await settle();

    // Row 2 starts 80px below the grid, 81px below the handle's top.
    expect(handleAt(grid, 0).style.clipPath).toBe(`path('M0 81 H${HIT_WIDTH} V121 H0 Z')`);
    // The merge's own right edge is a real border in every row.
    expect(handleAt(grid, 1).style.clipPath).toBe('');
    expect(handleAt(grid, 2).style.clipPath).toBe('');
  });

  it('a border hidden in every row takes no pointer at all', async () => {
    const grid = buildTable(rightColumnsMerged());

    document.body.appendChild(grid);
    new TableResize(grid, [100, 100, 100], vi.fn());
    await settle();

    expect(handleAt(grid, 1).style.clipPath).toBe('inset(50%)');
    expect(handleAt(grid, 0).style.clipPath).toBe('');
    expect(handleAt(grid, 2).style.clipPath).toBe('');
  });

  it('a plain grid keeps full-height handles', async () => {
    const grid = buildTable(flat3x3());

    document.body.appendChild(grid);
    new TableResize(grid, [100, 100, 100], vi.fn());
    await settle();

    expect([0, 1, 2].map(col => handleAt(grid, col).style.clipPath)).toEqual(['', '', '']);
  });

  it('a merge that swaps the body in after the handles exist updates them without a re-init', async () => {
    const grid = buildTable(flat3x3());

    document.body.appendChild(grid);
    new TableResize(grid, [100, 100, 100], vi.fn());

    const merged = buildTable(topLeft2x2()).querySelector('tbody');

    if (merged === null) {
      throw new Error('no tbody');
    }

    grid.querySelector('tbody')?.replaceWith(merged);
    await settle();

    expect(handleAt(grid, 0).style.clipPath).toBe(`path('M0 81 H${HIT_WIDTH} V121 H0 Z')`);
  });

  it('with ResizeObserver, a body swap measures the handles once, not once directly and again on the first resize callback', async () => {

    const grid = buildTable(flat3x3());

    document.body.appendChild(grid);
    new TableResize(grid, [100, 100, 100], vi.fn());
    await settle();

    const merged = buildTable(topLeft2x2()).querySelector('tbody');

    if (merged === null) {
      throw new Error('no tbody');
    }

    const handle = handleAt(grid, 0);
    const layout = vi.mocked(HTMLElement.prototype.getBoundingClientRect);

    layout.mockClear();
    grid.querySelector('tbody')?.replaceWith(merged);
    await settle();

    // One clip pass reads the hidden border's handle once.
    expect(layout.mock.contexts.filter(context => context === handle)).toHaveLength(1);
    expect(handle.style.clipPath).toBe(`path('M0 81 H${HIT_WIDTH} V121 H0 Z')`);
  });

  it('with ResizeObserver, construction measures the handles once', async () => {
    const layout = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const grid = buildTable(topLeft2x2());

    document.body.appendChild(grid);
    new TableResize(grid, [100, 100, 100], vi.fn());
    await settle();

    const handle = handleAt(grid, 0);

    expect(layout.mock.contexts.filter(context => context === handle)).toHaveLength(1);
    expect(handle.style.clipPath).toBe(`path('M0 81 H${HIT_WIDTH} V121 H0 Z')`);
  });

  it('destroy stops watching the body', async () => {
    const grid = buildTable(flat3x3());

    document.body.appendChild(grid);
    const resize = new TableResize(grid, [100, 100, 100], vi.fn());
    const handle = handleAt(grid, 0);

    resize.destroy();

    const merged = buildTable(topLeft2x2()).querySelector('tbody');

    if (merged === null) {
      throw new Error('no tbody');
    }

    grid.querySelector('tbody')?.replaceWith(merged);
    await settle();

    expect(handle.style.clipPath).toBe('');
  });
});
