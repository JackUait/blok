import {
  IconInsertAbove,
  IconInsertBelow,
  IconInsertLeft,
  IconInsertRight,
  IconMenu,
  IconMoveDown,
  IconMoveLeft,
  IconMoveRight,
  IconMoveUp,
  IconTrash,
  IconHeading,
} from '../../components/icons';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';
import { twMerge } from '../../components/utils/tw';

import { ROW_ATTR } from './table-core';
import { getCumulativeColEdges, TableRowColDrag } from './table-row-col-drag';

import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const HIDE_DELAY_MS = 150;
const HOVER_ZONE_PX = 20;
const GRIP_SIZE = 28;
const GRIP_OFFSET = GRIP_SIZE / 2;

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
  wrapper: HTMLElement;
  grid: HTMLElement;
  getColumnCount: () => number;
  getRowCount: () => number;
  isHeadingRow: () => boolean;
  onAction: (action: RowColAction) => void;
}

const GRIP_CAPSULE_CLASSES = [
  'absolute',
  'z-[3]',
  'flex',
  'items-center',
  'justify-center',
  'rounded-lg',
  'cursor-grab',
  'select-none',
  'transition-all',
  'duration-150',
];

const GRIP_IDLE_CLASSES = [
  'bg-gray-200',
  'opacity-0',
];

const GRIP_VISIBLE_CLASSES = [
  'bg-white',
  'border',
  'border-gray-200',
  'shadow-sm',
  'opacity-100',
];

/**
 * Manages row and column grip handles with popover menus and drag-to-reorder.
 */
export class TableRowColControls {
  private wrapper: HTMLElement;
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

  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  private boundPointerDown: (e: PointerEvent) => void;

  constructor(options: TableRowColControlsOptions) {
    this.wrapper = options.wrapper;
    this.grid = options.grid;
    this.getColumnCount = options.getColumnCount;
    this.getRowCount = options.getRowCount;
    this.isHeadingRow = options.isHeadingRow;
    this.onAction = options.onAction;

    this.drag = new TableRowColDrag({
      grid: this.grid,
      onAction: this.onAction,
    });

    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseLeave = this.scheduleHideAll.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);

    this.createGrips();

    this.wrapper.addEventListener('mousemove', this.boundMouseMove);
    this.wrapper.addEventListener('mouseleave', this.boundMouseLeave);
  }

  /**
   * Recreate grips after structural changes (row/column add/delete/move)
   */
  public refresh(): void {
    this.destroyGrips();
    this.createGrips();
  }

  public destroy(): void {
    this.closePopover();
    this.drag.cleanup();
    this.wrapper.removeEventListener('mousemove', this.boundMouseMove);
    this.wrapper.removeEventListener('mouseleave', this.boundMouseLeave);
    this.clearHideTimeout();
    this.destroyGrips();
  }

  private createGrips(): void {
    const colCount = this.getColumnCount();
    const rowCount = this.getRowCount();

    Array.from({ length: colCount }).forEach((_, i) => {
      const grip = this.createGripElement('col', i);

      this.colGrips.push(grip);
      this.wrapper.appendChild(grip);
    });

    Array.from({ length: rowCount }).forEach((_, i) => {
      const grip = this.createGripElement('row', i);

      this.rowGrips.push(grip);
      this.wrapper.appendChild(grip);
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
    grip.innerHTML = IconMenu;
    grip.style.width = `${GRIP_SIZE}px`;
    grip.style.height = `${GRIP_SIZE}px`;
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

    const gridOffsetLeft = this.grid.offsetLeft;
    const gridOffsetTop = this.grid.offsetTop;

    this.colGrips.forEach((grip, i) => {
      if (i + 1 >= edges.length) {
        return;
      }

      const centerX = (edges[i] + edges[i + 1]) / 2;
      const el: HTMLElement = grip;

      el.style.top = `${gridOffsetTop - GRIP_SIZE - 4}px`;
      el.style.left = `${gridOffsetLeft + centerX - GRIP_OFFSET}px`;
    });

    this.rowGrips.forEach((grip, i) => {
      if (i >= rows.length) {
        return;
      }

      const rowEl = rows[i] as HTMLElement;
      const centerY = rowEl.offsetTop + rowEl.offsetHeight / 2;
      const el: HTMLElement = grip;

      el.style.left = `${gridOffsetLeft - GRIP_SIZE - 4}px`;
      el.style.top = `${gridOffsetTop + centerY - GRIP_OFFSET}px`;
    });
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.activePopover !== null) {
      return;
    }

    const gridRect = this.grid.getBoundingClientRect();
    const relativeY = e.clientY - gridRect.top;
    const relativeX = e.clientX - gridRect.left;

    this.clearHideTimeout();
    this.updateColGripVisibility(relativeX, relativeY);
    this.updateRowGripVisibility(relativeX, relativeY);
  }

  private updateColGripVisibility(relativeX: number, relativeY: number): void {
    const isNearTopEdge = relativeY < HOVER_ZONE_PX && relativeY >= -HOVER_ZONE_PX;

    if (!isNearTopEdge && this.activeColGripIndex >= 0) {
      this.hideColGrip();

      return;
    }

    if (!isNearTopEdge) {
      return;
    }

    const colIndex = this.getColumnIndexAtX(relativeX);

    if (colIndex >= 0 && colIndex < this.colGrips.length) {
      this.showColGrip(colIndex);
    }
  }

  private updateRowGripVisibility(relativeX: number, relativeY: number): void {
    const isNearLeftEdge = relativeX < HOVER_ZONE_PX && relativeX >= -HOVER_ZONE_PX;

    if (!isNearLeftEdge && this.activeRowGripIndex >= 0) {
      this.hideRowGrip();

      return;
    }

    if (!isNearLeftEdge) {
      return;
    }

    const rowIndex = this.getRowIndexAtY(relativeY);

    if (rowIndex >= 0 && rowIndex < this.rowGrips.length) {
      this.showRowGrip(rowIndex);
    }
  }

  private getColumnIndexAtX(relativeX: number): number {
    const edges = getCumulativeColEdges(this.grid);

    return edges.findIndex((edge, i) =>
      i + 1 < edges.length && relativeX >= edge && relativeX < edges[i + 1]
    );
  }

  private getRowIndexAtY(relativeY: number): number {
    const rows = Array.from(this.grid.querySelectorAll(`[${ROW_ATTR}]`));

    return rows.findIndex(row => {
      const rowEl = row as HTMLElement;

      return relativeY >= rowEl.offsetTop && relativeY < rowEl.offsetTop + rowEl.offsetHeight;
    });
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
    const el: HTMLElement = grip;

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_VISIBLE_CLASSES);
  }

  private applyIdleClasses(grip: HTMLElement): void {
    const el: HTMLElement = grip;

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
    });

    this.activePopover.on(PopoverEvent.ClosedOnActivate, () => {
      this.destroyPopover();
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
