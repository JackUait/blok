import type { API } from '../../../types';

import type { TableCellBlocks } from './table-cell-blocks';
import { CELL_BLOCKS_ATTR } from './table-cell-blocks';
import { BORDER_WIDTH, ROW_ATTR, CELL_ATTR } from './table-core';
import type { TableGrid } from './table-core';
import type { LegacyCellContent, TableData } from './types';
import { isCellWithBlocks } from './types';

// ─── Pure DOM helpers ───────────────────────────────────────────────

export const readPixelWidths = (gridEl: HTMLElement): number[] => {
  const firstRow = gridEl.querySelector(`[${ROW_ATTR}]`);

  if (!firstRow) {
    return [];
  }

  const cells = firstRow.querySelectorAll(`[${CELL_ATTR}]`);

  return Array.from(cells).map(cell =>
    (cell as HTMLElement).getBoundingClientRect().width
  );
};

export const applyPixelWidths = (gridEl: HTMLElement, widths: number[]): void => {
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const gridStyle: HTMLElement = gridEl;

  gridStyle.style.width = `${totalWidth + BORDER_WIDTH}px`;

  const rowEls = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  rowEls.forEach(row => {
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    cells.forEach((node, i) => {
      if (i < widths.length) {
        const cellEl = node as HTMLElement;

        cellEl.style.width = `${widths[i]}px`;
      }
    });
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
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
    const cell = cells[colIndex] as HTMLElement | undefined;

    return !cell || isCellEmpty(cell);
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
  data: TableData,
  grid: TableGrid,
): number[] => {
  const colWidths = data.colWidths ?? readPixelWidths(gridEl);

  grid.addColumn(gridEl, index, colWidths);

  const halfAvgWidth = Math.round(
    (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
  ) / 100;
  const newWidths = [...colWidths];

  newWidths.splice(index, 0, halfAvgWidth);

  return newWidths;
};

export const computeHalfAvgWidth = (colWidths: number[]): number =>
  Math.round(
    (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
  ) / 100;

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
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    if (colIndex < cells.length) {
      cellsInColumn.push(cells[colIndex]);
    }
  });

  return cellBlocks?.getBlockIdsFromCells(cellsInColumn) ?? [];
};

// ─── Row/column deletion with block cleanup ─────────────────────────

export const deleteRowWithBlockCleanup = (
  gridEl: HTMLElement,
  rowIndex: number,
  grid: TableGrid,
  cellBlocks: TableCellBlocks | null,
): void => {
  const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);
  const row = rows[rowIndex];

  if (row && cellBlocks) {
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    cellBlocks.deleteBlocks(cellBlocks.getBlockIdsFromCells(cells));
  }

  grid.deleteRow(gridEl, rowIndex);
};

export const deleteColumnWithBlockCleanup = (
  gridEl: HTMLElement,
  colIndex: number,
  colWidths: number[] | undefined,
  grid: TableGrid,
  cellBlocks: TableCellBlocks | null,
): number[] | undefined => {
  if (cellBlocks) {
    const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);
    const cellsInColumn: Element[] = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (colIndex < cells.length) {
        cellsInColumn.push(cells[colIndex]);
      }
    });

    cellBlocks.deleteBlocks(cellBlocks.getBlockIdsFromCells(cellsInColumn));
  }

  grid.deleteColumn(gridEl, colIndex);

  return syncColWidthsAfterDeleteColumn(colWidths, colIndex);
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
): void => {
  const rowElements = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  content.forEach((rowData, rowIndex) => {
    const row = rowElements[rowIndex];

    if (!row) {
      return;
    }

    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    rowData.forEach((cellContent, colIndex) => {
      const cell = cells[colIndex] as HTMLElement | undefined;

      if (!cell) {
        return;
      }

      const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

      if (!container) {
        return;
      }

      if (!isCellWithBlocks(cellContent)) {
        return;
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

export const SCROLL_OVERFLOW_CLASSES = ['overflow-x-auto', 'pt-[9px]'];

export const enableScrollOverflow = (element: HTMLDivElement | null): void => {
  element?.classList.add(...SCROLL_OVERFLOW_CLASSES);
};

// ─── Heading styles ─────────────────────────────────────────────────

export const updateHeadingStyles = (element: HTMLDivElement | null, withHeadings: boolean): void => {
  if (!element) {
    return;
  }

  const gridEl = element.firstElementChild as HTMLElement;

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

export const updateHeadingColumnStyles = (element: HTMLDivElement | null, withHeadingColumn: boolean): void => {
  if (!element) {
    return;
  }

  const gridEl = element.firstElementChild as HTMLElement;

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
