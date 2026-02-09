import { CELL_ATTR, ROW_ATTR } from './table-core';

const SELECTED_ATTR = 'data-blok-table-cell-selected';

const SELECTION_BORDER = '2px solid #3b82f6';

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
  onSelectingChange?: (isSelecting: boolean) => void;
}

export class TableCellSelection {
  private grid: HTMLElement;
  private onSelectingChange: ((isSelecting: boolean) => void) | undefined;
  private anchorCell: CellCoord | null = null;
  private extentCell: CellCoord | null = null;
  private isSelecting = false;
  private hasSelection = false;
  private selectedCells: HTMLElement[] = [];
  private overlay: HTMLElement | null = null;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: () => void;
  private boundClearSelection: (e: PointerEvent) => void;

  constructor(options: CellSelectionOptions) {
    this.grid = options.grid;
    this.onSelectingChange = options.onSelectingChange;
    this.grid.style.position = 'relative';

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundClearSelection = this.handleClearSelection.bind(this);

    this.grid.addEventListener('pointerdown', this.boundPointerDown);
  }

  public destroy(): void {
    this.clearSelection();
    this.grid.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointerdown', this.boundClearSelection);
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

    if (target.closest('[data-blok-table-grip]') || target.closest('[data-blok-table-resize]')) {
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
      this.onSelectingChange?.(true);

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

  private handlePointerUp(): void {
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    if (this.isSelecting) {
      this.grid.style.userSelect = '';
      this.hasSelection = true;
      this.onSelectingChange?.(false);

      // Listen for next pointerdown anywhere to clear selection
      requestAnimationFrame(() => {
        document.addEventListener('pointerdown', this.boundClearSelection);
      });
    }

    this.isSelecting = false;
    this.anchorCell = null;
    this.extentCell = null;
  }

  private handleClearSelection(): void {
    document.removeEventListener('pointerdown', this.boundClearSelection);
    this.clearSelection();
  }

  private clearSelection(): void {
    this.restoreModifiedCells();
    this.hasSelection = false;
  }

  private restoreModifiedCells(): void {
    this.selectedCells.forEach(cell => {
      cell.removeAttribute(SELECTED_ATTR);
    });

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    this.selectedCells = [];
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

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    // Mark selected cells
    for (let r = minRow; r <= maxRow; r++) {
      const row = rows[r];

      if (!row) {
        continue;
      }

      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      for (let c = minCol; c <= maxCol; c++) {
        const cell = cells[c] as HTMLElement | undefined;

        if (!cell) {
          continue;
        }

        cell.setAttribute(SELECTED_ATTR, '');
        this.selectedCells.push(cell);
      }
    }

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

    let top = firstRect.top - gridRect.top - borderTop;
    let left = firstRect.left - gridRect.left - borderLeft;
    let width = lastRect.right - firstRect.left;
    let height = lastRect.bottom - firstRect.top;

    // When the selection touches the grid edge, extend the overlay outward
    // with a negative offset so the blue border covers the gray grid border.
    if (minRow === 0) {
      top = -borderTop;
      height += borderTop;
    }

    if (minCol === 0) {
      left = -borderLeft;
      width += borderLeft;
    }

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

    // Clamp row
    let row: number;

    if (e.clientY < gridRect.top) {
      row = 0;
    } else if (e.clientY > gridRect.bottom) {
      row = rowCount - 1;
    } else {
      row = this.extentCell?.row ?? this.anchorCell.row;
    }

    // Clamp col
    let col: number;

    if (e.clientX < gridRect.left) {
      col = 0;
    } else if (e.clientX > gridRect.right) {
      col = colCount - 1;
    } else {
      col = this.extentCell?.col ?? this.anchorCell.col;
    }

    const clamped = { row, col };

    if (!this.extentCell || this.extentCell.row !== clamped.row || this.extentCell.col !== clamped.col) {
      this.extentCell = clamped;
      this.paintSelection();
    }
  }
}
