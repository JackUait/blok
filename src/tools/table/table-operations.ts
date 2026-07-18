import type { API } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';

import type { TableCellBlocks } from './table-cell-blocks';
import { CELL_BLOCKS_ATTR } from './table-cell-blocks';
import { applyFluidMinWidth, equalWidths, BORDER_WIDTH, ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } from './table-core';
import type { TableGrid } from './table-core';
import type { CellContent, LegacyCellContent, TableData, TableTextSize } from './types';
import { isCellWithBlocks } from './types';

// ─── Pure DOM helpers ───────────────────────────────────────────────

export const readPixelWidths = (gridEl: HTMLElement): number[] => {
  const colgroup = gridEl.querySelector('colgroup');

  if (!colgroup) {
    return [];
  }

  const cols = colgroup.querySelectorAll('col');
  const firstCol = cols[0] as HTMLElement | undefined;

  // When columns use percentage widths, parseFloat would return the percentage
  // number (e.g. 50 from "50%") which is not a pixel value. In that case,
  // read actual rendered widths from the first row's cells.
  if (firstCol && firstCol.style.width.endsWith('%')) {
    const firstRow = gridEl.querySelector(`[${ROW_ATTR}]`);

    if (firstRow) {
      return Array.from(firstRow.querySelectorAll(`[${CELL_ATTR}]`)).map(
        cell => Math.round(cell.getBoundingClientRect().width)
      );
    }
  }

  return Array.from(cols).map(col =>
    parseFloat((col as HTMLElement).style.width) || 0
  );
};

export const applyPixelWidths = (gridEl: HTMLElement, widths: number[]): void => {
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const grid: HTMLElement = gridEl;

  grid.style.width = `${totalWidth + BORDER_WIDTH}px`;
  // Pixel mode carries its own explicit width; the fluid floor would fight it.
  grid.style.minWidth = '';

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
  const rowEl = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

  if (!rowEl || !gridEl.contains(rowEl)) {
    return null;
  }

  // Rows always render (rowspan never removes a <tr>), so the physical row
  // index equals the logical row. Columns DIVERGE: merged cells are not
  // rendered as <td>, so a physical NodeList index would be wrong in any
  // merge-touched row. Read the LOGICAL column the cell carries instead.
  const row = Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`)).indexOf(rowEl);
  const colAttr = cell.getAttribute(CELL_COL_ATTR);

  if (row < 0 || colAttr === null) {
    return null;
  }

  const col = parseInt(colAttr, 10);

  if (Number.isNaN(col)) {
    return null;
  }

  return { row, col };
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

/**
 * Return the grid to FLUID mode: percent columns summing to 100, `width: 100%`,
 * no pinned pixel width, and the per-column floor that lets a wide table scroll.
 *
 * This is the only way back from pixel mode — the first resize drag pins the
 * whole table to pixels forever otherwise (see Table.fitToPageWidth).
 */
export const applyFluidWidths = (gridEl: HTMLElement): void => {
  const colgroup = gridEl.querySelector('colgroup');

  if (!colgroup) {
    return;
  }

  const cols = Array.from(colgroup.querySelectorAll('col')) as HTMLElement[];
  const widths = equalWidths(cols.length);
  const grid: HTMLElement = gridEl;

  grid.style.width = '100%';
  applyFluidMinWidth(grid, cols.length);

  cols.forEach((col, i) => {
    const el: HTMLElement = col;

    el.style.width = `${widths[i]}%`;
  });
};

export const redistributePercentWidths = (gridEl: HTMLElement): void => {
  const colgroup = gridEl.querySelector('colgroup');

  if (!colgroup) {
    return;
  }

  const cols = colgroup.querySelectorAll('col');

  // The column COUNT changed (add/delete column in percent mode), so the fluid
  // floor has to grow/shrink with it.
  applyFluidMinWidth(gridEl, cols.length);

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

/**
 * Column widths around an insert, WITHOUT touching the DOM.
 *
 * `existing` are the widths of the columns that are already there, `inserted`
 * is the width for the new column, and `next` is the resulting width list.
 * Split out of computeInsertColumnWidths so a merged grid — which re-renders
 * its <tbody> from the model instead of splicing a <td> per row — can reuse
 * the exact same width arithmetic without the physical-index DOM insert.
 */
export interface InsertColumnWidthPlan {
  existing: number[];
  inserted: number;
  next: number[];
}

export const planInsertColumnWidths = (
  gridEl: HTMLElement,
  index: number,
  colWidths: number[] | undefined,
  initialColWidth: number | undefined,
): InsertColumnWidthPlan => {
  const existing = colWidths ?? readPixelWidths(gridEl);

  const inserted = initialColWidth !== undefined
    ? Math.round((initialColWidth / 2) * 100) / 100
    : computeHalfAvgWidth(existing);

  const next = [...existing];

  next.splice(index, 0, inserted);

  return { existing, inserted, next };
};

export const computeInsertColumnWidths = (
  gridEl: HTMLElement,
  index: number,
  colWidths: number[] | undefined,
  initialColWidth: number | undefined,
  grid: TableGrid,
): number[] => {
  const plan = planInsertColumnWidths(gridEl, index, colWidths, initialColWidth);

  grid.addColumn(gridEl, index, plan.existing, plan.inserted);

  return plan.next;
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
        // Wrap in a div with leading-[1.5] so the line-height matches paragraph
        // blocks used in edit mode (where legacy strings are converted to real
        // paragraph blocks with that line-height). Without this wrapper, the
        // text inherits the cell's leading-none, producing shorter cells.
        const wrapper = document.createElement('div');

        wrapper.className = 'leading-[1.5]';
        wrapper.innerHTML = cellContent;
        container.replaceChildren(wrapper);

        return;
      }

      // Clear the container before (re-)mounting block holders.
      // This covers two cases:
      //   1. Legacy text was previously rendered and needs to be replaced with blocks.
      //   2. Block holders are already mounted (e.g. from edit mode before a
      //      setReadOnly toggle) — without clearing, the clone-guard below would
      //      duplicate every holder because it detects them inside a
      //      [data-blok-nested-blocks] container and appends a cloneNode(true).
      if (hasExistingBlocks || (container.textContent ?? '').length > 0) {
        container.replaceChildren();
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

        // Skip blocks whose parentId explicitly points to a DIFFERENT table
        // (corrupted cross-table references). Blocks with null/undefined
        // parentId are accepted: legitimate flat-array data shapes (e.g. the
        // dodopizza article format) reference children by id from
        // `cell.blocks` without setting `parent` on each child, and the
        // Renderer's normalizeTableChildParents pre-step is the primary
        // place that backfills parentId. This guard is defense-in-depth for
        // load paths that bypass the Renderer (Yjs sync, direct insertion).
        if (block.parentId !== null && block.parentId !== undefined && block.parentId !== _tableBlockId) {
          continue;
        }

        // Guard: if the block holder is already inside another table cell's
        // blocks container, clone its visual content instead of moving (stealing)
        // the DOM node. This can happen when corrupted data references the same
        // block in multiple tables. In read-only mode a deep clone is safe
        // because the content is non-interactive.
        if (block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`)) {
          container.appendChild(block.holder.cloneNode(true));
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

/**
 * Pad ragged rows out to the widest row's column count with empty
 * `{ blocks: [] }` cells, producing a rectangular grid.
 *
 * Older published articles (and HTML-pasted tables with rowspan/colspan) can
 * store rows SHORTER than the widest row — e.g. a 3-column table whose later
 * rows only carry 1–2 cells. The grid is rendered to the widest row's column
 * count, so createGrid pads every short row out to full width in the DOM, but
 * initializeCells() iterates the STORED row, never visiting the padded trailing
 * cells. Those gap cells get no paragraph block → zero contenteditable target →
 * the cell is impossible to click into or type in (observed live: KB table
 * block DQfJHidzTi). Rectangularizing up front makes the whole edit pipeline
 * (grid, model, initializeCells, save) see one rectangular grid so every cell
 * is editable.
 *
 * Rows already at or above the max width (including merge tables, whose rows
 * carry full-width mergedInto placeholders) are returned untouched.
 */
export const rectangularizeContent = (
  content: LegacyCellContent[][],
): LegacyCellContent[][] => {
  const maxCols = content.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);

  // A null/undefined row would crash initializeCells' `rowData.forEach`, so it
  // counts as needing work even when it is not strictly shorter than maxCols
  // (e.g. an all-null grid where maxCols === 0). Bailing only on length checks
  // would let those rows slip through untouched.
  if (!content.some(row => row == null || row.length < maxCols)) {
    return content;
  }

  return content.map(row => {
    const cells = row ?? [];

    if (cells.length >= maxCols) {
      return cells;
    }

    const padded = [...cells];

    while (padded.length < maxCols) {
      padded.push({ blocks: [] });
    }

    return padded;
  });
};

/** HTML spec limits for span attributes (browsers clamp to the same values). */
const MAX_COLSPAN = 1000;
const MAX_ROWSPAN = 65534;

const parseSpan = (cell: Element, attr: 'colspan' | 'rowspan', max: number): number => {
  const raw = Number.parseInt(cell.getAttribute(attr) ?? '', 10);

  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }

  return Math.min(raw, max);
};

/**
 * Per-position factories used by {@link mapPastedTableCells} to build cells
 * for the logical grid.
 */
export interface PastedCellFactories<T> {
  /** Build a cell for a physical `<td>`/`<th>` (span already clamped). */
  cell: (cellEl: Element, span: { colspan: number; rowspan: number }) => T;
  /** Build a placeholder for a slot covered by a span originating at [row, col]. */
  covered: (origin: [number, number]) => T;
  /** Build a filler for slots left empty by ragged rows. */
  filler: () => T;
}

/**
 * Walk pasted `<tr>` elements into a rectangular logical grid, honouring
 * colspan/rowspan the way the HTML table processing model does: each cell is
 * placed at the first free logical slot of its row, and the slots it spans
 * are claimed as covered.
 *
 * This is what keeps merged tables from Google Docs / Word / buildin.ai
 * intact — reading cells by their physical DOM index both drops the merge
 * AND shifts every cell after a rowspan into the wrong column.
 *
 * @param rowElements - the pasted `<tr>` elements, in document order
 * @param factories - builders for physical, covered and filler positions
 */
export const mapPastedTableCells = <T>(
  rowElements: ArrayLike<Element>,
  factories: PastedCellFactories<T>,
): T[][] => {
  const rows = Array.from(rowElements);
  const grid: (T | undefined)[][] = rows.map(() => []);
  const state = { hasMerges: false };

  const nextFreeSlot = (row: (T | undefined)[], start: number): number =>
    row[start] === undefined ? start : nextFreeSlot(row, start + 1);

  const markCoveredSlots = (r: number, c: number, rowspan: number, colspan: number): void => {
    Array.from({ length: rowspan }).forEach((_, dr) => {
      Array.from({ length: colspan }).forEach((__, dc) => {
        if (dr === 0 && dc === 0) {
          return;
        }

        // Malformed HTML can declare overlapping spans; keep the first
        // cell that claimed a slot (matches browser behaviour).
        grid[r + dr][c + dc] ??= factories.covered([r, c]);
      });
    });
  };

  rows.forEach((rowEl, r) => {
    Array.from(rowEl.querySelectorAll('td, th')).reduce((cursor, cellEl) => {
      // Skip slots already covered by spans from earlier rows/cells
      const c = nextFreeSlot(grid[r], cursor);

      const colspan = parseSpan(cellEl, 'colspan', MAX_COLSPAN);
      // A rowspan can never extend past the last pasted row
      const rowspan = Math.min(parseSpan(cellEl, 'rowspan', MAX_ROWSPAN), rows.length - r);

      grid[r][c] = factories.cell(cellEl, { colspan, rowspan });

      if (colspan > 1 || rowspan > 1) {
        state.hasMerges = true;
        markCoveredSlots(r, c, rowspan, colspan);
      }

      return c + colspan;
    }, 0);
  });

  // A `<tr>` with no cells and no coverage contributes nothing. Only safe to
  // drop when the table has no merges — removing a row would otherwise shift
  // the [row, col] coordinates that covered origins reference.
  const kept = state.hasMerges ? grid : grid.filter(row => row.length > 0);

  const width = kept.reduce((max, row) => Math.max(max, row.length), 0);

  return kept.map(row =>
    Array.from({ length: width }, (_, i) => row[i] ?? factories.filler())
  );
};

/**
 * Parse pasted `<tr>` elements into a rectangular logical {@link CellContent}
 * grid: spans are recorded on origin cells, covered slots carry `mergedInto`
 * pointing at the origin.
 *
 * @param rowElements - the pasted `<tr>` elements, in document order
 * @param extractCellProps - per-cell extractor for extra props (e.g. colors)
 */
export const parsePastedTable = (
  rowElements: ArrayLike<Element>,
  extractCellProps: (cell: Element) => Partial<CellContent> = () => ({}),
): CellContent[][] =>
  mapPastedTableCells<CellContent>(rowElements, {
    cell: (cellEl, { colspan, rowspan }) => ({
      blocks: [],
      text: cellEl.innerHTML,
      ...extractCellProps(cellEl),
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    }),
    covered: (origin) => ({ blocks: [], mergedInto: origin }),
    filler: () => ({ blocks: [] }),
  });

export const normalizeTableData = (
  data: TableData | Record<string, never>,
  config: { withHeadings?: boolean; withHeadingColumn?: boolean; stretched?: boolean },
): TableData => {
  const isTableData = typeof data === 'object' && data !== null && 'content' in data;

  if (!isTableData) {
    return {
      withHeadings: config.withHeadings ?? false,
      withHeadingColumn: config.withHeadingColumn ?? false,
      stretched: config.stretched ?? false,
      content: [],
    };
  }

  const tableData = data as TableData;
  const content = rectangularizeContent(tableData.content ?? []);
  const cols = content[0]?.length;
  const colWidths = tableData.colWidths;
  const validWidths = colWidths
    && cols
    && colWidths.length === cols
    && colWidths.every(w => Number.isFinite(w) && w > 0)
    ? colWidths
    : undefined;

  return {
    withHeadings: tableData.withHeadings ?? config.withHeadings ?? false,
    withHeadingColumn: tableData.withHeadingColumn ?? config.withHeadingColumn ?? false,
    stretched: tableData.stretched ?? config.stretched ?? false,
    content,
    colWidths: validWidths,
    initialColWidth: tableData.initialColWidth,
    textSize: tableData.textSize,
  };
};

// ─── Keyboard navigation ────────────────────────────────────────────

export const setupKeyboardNavigation = (
  gridEl: HTMLElement,
  cellBlocks: TableCellBlocks | null,
): (() => void) => {
  const resolvePosition = (event: KeyboardEvent): { row: number; col: number } | null => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return null;
    }

    return getCellPosition(gridEl, cell);
  };

  const handler = (event: KeyboardEvent): void => {
    const position = resolvePosition(event);

    if (position) {
      cellBlocks?.handleKeyDown(event, position);
    }
  };

  /**
   * Arrow navigation runs in the CAPTURE phase so it acts before core's
   * block-level keydown (bound on each block holder in bubble phase), which
   * otherwise exits the whole table at a cell boundary. See handleArrowNavigation.
   */
  const arrowHandler = (event: KeyboardEvent): void => {
    const position = resolvePosition(event);

    if (position) {
      cellBlocks?.handleArrowNavigation(event, position);
    }
  };

  gridEl.addEventListener('keydown', handler);
  gridEl.addEventListener('keydown', arrowHandler, true);

  return () => {
    gridEl.removeEventListener('keydown', handler);
    gridEl.removeEventListener('keydown', arrowHandler, true);
  };
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

/**
 * Marker attribute for the comfortable (regular-size) text density.
 * Absent in compact mode — the cells' own text-sm is the compact scale.
 */
export const TEXT_SIZE_ATTR = 'data-blok-table-text-size';

export const updateTextSizeStyles = (gridEl: HTMLElement | null, textSize: TableTextSize): void => {
  if (!gridEl) {
    return;
  }

  if (textSize === 'comfortable') {
    gridEl.setAttribute(TEXT_SIZE_ATTR, 'comfortable');
  } else {
    gridEl.removeAttribute(TEXT_SIZE_ATTR);
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

export const applyCellPlacements = (gridEl: HTMLElement, content: LegacyCellContent[][]): void => {
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

      const blocksContainer = el.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

      if (!blocksContainer) {
        return;
      }

      if (isCellWithBlocks(cellContent) && cellContent.placement && cellContent.placement !== 'top-left') {
        blocksContainer.setAttribute('data-blok-cell-placement', cellContent.placement);
      } else {
        blocksContainer.removeAttribute('data-blok-cell-placement');
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

    // Query by LOGICAL column, never by first PHYSICAL cell: a row whose
    // column-0 slot is covered by a rowspan has no <td> for it (the origin
    // above renders it), so its first physical cell belongs to a later column
    // and would get the heading shading painted on the wrong cell.
    // Same rule as applyCellColors.
    rows.forEach(row => {
      const firstCell = row.querySelector(`[${CELL_COL_ATTR}="0"]`);

      if (firstCell) {
        firstCell.setAttribute('data-blok-table-heading-col', '');
      }
    });
  }
};
