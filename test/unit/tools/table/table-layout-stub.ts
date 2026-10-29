import { vi } from 'vitest';

const OWN_ROWS = ':scope > tbody > [data-blok-table-row], :scope > [data-blok-table-row]';

const rectOf = (x: number, y: number, width: number, height: number): DOMRect =>
  ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });

/**
 * jsdom lays nothing out, and the table's drags measure the live grid. This
 * derives every grid, row and cell rect from the table DOM as it is at the
 * moment of the call: rows are `rowHeight` tall, a column is its `<col>` pixel
 * width or `colWidth`. Restored by `vi.restoreAllMocks()`.
 */
export const stubTableLayout = ({ rowHeight = 30, colWidth = 100 } = {}): void => {
  const gridOf = (row: Element): HTMLElement | null => {
    const parent = row.parentElement;

    return parent?.tagName === 'TBODY' ? parent.parentElement : parent;
  };

  const widthsOf = (grid: HTMLElement): number[] => {
    const cols = Array.from(grid.querySelectorAll<HTMLElement>(':scope > colgroup > col'));
    const firstRow = grid.querySelector(OWN_ROWS);
    const count = Math.max(cols.length, firstRow?.children.length ?? 0);

    return Array.from({ length: count }, (_, i) => {
      const px = parseFloat(cols[i]?.style.width ?? '');

      return Number.isFinite(px) && (cols[i]?.style.width ?? '').endsWith('px') ? px : colWidth;
    });
  };

  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
    if (this.hasAttribute('data-blok-table-row')) {
      const grid = gridOf(this);

      if (grid === null) {
        return rectOf(0, 0, 0, 0);
      }

      const index = Array.from(grid.querySelectorAll(OWN_ROWS)).indexOf(this);

      return rectOf(0, index * rowHeight, sum(widthsOf(grid)), rowHeight);
    }

    if (this.hasAttribute('data-blok-table-cell')) {
      const row = this.parentElement;
      const grid = row === null ? null : gridOf(row);

      if (row === null || grid === null) {
        return rectOf(0, 0, 0, 0);
      }

      const widths = widthsOf(grid);
      const col = Number(this.getAttribute('data-blok-table-cell-col'));
      const r = Array.from(grid.querySelectorAll(OWN_ROWS)).indexOf(row);

      return rectOf(sum(widths.slice(0, col)), r * rowHeight, widths[col] ?? 0, rowHeight);
    }

    const rows = this.querySelectorAll(OWN_ROWS);

    if (rows.length > 0) {
      return rectOf(0, 0, sum(widthsOf(this)), rows.length * rowHeight);
    }

    return rectOf(0, 0, 0, 0);
  });
};
