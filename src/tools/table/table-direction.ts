import { getElementDirection } from '../../components/utils/direction';
import type { TextDirection } from '../../components/utils/direction';

/**
 * Table geometry is measured in reading order: `edges` (from
 * getCumulativeColEdges) grow from column 0's inline start. In RTL column 0
 * sits on the right, so these helpers mirror a logical offset inside the grid
 * to a physical one and back. The mirror is its own inverse.
 */
export const gridX = (x: number, gridWidth: number, direction: TextDirection): number =>
  direction === 'rtl' ? gridWidth - x : x;

/**
 * Physical x of column boundary `k`, from the grid's left edge.
 */
export const colEdgeX = (edges: number[], k: number, direction: TextDirection): number =>
  gridX(edges[k] ?? 0, edges[edges.length - 1] ?? 0, direction);

/**
 * Client x mirrored for RTL, so "further toward the inline end" is always the
 * larger number. Lets gesture math written for LTR run unchanged.
 */
export interface InlineAxis {
  x(clientX: number): number;
  start(rect: Pick<DOMRect, 'left' | 'right'>): number;
  end(rect: Pick<DOMRect, 'left' | 'right'>): number;
}

const LTR_AXIS: InlineAxis = {
  x: clientX => clientX,
  start: rect => rect.left,
  end: rect => rect.right,
};

const RTL_AXIS: InlineAxis = {
  x: clientX => -clientX,
  start: rect => -rect.right,
  end: rect => -rect.left,
};

export const inlineAxis = (direction: TextDirection): InlineAxis =>
  direction === 'rtl' ? RTL_AXIS : LTR_AXIS;

/**
 * Scroll a horizontal scroller to its inline end. RTL scrollLeft runs 0…-max.
 */
export const scrollToInlineEnd = (scroller: HTMLElement): void => {
  const target = scroller;

  target.scrollLeft = getElementDirection(scroller) === 'rtl' ? -scroller.scrollWidth : scroller.scrollWidth;
};

// Own rows and cells only: a nested table's rows sit inside ours, and in the
// last row they come after it in document order.
const OWN_ROWS = ':scope > tbody > [data-blok-table-row], :scope > [data-blok-table-row]';
const OWN_CELLS = ':scope > tbody > [data-blok-table-row] > [data-blok-table-cell], :scope > [data-blok-table-row] > [data-blok-table-cell]';

/**
 * Height of the bottom row, measured live. Rows are not uniform — one with
 * wrapped text is several times taller than an empty one — so a frozen step
 * would detach the grid's edge from the pointer after the first removal.
 */
export const measureLastRowHeight = (grid: HTMLElement): number => {
  const rows = grid.querySelectorAll<HTMLElement>(OWN_ROWS);
  const lastRow = rows[rows.length - 1] as HTMLElement | undefined;

  return lastRow?.getBoundingClientRect().height ?? 0;
};

/**
 * Width of the inline-end column, measured live: columns carry whatever width
 * the user resized them to.
 *
 * Taken as the innermost cell that ends at the grid's inline end, so a cell
 * merged across the last two columns does not report the pair as one column
 * whenever some other row still splits them.
 */
export const measureLastColumnWidth = (grid: HTMLElement, gridRect: DOMRect, axis: InlineAxis): number => {
  const gridEnd = axis.end(gridRect);
  const cells = Array.from(grid.querySelectorAll<HTMLElement>(OWN_CELLS));
  const start = cells.reduce((innermost, cell) => {
    const rect = cell.getBoundingClientRect();

    return Math.abs(axis.end(rect) - gridEnd) <= 1 && axis.start(rect) > innermost ? axis.start(rect) : innermost;
  }, -Infinity);

  return start === -Infinity ? 0 : gridEnd - start;
};
