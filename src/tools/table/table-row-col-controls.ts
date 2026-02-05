import {
  IconInsertAbove,
  IconInsertBelow,
  IconInsertLeft,
  IconInsertRight,
  IconMoveDown,
  IconMoveLeft,
  IconMoveRight,
  IconMoveUp,
  IconTrash,
  IconHeading,
} from '../../components/icons';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';
import { twMerge } from '../../components/utils/tw';

import { CELL_ATTR, ROW_ATTR } from './table-core';
import { getCumulativeColEdges, TableRowColDrag } from './table-row-col-drag';

import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const HIDE_DELAY_MS = 150;
const COL_PILL_WIDTH = 40;
const COL_PILL_HEIGHT = 6;
const ROW_PILL_WIDTH = 6;
const ROW_PILL_HEIGHT = 24;

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
  | { type: 'toggle-heading' };

export interface TableRowColControlsOptions {
  grid: HTMLElement;
  getColumnCount: () => number;
  getRowCount: () => number;
  isHeadingRow: () => boolean;
  onAction: (action: RowColAction) => void;
}

const GRIP_CAPSULE_CLASSES = [
  'absolute',
  'z-[3]',
  'rounded-full',
  'cursor-grab',
  'select-none',
  'transition-opacity',
  'duration-150',
];

const GRIP_IDLE_CLASSES = [
  'bg-gray-300',
  'opacity-0',
];

const GRIP_VISIBLE_CLASSES = [
  'bg-gray-400',
  'opacity-100',
];

/**
 * Manages row and column grip handles with popover menus and drag-to-reorder.
 */
export class TableRowColControls {
  private grid: HTMLElement;
  private getColumnCount: () => number;
  private getRowCount: () => number;
  private isHeadingRow: () => boolean;
  private onAction: (action: RowColAction) => void;

  private colGrips: HTMLElement[] = [];
  private rowGrips: HTMLElement[] = [];
  private activePopover: PopoverDesktop | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeColGripIndex = -1;
  private activeRowGripIndex = -1;

  private drag: TableRowColDrag;

  private boundFocusIn: (e: FocusEvent) => void;
  private boundFocusOut: (e: FocusEvent) => void;
  private boundPointerDown: (e: PointerEvent) => void;

  constructor(options: TableRowColControlsOptions) {
    this.grid = options.grid;
    this.getColumnCount = options.getColumnCount;
    this.getRowCount = options.getRowCount;
    this.isHeadingRow = options.isHeadingRow;
    this.onAction = options.onAction;

    this.drag = new TableRowColDrag({
      grid: this.grid,
      onAction: this.onAction,
    });

    this.boundFocusIn = this.handleFocusIn.bind(this);
    this.boundFocusOut = this.handleFocusOut.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);

    this.createGrips();

    this.grid.addEventListener('focusin', this.boundFocusIn);
    this.grid.addEventListener('focusout', this.boundFocusOut);
  }

  /**
   * Recreate grips after structural changes (row/column add/delete/move)
   */
  public refresh(): void {
    this.destroyGrips();
    this.createGrips();
    this.showGripsForFocusedCell();
  }

  public destroy(): void {
    this.closePopover();
    this.drag.cleanup();
    this.grid.removeEventListener('focusin', this.boundFocusIn);
    this.grid.removeEventListener('focusout', this.boundFocusOut);
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
   * Position grips relative to their row/column
   */
  private positionGrips(): void {
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

  private handleFocusIn(e: FocusEvent): void {
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

  private handleFocusOut(_e: FocusEvent): void {
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

  private showGripsForFocusedCell(): void {
    const focused = this.grid.querySelector<HTMLElement>(`[${CELL_ATTR}]:focus`);

    if (!focused) {
      return;
    }

    const position = this.getCellPosition(focused);

    if (!position) {
      return;
    }

    this.showColGrip(position.col);
    this.showRowGrip(position.row);
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
  }

  private applyIdleClasses(grip: HTMLElement): void {
    const el = grip;

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
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
    this.closePopover();

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

    this.activePopover.on(PopoverEvent.ClosedOnActivate, () => {
      this.destroyPopover();
      this.scheduleHideAll();
    });

    this.activePopover.show();
  }

  private closePopover(): void {
    if (this.activePopover !== null) {
      this.activePopover.hide();
      this.destroyPopover();
    }
  }

  private destroyPopover(): void {
    if (this.activePopover !== null) {
      this.activePopover.destroy();
      this.activePopover = null;
    }
  }

  private buildColumnMenu(colIndex: number): PopoverItemParams[] {
    const colCount = this.getColumnCount();

    return [
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
      { type: PopoverItemType.Separator },
      {
        icon: IconMoveLeft,
        title: 'Move Column Left',
        isDisabled: colIndex === 0,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'move-col', fromIndex: colIndex, toIndex: colIndex - 1 });
        },
      },
      {
        icon: IconMoveRight,
        title: 'Move Column Right',
        isDisabled: colIndex >= colCount - 1,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'move-col', fromIndex: colIndex, toIndex: colIndex + 1 });
        },
      },
      { type: PopoverItemType.Separator },
      {
        icon: IconTrash,
        title: 'Delete Column',
        confirmation: {
          title: 'Click to confirm',
          icon: IconTrash,
          onActivate: (): void => {
            this.onAction({ type: 'delete-col', index: colIndex });
          },
        },
      },
    ];
  }

  private buildRowMenu(rowIndex: number): PopoverItemParams[] {
    const rowCount = this.getRowCount();
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
      { type: PopoverItemType.Separator },
      {
        icon: IconMoveUp,
        title: 'Move Row Up',
        isDisabled: rowIndex === 0,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'move-row', fromIndex: rowIndex, toIndex: rowIndex - 1 });
        },
      },
      {
        icon: IconMoveDown,
        title: 'Move Row Down',
        isDisabled: rowIndex >= rowCount - 1,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'move-row', fromIndex: rowIndex, toIndex: rowIndex + 1 });
        },
      },
    ];

    const headingItems: PopoverItemParams[] = rowIndex === 0
      ? [
        { type: PopoverItemType.Separator },
        {
          icon: IconHeading,
          title: 'Set as Heading',
          isActive: this.isHeadingRow(),
          toggle: true,
          closeOnActivate: true,
          onActivate: (): void => {
            this.onAction({ type: 'toggle-heading' });
          },
        },
      ]
      : [];

    const deleteItems: PopoverItemParams[] = [
      { type: PopoverItemType.Separator },
      {
        icon: IconTrash,
        title: 'Delete Row',
        confirmation: {
          title: 'Click to confirm',
          icon: IconTrash,
          onActivate: (): void => {
            this.onAction({ type: 'delete-row', index: rowIndex });
          },
        },
      },
    ];

    return [...baseItems, ...headingItems, ...deleteItems];
  }
}
