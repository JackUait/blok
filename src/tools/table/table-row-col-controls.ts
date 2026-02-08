import {
  IconInsertAbove,
  IconInsertBelow,
  IconInsertLeft,
  IconInsertRight,
  IconTrash,
  IconHeaderRow,
  IconHeaderColumn,
} from '../../components/icons';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';
import { twMerge } from '../../components/utils/tw';

import { CELL_ATTR, ROW_ATTR } from './table-core';
import { createHeadingToggle } from './table-heading-toggle';
import { getCumulativeColEdges, TableRowColDrag } from './table-row-col-drag';

import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const HIDE_DELAY_MS = 150;
const COL_PILL_WIDTH = 32;
const COL_PILL_HEIGHT = 4;
const ROW_PILL_WIDTH = 4;
const ROW_PILL_HEIGHT = 20;

/**
 * Actions that can be performed on rows/columns
 */
export type RowColAction =
  | { type: 'insert-row-above'; index: number }
  | { type: 'insert-row-below'; index: number }
  | { type: 'insert-col-left'; index: number }
  | { type: 'insert-col-right'; index: number }
  | { type: 'move-row'; fromIndex: number; toIndex: number }
  | { type: 'move-col'; fromIndex: number; toIndex: number }
  | { type: 'delete-row'; index: number }
  | { type: 'delete-col'; index: number }
  | { type: 'toggle-heading' }
  | { type: 'toggle-heading-column' };

export interface TableRowColControlsOptions {
  grid: HTMLElement;
  getColumnCount: () => number;
  getRowCount: () => number;
  isHeadingRow: () => boolean;
  isHeadingColumn: () => boolean;
  onAction: (action: RowColAction) => void;
  onDragStateChange?: (isDragging: boolean, dragType: 'row' | 'col' | null) => void;
}

const GRIP_CAPSULE_CLASSES = [
  'absolute',
  'z-[3]',
  'rounded-full',
  'cursor-grab',
  'select-none',
  'transition-[opacity,background-color]',
  'duration-150',
];

const GRIP_IDLE_CLASSES = [
  'bg-gray-300',
  'opacity-0',
  'pointer-events-none',
];

const GRIP_VISIBLE_CLASSES = [
  'bg-gray-300',
  'hover:bg-gray-400',
  'opacity-100',
  'pointer-events-auto',
];

/**
 * Manages row and column grip handles with popover menus and drag-to-reorder.
 */
export class TableRowColControls {
  private grid: HTMLElement;
  private getColumnCount: () => number;
  private getRowCount: () => number;
  private isHeadingRow: () => boolean;
  private isHeadingColumn: () => boolean;
  private onAction: (action: RowColAction) => void;

  private colGrips: HTMLElement[] = [];
  private rowGrips: HTMLElement[] = [];
  private activePopover: PopoverDesktop | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeColGripIndex = -1;
  private activeRowGripIndex = -1;

  private drag: TableRowColDrag;

  private boundMouseOver: (e: MouseEvent) => void;
  private boundMouseLeave: (e: MouseEvent) => void;
  private boundPointerDown: (e: PointerEvent) => void;

  constructor(options: TableRowColControlsOptions) {
    this.grid = options.grid;
    this.getColumnCount = options.getColumnCount;
    this.getRowCount = options.getRowCount;
    this.isHeadingRow = options.isHeadingRow;
    this.isHeadingColumn = options.isHeadingColumn;
    this.onAction = options.onAction;

    this.drag = new TableRowColDrag({
      grid: this.grid,
      onAction: this.onAction,
      onDragStateChange: (isDragging, dragType) => {
        this.handleDragStateChange(isDragging, dragType);
        options.onDragStateChange?.(isDragging, dragType);
      },
    });

    this.boundMouseOver = this.handleMouseOver.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);

    this.createGrips();

    this.grid.addEventListener('mouseover', this.boundMouseOver);
    this.grid.addEventListener('mouseleave', this.boundMouseLeave);
  }

  /**
   * Recreate grips after structural changes (row/column add/delete/move)
   */
  public refresh(): void {
    this.destroyGrips();
    this.createGrips();
  }

  public destroy(): void {
    this.destroyPopover();
    this.drag.cleanup();
    this.grid.removeEventListener('mouseover', this.boundMouseOver);
    this.grid.removeEventListener('mouseleave', this.boundMouseLeave);
    this.clearHideTimeout();
    this.destroyGrips();
  }

  private createGrips(): void {
    const colCount = this.getColumnCount();
    const rowCount = this.getRowCount();

    Array.from({ length: colCount }).forEach((_, i) => {
      const grip = this.createGripElement('col', i);

      this.colGrips.push(grip);
      this.grid.appendChild(grip);
    });

    Array.from({ length: rowCount }).forEach((_, i) => {
      const grip = this.createGripElement('row', i);

      this.rowGrips.push(grip);
      this.grid.appendChild(grip);
    });

    this.positionGrips();
  }

  private destroyGrips(): void {
    this.colGrips.forEach(g => g.remove());
    this.rowGrips.forEach(g => g.remove());
    this.colGrips = [];
    this.rowGrips = [];
    this.activeColGripIndex = -1;
    this.activeRowGripIndex = -1;
  }

  private createGripElement(type: 'row' | 'col', index: number): HTMLElement {
    const grip = document.createElement('div');

    grip.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    grip.setAttribute(GRIP_ATTR, '');
    grip.setAttribute(type === 'col' ? GRIP_COL_ATTR : GRIP_ROW_ATTR, String(index));
    grip.setAttribute('contenteditable', 'false');

    if (type === 'col') {
      grip.style.width = `${COL_PILL_WIDTH}px`;
      grip.style.height = `${COL_PILL_HEIGHT}px`;
    } else {
      grip.style.width = `${ROW_PILL_WIDTH}px`;
      grip.style.height = `${ROW_PILL_HEIGHT}px`;
    }

    grip.addEventListener('pointerdown', this.boundPointerDown);

    return grip;
  }

  /**
   * Reposition grips to match current row/column layout.
   * Called after resize or structural changes.
   */
  public positionGrips(): void {
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const firstRow = rows[0];

    if (!firstRow) {
      return;
    }

    const edges = getCumulativeColEdges(this.grid);

    this.colGrips.forEach((grip, i) => {
      if (i + 1 >= edges.length) {
        return;
      }

      const centerX = (edges[i] + edges[i + 1]) / 2;
      const style = grip.style;

      style.top = `${-(COL_PILL_HEIGHT / 2)}px`;
      style.left = `${centerX - COL_PILL_WIDTH / 2}px`;
    });

    this.rowGrips.forEach((grip, i) => {
      if (i >= rows.length) {
        return;
      }

      const rowEl = rows[i] as HTMLElement;
      const centerY = rowEl.offsetTop + rowEl.offsetHeight / 2;
      const style = grip.style;

      style.left = `${-(ROW_PILL_WIDTH / 2)}px`;
      style.top = `${centerY - ROW_PILL_HEIGHT / 2}px`;
    });
  }

  private handleMouseOver(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return;
    }

    this.clearHideTimeout();

    const position = this.getCellPosition(cell);

    if (!position) {
      return;
    }

    this.showColGrip(position.col);
    this.showRowGrip(position.row);
  }

  private handleMouseLeave(): void {
    if (this.activePopover !== null) {
      return;
    }

    this.scheduleHideAll();
  }

  private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
    const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

    if (!row) {
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

  /**
   * Show or hide all grip elements by toggling display.
   * Used to hide grips during add-button drag operations.
   */
  public setGripsDisplay(visible: boolean): void {
    const display = visible ? '' : 'none';

    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      const el: HTMLElement = grip;

      el.style.display = display;
    });
  }

  /**
   * Immediately hide all grips (no delay). Used when resize drag starts.
   */
  public hideAllGrips(): void {
    this.clearHideTimeout();
    this.hideColGrip();
    this.hideRowGrip();
  }

  private showColGrip(index: number): void {
    if (this.activeColGripIndex === index) {
      return;
    }

    this.hideColGrip();
    this.activeColGripIndex = index;
    this.applyVisibleClasses(this.colGrips[index]);
  }

  private hideColGrip(): void {
    if (this.activeColGripIndex >= 0 && this.activeColGripIndex < this.colGrips.length) {
      this.applyIdleClasses(this.colGrips[this.activeColGripIndex]);
    }

    this.activeColGripIndex = -1;
  }

  private showRowGrip(index: number): void {
    if (this.activeRowGripIndex === index) {
      return;
    }

    this.hideRowGrip();
    this.activeRowGripIndex = index;
    this.applyVisibleClasses(this.rowGrips[index]);
  }

  private hideRowGrip(): void {
    if (this.activeRowGripIndex >= 0 && this.activeRowGripIndex < this.rowGrips.length) {
      this.applyIdleClasses(this.rowGrips[this.activeRowGripIndex]);
    }

    this.activeRowGripIndex = -1;
  }

  private applyVisibleClasses(grip: HTMLElement): void {
    const el = grip;

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_VISIBLE_CLASSES);
    el.setAttribute('data-blok-table-grip-visible', '');
  }

  private applyIdleClasses(grip: HTMLElement): void {
    const el = grip;

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    el.removeAttribute('data-blok-table-grip-visible');
  }

  private handleDragStateChange(isDragging: boolean, dragType: 'row' | 'col' | null): void {
    if (isDragging) {
      const gripsToHide = dragType === 'row' ? this.colGrips : this.rowGrips;

      gripsToHide.forEach(grip => {
        const el: HTMLElement = grip;

        el.style.display = 'none';
      });

      return;
    }

    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      const el: HTMLElement = grip;

      el.style.display = '';
    });
  }

  private scheduleHideAll(): void {
    this.hideTimeout = setTimeout(() => {
      this.hideColGrip();
      this.hideRowGrip();
      this.hideTimeout = null;
    }, HIDE_DELAY_MS);
  }

  private clearHideTimeout(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  // ── Click / Drag discrimination ──────────────────────────────

  private handlePointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const grip = target.closest<HTMLElement>(`[${GRIP_ATTR}]`);

    if (!grip) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const detected = this.detectGripType(grip);

    if (!detected) {
      return;
    }

    void this.drag
      .beginTracking(detected.type, detected.index, e.clientX, e.clientY)
      .then(wasDrag => {
        if (!wasDrag) {
          this.openPopover(detected.type, detected.index);
        }
      });
  }

  private detectGripType(grip: HTMLElement): { type: 'row' | 'col'; index: number } | null {
    const colStr = grip.getAttribute(GRIP_COL_ATTR);

    if (colStr !== null) {
      return { type: 'col', index: Number(colStr) };
    }

    const rowStr = grip.getAttribute(GRIP_ROW_ATTR);

    if (rowStr !== null) {
      return { type: 'row', index: Number(rowStr) };
    }

    return null;
  }

  // ── Popover menus ────────────────────────────────────────────

  private openPopover(type: 'row' | 'col', index: number): void {
    this.destroyPopover();
    this.clearHideTimeout();

    const grip = type === 'col'
      ? this.colGrips[index]
      : this.rowGrips[index];

    if (!grip) {
      return;
    }

    const items = type === 'col'
      ? this.buildColumnMenu(index)
      : this.buildRowMenu(index);

    this.activePopover = new PopoverDesktop({
      items,
      trigger: grip,
      flippable: true,
    });

    this.activePopover.on(PopoverEvent.Closed, () => {
      this.destroyPopover();
      this.scheduleHideAll();
    });

    this.activePopover.show();
  }

  private destroyPopover(): void {
    if (this.activePopover !== null) {
      const popover = this.activePopover;

      this.activePopover = null;
      popover.destroy();
    }
  }

  private buildColumnMenu(colIndex: number): PopoverItemParams[] {
    const headingItems: PopoverItemParams[] = colIndex === 0
      ? [
        {
          type: PopoverItemType.Html,
          element: createHeadingToggle({
            icon: IconHeaderColumn,
            label: 'Header column',
            isActive: this.isHeadingColumn(),
            onToggle: () => {
              this.onAction({ type: 'toggle-heading-column' });
            },
          }),
        },
        { type: PopoverItemType.Separator },
      ]
      : [];

    const baseItems: PopoverItemParams[] = [
      {
        icon: IconInsertLeft,
        title: 'Insert Column Left',
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'insert-col-left', index: colIndex });
        },
      },
      {
        icon: IconInsertRight,
        title: 'Insert Column Right',
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'insert-col-right', index: colIndex });
        },
      },
    ];

    const deleteItems: PopoverItemParams[] = [
      { type: PopoverItemType.Separator },
      {
        icon: IconTrash,
        title: 'Delete',
        isDestructive: true,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'delete-col', index: colIndex });
        },
      },
    ];

    return [...headingItems, ...baseItems, ...deleteItems];
  }

  private buildRowMenu(rowIndex: number): PopoverItemParams[] {
    const headingItems: PopoverItemParams[] = rowIndex === 0
      ? [
        {
          type: PopoverItemType.Html,
          element: createHeadingToggle({
            icon: IconHeaderRow,
            label: 'Header row',
            isActive: this.isHeadingRow(),
            onToggle: () => {
              this.onAction({ type: 'toggle-heading' });
            },
          }),
        },
        { type: PopoverItemType.Separator },
      ]
      : [];

    const baseItems: PopoverItemParams[] = [
      {
        icon: IconInsertAbove,
        title: 'Insert Row Above',
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'insert-row-above', index: rowIndex });
        },
      },
      {
        icon: IconInsertBelow,
        title: 'Insert Row Below',
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'insert-row-below', index: rowIndex });
        },
      },
    ];

    const deleteItems: PopoverItemParams[] = [
      { type: PopoverItemType.Separator },
      {
        icon: IconTrash,
        title: 'Delete',
        isDestructive: true,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'delete-row', index: rowIndex });
        },
      },
    ];

    return [...headingItems, ...baseItems, ...deleteItems];
  }
}
