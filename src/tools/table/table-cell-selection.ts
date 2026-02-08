import { CELL_ATTR, BORDER_WIDTH, ROW_ATTR } from './table-core';

const SELECTED_ATTR = 'data-blok-table-cell-selected';

const SELECTION_BORDER = '2px solid #3b82f6';
const TRANSPARENT_BORDER = `${BORDER_WIDTH}px solid transparent`;

interface BorderStyles {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

/**
 * Apply border styles to a DOM element.
 */
const setBorders = (el: HTMLElement, borders: BorderStyles): void => {
  Object.assign(el.style, {
    ...(borders.top !== undefined && { borderTop: borders.top }),
    ...(borders.right !== undefined && { borderRight: borders.right }),
    ...(borders.bottom !== undefined && { borderBottom: borders.bottom }),
    ...(borders.left !== undefined && { borderLeft: borders.left }),
  });
};

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
 * Selected cells are highlighted with a blue outer border around the selection rectangle.
 */
export class TableCellSelection {
  private grid: HTMLElement;
  private anchorCell: CellCoord | null = null;
  private extentCell: CellCoord | null = null;
  private isSelecting = false;
  private hasSelection = false;
  private selectedCells: HTMLElement[] = [];
  private savedBorders = new Map<HTMLElement, { top: string; right: string; bottom: string; left: string }>();
  private savedGridBorders: { top: string; left: string } | null = null;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: () => void;
  private boundClearSelection: (e: PointerEvent) => void;

  constructor(grid: HTMLElement) {
    this.grid = grid;

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

  private saveBorder(cell: HTMLElement): void {
    if (this.savedBorders.has(cell)) {
      return;
    }
    this.savedBorders.set(cell, {
      top: cell.style.borderTop,
      right: cell.style.borderRight,
      bottom: cell.style.borderBottom,
      left: cell.style.borderLeft,
    });
  }

  private restoreModifiedCells(): void {
    this.savedBorders.forEach((saved, cell) => {
      setBorders(cell, saved);
    });

    this.selectedCells.forEach(cell => {
      cell.removeAttribute(SELECTED_ATTR);
    });

    if (this.savedGridBorders) {
      this.grid.style.borderTop = this.savedGridBorders.top;
      this.grid.style.borderLeft = this.savedGridBorders.left;
    }

    this.selectedCells = [];
    this.savedBorders.clear();
    this.savedGridBorders = null;
  }

  private applyCellBorders(
    cell: HTMLElement,
    edges: { isTop: boolean; isBottom: boolean; isLeft: boolean; isRight: boolean },
    rows: NodeListOf<Element>,
    rowCells: NodeListOf<Element>,
    r: number,
    c: number,
  ): void {
    this.saveBorder(cell);

    this.applyTopEdge(cell, edges.isTop, rows, r, c);
    setBorders(cell, { bottom: edges.isBottom ? SELECTION_BORDER : TRANSPARENT_BORDER });
    this.applyLeftEdge(cell, edges.isLeft, rowCells, c);
    setBorders(cell, { right: edges.isRight ? SELECTION_BORDER : TRANSPARENT_BORDER });

    cell.setAttribute(SELECTED_ATTR, '');
    this.selectedCells.push(cell);
  }

  private applyTopEdge(cell: HTMLElement, isTop: boolean, rows: NodeListOf<Element>, r: number, c: number): void {
    if (!isTop) {
      return;
    }

    if (r === 0) {
      this.grid.style.borderTop = SELECTION_BORDER;

      return;
    }

    // Hide the cell-above's borderBottom and add borderTop on this cell
    const aboveCell = rows[r - 1]?.querySelectorAll(`[${CELL_ATTR}]`)[c] as HTMLElement | undefined;

    if (aboveCell) {
      this.saveBorder(aboveCell);
      setBorders(aboveCell, { bottom: TRANSPARENT_BORDER });
    }
    setBorders(cell, { top: SELECTION_BORDER });
  }

  private applyLeftEdge(cell: HTMLElement, isLeft: boolean, rowCells: NodeListOf<Element>, c: number): void {
    if (!isLeft) {
      return;
    }

    if (c === 0) {
      this.grid.style.borderLeft = SELECTION_BORDER;

      return;
    }

    // Hide left neighbor's borderRight and add borderLeft on this cell
    const leftCell = rowCells[c - 1] as HTMLElement | undefined;

    if (leftCell) {
      this.saveBorder(leftCell);
      setBorders(leftCell, { right: TRANSPARENT_BORDER });
    }
    setBorders(cell, { left: SELECTION_BORDER });
  }

  private paintSelection(): void {
    if (!this.anchorCell || !this.extentCell) {
      return;
    }

    // Restore previous selection state
    this.restoreModifiedCells();

    // Compute rectangle bounds
    const minRow = Math.min(this.anchorCell.row, this.extentCell.row);
    const maxRow = Math.max(this.anchorCell.row, this.extentCell.row);
    const minCol = Math.min(this.anchorCell.col, this.extentCell.col);
    const maxCol = Math.max(this.anchorCell.col, this.extentCell.col);

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    // Save grid borders before modifying
    this.savedGridBorders = {
      top: this.grid.style.borderTop,
      left: this.grid.style.borderLeft,
    };

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

        this.applyCellBorders(
          cell,
          { isTop: r === minRow, isBottom: r === maxRow, isLeft: c === minCol, isRight: c === maxCol },
          rows,
          cells,
          r,
          c,
        );
      }
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
