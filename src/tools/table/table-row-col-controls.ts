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

import { BORDER_WIDTH, CELL_ATTR, ROW_ATTR } from './table-core';
import { collapseGrip, createGripDotsSvg, expandGrip, GRIP_HOVER_SIZE } from './table-grip-visuals';
import { createHeadingToggle } from './table-heading-toggle';
import { getCumulativeColEdges, TableRowColDrag } from './table-row-col-drag';

import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const HIDE_DELAY_MS = 150;
const COL_PILL_WIDTH = 24;
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
  onGripClick?: (type: 'row' | 'col', index: number) => void;
  onGripPopoverClose?: () => void;
}

const GRIP_CAPSULE_CLASSES = [
  'absolute',
  'z-[3]',
  'rounded',
  'cursor-grab',
  'select-none',
  'transition-[opacity,background-color,width,height]',
  'duration-150',
  'group',
  'flex',
  'items-center',
  'justify-center',
  'overflow-hidden',
];

const GRIP_IDLE_CLASSES = [
  'bg-gray-300',
  'opacity-0',
  'pointer-events-none',
];

const GRIP_VISIBLE_CLASSES = [
  'bg-gray-300',
  'opacity-100',
  'pointer-events-auto',
];

const GRIP_ACTIVE_CLASSES = [
  'bg-blue-500',
  'text-white',
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
  private onGripClick: ((type: 'row' | 'col', index: number) => void) | undefined;
  private onGripPopoverClose: (() => void) | undefined;

  private colGrips: HTMLElement[] = [];
  private rowGrips: HTMLElement[] = [];
  private activePopover: PopoverDesktop | null = null;
  private activePopoverGrip: HTMLElement | null = null;
  private lockedGrip: HTMLElement | null = null;
  private boundUnlockGrip: (e: PointerEvent) => void;
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
    this.onGripClick = options.onGripClick;
    this.onGripPopoverClose = options.onGripPopoverClose;

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
    this.boundUnlockGrip = this.handleUnlockGrip.bind(this);

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

  /**
   * Set a specific grip to active (blue) state without opening the popover.
   * Hides all other grips.
   */
  public setActiveGrip(type: 'row' | 'col', index: number): void {
    const grip = type === 'col'
      ? this.colGrips[index]
      : this.rowGrips[index];

    if (!grip) {
      return;
    }

    this.unlockGrip();
    this.hideAllGripsExcept(grip);
    this.applyActiveClasses(grip);

    if (type === 'col') {
      grip.style.height = `${GRIP_HOVER_SIZE}px`;
    } else {
      grip.style.width = `${GRIP_HOVER_SIZE}px`;
    }

    this.lockedGrip = grip;

    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', this.boundUnlockGrip);
    });
  }

  private handleUnlockGrip(): void {
    document.removeEventListener('pointerdown', this.boundUnlockGrip);

    if (this.lockedGrip) {
      this.applyIdleClasses(this.lockedGrip);
      this.lockedGrip = null;
    }
  }

  private unlockGrip(): void {
    document.removeEventListener('pointerdown', this.boundUnlockGrip);
    this.lockedGrip = null;
  }

  public destroy(): void {
    this.destroyPopover();
    this.unlockGrip();
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

    // Padding expands hit area but background-clip keeps visual size at 4px
    const HIT_AREA_PADDING = 12;
    const pillSize = type === 'col' ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;
    const idleWidth = type === 'col' ? COL_PILL_WIDTH : ROW_PILL_WIDTH;
    const idleHeight = type === 'col' ? COL_PILL_HEIGHT : ROW_PILL_HEIGHT;

    grip.style.width = `${idleWidth}px`;
    grip.style.height = `${idleHeight}px`;
    grip.style.transform = 'translate(-50%, -50%)';
    grip.style.boxShadow = 'inset 0 0 0 2px white';
    grip.style.boxSizing = 'content-box';
    grip.style.backgroundClip = 'content-box';

    // Expand hit area for row grips (4px → 16px)
    if (type === 'row') {
      grip.style.paddingLeft = '6px';
      grip.style.paddingRight = '6px';
      grip.style.marginLeft = '-6px';
      grip.style.marginRight = '-6px';
    }

    // Expand hit area for col grips (4px → 16px)
    if (type === 'col') {
      grip.style.paddingTop = '6px';
      grip.style.paddingBottom = '6px';
      grip.style.marginTop = '-6px';
      grip.style.marginBottom = '-6px';
    }

    grip.appendChild(createGripDotsSvg(type === 'col' ? 'horizontal' : 'vertical'));

    grip.addEventListener('pointerdown', this.boundPointerDown);
    grip.addEventListener('mouseenter', () => {
      if (!this.isGripInteractionLocked()) {
        expandGrip(grip, type);
      }
    });
    grip.addEventListener('mouseleave', () => {
      if (!this.isGripInteractionLocked()) {
        collapseGrip(grip, type, pillSize);
      }
    });

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

      style.top = `${-BORDER_WIDTH / 2}px`;
      style.left = `${centerX}px`;
    });

    this.rowGrips.forEach((grip, i) => {
      if (i >= rows.length) {
        return;
      }

      const rowEl = rows[i] as HTMLElement;
      const centerY = rowEl.offsetTop + rowEl.offsetHeight / 2;
      const style = grip.style;

      style.left = `${-BORDER_WIDTH / 2}px`;
      style.top = `${centerY}px`;
    });
  }

  private isGripInteractionLocked(): boolean {
    return this.activePopover !== null || this.lockedGrip !== null;
  }

  private handleMouseOver(e: MouseEvent): void {
    if (this.isGripInteractionLocked()) {
      return;
    }

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
    if (this.isGripInteractionLocked()) {
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
   * Preserves visibility of the grip with an active popover.
   */
  public setGripsDisplay(visible: boolean): void {
    const display = visible ? '' : 'none';

    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      const el: HTMLElement = grip;

      // Don't hide the grip that has an active popover
      if (!visible && grip === this.activePopoverGrip) {
        return;
      }

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
    const isCol = el.hasAttribute(GRIP_COL_ATTR);
    const type: 'col' | 'row' = isCol ? 'col' : 'row';
    const pillSize = isCol ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;

    // Reset to pill size before making visible
    collapseGrip(el, type, pillSize);

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_VISIBLE_CLASSES);
    el.setAttribute('data-blok-table-grip-visible', '');

    const svg = el.querySelector('svg');

    if (svg) {
      svg.classList.remove('text-white');
      svg.classList.add('text-gray-400');
    }
  }

  private applyActiveClasses(grip: HTMLElement): void {
    grip.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_ACTIVE_CLASSES);
    grip.setAttribute('data-blok-table-grip-visible', '');

    const svg = grip.querySelector('svg');

    if (svg) {
      svg.classList.remove('text-gray-400', 'opacity-0');
      svg.classList.add('text-white', 'opacity-100');
    }
  }

  private hideAllGripsExcept(activeGrip: HTMLElement): void {
    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      if (grip !== activeGrip) {
        this.applyIdleClasses(grip);
      }
    });
  }

  private applyIdleClasses(grip: HTMLElement): void {
    const el = grip;
    const isCol = el.hasAttribute(GRIP_COL_ATTR);
    const type: 'col' | 'row' = isCol ? 'col' : 'row';
    // With border-box, pillSize must account for the 12px padding (6px each side)
    const HIT_AREA_PADDING = 12;
    const pillSize = isCol ? (COL_PILL_HEIGHT + HIT_AREA_PADDING) : (ROW_PILL_WIDTH + HIT_AREA_PADDING);

    collapseGrip(el, type, pillSize);
    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    el.removeAttribute('data-blok-table-grip-visible');
  }

  private handleDragStateChange(isDragging: boolean, _dragType: 'row' | 'col' | null): void {
    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      const el: HTMLElement = grip;

      el.style.display = isDragging ? 'none' : '';
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

    // Track which grip has the popover so setGripsDisplay won't hide it
    this.activePopoverGrip = grip;

    this.activePopover.on(PopoverEvent.Closed, () => {
      // Guard against re-entrant calls: destroyPopover() calls popover.destroy()
      // which calls hide() and re-emits Closed. Skip the re-entrant invocation.
      if (this.activePopover === null) {
        return;
      }

      this.destroyPopover();
      this.applyVisibleClasses(grip);
      this.scheduleHideAll();
      this.onGripPopoverClose?.();
    });

    // Hide all other grips and make the active one blue
    this.hideAllGripsExcept(grip);
    this.applyActiveClasses(grip);

    // Expand the grip to hover size so it remains visible while popover is open
    if (type === 'col') {
      grip.style.height = `${GRIP_HOVER_SIZE}px`;
    } else {
      grip.style.width = `${GRIP_HOVER_SIZE}px`;
    }

    this.activePopover.show();
    this.onGripClick?.(type, index);
  }

  private destroyPopover(): void {
    if (this.activePopover !== null) {
      const popover = this.activePopover;

      this.activePopover = null;
      this.activePopoverGrip = null;
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

    const canDelete = this.getColumnCount() > 1;
    const deleteItems: PopoverItemParams[] = [
      { type: PopoverItemType.Separator },
      {
        icon: IconTrash,
        title: 'Delete',
        isDestructive: true,
        isDisabled: !canDelete,
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

    const canDelete = this.getRowCount() > 1;
    const deleteItems: PopoverItemParams[] = [
      { type: PopoverItemType.Separator },
      {
        icon: IconTrash,
        title: 'Delete',
        isDestructive: true,
        isDisabled: !canDelete,
        closeOnActivate: true,
        onActivate: (): void => {
          this.onAction({ type: 'delete-row', index: rowIndex });
        },
      },
    ];

    return [...headingItems, ...baseItems, ...deleteItems];
  }
}
