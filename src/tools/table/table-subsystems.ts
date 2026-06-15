import type { API } from '../../../types';

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
        let removed = false;

        this.host.runTransactedStructuralOp(() => {
          const rowCount = this.host.grid.getRowCount(gridEl);

          if (rowCount > 1 && isRowEmpty(gridEl, rowCount - 1)) {
            const { blocksToDelete } = this.host.model.deleteRow(rowCount - 1);

            this.host.cellBlocks?.deleteBlocks(blocksToDelete);
            this.host.grid.deleteRow(gridEl, rowCount - 1);
            removed = true;
          }
        });

        return removed;
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
        let removed = false;

        this.host.runTransactedStructuralOp(() => {
          const colCount = this.host.grid.getColumnCount(gridEl);

          if (colCount <= 1 || !isColumnEmpty(gridEl, colCount - 1)) {
            return;
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
          removed = true;
        });

        return removed;
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
        // Drag may have grown the table past the container without scrolling;
        // recompute the haze so the scroll affordance is correct on release.
        this.scrollHaze?.update();
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
          this.scrollHaze?.update();
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
      onAction: (action: RowColAction) => this.handleRowColAction(gridEl, action),
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
      onGripPopoverClose: () => {
        if (this.pendingHighlight) {
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
        } else {
          this.cellSelection?.clearActiveSelection();
        }
      },
    });
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
            hasMerges: this.host.model.hasMerges(),
          },
          cellBlocks: this.host.cellBlocks,
          blocksToDelete,
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
      case 'move-row':
        // Skip on merged grids; the DOM move is blocked too, so moving the
        // model here would desync them (see executeRowColAction).
        if (!this.host.model.hasMerges()) {
          this.host.model.moveRow(action.fromIndex, action.toIndex);
        }
        break;
      case 'move-col':
        if (!this.host.model.hasMerges()) {
          this.host.model.moveColumn(action.fromIndex, action.toIndex);
        }
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

        this.host.model.setCellPlacement(coord.row, coord.col, placement === 'top-left' ? undefined : placement);

        const blocksContainer = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

        if (!blocksContainer) {
          continue;
        }

        if (placement === 'top-left') {
          blocksContainer.removeAttribute('data-blok-cell-placement');
        } else {
          blocksContainer.setAttribute('data-blok-cell-placement', placement);
        }
      }
    });
  }

  private collectCellBlockData(
    cells: HTMLElement[],
  ): Array<{ row: number; col: number; blocks: ClipboardBlockData[]; color?: string; textColor?: string }> {
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

      return {
        row: rowIndex,
        col: colIndex,
        blocks,
        ...(color !== undefined ? { color } : {}),
        ...(textColor !== undefined ? { textColor } : {}),
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
        const cellBlocks = this.host.cellBlocks;

        if (!cellBlocks) {
          return;
        }

        this.host.runTransactedStructuralOp(() => {
          const blockIds = cellBlocks.getBlockIdsFromCells(cells);

          cellBlocks.deleteBlocks(blockIds);

          const gridEl = this.host.gridElement;

          if (!gridEl) {
            return;
          }

          for (const cell of cells) {
            const coord = getCellPosition(gridEl, cell);

            if (!coord) {
              continue;
            }

            this.host.model.setCellColor(coord.row, coord.col, undefined);
            this.host.model.setCellTextColor(coord.row, coord.col, undefined);
            cell.style.backgroundColor = '';
            cell.style.color = '';
          }
        });
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
        });
      },
      isMergedCell: (row, col) => {
        return this.host.model.isMergedCell(row, col);
      },
      onSplitCell: (row, col) => {
        this.host.runTransactedStructuralOp(() => {
          this.host.model.splitCell(row, col);
          this.host.rebuildTableBody();
        });
      },
      getCellSpan: (row, col) => {
        return this.host.model.getCellSpan(row, col);
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
      // Inline caret-insert only works for text blocks. A non-text block
      // (image/embed/list/code) has no data.text and would be silently dropped,
      // so recreate it as a real block in the target cell instead.
      const isTextOnly = singleCell.blocks.every(block => typeof block.data.text === 'string');

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

  private pastePayloadIntoCells(
    gridEl: HTMLElement,
    payload: TableCellsClipboard,
    startRow: number,
    startCol: number,
  ): void {
    this.host.runTransactedStructuralOp(() => {
      this.expandGridForPaste(gridEl, startRow + payload.rows, startCol + payload.cols);

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
          }
        });
      });

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
      const block = this.host.api.blocks.insert(
        blockData.tool,
        blockData.data,
        {},
        this.host.api.blocks.getBlocksCount(),
        false,
      );

      container.appendChild(block.holder);
      this.host.api.blocks.setBlockParent(block.id, this.host.blockId ?? '');
    }
  }
}
