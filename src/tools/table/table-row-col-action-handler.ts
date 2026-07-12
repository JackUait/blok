import type { TableCellBlocks } from './table-cell-blocks';
import type { TableGrid } from './table-core';
import {
  applyPixelWidths,
  computeHalfAvgWidth,
  computeInsertColumnWidths,
  planInsertColumnWidths,
  populateNewCells,
  readPixelWidths,
  redistributePercentWidths,
  syncColWidthsAfterDeleteColumn,
  syncColWidthsAfterMove,
} from './table-operations';
import type { RowColAction } from './table-row-col-controls';

/**
 * Describes which row or column to highlight after an action completes.
 */
export type PendingHighlight = { type: 'row' | 'col'; index: number };

/**
 * Minimal metadata the action handler needs.
 * Decoupled from TableData so callers can pass model-derived primitives.
 */
export interface ActionData {
  colWidths?: number[];
  withHeadings: boolean;
  withHeadingColumn: boolean;
  initialColWidth?: number;
  /**
   * True when the table contains any merged cell. Every structural op then
   * re-renders the body from the model instead of mutating the DOM at physical
   * indices (see applyStructuralDom).
   */
  hasMerges?: boolean;
  /**
   * For move-row / move-col only: does the model accept this exact move?
   * False when the moved row/column is part of a merge, or when it would land
   * inside a merged span. Computed by the caller from the PRE-mutation model
   * (TableModel.canMoveRow / canMoveColumn) so the DOM and the model can never
   * disagree about whether the move happened.
   */
  moveAllowed?: boolean;
}

interface ActionContext {
  grid: TableGrid;
  data: ActionData;
  cellBlocks: TableCellBlocks | null;
  blocksToDelete?: string[];
  /**
   * Re-render the whole <tbody> from the current model. This is how EVERY
   * structural op renders on a merged grid — see applyStructuralDom.
   */
  rebuildTableBody?: () => void;
}

interface ActionResult {
  pendingHighlight: PendingHighlight | null;
  moveSelection: { type: 'row' | 'col'; index: number } | null;
  colWidths: number[] | undefined;
  withHeadings: boolean;
  withHeadingColumn: boolean;
}

/**
 * THE MERGED-GRID INVARIANT — every structural DOM change goes through here.
 *
 * TableGrid's row/column mutators work on PHYSICAL indices and emit plain
 * <td>s: addRow appends one cell per column, insertColumn splices one <td>
 * into every <tr>, deleteRow/deleteColumn drop cells by position, and none of
 * them touch existing colSpan/rowSpan (spans are only ever written by
 * createGridFromModel). On a merged grid every one of those assumptions is
 * false — a covered cell has no <td> at all — so the physical op inserts a
 * phantom cell inside the merge footprint, leaves the origin's span stale, and
 * reindexCoordinates then re-derives logical coordinates from the stale spans
 * and scrambles them. Content typed into the phantom cell has no model slot
 * and is dropped on the next render.
 *
 * The model half is always right (expandSpansForInsertedRow/Col,
 * contractSpansForDeletedRow/Col, the move guards), so the fix is to stop
 * hand-mutating the DOM whenever merges exist and re-render the body from the
 * already-mutated model instead.
 *
 * Handlers MUST NOT call ctx.grid mutators directly — pass the physical op as
 * the callback here. Enforced by
 * test/unit/architecture/table-merge-structural-op-law.test.ts.
 */
const applyStructuralDom = (ctx: ActionContext, physicalOp: () => void): void => {
  if (ctx.data.hasMerges && ctx.rebuildTableBody) {
    ctx.rebuildTableBody();

    return;
  }

  physicalOp();
};

const handleInsertRow = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  applyStructuralDom(ctx, () => ctx.grid.addRow(gridEl, index));
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
  // The width arithmetic is identical on both paths; only the DOM half differs.
  // computeInsertColumnWidths performs the physical <col>/<td> insert itself,
  // so the merged path uses the pure plan and re-applies the widths to the
  // <colgroup> that rebuildTableBody rebuilt from the model.
  const plan = planInsertColumnWidths(gridEl, index, ctx.data.colWidths, ctx.data.initialColWidth);

  applyStructuralDom(ctx, () => {
    computeInsertColumnWidths(gridEl, index, ctx.data.colWidths, ctx.data.initialColWidth, ctx.grid);
  });

  if (ctx.data.hasMerges && ctx.rebuildTableBody) {
    applyPixelWidths(gridEl, plan.next);
  }

  populateNewCells(gridEl, ctx.cellBlocks);

  return {
    pendingHighlight: { type: 'col', index },
    moveSelection: null,
    colWidths: plan.next,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

/**
 * Duplicate = insert an empty row directly below, then let the caller copy the
 * source row's content/colors into it (the caller owns the block API; this file
 * owns only the grid). The DOM half is the same physical insert as
 * handleInsertRow — and therefore must obey the same merged-grid law.
 */
const handleDuplicateRow = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  applyStructuralDom(ctx, () => ctx.grid.addRow(gridEl, index + 1));
  populateNewCells(gridEl, ctx.cellBlocks);

  return {
    pendingHighlight: { type: 'row', index: index + 1 },
    moveSelection: null,
    colWidths: ctx.data.colWidths,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

/**
 * Widths after duplicating a column: the copy inherits the SOURCE column's
 * width, not the half-average width a fresh insert would get.
 *
 * A percent-mode table (`colWidths === undefined`) stays percent-mode — the
 * widths are redistributed instead of pinned. Deriving pixel widths from the DOM
 * here would be wrong on a merged grid anyway: the first row of a merged table
 * has fewer <td>s than it has columns, so the read comes back short and the
 * model's colWidths/column-count invariant breaks.
 */
const planDuplicateColumnWidths = (
  colWidths: number[] | undefined,
  index: number,
): number[] | undefined => {
  if (colWidths === undefined || colWidths.length === 0) {
    return undefined;
  }

  const next = [...colWidths];

  next.splice(index + 1, 0, next[index] ?? computeHalfAvgWidth(colWidths));

  return next;
};

const handleDuplicateCol = (
  gridEl: HTMLElement,
  index: number,
  ctx: ActionContext,
): ActionResult => {
  const next = planDuplicateColumnWidths(ctx.data.colWidths, index);

  applyStructuralDom(ctx, () => {
    const domWidths = ctx.data.colWidths ?? readPixelWidths(gridEl);
    const inserted = domWidths[index] ?? computeHalfAvgWidth(domWidths);

    ctx.grid.addColumn(gridEl, index + 1, domWidths, inserted);
  });

  if (next) {
    applyPixelWidths(gridEl, next);
  } else {
    redistributePercentWidths(gridEl);
  }

  populateNewCells(gridEl, ctx.cellBlocks);

  return {
    pendingHighlight: { type: 'col', index: index + 1 },
    moveSelection: null,
    colWidths: next,
    withHeadings: ctx.data.withHeadings,
    withHeadingColumn: ctx.data.withHeadingColumn,
  };
};

const noOpResult = (ctx: ActionContext): ActionResult => ({
  pendingHighlight: null,
  moveSelection: null,
  colWidths: ctx.data.colWidths,
  withHeadings: ctx.data.withHeadings,
  withHeadingColumn: ctx.data.withHeadingColumn,
});

/**
 * A move the model refused (it would tear a merge) must leave the DOM alone —
 * the model did not move either, so mutating the DOM would desync them.
 * The drag UI blocks these gestures up front with a not-allowed affordance,
 * so this is a backstop, not the user-facing feedback.
 */
const isMoveBlocked = (ctx: ActionContext): boolean =>
  ctx.data.moveAllowed === false;

const handleMoveRow = (
  gridEl: HTMLElement,
  fromIndex: number,
  toIndex: number,
  ctx: ActionContext,
): ActionResult => {
  if (isMoveBlocked(ctx)) {
    return noOpResult(ctx);
  }

  applyStructuralDom(ctx, () => ctx.grid.moveRow(gridEl, fromIndex, toIndex));

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
  if (isMoveBlocked(ctx)) {
    return noOpResult(ctx);
  }

  applyStructuralDom(ctx, () => ctx.grid.moveColumn(gridEl, fromIndex, toIndex));

  const colWidths = syncColWidthsAfterMove(ctx.data.colWidths, fromIndex, toIndex);

  // rebuildTableBody only swaps the <colgroup> when the column COUNT changes,
  // so a move on a merged grid must re-apply the reordered widths itself.
  if (ctx.data.hasMerges && ctx.rebuildTableBody) {
    if (colWidths) {
      applyPixelWidths(gridEl, colWidths);
    } else {
      redistributePercentWidths(gridEl);
    }
  }

  return {
    pendingHighlight: null,
    moveSelection: { type: 'col', index: toIndex },
    colWidths,
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

  // On a merged grid the physical-index DOM delete can't render cells the model
  // promotes out of a merge. Rebuild from the (already-updated) model instead.
  applyStructuralDom(ctx, () => ctx.grid.deleteRow(gridEl, index));

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

  // See handleDeleteRow: merged grids must rebuild from the model so promoted
  // cells render with an editable target instead of vanishing.
  applyStructuralDom(ctx, () => ctx.grid.deleteColumn(gridEl, index));

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
    case 'duplicate-row':
      return handleDuplicateRow(gridEl, action.index, ctx);
    case 'duplicate-col':
      return handleDuplicateCol(gridEl, action.index, ctx);
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
