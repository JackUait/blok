import type { I18n } from '../../../types/api';
import { IconCopy, IconCross, IconMarker } from '../../components/icons';
import { MODIFIER_KEY } from '../../components/constants';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';
import { twMerge } from '../../components/utils/tw';

import { CELL_ATTR, ROW_ATTR } from './table-core';
import { createCellColorPicker } from './table-cell-color-picker';
import type { CellColorMode } from './table-cell-color-picker';
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
  isPopoverOpen?: () => boolean;
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

  private onCopy: ((cells: HTMLElement[], clipboardData: DataTransfer) => void) | undefined;
  private onCut: ((cells: HTMLElement[], clipboardData: DataTransfer) => void) | undefined;
  private onCopyViaButton: ((cells: HTMLElement[]) => void) | undefined;
  private onColorChange: ((cells: HTMLElement[], color: string | null, mode: CellColorMode) => void) | undefined;
  private onSelectionRangeChange: ((range: SelectionRange) => void) | undefined;
  private isPopoverOpen: (() => boolean) | undefined;
  private lastPaintedRange: SelectionRange | null = null;

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
    this.onSelectionRangeChange = options.onSelectionRangeChange;
    this.isPopoverOpen = options.isPopoverOpen;
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
    this.clearSelection();
    this.grid.removeEventListener('pointerdown', this.boundPointerDown);
    this.grid.removeEventListener('dragstart', this.boundPreventDragStart);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
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
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const colCount = rows[0]?.querySelectorAll(`[${CELL_ATTR}]`).length ?? 0;

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

    // If there's an existing selection, clear it first
    if (this.hasSelection) {
      this.clearSelection();
    }

    this.anchorCell = cell;
    this.isSelecting = false;

    // Listen to mousemove in capture phase to cancel RectangleSelection before it runs
    document.addEventListener('mousemove', this.boundCancelRectangle, true);
    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
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

      // Clear native text selection
      window.getSelection()?.removeAllRanges();
      this.grid.style.userSelect = 'none';
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

    if (this.isSelecting) {
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
      // Single click without drag — select the clicked cell
      this.showProgrammaticSelection(
        this.anchorCell.row,
        this.anchorCell.col,
        this.anchorCell.row,
        this.anchorCell.col,
      );
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

    e.preventDefault();
    this.onCopy?.([...this.selectedCells], e.clipboardData);
  }

  private handleCut(e: ClipboardEvent): void {
    if (!this.hasSelection || !e.clipboardData) {
      return;
    }

    e.preventDefault();
    this.onCut?.([...this.selectedCells], e.clipboardData);
    this.onClearContent?.([...this.selectedCells]);
    this.clearSelection();
  }

  private clearSelection(): void {
    const hadSelection = this.hasSelection;

    this.restoreModifiedCells();
    this.hasSelection = false;
    this.lastPaintedRange = null;

    if (hadSelection) {
      this.onSelectionActiveChange?.(false);
    }
  }

  private restoreModifiedCells(): void {
    this.destroyPillPopover();

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

    this.lastPaintedRange = { minRow, maxRow, minCol, maxCol };

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    // Mark selected cells
    this.selectedCells = this.collectCellsInRange(rows, minRow, maxRow, minCol, maxCol);
    this.selectedCells.forEach(cell => {
      cell.setAttribute(SELECTED_ATTR, '');
    });

    // Calculate overlay position from bounding rects of corner cells
    const firstCell = rows[minRow]?.querySelectorAll(`[${CELL_ATTR}]`)[minCol] as HTMLElement | undefined;
    const lastCell = rows[maxRow]?.querySelectorAll(`[${CELL_ATTR}]`)[maxCol] as HTMLElement | undefined;

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
    pill.style.outline = '2px solid white';

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
          width: '12.5rem',
        },
      });
    }

    const items: PopoverItemParams[] = [
      ...colorPickerItems,
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
    const colCount = rows[0]?.querySelectorAll(`[${CELL_ATTR}]`).length ?? 0;

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
    return Array.from(rows)
      .slice(minRow, maxRow + 1)
      .flatMap(row => {
        const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

        return Array.from(cells)
          .slice(minCol, maxCol + 1)
          .filter((cell): cell is HTMLElement => cell instanceof HTMLElement);
      });
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
