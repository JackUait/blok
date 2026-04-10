import type { I18n } from '../../../types/api';
import { IconCopy, IconCross, IconMarker, IconMergeCells, IconPlacement, IconSplitCell } from '../../components/icons';
import { MODIFIER_KEY } from '../../components/constants';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';
import { twMerge } from '../../components/utils/tw';

import { CELL_ATTR, CELL_COL_ATTR, CELL_ROW_ATTR, ROW_ATTR } from './table-core';
import { createCellColorPicker } from './table-cell-color-picker';
import type { CellColorMode } from './table-cell-color-picker';
import { createCellPlacementPicker } from './table-cell-placement-picker';
import type { CellPlacement } from './types';
import { createGripDotsSvg } from './table-grip-visuals';

import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const SELECTED_ATTR = 'data-blok-table-cell-selected';

const SELECTION_BORDER = '2px solid #3b82f6';

const PILL_ATTR = 'data-blok-table-selection-pill';
const PILL_WIDTH = 16;
const PILL_HEIGHT = 20;
const PILL_IDLE_SIZE = 4;

const PILL_CLASSES = [
  'absolute',
  'z-3',
  'rounded-sm',
  'select-none',
  'transition-[opacity,background-color,width]',
  'duration-150',
  'flex',
  'items-center',
  'justify-center',
  'overflow-hidden',
  'cursor-pointer',
  'bg-blue-500',
];

export interface SelectionRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

interface CellCoord {
  row: number;
  col: number;
}

/**
 * Check if a grip drag or resize is in progress by testing for known drag indicators.
 * Returns true if the grid has an active drag ghost or user-select is disabled.
 */
const isOtherInteractionActive = (grid: HTMLElement): boolean => {
  return grid.style.userSelect === 'none';
};

/**
 * Handles rectangular cell selection via click-and-drag.
 * Selection starts when a pointer drag crosses from one cell into another.
 * Selected cells are highlighted with a blue outer border around the selection rectangle
 * using an absolutely-positioned overlay div.
 */
interface CellSelectionOptions {
  grid: HTMLElement;
  rectangleSelection?: { cancelActiveSelection: () => void };
  onSelectionActiveChange?: (hasSelection: boolean) => void;
  onSelectionRangeChange?: (range: SelectionRange) => void;
  onClearContent?: (cells: HTMLElement[]) => void;
  onCopy?: (cells: HTMLElement[], clipboardData: DataTransfer) => void;
  onCut?: (cells: HTMLElement[], clipboardData: DataTransfer) => void;
  onCopyViaButton?: (cells: HTMLElement[]) => void;
  onColorChange?: (cells: HTMLElement[], color: string | null, mode: CellColorMode) => void;
  onPlacementChange?: (cells: HTMLElement[], placement: CellPlacement) => void;
  getCellPlacement?: (row: number, col: number) => CellPlacement | undefined;
  onPointerDragActiveChange?: (active: boolean) => void;
  isPopoverOpen?: () => boolean;
  /** Called to check if the current selection range can be merged. */
  canMergeCells?: (range: SelectionRange) => boolean;
  /** Called when user requests to merge the selected cells. */
  onMergeCells?: (range: SelectionRange) => void;
  /** Called to check if the cell at (row, col) is a merge origin that can be split. */
  isMergedCell?: (row: number, col: number) => boolean;
  /** Called when user requests to split a merged cell. */
  onSplitCell?: (row: number, col: number) => void;
  /** Returns the colspan and rowspan of the cell at (row, col). Used to expand the selection rect to full merged-cell spans. */
  getCellSpan?: (row: number, col: number) => { colspan: number; rowspan: number };
  i18n: I18n;
}

export class TableCellSelection {
  private grid: HTMLElement;
  private rectangleSelection?: { cancelActiveSelection: () => void };
  private onSelectionActiveChange: ((hasSelection: boolean) => void) | undefined;
  private onClearContent: ((cells: HTMLElement[]) => void) | undefined;
  private i18n: I18n;
  private anchorCell: CellCoord | null = null;
  private extentCell: CellCoord | null = null;
  private isSelecting = false;
  private hasSelection = false;
  private selectedCells: HTMLElement[] = [];
  private overlay: HTMLElement | null = null;
  private pill: HTMLElement | null = null;
  private pillPopover: PopoverDesktop | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private onCopy: ((cells: HTMLElement[], clipboardData: DataTransfer) => void) | undefined;
  private onCut: ((cells: HTMLElement[], clipboardData: DataTransfer) => void) | undefined;
  private onCopyViaButton: ((cells: HTMLElement[]) => void) | undefined;
  private onColorChange: ((cells: HTMLElement[], color: string | null, mode: CellColorMode) => void) | undefined;
  private onPlacementChange: ((cells: HTMLElement[], placement: CellPlacement) => void) | undefined;
  private getCellPlacement: ((row: number, col: number) => CellPlacement | undefined) | undefined;
  private onSelectionRangeChange: ((range: SelectionRange) => void) | undefined;
  private onPointerDragActiveChange: ((active: boolean) => void) | undefined;
  private isPopoverOpen: (() => boolean) | undefined;
  private canMergeCells: ((range: SelectionRange) => boolean) | undefined;
  private onMergeCells: ((range: SelectionRange) => void) | undefined;
  private isMergedCell: ((row: number, col: number) => boolean) | undefined;
  private onSplitCell: ((row: number, col: number) => void) | undefined;
  private getCellSpan: ((row: number, col: number) => { colspan: number; rowspan: number }) | undefined;
  private lastPaintedRange: SelectionRange | null = null;
  private preExpansionWasSingleCell = false;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: () => void;
  private boundClearSelection: (e: PointerEvent) => void;
  private boundCancelRectangle: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundCopyHandler: (e: ClipboardEvent) => void;
  private boundCutHandler: (e: ClipboardEvent) => void;
  private boundPreventDragStart: (e: Event) => void;

  constructor(options: CellSelectionOptions) {
    this.grid = options.grid;
    this.rectangleSelection = options.rectangleSelection;
    this.onSelectionActiveChange = options.onSelectionActiveChange;
    this.onClearContent = options.onClearContent;
    this.onCopy = options.onCopy;
    this.onCut = options.onCut;
    this.onCopyViaButton = options.onCopyViaButton;
    this.onColorChange = options.onColorChange;
    this.onPlacementChange = options.onPlacementChange;
    this.getCellPlacement = options.getCellPlacement;
    this.onSelectionRangeChange = options.onSelectionRangeChange;
    this.onPointerDragActiveChange = options.onPointerDragActiveChange;
    this.isPopoverOpen = options.isPopoverOpen;
    this.canMergeCells = options.canMergeCells;
    this.onMergeCells = options.onMergeCells;
    this.isMergedCell = options.isMergedCell;
    this.onSplitCell = options.onSplitCell;
    this.getCellSpan = options.getCellSpan;
    this.i18n = options.i18n;
    this.grid.style.position = 'relative';

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundClearSelection = this.handleClearSelection.bind(this);
    this.boundCancelRectangle = this.handleCancelRectangle.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundCopyHandler = this.handleCopy.bind(this);
    this.boundCutHandler = this.handleCut.bind(this);
    this.boundPreventDragStart = this.handleDragStart.bind(this);

    this.grid.addEventListener('pointerdown', this.boundPointerDown);
    this.grid.addEventListener('dragstart', this.boundPreventDragStart);
    document.addEventListener('keydown', this.boundKeyDown);
    document.addEventListener('copy', this.boundCopyHandler);
    document.addEventListener('cut', this.boundCutHandler);
  }

  public destroy(): void {
    this.destroyPillPopover();
    this.disconnectResizeObserver();
    this.clearSelection();
    // Ensure Yjs sync suppression and userSelect are cleaned up if destroyed mid-drag.
    if (this.anchorCell) {
      this.onPointerDragActiveChange?.(false);
      this.grid.style.userSelect = '';
    }
    this.grid.removeEventListener('pointerdown', this.boundPointerDown);
    this.grid.removeEventListener('dragstart', this.boundPreventDragStart);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerUp);
    document.removeEventListener('pointerdown', this.boundClearSelection);
    document.removeEventListener('mousemove', this.boundCancelRectangle, true);
    document.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('copy', this.boundCopyHandler);
    document.removeEventListener('cut', this.boundCutHandler);
  }

  /**
   * Programmatically select an entire row.
   */
  public selectRow(rowIndex: number): void {
    const colCount = this.getLogicalColumnCount();

    if (colCount === 0) {
      return;
    }

    this.showProgrammaticSelection(rowIndex, 0, rowIndex, colCount - 1);
  }

  /**
   * Programmatically select an entire column.
   */
  public selectColumn(colIndex: number): void {
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const rowCount = rows.length;

    if (rowCount === 0) {
      return;
    }

    this.showProgrammaticSelection(0, colIndex, rowCount - 1, colIndex);
  }

  /**
   * Clear any active programmatic or drag selection.
   */
  public clearActiveSelection(): void {
    this.clearSelection();
  }

  /**
   * Return the currently painted selection range, or null if nothing is selected.
   */
  public getSelectedRange(): SelectionRange | null {
    return this.hasSelection ? this.lastPaintedRange : null;
  }

  /**
   * Programmatically restore a selection range (e.g. after a DOM rebuild).
   */
  public selectRange(range: SelectionRange): void {
    this.showProgrammaticSelection(range.minRow, range.minCol, range.maxRow, range.maxCol);
  }

  /**
   * Prevent native drag-and-drop while a cell selection drag is in progress.
   * Without this, the browser can fire dragstart on contenteditable cells
   * during a pointer drag, which suppresses pointermove events and breaks
   * the cell selection.
   */
  private handleDragStart(e: Event): void {
    if (this.anchorCell) {
      e.preventDefault();
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    // Don't interfere with grip drags, resize, or add-button drags
    if (isOtherInteractionActive(this.grid)) {
      return;
    }

    // Only respond to primary button
    if (e.button !== 0) {
      return;
    }

    // Don't start selection from grip elements
    const target = e.target as HTMLElement;

    if (target.closest('[data-blok-table-grip]') || target.closest('[data-blok-table-resize]') || target.closest(`[${PILL_ATTR}]`)) {
      return;
    }

    const cell = this.resolveCellCoord(target);

    if (!cell) {
      return;
    }

    // If clicking the same single-cell that's already selected, keep the
    // selection instead of clearing and re-creating it (avoids border flash).
    const clickedSameCell = this.hasSelection
      && this.lastPaintedRange !== null
      && this.lastPaintedRange.minRow === cell.row
      && this.lastPaintedRange.maxRow === cell.row
      && this.lastPaintedRange.minCol === cell.col
      && this.lastPaintedRange.maxCol === cell.col;

    if (clickedSameCell) {
      // Remove the document clear handler so it doesn't fire for this click
      document.removeEventListener('pointerdown', this.boundClearSelection);
    } else if (this.hasSelection) {
      this.clearSelection();
    }

    this.anchorCell = cell;
    this.isSelecting = false;

    // Suppress DOM-mutation-triggered Yjs syncs for the duration of this pointer drag.
    // The browser can mutate contenteditable DOM across cell boundaries during a drag,
    // and writing that corrupted state to Yjs would break undo.
    this.onPointerDragActiveChange?.(true);

    // Listen to mousemove in capture phase to cancel RectangleSelection before it runs
    document.addEventListener('mousemove', this.boundCancelRectangle, true);
    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    // pointercancel fires when the browser interrupts the pointer sequence (e.g. touch scroll).
    // Treat it like pointerup so the drag-active flag is always cleared.
    document.addEventListener('pointercancel', this.boundPointerUp);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.anchorCell) {
      return;
    }

    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;

    if (!target) {
      return;
    }

    const cell = this.resolveCellCoord(target);

    if (!cell) {
      // Pointer left the grid — clamp to edge
      this.clampExtentToEdge(e);

      return;
    }

    // Still in the same cell as anchor — don't start selection yet
    if (!this.isSelecting && cell.row === this.anchorCell.row && cell.col === this.anchorCell.col) {
      return;
    }

    // Crossed into a different cell — start selection
    if (!this.isSelecting) {
      this.isSelecting = true;
      this.onSelectionActiveChange?.(true);

      // Prevent native text selection from extending across cell boundaries.
      // We restore userSelect in handlePointerUp.
      this.grid.style.userSelect = 'none';

      // Clear any native text selection that may have formed within the anchor cell.
      window.getSelection()?.removeAllRanges();
    }

    // Update extent and repaint
    if (!this.extentCell || this.extentCell.row !== cell.row || this.extentCell.col !== cell.col) {
      this.extentCell = cell;
      this.paintSelection();
    }
  }

  private handleCancelRectangle(_e: MouseEvent): void {
    // Cancel RectangleSelection in capture phase, before it processes the event
    if (!this.rectangleSelection) {
      return;
    }

    this.rectangleSelection.cancelActiveSelection();

    // Also directly hide the overlay since cancelActiveSelection() doesn't work when called repeatedly
    const overlay = document.querySelector('[data-blok-overlay-rectangle]');

    if (!overlay) {
      return;
    }

    const overlayElement = overlay as HTMLElement;

    overlayElement.style.display = 'none';
  }

  private handlePointerUp(): void {
    document.removeEventListener('mousemove', this.boundCancelRectangle, true);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerUp);

    // Re-enable Yjs sync suppression that was set in handlePointerDown.
    this.onPointerDragActiveChange?.(false);

    if (this.isSelecting) {
      // Restore userSelect that was set in handlePointerMove when crossing cells.
      this.grid.style.userSelect = '';
      this.hasSelection = true;

      if (this.lastPaintedRange) {
        this.onSelectionRangeChange?.(this.lastPaintedRange);
      }

      // Listen for next pointerdown anywhere to clear selection.
      // Register synchronously — pointerdown for the drag already fired
      // before this pointerup, so there is no risk of the current
      // interaction's pointerdown triggering the clear handler.
      document.addEventListener('pointerdown', this.boundClearSelection);
    } else if (this.anchorCell) {
      if (this.hasSelection) {
        // Already selected (same single cell) — just re-register clear handler
        document.addEventListener('pointerdown', this.boundClearSelection);
      } else {
        // Single click without drag — select the clicked cell
        this.showProgrammaticSelection(
          this.anchorCell.row,
          this.anchorCell.col,
          this.anchorCell.row,
          this.anchorCell.col,
        );
      }
    }

    this.isSelecting = false;
    this.anchorCell = null;
    this.extentCell = null;
  }

  private handleClearSelection(e: PointerEvent): void {
    const target = e.target;

    if (target instanceof HTMLElement && target.closest(`[${PILL_ATTR}]`)) {
      return;
    }

    // Don't clear when clicking inside an open popover — the user may be
    // clicking a popover item whose pointerdown bubbles to the document.
    // Popovers render on document.body and carry `data-blok-popover-opened`.
    if (target instanceof HTMLElement && target.closest('[data-blok-popover-opened]') !== null) {
      return;
    }

    if (this.pillPopover !== null) {
      this.destroyPillPopover();
    }

    document.removeEventListener('pointerdown', this.boundClearSelection);
    this.clearSelection();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Only trigger when selection is active
    if (!this.hasSelection) {
      return;
    }

    // Check for Delete or Backspace
    if (e.key !== 'Delete' && e.key !== 'Backspace') {
      return;
    }

    // For single-cell selections, let the browser handle Delete/Backspace
    // as normal character-level editing in the contenteditable cell.
    if (this.selectedCells.length <= 1) {
      return;
    }

    // Prevent default behavior
    e.preventDefault();

    // Clear content and dismiss selection
    this.onClearContent?.([...this.selectedCells]);
    this.clearSelection();
  }

  private handleCopy(e: ClipboardEvent): void {
    if (!this.hasSelection || !e.clipboardData) {
      return;
    }

    // For single-cell selections, if the user has a non-collapsed native text
    // selection within the cell's contenteditable (i.e., they selected specific
    // text characters), defer to the browser's native copy so their text
    // selection is copied rather than the whole cell block structure.
    if (this.selectedCells.length <= 1 && this.hasNativeTextSelection()) {
      return;
    }

    e.preventDefault();
    this.onCopy?.([...this.selectedCells], e.clipboardData);
  }

  private handleCut(e: ClipboardEvent): void {
    if (!this.hasSelection || !e.clipboardData) {
      return;
    }

    // For single-cell selections, if the user has a non-collapsed native text
    // selection within the cell's contenteditable, defer to the browser's native
    // cut so their text selection is cut rather than clearing the entire cell.
    if (this.selectedCells.length <= 1 && this.hasNativeTextSelection()) {
      return;
    }

    e.preventDefault();
    this.onCut?.([...this.selectedCells], e.clipboardData);
    this.onClearContent?.([...this.selectedCells]);
    this.clearSelection();
  }

  /**
   * Returns true if the browser has a non-collapsed text selection (i.e. the
   * user has selected one or more characters inside a contenteditable), as
   * opposed to a mere caret position or no selection at all.
   */
  private hasNativeTextSelection(): boolean {
    const selection = window.getSelection();

    return selection !== null && !selection.isCollapsed;
  }

  private clearSelection(): void {
    const hadSelection = this.hasSelection;

    this.restoreModifiedCells();
    this.hasSelection = false;
    this.lastPaintedRange = null;
    this.preExpansionWasSingleCell = false;

    if (hadSelection) {
      this.onSelectionActiveChange?.(false);
    }
  }

  private restoreModifiedCells(): void {
    this.destroyPillPopover();
    this.disconnectResizeObserver();

    this.selectedCells.forEach(cell => {
      cell.removeAttribute(SELECTED_ATTR);
    });

    if (this.pill) {
      this.pill.remove();
      this.pill = null;
    }

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    this.selectedCells = [];
  }

  private showProgrammaticSelection(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
  ): void {
    this.clearSelection();
    this.anchorCell = { row: fromRow, col: fromCol };
    this.extentCell = { row: toRow, col: toCol };
    this.paintSelection();
    this.hasSelection = true;
    this.onSelectionActiveChange?.(true);

    if (this.lastPaintedRange) {
      this.onSelectionRangeChange?.(this.lastPaintedRange);
    }

    this.anchorCell = null;
    this.extentCell = null;

    // Listen for next pointerdown anywhere to clear the programmatic selection.
    // Register synchronously to avoid race conditions where a fast
    // pointerdown arrives before the next animation frame.
    document.addEventListener('pointerdown', this.boundClearSelection);
  }

  /**
   * Expand a selection rect to fully include the spans of any merged cells
   * whose origins fall within the rect. Iterates until the rect is stable,
   * since pulling in a new merged cell may expose further cells that extend
   * beyond the current boundary.
   */
  private expandRectToMergedSpans(rect: SelectionRange): SelectionRange {
    if (!this.getCellSpan) {
      return rect;
    }

    return this.expandRectStep(rect);
  }

  private expandRectStep(rect: SelectionRange): SelectionRange {
    const getCellSpan = this.getCellSpan;

    if (!getCellSpan) {
      return rect;
    }

    const rows = Array.from({ length: rect.maxRow - rect.minRow + 1 }, (_, i) => rect.minRow + i);
    const cols = Array.from({ length: rect.maxCol - rect.minCol + 1 }, (_, i) => rect.minCol + i);

    const expanded = rows.reduce<SelectionRange>((acc, r) => {
      return cols.reduce<SelectionRange>((inner, c) => {
        const { colspan, rowspan } = getCellSpan(r, c);

        return {
          minRow: inner.minRow,
          maxRow: Math.max(inner.maxRow, r + rowspan - 1),
          minCol: inner.minCol,
          maxCol: Math.max(inner.maxCol, c + colspan - 1),
        };
      }, acc);
    }, rect);

    const changed =
      expanded.maxRow !== rect.maxRow ||
      expanded.maxCol !== rect.maxCol;

    return changed ? this.expandRectStep(expanded) : expanded;
  }

  private paintSelection(): void {
    if (!this.anchorCell || !this.extentCell) {
      return;
    }

    // Clear previous cell markers
    this.selectedCells.forEach(cell => {
      cell.removeAttribute(SELECTED_ATTR);
    });
    this.selectedCells = [];

    // Compute rectangle bounds
    const minRow = Math.min(this.anchorCell.row, this.extentCell.row);
    const maxRow = Math.max(this.anchorCell.row, this.extentCell.row);
    const minCol = Math.min(this.anchorCell.col, this.extentCell.col);
    const maxCol = Math.max(this.anchorCell.col, this.extentCell.col);

    this.preExpansionWasSingleCell = minRow === maxRow && minCol === maxCol;
    this.lastPaintedRange = this.expandRectToMergedSpans({ minRow, maxRow, minCol, maxCol });

    const { minRow: expandedMinRow, maxRow: expandedMaxRow, minCol: expandedMinCol, maxCol: expandedMaxCol } = this.lastPaintedRange;

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    // Mark selected cells
    this.selectedCells = this.collectCellsInRange(rows, expandedMinRow, expandedMaxRow, expandedMinCol, expandedMaxCol);
    this.selectedCells.forEach(cell => {
      cell.setAttribute(SELECTED_ATTR, '');
    });

    // Calculate overlay position from bounding rects of corner cells.
    // Try coordinate-based lookup first (works with merged cells),
    // then fall back to index-based lookup for backwards compatibility.
    const firstCell = this.findCellByCoordOrIndex(rows, expandedMinRow, expandedMinCol);
    const lastCell = this.findCellByCoordOrIndex(rows, expandedMaxRow, expandedMaxCol);

    if (!firstCell || !lastCell) {
      return;
    }

    const gridRect = this.grid.getBoundingClientRect();
    const firstRect = firstCell.getBoundingClientRect();
    const lastRect = lastCell.getBoundingClientRect();

    // getBoundingClientRect() measures from the border-box edge, but
    // position:absolute offsets from the padding-box edge. Subtract
    // grid border widths to align with cell edges.
    const gridStyle = getComputedStyle(this.grid);
    const borderTop = parseFloat(gridStyle.borderTopWidth) || 0;
    const borderLeft = parseFloat(gridStyle.borderLeftWidth) || 0;

    const width = lastRect.right - firstRect.left + 1;
    const height = lastRect.bottom - firstRect.top + 1;

    // Extend overlay 1px outward to cover adjacent borders:
    // grid border-top/border-left at row 0/col 0, or the previous
    // row's border-bottom / previous column's border-right otherwise.
    const top = firstRect.top - gridRect.top - borderTop - 1;
    const left = firstRect.left - gridRect.left - borderLeft - 1;

    // Create overlay once, reuse on subsequent paints
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.setAttribute('data-blok-table-selection-overlay', '');
      this.overlay.style.position = 'absolute';
      this.overlay.style.border = SELECTION_BORDER;
      this.overlay.style.pointerEvents = 'none';
      this.overlay.style.boxSizing = 'border-box';
      this.overlay.style.borderRadius = '2px';
      this.grid.appendChild(this.overlay);
    }

    this.overlay.style.top = `${top}px`;
    this.overlay.style.left = `${left}px`;
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;

    // Create pill once, reuse on subsequent paints
    if (!this.pill) {
      this.pill = this.createPill();
      this.grid.appendChild(this.pill);
    }

    // Position at center of the 2px right border; translate(-50%,-50%) handles centering
    this.pill.style.left = `${left + width - 1}px`;
    this.pill.style.top = `${top + height / 2}px`;

    this.observeCellResizes();
  }

  /**
   * Recalculate overlay and pill positions from the last painted range.
   * Called by the ResizeObserver when selected cells change size.
   */
  private repositionOverlay(): void {
    const range = this.lastPaintedRange;

    if (!range || !this.overlay) {
      return;
    }

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const firstCell = this.findCellByCoordOrIndex(rows, range.minRow, range.minCol);
    const lastCell = this.findCellByCoordOrIndex(rows, range.maxRow, range.maxCol);

    if (!firstCell || !lastCell) {
      return;
    }

    const gridRect = this.grid.getBoundingClientRect();
    const firstRect = firstCell.getBoundingClientRect();
    const lastRect = lastCell.getBoundingClientRect();

    const gridStyle = getComputedStyle(this.grid);
    const borderTop = parseFloat(gridStyle.borderTopWidth) || 0;
    const borderLeft = parseFloat(gridStyle.borderLeftWidth) || 0;

    const width = lastRect.right - firstRect.left + 1;
    const height = lastRect.bottom - firstRect.top + 1;
    const top = firstRect.top - gridRect.top - borderTop - 1;
    const left = firstRect.left - gridRect.left - borderLeft - 1;

    this.overlay.style.top = `${top}px`;
    this.overlay.style.left = `${left}px`;
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;

    if (this.pill) {
      this.pill.style.left = `${left + width - 1}px`;
      this.pill.style.top = `${top + height / 2}px`;
    }
  }

  /**
   * Start observing selected cells for size changes so the overlay
   * stays in sync when cell content grows or shrinks.
   */
  private observeCellResizes(): void {
    this.disconnectResizeObserver();

    if (this.selectedCells.length === 0) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.repositionOverlay();
    });

    for (const cell of this.selectedCells) {
      this.resizeObserver.observe(cell);
    }
  }

  private disconnectResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private createPill(): HTMLElement {
    const pill = document.createElement('div');

    pill.setAttribute(PILL_ATTR, '');
    pill.setAttribute('contenteditable', 'false');
    pill.className = twMerge(PILL_CLASSES);
    pill.style.width = `${PILL_IDLE_SIZE}px`;
    pill.style.height = `${PILL_HEIGHT}px`;
    pill.style.pointerEvents = 'auto';
    pill.style.transform = 'translate(-50%, -50%)';
    pill.style.outline = '2px solid var(--blok-table-grip-outline, transparent)';

    const svg = createGripDotsSvg('vertical');

    svg.classList.remove('text-gray-400');
    svg.classList.add('text-white');
    pill.appendChild(svg);

    pill.addEventListener('mouseenter', () => {
      if (this.pillPopover === null) {
        this.expandPill();
      }
    });
    pill.addEventListener('mouseleave', () => {
      if (this.pillPopover === null) {
        this.collapsePill();
      }
    });
    pill.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.openPillPopover();
    });

    return pill;
  }

  private openPillPopover(): void {
    this.destroyPillPopover();

    if (!this.pill) {
      return;
    }

    this.expandPill();

    const copyShortcut = MODIFIER_KEY === 'Meta' ? '⌘C' : 'Ctrl+C';

    const colorPickerItems: PopoverItemParams[] = [];

    if (this.onColorChange !== undefined) {
      const { element: pickerElement } = createCellColorPicker({
        i18n: this.i18n,
        onColorSelect: (color: string | null, mode: CellColorMode): void => {
          this.onColorChange?.([...this.selectedCells], color, mode);
        },
      });

      colorPickerItems.push({
        icon: IconMarker,
        title: this.i18n.t('tools.table.cellColor'),
        name: 'cellColor',
        children: {
          items: [{
            type: PopoverItemType.Html,
            element: pickerElement,
          }],
          isFlippable: false,
        },
      });
    }

    const placementItems: PopoverItemParams[] = [];

    if (this.onPlacementChange !== undefined) {
      const currentPlacement: CellPlacement | undefined = this.lastPaintedRange && this.getCellPlacement
        ? this.getCellPlacement(this.lastPaintedRange.minRow, this.lastPaintedRange.minCol)
        : undefined;

      const { element: pickerElement } = createCellPlacementPicker({
        i18n: this.i18n,
        currentPlacement,
        onPlacementSelect: (placement: CellPlacement): void => {
          this.onPlacementChange?.([...this.selectedCells], placement);
        },
      });

      placementItems.push({
        icon: IconPlacement,
        title: this.i18n.t('tools.table.placement'),
        name: 'cellPlacement',
        children: {
          items: [{
            type: PopoverItemType.Html,
            element: pickerElement,
          }],
          isFlippable: false,
        },
      });
    }

    const mergeItems: PopoverItemParams[] = [];

    if (this.lastPaintedRange && this.onMergeCells) {
      const range = this.lastPaintedRange;
      const isMultiCell = range.minRow !== range.maxRow || range.minCol !== range.maxCol;
      const canMerge = isMultiCell && !this.preExpansionWasSingleCell && this.canMergeCells?.(range);

      if (canMerge) {
        mergeItems.push({
          icon: IconMergeCells,
          title: this.i18n.t('tools.table.mergeCells'),
          closeOnActivate: true,
          onActivate: (): void => {
            this.onMergeCells?.(range);
            this.clearSelection();
          },
        });
      }
    }

    if (this.lastPaintedRange && this.onSplitCell) {
      const range = this.lastPaintedRange;
      const isSingleCell = range.minRow === range.maxRow && range.minCol === range.maxCol;
      const isSingleOriginExpanded = this.preExpansionWasSingleCell && this.isMergedCell?.(range.minRow, range.minCol);

      if ((isSingleCell || isSingleOriginExpanded) && this.isMergedCell?.(range.minRow, range.minCol)) {
        mergeItems.push({
          icon: IconSplitCell,
          title: this.i18n.t('tools.table.splitCell'),
          closeOnActivate: true,
          onActivate: (): void => {
            this.onSplitCell?.(range.minRow, range.minCol);
            this.clearSelection();
          },
        });
      }
    }

    const items: PopoverItemParams[] = [
      ...colorPickerItems,
      ...placementItems,
      ...mergeItems,
      {
        icon: IconCopy,
        title: this.i18n.t('tools.table.copySelection'),
        secondaryLabel: copyShortcut,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onCopyViaButton?.([...this.selectedCells]);
        },
      },
      {
        icon: IconCross,
        title: this.i18n.t('tools.table.clearSelection'),
        secondaryLabel: 'Del',
        closeOnActivate: true,
        onActivate: (): void => {
          this.onClearContent?.([...this.selectedCells]);
          this.clearSelection();
        },
      },
    ];

    this.pillPopover = new PopoverDesktop({
      items,
      trigger: this.pill,
      flippable: true,
    });

    this.pillPopover.on(PopoverEvent.Closed, () => {
      if (this.pillPopover === null) {
        return;
      }

      this.destroyPillPopover();

      this.collapsePill();
    });

    this.pillPopover.show();
  }

  private expandPill(): void {
    if (!this.pill) {
      return;
    }

    this.pill.style.width = `${PILL_WIDTH}px`;

    const svg = this.pill.querySelector('svg');

    if (svg) {
      svg.classList.remove('opacity-0');
      svg.classList.add('opacity-100');
    }
  }

  private collapsePill(): void {
    if (!this.pill) {
      return;
    }

    this.pill.style.width = `${PILL_IDLE_SIZE}px`;

    const svg = this.pill.querySelector('svg');

    if (svg) {
      svg.classList.add('opacity-0');
      svg.classList.remove('opacity-100');
    }
  }

  private destroyPillPopover(): void {
    if (this.pillPopover !== null) {
      const popover = this.pillPopover;

      this.pillPopover = null;
      popover.destroy();
    }
  }

  private resolveCellCoord(target: HTMLElement): CellCoord | null {
    const cell = target.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return null;
    }

    const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

    if (!row) {
      return null;
    }

    // Verify cell is within our grid
    if (!this.grid.contains(row)) {
      return null;
    }

    // Prefer logical coordinate attributes stamped by reindexCoordinates() —
    // these are correct even when rows have fewer physical <td> elements than
    // logical columns (e.g. after a colspan/rowspan merge).
    const cellRowAttr = cell.getAttribute(CELL_ROW_ATTR);
    const cellColAttr = cell.getAttribute(CELL_COL_ATTR);

    if (cellRowAttr !== null && cellColAttr !== null) {
      const rowIndex = parseInt(cellRowAttr, 10);
      const colIndex = parseInt(cellColAttr, 10);

      if (!isNaN(rowIndex) && !isNaN(colIndex)) {
        return { row: rowIndex, col: colIndex };
      }
    }

    // Fallback: physical DOM index — only used for grids without coordinate
    // attributes (e.g. legacy non-table grid elements).
    const rows = Array.from(this.grid.querySelectorAll(`[${ROW_ATTR}]`));
    const rowIndex = rows.indexOf(row);

    if (rowIndex < 0) {
      return null;
    }

    const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
    const colIndex = cells.indexOf(cell);

    if (colIndex < 0) {
      return null;
    }

    return { row: rowIndex, col: colIndex };
  }

  private clampExtentToEdge(e: PointerEvent): void {
    if (!this.anchorCell || !this.isSelecting) {
      return;
    }

    const gridRect = this.grid.getBoundingClientRect();
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const rowCount = rows.length;
    const colCount = this.getLogicalColumnCount();

    if (rowCount === 0 || colCount === 0) {
      return;
    }

    const row = this.clampAxis(e.clientY, gridRect.top, gridRect.bottom, rowCount, this.extentCell?.row ?? this.anchorCell.row);
    const col = this.clampAxis(e.clientX, gridRect.left, gridRect.right, colCount, this.extentCell?.col ?? this.anchorCell.col);

    const clamped = { row, col };

    if (!this.extentCell || this.extentCell.row !== clamped.row || this.extentCell.col !== clamped.col) {
      this.extentCell = clamped;
      this.paintSelection();
    }
  }

  private collectCellsInRange(
    rows: NodeListOf<Element>,
    minRow: number,
    maxRow: number,
    minCol: number,
    maxCol: number,
  ): HTMLElement[] {
    const hasCoordAttrs = this.grid.querySelector(`[${CELL_ROW_ATTR}]`) !== null;

    if (!hasCoordAttrs) {
      // Fallback: index-based lookup for grids without coordinate attributes
      return Array.from(rows)
        .slice(minRow, maxRow + 1)
        .flatMap(row => {
          const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

          return Array.from(cells)
            .slice(minCol, maxCol + 1)
            .filter((cell): cell is HTMLElement => cell instanceof HTMLElement);
        });
    }

    const allCells = this.grid.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`);

    return Array.from(allCells).filter(cell => {
      const rowAttr = cell.getAttribute(CELL_ROW_ATTR);
      const colAttr = cell.getAttribute(CELL_COL_ATTR);

      if (rowAttr === null || colAttr === null) {
        return false;
      }

      const cellRow = Number(rowAttr);
      const cellCol = Number(colAttr);
      const td = cell as HTMLTableCellElement;
      const cellMaxRow = cellRow + (td.rowSpan || 1) - 1;
      const cellMaxCol = cellCol + (td.colSpan || 1) - 1;

      // Include if the cell's area overlaps the selection range
      return cellRow <= maxRow && cellMaxRow >= minRow
        && cellCol <= maxCol && cellMaxCol >= minCol;
    });
  }

  /**
   * Find a cell by coordinate attributes first, falling back to index-based
   * lookup when coordinate attributes are not present.
   *
   * When both primary lookups fail (e.g. `col` points to a covered logical
   * column that has no physical <td> of its own), scan all cells in the row
   * and return the one whose colspan range covers `col`.  This handles the
   * case where `expandRectToMergedSpans` has expanded the selection corner to
   * a column that is spanned by an origin cell at a lower column index.
   */
  private findCellByCoordOrIndex(
    rows: NodeListOf<Element>,
    row: number,
    col: number,
  ): HTMLElement | undefined {
    const coordCell = this.grid.querySelector<HTMLElement>(
      `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
    );

    if (coordCell) {
      return coordCell;
    }

    const indexCell = rows[row]?.querySelectorAll(`[${CELL_ATTR}]`)[col] as HTMLElement | undefined;

    if (indexCell) {
      return indexCell;
    }

    // Neither coord-based nor index-based lookup found a cell.  Walk all
    // physical cells in the row to find one whose logical column range covers
    // the requested column (origin cellCol <= col <= cellCol + colSpan - 1).
    const rowCells = Array.from(rows[row]?.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`) ?? []);

    return rowCells.find(cell => {
      const cellCol = Number(cell.getAttribute(CELL_COL_ATTR));
      const cellColSpan = (cell as HTMLTableCellElement).colSpan || 1;

      return cellCol <= col && cellCol + cellColSpan - 1 >= col;
    });
  }

  /**
   * Get the logical column count from the colgroup, falling back to the
   * physical cell count in the first row when no colgroup exists.
   */
  private getLogicalColumnCount(): number {
    const colgroupCount = this.grid.querySelector('colgroup')?.querySelectorAll('col').length;

    if (colgroupCount !== undefined && colgroupCount > 0) {
      return colgroupCount;
    }

    const firstRow = this.grid.querySelector(`[${ROW_ATTR}]`);

    return firstRow?.querySelectorAll(`[${CELL_ATTR}]`).length ?? 0;
  }

  /**
   * Clamp a pointer coordinate to an axis range, returning the edge index
   * when outside or the fallback when inside.
   */
  private clampAxis(pointer: number, min: number, max: number, count: number, fallback: number): number {
    if (pointer < min) {
      return 0;
    }

    if (pointer > max) {
      return count - 1;
    }

    return fallback;
  }
}
