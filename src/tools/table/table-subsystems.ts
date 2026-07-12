import type { API, BlockAPI } from '../../../types';

import { TableAddControls } from './table-add-controls';
import type { TableCellBlocks } from './table-cell-blocks';
import { CELL_BLOCKS_ATTR } from './table-cell-blocks';
import {
  serializeCellsToClipboard,
  buildClipboardHtml,
  buildClipboardPlainText,
  parseClipboardHtml,
  parseGenericHtmlTable,
} from './table-cell-clipboard';
import type { CellColorMode } from './table-cell-color-picker';
import { TableCellSelection } from './table-cell-selection';
import type { CellMark, FillDirection, SelectionRange } from './table-cell-selection';
import type { TableGrid } from './table-core';
import { ROW_ATTR, CELL_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from './table-core';
import { TableCornerDrag } from './table-corner-drag';
import type { TableModel } from './table-model';
import {
  applyPixelWidths,
  computeHalfAvgWidth,
  enableScrollOverflow,
  getCellPosition,
  isColumnEmpty,
  isRowEmpty,
  populateNewCells,
  readPixelWidths,
  updateHeadingColumnStyles,
  updateHeadingStyles,
} from './table-operations';
import { TableResize } from './table-resize';
import { executeRowColAction } from './table-row-col-action-handler';
import type { PendingHighlight } from './table-row-col-action-handler';
import { TableRowColControls } from './table-row-col-controls';
import type { RowColAction } from './table-row-col-controls';
import { TableScrollHaze } from './table-scroll-haze';
import type { CellPlacement, ClipboardBlockData, TableCellsClipboard } from './types';

/**
 * Tags each bulk-formattable mark produces. The first entry is what we WRITE;
 * the rest are equivalents we still RECOGNISE (pasted `<b>`/`<em>` content).
 * Kept in sync with each inline tool's `static get sanitize()`.
 */
const MARK_TAGS: Record<CellMark, string[]> = {
  bold: ['strong', 'b'],
  italic: ['i', 'em'],
  underline: ['u'],
  strikethrough: ['s'],
  code: ['code'],
};

/**
 * Child nodes that carry meaning (whitespace-only text nodes don't).
 */
const meaningfulNodes = (input: HTMLElement): ChildNode[] =>
  Array.from(input.childNodes).filter(
    node => !(node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '')
  );

/**
 * True when the input's whole content already sits inside the mark's tag(s).
 */
const isFullyMarked = (input: HTMLElement, tags: string[]): boolean => {
  const nodes = meaningfulNodes(input);

  return nodes.length > 0 && nodes.every(
    node => node instanceof HTMLElement && tags.includes(node.tagName.toLowerCase())
  );
};

const wrapMark = (input: HTMLElement, tags: string[]): string => {
  if (isFullyMarked(input, tags)) {
    return input.innerHTML;
  }

  return `<${tags[0]}>${input.innerHTML}</${tags[0]}>`;
};

const unwrapMark = (input: HTMLElement, tags: string[]): string =>
  Array.from(input.childNodes)
    .map(node => {
      if (node instanceof HTMLElement) {
        return tags.includes(node.tagName.toLowerCase()) ? node.innerHTML : node.outerHTML;
      }

      return node.textContent ?? '';
    })
    .join('');

/**
 * Shared table state and operations that the visual subsystems depend on but
 * that remain owned by the {@link Table} block tool. Provided to
 * {@link TableSubsystems} as a dependency-injected adapter so the manager never
 * reaches into Table's private fields directly.
 */
export interface TableHost {
  readonly api: API;
  readonly readOnly: boolean;
  readonly blockId: string | undefined;
  readonly model: TableModel;
  readonly grid: TableGrid;
  readonly cellBlocks: TableCellBlocks | null;
  readonly element: HTMLDivElement | null;
  readonly gridElement: HTMLElement | null;
  readonly scrollContainer: HTMLDivElement | null;
  readonly gripOverlay: HTMLDivElement | null;
  readonly setDataGeneration: number;
  runStructuralOp<T>(fn: () => T, discard?: boolean): T;
  runTransactedStructuralOp<T>(fn: () => T, discard?: boolean): T;
  ensureScrollContainer(): HTMLDivElement;
  rebuildTableBody(): void;
}

/**
 * Owns the table's interactive visual subsystems (resize, add-controls,
 * corner-drag, row/col controls, cell-selection, scroll-haze) and the callback
 * wiring + action handlers that connect user gestures to model/grid mutations.
 *
 * Extracted from the {@link Table} god-object so the orchestration lives in one
 * cohesive, separately testable unit. All shared state is read through the
 * injected {@link TableHost}.
 */
export class TableSubsystems {
  private readonly host: TableHost;

  private resize: TableResize | null = null;
  private addControls: TableAddControls | null = null;
  private rowColControls: TableRowColControls | null = null;
  private cellSelection: TableCellSelection | null = null;
  private cornerDrag: TableCornerDrag | null = null;
  private scrollHaze: TableScrollHaze | null = null;
  private gridPasteCleanup: (() => void) | null = null;
  private pendingHighlight: PendingHighlight | null = null;

  constructor(host: TableHost) {
    this.host = host;
  }

  /** The cell-selection subsystem, exposed for selection save/restore in Table. */
  public get cellSelectionSubsystem(): TableCellSelection | null {
    return this.cellSelection;
  }

  /** The row/col controls subsystem, exposed for grip save/restore in Table. */
  public get rowColControlsSubsystem(): TableRowColControls | null {
    return this.rowColControls;
  }

  /**
   * Forward a freshly created scroll container to the add-controls subsystem so
   * add-button positions stay in sync with horizontal scrolling. Called by the
   * host's ensureScrollContainer() — addControls may not exist yet, in which
   * case initAddControls() attaches the container itself once created.
   */
  public attachScrollContainer(scrollContainer: HTMLDivElement): void {
    this.addControls?.attachScrollContainer(scrollContainer);
  }

  /**
   * Initialize all visual subsystems on a grid element.
   * Shared by Table's rendered(), setData(), and onPaste() to ensure consistent
   * subsystem initialization order.
   */
  public initAll(gridEl: HTMLElement): void {
    this.initResize(gridEl);
    this.initAddControls(gridEl);
    this.initCornerDrag(gridEl);
    this.initRowColControls(gridEl);
    this.initCellSelection(gridEl);
    this.initGridPasteListener(gridEl);
    this.initScrollHaze();
  }

  /**
   * Initialize only the scroll-haze subsystem. Used by Table for the read-only
   * render path where the interactive subsystems are not created.
   */
  public initScrollHazeOnly(): void {
    this.initScrollHaze();
  }

  /**
   * Tear down all visual subsystems (resize, add-controls, corner-drag,
   * row/col-controls, cell-selection, scroll-haze) and the grid paste listener.
   * Called before DOM rebuild in setData/onPaste, when entering read-only, and
   * during destroy(). Does NOT tear down cellBlocks — Table owns that.
   */
  public teardown(): void {
    this.resize?.destroy();
    this.resize = null;
    this.addControls?.destroy();
    this.addControls = null;
    this.cornerDrag?.destroy();
    this.cornerDrag = null;
    this.rowColControls?.destroy();
    this.rowColControls = null;
    this.cellSelection?.destroy();
    this.cellSelection = null;
    this.scrollHaze?.destroy();
    this.scrollHaze = null;
    this.gridPasteCleanup?.();
    this.gridPasteCleanup = null;
  }

  private initAddControls(gridEl: HTMLElement): void {
    this.addControls?.destroy();

    if (!this.host.element) {
      return;
    }

    const dragState = { addedCols: 0 };

    this.addControls = new TableAddControls({
      wrapper: this.host.element,
      grid: gridEl,
      i18n: this.host.api.i18n,
      getTableSize: () => ({
        rows: this.host.model.rows,
        cols: this.host.model.cols,
      }),
      getNewColumnWidth: () => {
        const colWidths = this.host.model.colWidths ?? readPixelWidths(gridEl);

        return this.host.model.initialColWidth !== undefined
          ? Math.round((this.host.model.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);
      },
      onAddRow: () => {
        this.host.runTransactedStructuralOp(() => {
          this.host.grid.addRow(gridEl);
          this.host.model.addRow();
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingStyles(this.host.gridElement, this.host.model.withHeadings);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
          this.initResize(gridEl);
          this.addControls?.syncRowButtonWidth();
          this.rowColControls?.refresh();
        });
      },
      onAddColumn: () => {
        this.host.runTransactedStructuralOp(() => {
          const colWidths = this.host.model.colWidths ?? readPixelWidths(gridEl);
          const halfWidth = this.host.model.initialColWidth !== undefined
            ? Math.round((this.host.model.initialColWidth / 2) * 100) / 100
            : computeHalfAvgWidth(colWidths);

          this.host.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
          this.host.model.addColumn(undefined, halfWidth);
          this.host.model.setColWidths([...colWidths, halfWidth]);
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
          this.initResize(gridEl);
          this.rowColControls?.refresh();

          if (this.host.scrollContainer) {
            this.host.scrollContainer.scrollLeft = this.host.scrollContainer.scrollWidth;
          }

          this.addControls?.syncRowButtonWidth();
        });
      },
      onDragStart: () => {
        if (this.resize) {
          this.resize.enabled = false;
        }
        this.rowColControls?.hideAllGrips();
        this.rowColControls?.setGripsDisplay(false);
      },
      onDragAddRow: () => {
        this.host.runTransactedStructuralOp(() => {
          this.host.grid.addRow(gridEl);
          this.host.model.addRow();
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingStyles(this.host.gridElement, this.host.model.withHeadings);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
        });

        return true;
      },
      onDragRemoveRow: () => {
        return this.host.runTransactedStructuralOp(() => {
          const rowCount = this.host.grid.getRowCount(gridEl);

          if (rowCount <= 1 || !isRowEmpty(gridEl, rowCount - 1)) {
            return false;
          }

          const { blocksToDelete } = this.host.model.deleteRow(rowCount - 1);

          this.host.cellBlocks?.deleteBlocks(blocksToDelete);
          this.host.grid.deleteRow(gridEl, rowCount - 1);

          return true;
        });
      },
      onDragAddCol: () => {
        this.host.runTransactedStructuralOp(() => {
          const colWidths = this.host.model.colWidths ?? readPixelWidths(gridEl);
          const halfWidth = this.host.model.initialColWidth !== undefined
            ? Math.round((this.host.model.initialColWidth / 2) * 100) / 100
            : computeHalfAvgWidth(colWidths);

          const newWidths = [...colWidths, halfWidth];

          this.host.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
          this.host.model.addColumn(undefined, halfWidth);
          this.host.model.setColWidths(newWidths);
          applyPixelWidths(gridEl, newWidths);
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
          this.initResize(gridEl);

          dragState.addedCols++;

          if (this.host.scrollContainer) {
            this.host.scrollContainer.scrollLeft = this.host.scrollContainer.scrollWidth;
          }
        });

        return true;
      },
      onDragRemoveCol: () => {
        return this.host.runTransactedStructuralOp(() => {
          const colCount = this.host.grid.getColumnCount(gridEl);

          if (colCount <= 1 || !isColumnEmpty(gridEl, colCount - 1)) {
            return false;
          }

          // model.deleteColumn() already removes the width internally,
          // so no additional syncColWidthsAfterDeleteColumn is needed.
          const { blocksToDelete } = this.host.model.deleteColumn(colCount - 1);

          this.host.cellBlocks?.deleteBlocks(blocksToDelete);
          this.host.grid.deleteColumn(gridEl, colCount - 1);

          const updatedWidths = this.host.model.colWidths;

          if (updatedWidths) {
            applyPixelWidths(gridEl, updatedWidths);
          }

          this.initResize(gridEl);

          dragState.addedCols--;

          return true;
        });
      },
      onDragEnd: () => {
        this.initResize(gridEl);
        this.rowColControls?.refresh();

        if (this.host.scrollContainer) {
          this.host.scrollContainer.scrollLeft = dragState.addedCols > 0 ? this.host.scrollContainer.scrollWidth : 0;
        }

        this.addControls?.syncRowButtonWidth();
        dragState.addedCols = 0;
      },
    });

    // If the scroll container already exists (pixel-mode table loaded from data),
    // attach the scroll listener now. For percent-mode tables the listener is
    // attached later inside ensureScrollContainer() when the first column is added.
    if (this.host.scrollContainer) {
      this.addControls.attachScrollContainer(this.host.scrollContainer);
    }
  }

  private initCornerDrag(gridEl: HTMLElement): void {
    this.cornerDrag?.destroy();

    if (!this.host.element) {
      return;
    }

    this.cornerDrag = new TableCornerDrag({
      wrapper: this.host.element,
      gridEl,
      onAddRow: () => {
        this.host.runStructuralOp(() => {
          this.host.grid.addRow(gridEl);
          this.host.model.addRow();
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingStyles(this.host.gridElement, this.host.model.withHeadings);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
        });
      },
      onAddColumn: () => {
        this.host.runStructuralOp(() => {
          const colWidths = this.host.model.colWidths ?? readPixelWidths(gridEl);
          const halfWidth = this.host.model.initialColWidth !== undefined
            ? Math.round((this.host.model.initialColWidth / 2) * 100) / 100
            : computeHalfAvgWidth(colWidths);
          const newWidths = [...colWidths, halfWidth];

          this.host.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
          this.host.model.addColumn(undefined, halfWidth);
          this.host.model.setColWidths(newWidths);
          applyPixelWidths(gridEl, newWidths);
          enableScrollOverflow(this.host.ensureScrollContainer());
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
          // Refresh the overflow haze so the right-edge scroll affordance
          // appears immediately when the new column overflows the container.
          this.scrollHaze?.update();
        });
      },
      onRemoveLastRow: () => {
        this.host.runStructuralOp(() => {
          const rowCount = this.host.grid.getRowCount(gridEl);

          if (rowCount <= 1) {
            return;
          }

          const { blocksToDelete } = this.host.model.deleteRow(rowCount - 1);

          this.host.cellBlocks?.deleteBlocks(blocksToDelete);
          this.host.grid.deleteRow(gridEl, rowCount - 1);
        });
      },
      onRemoveLastColumn: () => {
        this.host.runStructuralOp(() => {
          const colCount = this.host.grid.getColumnCount(gridEl);

          if (colCount <= 1) {
            return;
          }

          const { blocksToDelete } = this.host.model.deleteColumn(colCount - 1);

          this.host.cellBlocks?.deleteBlocks(blocksToDelete);
          this.host.grid.deleteColumn(gridEl, colCount - 1);

          const updatedWidths = this.host.model.colWidths;

          if (updatedWidths) {
            applyPixelWidths(gridEl, updatedWidths);
          }
        });
      },
      onDragStart: () => {
        if (this.resize) {
          this.resize.enabled = false;
        }
        this.rowColControls?.hideAllGrips();
        this.rowColControls?.setGripsDisplay(false);
        this.addControls?.setDisplay(false);
      },
      onDragEnd: () => {
        this.initResize(gridEl);
        this.rowColControls?.refresh();
        this.addControls?.setDisplay(true);
        this.addControls?.syncRowButtonWidth();
      },
      getTableSize: () => {
        return { rows: this.host.model.rows, cols: this.host.model.cols };
      },
      canRemoveLastRow: () => {
        return this.host.model.rows > 1 && isRowEmpty(gridEl, this.host.model.rows - 1);
      },
      canRemoveLastColumn: () => {
        return this.host.model.cols > 1 && isColumnEmpty(gridEl, this.host.model.cols - 1);
      },
      onClickAdd: () => {
        this.host.runTransactedStructuralOp(() => {
          // Add row
          this.host.grid.addRow(gridEl);
          this.host.model.addRow();
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingStyles(this.host.gridElement, this.host.model.withHeadings);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);

          // Add column
          const colWidths = this.host.model.colWidths ?? readPixelWidths(gridEl);
          const halfWidth = this.host.model.initialColWidth !== undefined
            ? Math.round((this.host.model.initialColWidth / 2) * 100) / 100
            : computeHalfAvgWidth(colWidths);
          const newWidths = [...colWidths, halfWidth];

          this.host.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
          this.host.model.addColumn(undefined, halfWidth);
          this.host.model.setColWidths(newWidths);
          applyPixelWidths(gridEl, newWidths);
          populateNewCells(gridEl, this.host.cellBlocks);
          updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);

          // Refresh subsystems
          this.initResize(gridEl);
          this.rowColControls?.refresh();
          this.addControls?.syncRowButtonWidth();
        });
      },
    });
  }

  private initRowColControls(gridEl: HTMLElement): void {
    this.rowColControls?.destroy();

    if (!this.host.element) {
      return;
    }

    this.rowColControls = new TableRowColControls({
      grid: gridEl,
      overlay: this.host.gripOverlay ?? undefined,
      scrollContainer: this.host.scrollContainer ?? undefined,
      getColumnCount: () => this.host.grid.getColumnCount(gridEl),
      getRowCount: () => this.host.grid.getRowCount(gridEl),
      isHeadingRow: () => this.host.model.withHeadings,
      isHeadingColumn: () => this.host.model.withHeadingColumn,
      i18n: this.host.api.i18n,
      // Per-index merge guards, not a table-wide bail: a row/column clear of
      // every merge stays draggable on a merged table, and one that a merge
      // locks gets a disabled affordance instead of a silent snap-back.
      canDrag: (type, index) => (
        type === 'row'
          ? this.host.model.isRowMovable(index)
          : this.host.model.isColumnMovable(index)
      ),
      canDrop: (type, fromIndex, toIndex) => (
        type === 'row'
          ? this.host.model.canMoveRow(fromIndex, toIndex)
          : this.host.model.canMoveColumn(fromIndex, toIndex)
      ),
      onAction: (action: RowColAction) => this.handleRowColAction(gridEl, action),
      onClearContents: (type, index) => this.clearRangeContents(type, index),
      onColorChange: (type, index, color, mode) => this.colorRange(type, index, color, mode),
      onDragStateChange: (isDragging: boolean) => {
        if (this.resize) {
          this.resize.enabled = !isDragging;
        }

        this.addControls?.setDisplay(!isDragging);
        this.cornerDrag?.setDisplay(!isDragging);

        if (isDragging) {
          this.host.api.toolbar.close({ setExplicitlyClosed: false });
        }
      },
      onGripClick: (type, index) => {
        if (type === 'row') {
          this.cellSelection?.selectRow(index);
        } else {
          this.cellSelection?.selectColumn(index);
        }
      },
      onGripPopoverClose: () => this.handleGripPopoverClose(),
    });
  }

  /**
   * The grip popover closed. Re-highlight the row/column an action just
   * created/moved, if there is one.
   *
   * It must NOT clear the cell selection. The grip popover closes for reasons
   * that are not "the user dismissed the row": the PopoverRegistry's mutual
   * exclusion hides it whenever ANY other root popover opens — including the
   * selection pill's own menu, the only surface that used to carry row/column
   * Color. Clearing here destroyed the pill (and its popover) mid-show, which is
   * why Color was unreachable from a grip at all. Dropping the selection on a
   * real outside click is already owned by TableCellSelection's own
   * document-pointerdown handler, which correctly ignores clicks on the pill and
   * inside open popovers.
   */
  private handleGripPopoverClose(): void {
    if (!this.pendingHighlight) {
      return;
    }

    const { type, index } = this.pendingHighlight;

    this.pendingHighlight = null;

    // Lock the grip synchronously so the unlock listener is registered
    // before any external click can race with a deferred RAF
    this.rowColControls?.setActiveGrip(type, index);

    // Wait for layout so newly inserted cells have dimensions
    requestAnimationFrame(() => {
      if (type === 'row') {
        this.cellSelection?.selectRow(index);
      } else {
        this.cellSelection?.selectColumn(index);
      }
    });
  }

  /**
   * Every real <td> of a row/column, in order. Merge-covered coordinates have no
   * <td> at all, so they simply do not appear (and a merge origin appears once).
   */
  private rangeCells(gridEl: HTMLElement, type: 'row' | 'col', index: number): HTMLElement[] {
    const count = type === 'row'
      ? this.host.grid.getColumnCount(gridEl)
      : this.host.grid.getRowCount(gridEl);

    return Array.from({ length: count }, (_, i) => (
      type === 'row' ? this.cellAt(gridEl, index, i) : this.cellAt(gridEl, i, index)
    )).filter((cell): cell is HTMLElement => cell !== null);
  }

  /**
   * The <td> at a LOGICAL coordinate, or null when the coordinate is covered by
   * a merge. Deliberately not TableGrid.getCell: that falls back to a physical
   * index lookup, which resolves a covered coordinate to the wrong cell.
   */
  private cellAt(gridEl: HTMLElement, row: number, col: number): HTMLElement | null {
    return gridEl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);
  }

  /**
   * Copy a row/column's content and formatting into the freshly inserted empty
   * row/column beside it.
   *
   * The blocks are DEEP-copied — each cell's payload is re-inserted through the
   * blocks API, so the copy owns brand-new block ids and its own data objects.
   * Aliasing the source block ids would put one block in two cells, and editing
   * either would silently rewrite the other.
   *
   * Merges are NOT copied: a coordinate covered by a merge has no cell on either
   * side and is skipped, leaving the duplicate flat rather than inventing spans
   * the model never sanctioned.
   */
  private duplicateRangeContent(
    gridEl: HTMLElement,
    type: 'row' | 'col',
    sourceIndex: number,
    targetIndex: number,
  ): void {
    const count = type === 'row'
      ? this.host.grid.getColumnCount(gridEl)
      : this.host.grid.getRowCount(gridEl);

    Array.from({ length: count }, (_, i) => i).forEach((i) => {
      const source = type === 'row' ? { row: sourceIndex, col: i } : { row: i, col: sourceIndex };
      const target = type === 'row' ? { row: targetIndex, col: i } : { row: i, col: targetIndex };

      const sourceCell = this.cellAt(gridEl, source.row, source.col);
      const targetCell = this.cellAt(gridEl, target.row, target.col);

      if (!sourceCell || !targetCell || sourceCell === targetCell) {
        return;
      }

      const blocks = this.readCellBlocks(sourceCell).map(block => ({
        ...block,
        data: structuredClone(block.data),
      }));

      this.pasteCellPayload(targetCell, { blocks });
      this.host.model.setCellBlocks(
        target.row,
        target.col,
        this.host.cellBlocks?.getBlockIdsFromCells([targetCell]) ?? [],
      );

      const color = this.host.model.getCellColor(source.row, source.col);
      const textColor = this.host.model.getCellTextColor(source.row, source.col);
      const placement = this.host.model.getCellPlacement(source.row, source.col);

      this.host.model.setCellColor(target.row, target.col, color);
      this.host.model.setCellTextColor(target.row, target.col, textColor);
      targetCell.style.backgroundColor = color ?? '';
      targetCell.style.color = textColor ?? '';

      this.host.model.setCellPlacement(target.row, target.col, placement);

      const blocksContainer = targetCell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

      if (blocksContainer) {
        if (placement === undefined) {
          blocksContainer.removeAttribute('data-blok-cell-placement');
        } else {
          blocksContainer.setAttribute('data-blok-cell-placement', placement);
        }
      }
    });
  }

  /**
   * Clear the contents of a whole row/column from the grip menu.
   */
  private clearRangeContents(type: 'row' | 'col', index: number): void {
    const gridEl = this.host.gridElement;

    if (!gridEl || this.host.readOnly) {
      return;
    }

    this.clearCellsContent(this.rangeCells(gridEl, type, index));
  }

  /**
   * Paint a whole row/column from the grip menu's color submenu.
   */
  private colorRange(type: 'row' | 'col', index: number, color: string | null, mode: CellColorMode): void {
    const gridEl = this.host.gridElement;

    if (!gridEl || this.host.readOnly) {
      return;
    }

    this.handleCellColorChange(this.rangeCells(gridEl, type, index), color, mode);
  }

  /**
   * Wipe the CONTENT of the given cells — and only the content.
   *
   * Colors and placement are formatting, not content: Notion's "Clear contents"
   * leaves them in place, and so does this. (There is no "clear formatting"
   * action; if one is ever added it must be its own explicitly-named operation.)
   */
  private clearCellsContent(cells: HTMLElement[]): void {
    const cellBlocks = this.host.cellBlocks;

    if (!cellBlocks || cells.length === 0) {
      return;
    }

    // Keep the caret inside the table after clearing. cells[0] is the
    // top-left cell of the selection (collected row-major).
    const anchorCell = cells[0];

    // ONLY the blocks are deleted. The cell-blocks mutation handler re-syncs the
    // model and re-seeds every emptied cell with a fresh empty block; emptying
    // the model's cell entries here would leave that handler with nothing to
    // repair and the non-anchor cells with no editable at all.
    this.host.runTransactedStructuralOp(() => {
      cellBlocks.deleteBlocks(cellBlocks.getBlockIdsFromCells(cells));
    });

    cellBlocks.focusClearedCell(anchorCell);
  }

  private handleRowColAction(gridEl: HTMLElement, action: RowColAction): void {
    const generationAtStart = this.host.setDataGeneration;

    this.host.runTransactedStructuralOp(() => {
      if (generationAtStart !== this.host.setDataGeneration || this.host.gridElement !== gridEl) {
        return;
      }

      // Capture colWidths BEFORE the model mutation so the action handler
      // receives pre-mutation widths. Model methods (addColumn, deleteColumn,
      // moveColumn) update colWidths internally, and the handler functions
      // (syncColWidthsAfterMove, syncColWidthsAfterDeleteColumn, computeInsertColumnWidths)
      // also transform widths — passing post-mutation widths would double-apply
      // the transformation.
      const colWidthsBeforeMutation = this.host.model.colWidths;
      // Capture BEFORE the model mutation: deleting a merge-origin row/column
      // can remove the last merge, so a post-mutation read would miss that the
      // delete straddled a merge and the DOM needs a full rebuild.
      const hasMergesBeforeMutation = this.host.model.hasMerges();
      // Same reason: the model's own move guard is consulted pre-mutation so
      // the DOM half and the model half can never disagree about whether the
      // move happened.
      const moveAllowedBeforeMutation = this.isMoveAllowed(action);

      // Sync model structural operation before DOM changes
      const { blocksToDelete } = this.syncModelForAction(action);

      const result = executeRowColAction(
        gridEl,
        action,
        {
          grid: this.host.grid,
          data: {
            colWidths: colWidthsBeforeMutation,
            withHeadings: this.host.model.withHeadings,
            withHeadingColumn: this.host.model.withHeadingColumn,
            initialColWidth: this.host.model.initialColWidth,
            hasMerges: hasMergesBeforeMutation,
            moveAllowed: moveAllowedBeforeMutation,
          },
          cellBlocks: this.host.cellBlocks,
          blocksToDelete,
          rebuildTableBody: () => this.host.rebuildTableBody(),
        },
      );

      if (generationAtStart !== this.host.setDataGeneration || this.host.gridElement !== gridEl) {
        return;
      }

      this.host.model.setColWidths(result.colWidths);
      this.host.model.setWithHeadings(result.withHeadings);
      this.host.model.setWithHeadingColumn(result.withHeadingColumn);
      this.pendingHighlight = result.pendingHighlight;

      updateHeadingStyles(this.host.gridElement, this.host.model.withHeadings);
      updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
      this.initResize(gridEl);
      this.addControls?.syncRowButtonWidth();

      // Heading toggles don't change grid structure (no rows/columns
      // added/removed/moved), so grips don't need to be recreated.
      // Skipping refresh() keeps the popover's trigger element intact.
      const isHeadingToggle = action.type === 'toggle-heading' || action.type === 'toggle-heading-column';

      if (!isHeadingToggle) {
        this.rowColControls?.refresh();
      }

      if (action.type === 'duplicate-row') {
        this.duplicateRangeContent(gridEl, 'row', action.index, action.index + 1);
      } else if (action.type === 'duplicate-col') {
        this.duplicateRangeContent(gridEl, 'col', action.index, action.index + 1);
      }

      if (!result.moveSelection) {
        return;
      }

      // After move operations, select the moved row/column to show where it landed
      const { type: moveType, index: moveIndex } = result.moveSelection;

      if (moveType === 'row') {
        this.cellSelection?.selectRow(moveIndex);
      } else {
        this.cellSelection?.selectColumn(moveIndex);
      }

      this.rowColControls?.setActiveGrip(moveType, moveIndex);
    });
  }

  /**
   * Does the model accept this move? Non-move actions are always "allowed".
   * Read from the PRE-mutation model and handed to the action handler so the
   * DOM half never moves a row/column the model refused (and vice versa).
   */
  private isMoveAllowed(action: RowColAction): boolean {
    if (action.type === 'move-row') {
      return this.host.model.canMoveRow(action.fromIndex, action.toIndex);
    }

    if (action.type === 'move-col') {
      return this.host.model.canMoveColumn(action.fromIndex, action.toIndex);
    }

    return true;
  }

  private syncModelForAction(action: RowColAction): { blocksToDelete?: string[] } {
    switch (action.type) {
      case 'insert-row-above':
        this.host.model.addRow(action.index);
        break;
      case 'insert-row-below':
        this.host.model.addRow(action.index + 1);
        break;
      case 'insert-col-left':
        this.host.model.addColumn(action.index);
        break;
      case 'insert-col-right':
        this.host.model.addColumn(action.index + 1);
        break;
      case 'duplicate-row':
        // The copy starts life as an empty row; its content is deep-copied in
        // duplicateRangeContent() once the DOM half has rendered the new cells.
        this.host.model.addRow(action.index + 1);
        break;
      case 'duplicate-col':
        this.host.model.addColumn(action.index + 1);
        break;
      case 'move-row':
        // The model refuses only the moves that would tear a merge, and the
        // DOM half is gated on the same answer (ActionData.moveAllowed), so a
        // row clear of every merge reorders normally even on a merged grid.
        this.host.model.moveRow(action.fromIndex, action.toIndex);
        break;
      case 'move-col':
        this.host.model.moveColumn(action.fromIndex, action.toIndex);
        break;
      case 'delete-row':
        return this.host.model.deleteRow(action.index);
      case 'delete-col':
        return this.host.model.deleteColumn(action.index);
      case 'toggle-heading':
      case 'toggle-heading-column':
        // Metadata only — handled after executeRowColAction
        break;
    }

    return {};
  }

  /**
   * Re-create the resize handles after the width MODE changed underneath them
   * (fit-to-page-width drops colWidths, so the resizer must go back to percent
   * mode and stop pinning pixel widths on the next pointerdown).
   */
  public refreshResize(gridEl: HTMLElement): void {
    this.initResize(gridEl);
    this.rowColControls?.positionGrips();
    this.addControls?.syncRowButtonWidth();
  }

  private initResize(gridEl: HTMLElement): void {
    this.resize?.destroy();

    const isPercentMode = this.host.model.colWidths === undefined;
    const widths = this.host.model.colWidths ?? readPixelWidths(gridEl);

    if (!isPercentMode) {
      enableScrollOverflow(this.host.ensureScrollContainer());
    }

    this.resize = new TableResize(
      gridEl,
      widths,
      (newWidths: number[]) => {
        this.host.model.setColWidths(newWidths);
        enableScrollOverflow(this.host.ensureScrollContainer());
        this.rowColControls?.positionGrips();
        this.addControls?.syncRowButtonWidth();
        this.scrollHaze?.update();
      },
      () => {
        this.rowColControls?.hideAllGrips();
      },
      () => {
        this.addControls?.syncRowButtonWidth();
        this.scrollHaze?.update();
      },
      isPercentMode,
    );

    // Every structural grow path (grip insert-col, +button drag, corner drag,
    // paste-grow) funnels through initResize. Refresh the overflow haze here so
    // the right-edge scroll affordance is always correct after the table grows,
    // instead of spot-patching each call site (and missing some).
    this.scrollHaze?.update();
  }

  private handleCellCopy(cells: HTMLElement[], clipboardData: DataTransfer): void {
    const entries = this.collectCellBlockData(cells);

    if (entries.length === 0) {
      return;
    }

    const payload = serializeCellsToClipboard(entries);

    clipboardData.setData('text/html', buildClipboardHtml(payload));
    clipboardData.setData('text/plain', buildClipboardPlainText(payload));
  }

  private handleCellCopyViaButton(cells: HTMLElement[]): void {
    const entries = this.collectCellBlockData(cells);

    if (entries.length === 0) {
      return;
    }

    const payload = serializeCellsToClipboard(entries);
    const html = buildClipboardHtml(payload);
    const plainText = buildClipboardPlainText(payload);

    const htmlBlob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([plainText], { type: 'text/plain' });

    void navigator.clipboard.write([
      new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      }),
    ]);
  }

  /**
   * Toggle an inline mark across every block of every selected cell.
   *
   * The cross-cell drag deliberately destroys the native Selection (a Range
   * cannot span cells), so the core inline-format path has nothing to act on.
   * We therefore apply the mark block-by-block on the blocks' own editables and
   * let each block's mutation observer persist it — all inside ONE transaction,
   * so a single undo reverts the whole rectangle.
   */
  private handleCellFormat(cells: HTMLElement[], mark: CellMark): void {
    const cellBlocks = this.host.cellBlocks;

    if (!cellBlocks || this.host.readOnly) {
      return;
    }

    const targets = cellBlocks
      .getBlockIdsFromCells(cells)
      .map(id => this.host.api.blocks.getById(id))
      .filter((block): block is BlockAPI => block !== null && block !== undefined)
      .map(block => ({
        block,
        input: block.holder.querySelector<HTMLElement>('[contenteditable="true"]'),
      }))
      .filter((target): target is { block: BlockAPI; input: HTMLElement } =>
        target.input !== null && (target.input.textContent ?? '').trim() !== '');

    if (targets.length === 0) {
      return;
    }

    const tags = MARK_TAGS[mark];
    /**
     * Notion-style toggle: only remove the mark when EVERY cell already carries
     * it. A mixed rectangle gets marked, it does not get unmarked.
     */
    const shouldRemove = targets.every(({ input }) => isFullyMarked(input, tags));

    this.host.runTransactedStructuralOp(() => {
      targets.forEach((target) => {
        const editable = target.input;

        editable.innerHTML = shouldRemove ? unwrapMark(editable, tags) : wrapMark(editable, tags);
        target.block.dispatchChange();
      });
    });
  }

  /**
   * Fill the rectangle from its leftmost column (right) or its top row (down),
   * as one undo step. Merge-covered coordinates have no cell and are skipped.
   */
  private handleCellFill(range: SelectionRange, direction: FillDirection): void {
    const gridEl = this.host.gridElement;

    if (!gridEl || this.host.readOnly) {
      return;
    }

    const rows = Array.from({ length: range.maxRow - range.minRow + 1 }, (_, i) => range.minRow + i);
    const cols = Array.from({ length: range.maxCol - range.minCol + 1 }, (_, i) => range.minCol + i);

    this.host.runTransactedStructuralOp(() => {
      rows.forEach(row => {
        cols.forEach(col => {
          const isSourceCell = direction === 'right' ? col === range.minCol : row === range.minRow;

          if (isSourceCell) {
            return;
          }

          const sourceCell = direction === 'right'
            ? this.host.grid.getCell(gridEl, row, range.minCol)
            : this.host.grid.getCell(gridEl, range.minRow, col);
          const targetCell = this.host.grid.getCell(gridEl, row, col);

          if (!sourceCell || !targetCell || sourceCell === targetCell) {
            return;
          }

          this.pasteCellPayload(targetCell, { blocks: this.readCellBlocks(sourceCell) });

          this.host.model.setCellBlocks(
            row,
            col,
            this.host.cellBlocks?.getBlockIdsFromCells([targetCell]) ?? [],
          );
        });
      });
    });
  }

  /**
   * Snapshot a cell's blocks as insertable payload data.
   */
  private readCellBlocks(cell: HTMLElement): ClipboardBlockData[] {
    const ids = this.host.cellBlocks?.getBlockIdsFromCells([cell]) ?? [];

    return ids
      .map(id => this.host.api.blocks.getById(id))
      .filter((block): block is BlockAPI => block !== null && block !== undefined)
      .map(block => ({
        tool: block.name,
        data: block.preservedData,
        ...(Object.keys(block.preservedTunes).length > 0 ? { tunes: block.preservedTunes } : {}),
      }));
  }

  private handleCellColorChange(cells: HTMLElement[], color: string | null, mode: CellColorMode): void {
    const gridEl = this.host.gridElement;

    if (!gridEl) {
      return;
    }

    this.host.runTransactedStructuralOp(() => {
      for (const cell of cells) {
        const coord = getCellPosition(gridEl, cell);

        if (!coord) {
          continue;
        }

        if (mode === 'backgroundColor') {
          this.host.model.setCellColor(coord.row, coord.col, color ?? undefined);
          cell.style.backgroundColor = color ?? '';
        } else {
          this.host.model.setCellTextColor(coord.row, coord.col, color ?? undefined);
          cell.style.color = color ?? '';
        }
      }
    });
  }

  private handleCellPlacementChange(cells: HTMLElement[], placement: CellPlacement): void {
    const gridEl = this.host.gridElement;

    if (!gridEl) {
      return;
    }

    this.host.runTransactedStructuralOp(() => {
      for (const cell of cells) {
        const coord = getCellPosition(gridEl, cell);

        if (!coord) {
          continue;
        }

        this.applyCellPlacement(cell, coord.row, coord.col, placement === 'top-left' ? undefined : placement);
      }
    });
  }

  /**
   * Write a cell's 9-way placement to the model and to the rendered container.
   * `undefined` (or the default top-left) clears it.
   */
  private applyCellPlacement(
    cell: HTMLElement,
    row: number,
    col: number,
    placement: CellPlacement | undefined,
  ): void {
    this.host.model.setCellPlacement(row, col, placement);

    const blocksContainer = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!blocksContainer) {
      return;
    }

    if (placement === undefined) {
      blocksContainer.removeAttribute('data-blok-cell-placement');
    } else {
      blocksContainer.setAttribute('data-blok-cell-placement', placement);
    }
  }

  private collectCellBlockData(
    cells: HTMLElement[],
  ): Array<{
    row: number;
    col: number;
    blocks: ClipboardBlockData[];
    color?: string;
    textColor?: string;
    placement?: CellPlacement;
    colspan?: number;
    rowspan?: number;
  }> {
    const gridEl = this.host.gridElement;

    if (!gridEl) {
      return [];
    }

    return cells.map(cell => {
      const rowIndex = parseInt(cell.getAttribute(CELL_ROW_ATTR) ?? '0', 10);
      const colIndex = parseInt(cell.getAttribute(CELL_COL_ATTR) ?? '0', 10);

      const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);
      const blocks: ClipboardBlockData[] = [];

      if (!container) {
        return { row: rowIndex, col: colIndex, blocks };
      }

      container.querySelectorAll('[data-blok-id]').forEach(blockEl => {
        const blockId = blockEl.getAttribute('data-blok-id');

        if (!blockId) {
          return;
        }

        const blockIndex = this.host.api.blocks.getBlockIndex(blockId);

        if (blockIndex === undefined) {
          return;
        }

        const block = this.host.api.blocks.getBlockByIndex(blockIndex);

        if (!block) {
          return;
        }

        blocks.push({
          tool: block.name,
          data: block.preservedData,
          ...(Object.keys(block.preservedTunes).length > 0
            ? { tunes: block.preservedTunes }
            : {}),
        });
      });

      // Read-only legacy cells can render plain text without mounted block holders.
      const text = blocks.length === 0 ? (container.innerHTML ?? '').trim() : '';

      if (blocks.length === 0 && text.length > 0) {
        blocks.push({
          tool: 'paragraph',
          data: { text },
        });
      }

      const color = this.host.model.getCellColor(rowIndex, colIndex);
      const textColor = this.host.model.getCellTextColor(rowIndex, colIndex);
      // The 9-way content placement is part of the cell, not of its blocks:
      // omitting it here made the clipboard's `placement` field dead on arrival.
      const placement = this.host.model.getCellPlacement(rowIndex, colIndex);
      // Record merge spans so paste can reconstruct the merge instead of
      // flattening it into a grid of real empty cells.
      const span = this.host.model.getCellSpan(rowIndex, colIndex);

      return {
        row: rowIndex,
        col: colIndex,
        blocks,
        ...(color !== undefined ? { color } : {}),
        ...(textColor !== undefined ? { textColor } : {}),
        ...(placement !== undefined ? { placement } : {}),
        ...(span.colspan > 1 ? { colspan: span.colspan } : {}),
        ...(span.rowspan > 1 ? { rowspan: span.rowspan } : {}),
      };
    });
  }

  private initCellSelection(gridEl: HTMLElement): void {
    this.cellSelection?.destroy();

    // Get RectangleSelection from API
    const rectangleSelection = this.host.api.rectangleSelection;

    this.cellSelection = new TableCellSelection({
      grid: gridEl,
      rectangleSelection, // Pass reference
      i18n: this.host.api.i18n,
      isPopoverOpen: () => this.rowColControls?.isPopoverOpen ?? false,
      onPointerDragActiveChange: (active) => {
        this.host.api.blocks.setPointerDragActive?.(active);
      },
      onSelectionActiveChange: (hasSelection) => {
        if (this.resize) {
          this.resize.enabled = !hasSelection;
        }

        this.addControls?.setInteractive(!hasSelection);
        this.cornerDrag?.setInteractive(!hasSelection);
        this.rowColControls?.setGripsDisplay(!hasSelection);
      },
      onSelectionRangeChange: () => {
        // Selection finalized — restore grips so hover works normally
        this.rowColControls?.setGripsDisplay(true);
      },
      onClearContent: (cells) => {
        this.clearCellsContent(cells);
      },
      onCopy: (cells, clipboardData) => {
        this.handleCellCopy(cells, clipboardData);
      },
      onCut: (cells, clipboardData) => {
        this.handleCellCopy(cells, clipboardData);
      },
      onCopyViaButton: (cells) => {
        this.handleCellCopyViaButton(cells);
      },
      onColorChange: (cells, color, mode) => {
        this.handleCellColorChange(cells, color, mode);
      },
      onPlacementChange: (cells, placement) => {
        this.handleCellPlacementChange(cells, placement);
      },
      getCellPlacement: (row, col) => {
        return this.host.model.getCellPlacement(row, col);
      },
      canMergeCells: (range) => {
        return this.host.model.canMergeCells(range);
      },
      onMergeCells: (range) => {
        this.host.runTransactedStructuralOp(() => {
          this.host.model.mergeCells(range);
          this.host.rebuildTableBody();
          // Merging locks the affected rows/columns in place, so the grips must
          // be recreated to pick up their disabled drag affordance.
          this.rowColControls?.refresh();
        });
      },
      isMergedCell: (row, col) => {
        return this.host.model.isMergedCell(row, col);
      },
      onSplitCell: (row, col) => {
        this.host.runTransactedStructuralOp(() => {
          this.host.model.splitCell(row, col);
          this.host.rebuildTableBody();
          // Splitting frees the rows/columns again — refresh so their grips
          // become draggable.
          this.rowColControls?.refresh();
        });
      },
      getCellSpan: (row, col) => {
        return this.host.model.getCellSpan(row, col);
      },
      onFormatCells: (cells, mark) => {
        this.handleCellFormat(cells, mark);
      },
      onFillCells: (cells, range, direction) => {
        this.handleCellFill(range, direction);
      },
    });
  }

  private initScrollHaze(): void {
    this.scrollHaze?.destroy();

    if (!this.host.element || !this.host.scrollContainer) {
      return;
    }

    this.scrollHaze = new TableScrollHaze();
    this.scrollHaze.init(this.host.element, this.host.scrollContainer);
  }

  private initGridPasteListener(gridEl: HTMLElement): void {
    const handler = (e: ClipboardEvent): void => {
      this.handleGridPaste(e, gridEl);
    };

    gridEl.addEventListener('paste', handler);
    this.gridPasteCleanup = () => {
      gridEl.removeEventListener('paste', handler);
    };
  }

  private handleGridPaste(e: ClipboardEvent, gridEl: HTMLElement): void {
    if (this.host.readOnly || !e.clipboardData || e.defaultPrevented) {
      return;
    }

    const html = e.clipboardData.getData('text/html');
    const blokPayload = parseClipboardHtml(html);
    const externalPayload = blokPayload === null ? parseGenericHtmlTable(html) : null;
    const payload = blokPayload ?? externalPayload;

    if (!payload) {
      return;
    }

    /**
     * If the pasted HTML contains multiple tables (e.g. from Google Docs),
     * don't intercept — let the Paste module handle it as a document-level paste
     * so each table becomes a separate block without overwriting existing cells.
     */
    if (
      externalPayload !== null &&
      new DOMParser().parseFromString(html, 'text/html').querySelectorAll('table').length > 1
    ) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;

    if (!activeElement) {
      return;
    }

    const targetCell = activeElement.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!targetCell || !gridEl.contains(targetCell)) {
      return;
    }

    if (!targetCell.closest(`[${ROW_ATTR}]`)) {
      return;
    }

    /**
     * Single-cell (1×1) payloads should insert content inline at the caret
     * position rather than replacing the entire target cell. This matches user
     * expectations: copying one cell and pasting into another cell (or the same
     * cell) appends/inserts the text instead of overwriting.
     */
    e.preventDefault();
    e.stopPropagation();

    // Read true model coordinates from stamped data attributes
    const targetRowIndex = parseInt(targetCell.getAttribute(CELL_ROW_ATTR) ?? '0', 10);
    const targetColIndex = parseInt(targetCell.getAttribute(CELL_COL_ATTR) ?? '0', 10);

    if (payload.rows === 1 && payload.cols === 1) {
      const singleCell = payload.cells[0][0];
      // Inline caret-insert only works for plain text blocks. Anything else
      // (image/embed/code, and list items — which DO carry data.text but would
      // lose their list structure in a text join) must be recreated as real
      // blocks in the target cell instead.
      const isTextOnly = singleCell.blocks.every(
        block => block.tool === 'paragraph' && typeof block.data.text === 'string'
      );

      if (isTextOnly) {
        this.insertSingleCellPayloadInline(singleCell);

        return;
      }

      this.pastePayloadIntoCells(gridEl, payload, targetRowIndex, targetColIndex);

      return;
    }

    this.pastePayloadIntoCells(gridEl, payload, targetRowIndex, targetColIndex);
  }

  /**
   * Insert the content of a single clipboard cell at the current caret position.
   * Extracts text from each block and joins with line breaks.
   */
  private insertSingleCellPayloadInline(cell: { blocks: ClipboardBlockData[] }): void {
    const html = cell.blocks
      .map((block) => {
        if (typeof block.data.text === 'string') {
          return block.data.text;
        }

        return '';
      })
      .filter(Boolean)
      .join('<br>');

    if (!html) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!range.collapsed) {
      range.deleteContents();
    }

    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');

    wrapper.innerHTML = html;

    Array.from(wrapper.childNodes).forEach((child) => fragment.appendChild(child));

    if (fragment.childNodes.length === 0) {
      fragment.appendChild(new Text());
    }

    const lastChild = fragment.lastChild as ChildNode;

    range.insertNode(fragment);

    const newRange = document.createRange();
    const nodeToSetCaret = lastChild.nodeType === Node.TEXT_NODE ? lastChild : lastChild.firstChild;

    if (nodeToSetCaret !== null && nodeToSetCaret.textContent !== null) {
      newRange.setStart(nodeToSetCaret, nodeToSetCaret.textContent.length);
    }

    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  /**
   * Split every merge whose origin sits inside, or whose span reaches into, the
   * rectangle [startRow..startRow+rows-1] × [startCol..startCol+cols-1], then
   * rebuild the DOM so the freed cells get real <td>s. Used before a paste so no
   * destination coordinate is merge-covered (which would drop that payload cell).
   */
  private splitMergesInRegion(
    startRow: number,
    startCol: number,
    rows: number,
    cols: number,
  ): void {
    const rowOffsets = Array.from({ length: rows }, (_, i) => startRow + i);
    const colOffsets = Array.from({ length: cols }, (_, i) => startCol + i);
    const originsByKey = new Map<string, [number, number]>();

    rowOffsets.forEach((r) => {
      colOffsets.forEach((c) => {
        const origin = this.host.model.getMergeOrigin(r, c);

        if (origin !== null) {
          originsByKey.set(`${origin[0]}:${origin[1]}`, origin);
        }
      });
    });

    if (originsByKey.size === 0) {
      return;
    }

    originsByKey.forEach(([r, c]) => this.host.model.splitCell(r, c));
    this.host.rebuildTableBody();
  }

  private pastePayloadIntoCells(
    gridEl: HTMLElement,
    payload: TableCellsClipboard,
    startRow: number,
    startCol: number,
  ): void {
    this.host.runTransactedStructuralOp(() => {
      this.expandGridForPaste(gridEl, startRow + payload.rows, startCol + payload.cols);

      // Split any merge overlapping the destination region BEFORE pasting.
      // A merge-covered destination coordinate has no <td> (grid.getCell returns
      // null), so its payload cell would be silently dropped. Splitting first
      // turns every target into a real cell so no pasted data is lost.
      this.splitMergesInRegion(startRow, startCol, payload.rows, payload.cols);

      // Paste block data into target cells. Resolve each target by LOGICAL
      // coordinate (merge-safe getCell) so the DOM cell we write matches the
      // logical model write below — a physical NodeList index would diverge in
      // any merge-touched row and drop or misplace the pasted blocks.
      Array.from({ length: payload.rows }, (_, r) => r).forEach((r) => {
        Array.from({ length: payload.cols }, (_, c) => c).forEach((c) => {
          const cellPayload = payload.cells[r][c];

          // Skip merge-covered source positions: they are not real cells, so
          // pasting them would wipe whatever sits at the destination.
          if (cellPayload.covered) {
            return;
          }

          const cell = this.host.grid.getCell(gridEl, startRow + r, startCol + c);

          if (cell) {
            this.pasteCellPayload(cell, cellPayload);

            // Sync pasted block IDs to model
            const blockIds = this.host.cellBlocks?.getBlockIdsFromCells([cell]) ?? [];

            this.host.model.setCellBlocks(startRow + r, startCol + c, blockIds);

            // Restore cell colors from clipboard
            const destRow = startRow + r;
            const destCol = startCol + c;

            this.host.model.setCellColor(destRow, destCol, cellPayload.color);
            cell.style.backgroundColor = cellPayload.color ?? '';

            this.host.model.setCellTextColor(destRow, destCol, cellPayload.textColor);
            cell.style.color = cellPayload.textColor ?? '';

            // Restore the 9-way content placement (model + rendered container),
            // mirroring the color restore above.
            this.applyCellPlacement(cell, destRow, destCol, cellPayload.placement);
          }
        });
      });

      // Reconstruct merges carried by the payload: without this, a copied
      // merged region pastes as a flat grid of real empty cells.
      this.applyPayloadMerges(gridEl, payload, startRow, startCol);

      // Update table state after paste
      this.initResize(gridEl);
      this.addControls?.syncRowButtonWidth();
      this.rowColControls?.refresh();
    });

    // Caret placement outside the lock (no structural mutation). Resolve the
    // last pasted cell by logical coordinate to stay merge-safe.
    const lastCell = this.host.grid.getCell(
      gridEl,
      startRow + payload.rows - 1,
      startCol + payload.cols - 1,
    );

    if (!lastCell || !this.host.cellBlocks || !this.host.api.caret) {
      return;
    }

    const blockIds = this.host.cellBlocks.getBlockIdsFromCells([lastCell]);
    const lastBlockId = blockIds[blockIds.length - 1];

    if (lastBlockId === undefined) {
      return;
    }

    this.host.api.caret.setToBlock(lastBlockId, 'end');
  }

  /**
   * Merge regions declared by the payload's origin cells (colspan/rowspan > 1),
   * clamped to the payload bounds. Payloads from older Blok versions carry no
   * spans and yield an empty list (flat paste, back-compat).
   */
  private collectPayloadMerges(
    payload: TableCellsClipboard,
  ): Array<{ row: number; col: number; colspan: number; rowspan: number }> {
    return payload.cells.flatMap((rowCells, r) =>
      rowCells.flatMap((cell, c) => {
        const colspan = Math.min(cell.colspan ?? 1, payload.cols - c);
        const rowspan = Math.min(cell.rowspan ?? 1, payload.rows - r);

        return colspan > 1 || rowspan > 1 ? [{ row: r, col: c, colspan, rowspan }] : [];
      })
    );
  }

  /**
   * Re-apply the merges described by a pasted payload at the destination.
   * Covered destination cells are cleared first so the merge doesn't absorb
   * stale content that the (skipped) covered payload slots left behind.
   */
  private applyPayloadMerges(
    gridEl: HTMLElement,
    payload: TableCellsClipboard,
    startRow: number,
    startCol: number,
  ): void {
    const merges = this.collectPayloadMerges(payload);

    if (merges.length === 0) {
      return;
    }

    merges.forEach(({ row, col, colspan, rowspan }) => {
      this.clearCoveredDestinationCells(gridEl, startRow + row, startCol + col, rowspan, colspan);
      this.host.model.mergeCells({
        minRow: startRow + row,
        maxRow: startRow + row + rowspan - 1,
        minCol: startCol + col,
        maxCol: startCol + col + colspan - 1,
      });
    });

    this.host.rebuildTableBody();
  }

  /**
   * Delete the blocks and styling of every cell in a merge footprint except
   * its origin, so a following mergeCells collects only the origin's content.
   */
  private clearCoveredDestinationCells(
    gridEl: HTMLElement,
    originRow: number,
    originCol: number,
    rowspan: number,
    colspan: number,
  ): void {
    Array.from({ length: rowspan }).forEach((_, dr) => {
      Array.from({ length: colspan }).forEach((__, dc) => {
        if (dr === 0 && dc === 0) {
          return;
        }

        const r = originRow + dr;
        const c = originCol + dc;
        const cell = this.host.grid.getCell(gridEl, r, c);

        if (cell && this.host.cellBlocks) {
          this.host.cellBlocks.deleteBlocks(this.host.cellBlocks.getBlockIdsFromCells([cell]));
        }

        this.host.model.setCellBlocks(r, c, []);
        this.host.model.setCellColor(r, c, undefined);
        this.host.model.setCellTextColor(r, c, undefined);
      });
    });
  }

  /**
   * Expand the grid to have at least the required number of rows and columns.
   */
  private expandGridForPaste(gridEl: HTMLElement, neededRows: number, neededCols: number): void {
    const currentRowCount = this.host.grid.getRowCount(gridEl);
    const currentColCount = this.host.grid.getColumnCount(gridEl);

    // Auto-expand rows
    Array.from({ length: Math.max(0, neededRows - currentRowCount) }).forEach(() => {
      this.host.grid.addRow(gridEl);
      this.host.model.addRow();
      populateNewCells(gridEl, this.host.cellBlocks);
      updateHeadingStyles(this.host.gridElement, this.host.model.withHeadings);
      updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
    });

    // Auto-expand columns
    Array.from({ length: Math.max(0, neededCols - currentColCount) }).forEach(() => {
      const colWidths = this.host.model.colWidths ?? readPixelWidths(gridEl);
      const halfWidth = this.host.model.initialColWidth !== undefined
        ? Math.round((this.host.model.initialColWidth / 2) * 100) / 100
        : computeHalfAvgWidth(colWidths);

      this.host.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
      this.host.model.addColumn(undefined, halfWidth);
      this.host.model.setColWidths([...colWidths, halfWidth]);
      populateNewCells(gridEl, this.host.cellBlocks);
      updateHeadingColumnStyles(this.host.gridElement, this.host.model.withHeadingColumn);
    });
  }

  /**
   * Replace the contents of a single cell with data from the clipboard payload.
   */
  private pasteCellPayload(
    cell: HTMLElement,
    payloadCell: { blocks: ClipboardBlockData[] },
  ): void {
    // Clear existing blocks in this cell
    if (this.host.cellBlocks) {
      const existingIds = this.host.cellBlocks.getBlockIdsFromCells([cell]);

      this.host.cellBlocks.deleteBlocks(existingIds);
    }

    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    if (payloadCell.blocks.length === 0) {
      this.host.cellBlocks?.ensureCellHasBlock(cell);

      return;
    }

    for (const blockData of payloadCell.blocks) {
      // The 8th argument is the block's tunes: the payload collected them and
      // this call used to omit them, so every copied cell lost its tunes.
      const block = this.host.api.blocks.insert(
        blockData.tool,
        blockData.data,
        {},
        this.host.api.blocks.getBlocksCount(),
        false,
        false,
        undefined,
        blockData.tunes,
      );

      container.appendChild(block.holder);
      this.host.api.blocks.setBlockParent(block.id, this.host.blockId ?? '');
    }
  }
}
