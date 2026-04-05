import type { API } from '../../../types';

import type { TableCellBlocks } from './table-cell-blocks';
import { CELL_BLOCKS_ATTR } from './table-cell-blocks';
import { BORDER_WIDTH, ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } from './table-core';
import type { TableGrid } from './table-core';
import type { LegacyCellContent, TableData } from './types';
import { isCellWithBlocks } from './types';

// ─── Pure DOM helpers ───────────────────────────────────────────────

export const readPixelWidths = (gridEl: HTMLElement): number[] => {
  const colgroup = gridEl.querySelector('colgroup');

  if (!colgroup) {
    return [];
  }

  const cols = colgroup.querySelectorAll('col');

  return Array.from(cols).map(col =>
    parseFloat((col as HTMLElement).style.width) || 0
  );
};

export const applyPixelWidths = (gridEl: HTMLElement, widths: number[]): void => {
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const grid: HTMLElement = gridEl;

  grid.style.width = `${totalWidth + BORDER_WIDTH}px`;

  const colgroup = gridEl.querySelector('colgroup');

  if (!colgroup) {
    return;
  }

  const cols = Array.from(colgroup.querySelectorAll('col')) as HTMLElement[];

  widths.forEach((w, i) => {
    if (i < cols.length) {
      cols[i].style.width = `${w}px`;
    }
  });
};

export const getCellPosition = (gridEl: HTMLElement, cell: HTMLElement): { row: number; col: number } | null => {
  const rows = Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`));

  const rowIndex = rows.findIndex(row => {
    const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));

    return cells.includes(cell);
  });

  if (rowIndex === -1) {
    return null;
  }

  const cells = Array.from(rows[rowIndex].querySelectorAll(`[${CELL_ATTR}]`));
  const colIndex = cells.indexOf(cell);

  return { row: rowIndex, col: colIndex };
};

// ─── Cell emptiness ─────────────────────────────────────────────────

export const isCellEmpty = (cell: HTMLElement): boolean => {
  const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

  if (!container) {
    return true;
  }

  return (container.textContent ?? '').trim().length === 0;
};

export const isRowEmpty = (gridEl: HTMLElement, rowIndex: number): boolean => {
  const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);
  const row = rows[rowIndex];

  if (!row) {
    return true;
  }

  const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

  return Array.from(cells).every(cell => isCellEmpty(cell as HTMLElement));
};

export const isColumnEmpty = (gridEl: HTMLElement, colIndex: number): boolean => {
  const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  return Array.from(rows).every(row => {
    const cell = row.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${colIndex}"]`);

    return !cell || isCellEmpty(cell);
  });
};

// ─── Percent-mode width redistribution ──────────────────────────────

export const redistributePercentWidths = (gridEl: HTMLElement): void => {
  const colgroup = gridEl.querySelector('colgroup');

  if (!colgroup) {
    return;
  }

  const cols = colgroup.querySelectorAll('col');
  const currentTotal = Array.from(cols).reduce(
    (sum, col) => sum + (parseFloat((col as HTMLElement).style.width) || 0),
    0,
  );

  if (currentTotal <= 0) {
    return;
  }

  const scale = 100 / currentTotal;

  cols.forEach(col => {
    const el = col as HTMLElement;
    const oldWidth = parseFloat(el.style.width) || 0;

    el.style.width = `${Math.round(oldWidth * scale * 100) / 100}%`;
  });
};

// ─── Column width bookkeeping ───────────────────────────────────────

export const syncColWidthsAfterMove = (colWidths: number[] | undefined, fromIndex: number, toIndex: number): number[] | undefined => {
  if (!colWidths) {
    return colWidths;
  }

  const widths = [...colWidths];
  const [moved] = widths.splice(fromIndex, 1);

  widths.splice(toIndex, 0, moved);

  return widths;
};

export const syncColWidthsAfterDeleteColumn = (colWidths: number[] | undefined, index: number): number[] | undefined => {
  if (!colWidths) {
    return colWidths;
  }

  const widths = [...colWidths];

  widths.splice(index, 1);

  return widths.length > 0 ? widths : undefined;
};

export const computeInsertColumnWidths = (
  gridEl: HTMLElement,
  index: number,
  colWidths: number[] | undefined,
  initialColWidth: number | undefined,
  grid: TableGrid,
): number[] => {
  const widths = colWidths ?? readPixelWidths(gridEl);

  const halfWidth = initialColWidth !== undefined
    ? Math.round((initialColWidth / 2) * 100) / 100
    : computeHalfAvgWidth(widths);

  grid.addColumn(gridEl, index, widths, halfWidth);

  const newWidths = [...widths];

  newWidths.splice(index, 0, halfWidth);

  return newWidths;
};

export const computeHalfAvgWidth = (colWidths: number[]): number =>
  Math.round(
    (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
  ) / 100;

export const computeInitialColWidth = (colWidths: number[]): number => {
  if (colWidths.length === 0) {
    return 0;
  }

  return Math.round((colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length) * 100) / 100;
};

// ─── Block IDs from cells ───────────────────────────────────────────

export const getBlockIdsInRow = (element: HTMLElement | null, cellBlocks: TableCellBlocks | null, rowIndex: number): string[] => {
  if (!element) {
    return [];
  }

  const rows = element.querySelectorAll(`[${ROW_ATTR}]`);
  const row = rows[rowIndex];

  if (!row) {
    return [];
  }

  return cellBlocks?.getBlockIdsFromCells(row.querySelectorAll(`[${CELL_ATTR}]`)) ?? [];
};

export const getBlockIdsInColumn = (element: HTMLElement | null, cellBlocks: TableCellBlocks | null, colIndex: number): string[] => {
  if (!element) {
    return [];
  }

  const rows = element.querySelectorAll(`[${ROW_ATTR}]`);
  const cellsInColumn: Element[] = [];

  rows.forEach(row => {
    const cell = row.querySelector(`[${CELL_COL_ATTR}="${colIndex}"]`);

    if (cell) {
      cellsInColumn.push(cell);
    }
  });

  return cellBlocks?.getBlockIdsFromCells(cellsInColumn) ?? [];
};

// ─── Populate new cells ─────────────────────────────────────────────

export const populateNewCells = (gridEl: HTMLElement, cellBlocks: TableCellBlocks | null): void => {
  const cells = gridEl.querySelectorAll(`[${CELL_ATTR}]`);

  cells.forEach(cell => {
    cellBlocks?.ensureCellHasBlock(cell as HTMLElement);
  });
};

// ─── Readonly block mounting ────────────────────────────────────────

export const mountCellBlocksReadOnly = (
  gridEl: HTMLElement,
  content: LegacyCellContent[][],
  api: API,
  _tableBlockId: string,
): void => {
  const rowElements = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  content.forEach((rowData, rowIndex) => {
    const row = rowElements[rowIndex];

    if (!row) {
      return;
    }

    rowData.forEach((cellContent, colIndex) => {
      const cell = row.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${colIndex}"]`);

      if (!cell) {
        return;
      }

      const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

      if (!container) {
        return;
      }

      // Skip legacy cells that already have blocks (idempotency guard)
      const hasExistingBlocks = container.querySelectorAll('[data-blok-id]').length > 0;

      if (!isCellWithBlocks(cellContent) && hasExistingBlocks) {
        return;
      }

      if (!isCellWithBlocks(cellContent)) {
        // Read-only render path must not mutate block state.
        // Use innerHTML so that legacy HTML markup (e.g. <b>bold</b>) is
        // interpreted by the browser rather than shown as literal text.
        container.innerHTML = cellContent;

        return;
      }

      // If this container previously rendered legacy text, clear it before mounting holders.
      if (!hasExistingBlocks && (container.textContent ?? '').length > 0) {
        container.textContent = '';
      }

      for (const blockId of cellContent.blocks) {
        const index = api.blocks.getBlockIndex(blockId);

        if (index === undefined) {
          continue;
        }

        const block = api.blocks.getBlockByIndex(index);

        if (!block) {
          continue;
        }

        container.appendChild(block.holder);
      }

      // Strip placeholder attributes so paragraphs inside table cells
      // don't show standalone-paragraph placeholders in readonly mode.
      container.querySelectorAll<HTMLElement>('[data-blok-placeholder-active]').forEach(el => {
        el.removeAttribute('data-blok-placeholder-active');
      });
      container.querySelectorAll<HTMLElement>('[data-placeholder]').forEach(el => {
        el.removeAttribute('data-placeholder');
      });
    });
  });
};

// ─── Data normalization ─────────────────────────────────────────────

export const normalizeTableData = (
  data: TableData | Record<string, never>,
  config: { withHeadings?: boolean; stretched?: boolean },
): TableData => {
  const isTableData = typeof data === 'object' && data !== null && 'content' in data;

  if (!isTableData) {
    return {
      withHeadings: config.withHeadings ?? false,
      withHeadingColumn: false,
      stretched: config.stretched ?? false,
      content: [],
    };
  }

  const tableData = data as TableData;
  const cols = tableData.content?.[0]?.length;
  const colWidths = tableData.colWidths;
  const validWidths = colWidths && cols && colWidths.length === cols ? colWidths : undefined;

  return {
    withHeadings: tableData.withHeadings ?? config.withHeadings ?? false,
    withHeadingColumn: tableData.withHeadingColumn ?? false,
    stretched: tableData.stretched ?? config.stretched ?? false,
    content: tableData.content ?? [],
    colWidths: validWidths,
    initialColWidth: tableData.initialColWidth,
  };
};

// ─── Keyboard navigation ────────────────────────────────────────────

export const setupKeyboardNavigation = (
  gridEl: HTMLElement,
  cellBlocks: TableCellBlocks | null,
): void => {
  gridEl.addEventListener('keydown', (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return;
    }

    const position = getCellPosition(gridEl, cell);

    if (position) {
      cellBlocks?.handleKeyDown(event, position);
    }
  });
};

export const SCROLL_OVERFLOW_CLASSES = ['overflow-x-auto', 'overflow-y-hidden'];

export const enableScrollOverflow = (element: HTMLDivElement | null): void => {
  element?.classList.add(...SCROLL_OVERFLOW_CLASSES);
};

// ─── Heading styles ─────────────────────────────────────────────────

export const updateHeadingStyles = (gridEl: HTMLElement | null, withHeadings: boolean): void => {
  if (!gridEl) {
    return;
  }

  const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  rows.forEach(row => {
    row.removeAttribute('data-blok-table-heading');
  });

  if (withHeadings && rows.length > 0) {
    rows[0].setAttribute('data-blok-table-heading', '');
  }
};

export const applyCellColors = (gridEl: HTMLElement, content: LegacyCellContent[][]): void => {
  const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  content.forEach((rowContent, r) => {
    if (r >= rows.length) {
      return;
    }

    rowContent.forEach((cellContent, c) => {
      const el = rows[r].querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${c}"]`);

      if (!el) {
        return;
      }

      if (isCellWithBlocks(cellContent) && cellContent.color) {
        el.style.backgroundColor = cellContent.color;
      } else {
        el.style.backgroundColor = '';
      }

      if (isCellWithBlocks(cellContent) && cellContent.textColor) {
        el.style.color = cellContent.textColor;
      } else {
        el.style.color = '';
      }
    });
  });
};

export const updateHeadingColumnStyles = (gridEl: HTMLElement | null, withHeadingColumn: boolean): void => {
  if (!gridEl) {
    return;
  }

  const allCells = gridEl.querySelectorAll(`[${CELL_ATTR}]`);

  allCells.forEach(cell => {
    cell.removeAttribute('data-blok-table-heading-col');
  });

  if (withHeadingColumn) {
    const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const firstCell = row.querySelector(`[${CELL_ATTR}]`);

      if (firstCell) {
        firstCell.setAttribute('data-blok-table-heading-col', '');
      }
    });
  }
};
