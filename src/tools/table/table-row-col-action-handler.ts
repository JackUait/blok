import type { TableCellBlocks } from './table-cell-blocks';
import type { TableGrid } from './table-core';
import {
  applyPixelWidths,
  computeInsertColumnWidths,
  populateNewCells,
  redistributePercentWidths,
  syncColWidthsAfterDeleteColumn,
  syncColWidthsAfterMove,
} from './table-operations';
import type { RowColAction } from './table-row-col-controls';
import type { TableData } from './types';

/**
 * Describes which row or column to highlight after an action completes.
 */
export type PendingHighlight = { type: 'row' | 'col'; index: number };

interface ActionContext {
  grid: TableGrid;
  data: TableData;
  cellBlocks: TableCellBlocks | null;
  blocksToDelete?: string[];
}

interface ActionResult {
  pendingHighlight: PendingHighlight | null;
  moveSelection: { type: 'row' | 'col'; index: number } | null;
  colWidths: number[] | undefined;
  withHeadings: boolean;
  withHeadingColumn: boolean;
}

const handleInsertRow = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  ctx.grid.addRow(gridEl, index);
  populateNewCells(gridEl, ctx.cellBlocks);

  return {
    pendingHighlight: { type: 'row', index },
    moveSelection: null,
    colWidths: ctx.data.colWidths,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

const handleInsertCol = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  const colWidths = computeInsertColumnWidths(gridEl, index, ctx.data, ctx.grid);

  populateNewCells(gridEl, ctx.cellBlocks);

  return {
    pendingHighlight: { type: 'col', index },
    moveSelection: null,
    colWidths,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

const handleMoveRow = (
  gridEl: HTMLElement,
  fromIndex: number,
  toIndex: number,
  ctx: ActionContext,
): ActionResult => {
  ctx.grid.moveRow(gridEl, fromIndex, toIndex);

  return {
    pendingHighlight: null,
    moveSelection: { type: 'row', index: toIndex },
    colWidths: ctx.data.colWidths,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

const handleMoveCol = (
  gridEl: HTMLElement,
  fromIndex: number,
  toIndex: number,
  ctx: ActionContext,
): ActionResult => {
  ctx.grid.moveColumn(gridEl, fromIndex, toIndex);

  return {
    pendingHighlight: null,
    moveSelection: { type: 'col', index: toIndex },
    colWidths: syncColWidthsAfterMove(ctx.data.colWidths, fromIndex, toIndex),
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

const handleDeleteRow = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  ctx.cellBlocks?.deleteBlocks(ctx.blocksToDelete ?? []);
  ctx.grid.deleteRow(gridEl, index);

  const newRowCount = ctx.grid.getRowCount(gridEl);
  const neighborRow = index < newRowCount ? index : index - 1;

  return {
    pendingHighlight: { type: 'row', index: neighborRow },
    moveSelection: null,
    colWidths: ctx.data.colWidths,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

const handleDeleteCol = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  ctx.cellBlocks?.deleteBlocks(ctx.blocksToDelete ?? []);
  ctx.grid.deleteColumn(gridEl, index);

  const colWidths = syncColWidthsAfterDeleteColumn(ctx.data.colWidths, index);

  if (colWidths) {
    applyPixelWidths(gridEl, colWidths);
  } else {
    redistributePercentWidths(gridEl);
  }

  const newColCount = ctx.grid.getColumnCount(gridEl);
  const neighborCol = index < newColCount ? index : index - 1;

  return {
    pendingHighlight: { type: 'col', index: neighborCol },
    moveSelection: null,
    colWidths,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

/**
 * Execute a row/column action on the table grid.
 * Returns the updated colWidths, withHeadings, withHeadingColumn values
 * along with pendingHighlight and moveSelection for the caller to apply.
 */
export const executeRowColAction = (
  gridEl: HTMLElement,
  action: RowColAction,
  ctx: ActionContext,
): ActionResult => {
  switch (action.type) {
    case 'insert-row-above':
      return handleInsertRow(gridEl, action.index, ctx);
    case 'insert-row-below':
      return handleInsertRow(gridEl, action.index + 1, ctx);
    case 'insert-col-left':
      return handleInsertCol(gridEl, action.index, ctx);
    case 'insert-col-right':
      return handleInsertCol(gridEl, action.index + 1, ctx);
    case 'move-row':
      return handleMoveRow(gridEl, action.fromIndex, action.toIndex, ctx);
    case 'move-col':
      return handleMoveCol(gridEl, action.fromIndex, action.toIndex, ctx);
    case 'delete-row':
      return handleDeleteRow(gridEl, action.index, ctx);
    case 'delete-col':
      return handleDeleteCol(gridEl, action.index, ctx);
    case 'toggle-heading':
      return {
        pendingHighlight: { type: 'row', index: 0 },
        moveSelection: null,
        colWidths: ctx.data.colWidths,
        withHeadings: !ctx.data.withHeadings,
        withHeadingColumn: ctx.data.withHeadingColumn,
      };
    case 'toggle-heading-column':
      return {
        pendingHighlight: { type: 'col', index: 0 },
        moveSelection: null,
        colWidths: ctx.data.colWidths,
        withHeadings: ctx.data.withHeadings,
        withHeadingColumn: !ctx.data.withHeadingColumn,
      };
  }
};
