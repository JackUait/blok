import { copyGhostRadius, mountGhost } from './copy-ghost-radius';
import { DatabaseDropLine } from './database-drop-line';

const DRAG_THRESHOLD = 10;

export interface ListRowDragResult {
  rowId: string;
  beforeRowId: string | null;
  afterRowId: string | null;
}

export interface ListRowDragOptions {
  wrapper: HTMLElement;
  onDrop: (result: ListRowDragResult) => void;
}

/**
 * Handles pointer-based drag-and-drop for list rows.
 * Supports vertical-only movement for reordering rows within a list.
 */
export class DatabaseListRowDrag {
  private readonly wrapper: HTMLElement;
  private readonly onDrop: (result: ListRowDragResult) => void;

  private isDragging = false;
  private rowId = '';
  private startX = 0;
  private startY = 0;
  private ghostEl: HTMLElement | null = null;
  private sourceRow: HTMLElement | null = null;
  private ghostOffsetY = 0;
  private ghostOffsetX = 0;
  /** Where a fixed ghost at 0,0 lands: not the viewport corner inside a transformed ancestor. */
  private ghostOrigin = { x: 0, y: 0 };
  private readonly dropLine: DatabaseDropLine;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: ListRowDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;
    this.dropLine = new DatabaseDropLine(options.wrapper);

    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Start tracking pointer after a pointerdown on a list row.
   */
  public beginTracking(rowId: string, startX: number, startY: number): void {
    this.cleanup();
    this.rowId = rowId;
    this.startX = startX;
    this.startY = startY;
    this.isDragging = false;
    this.sourceRow = this.wrapper.querySelector(`[data-row-id="${rowId}"]`);

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    document.addEventListener('pointercancel', this.boundPointerCancel);
    document.addEventListener('keydown', this.boundKeyDown);
  }

  public cleanup(): void {
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerCancel);
    document.removeEventListener('keydown', this.boundKeyDown);

    this.ghostEl?.remove();
    this.ghostEl = null;

    this.dropLine.hide();

    if (this.sourceRow) {
      this.sourceRow.removeAttribute('data-blok-database-drag-source');
      this.sourceRow = null;
    }

    this.isDragging = false;
    this.rowId = '';
    this.ghostOffsetY = 0;
    this.ghostOffsetX = 0;
    this.ghostOrigin = { x: 0, y: 0 };
  }

  /** True while a drag has passed the threshold and not yet dropped. */
  public get active(): boolean {
    return this.isDragging;
  }

  public destroy(): void {
    this.cleanup();
    this.dropLine.destroy();
  }

  private handlePointerMove(e: PointerEvent): void {
    const dy = Math.abs(e.clientY - this.startY);

    if (!this.isDragging && dy > DRAG_THRESHOLD) {
      this.isDragging = true;
      this.startActiveDrag(e);
    }

    if (this.isDragging) {
      this.updateGhostPosition(e);
      this.updateDropIndicator(e);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.isDragging) {
      this.commitDrop(e);
    }

    this.cleanup();
  }

  private handlePointerCancel(): void {
    this.cleanup();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  private startActiveDrag(e: PointerEvent): void {
    if (this.sourceRow) {
      const rect = this.sourceRow.getBoundingClientRect();

      this.ghostOffsetY = this.startY - rect.top;
      this.ghostOffsetX = this.startX - rect.left;
      this.sourceRow.setAttribute('data-blok-database-drag-source', '');
    }

    this.createGhost(e);
  }

  private createGhost(e: PointerEvent): void {
    const ghost = document.createElement('div');

    ghost.setAttribute('data-blok-database-ghost', '');
    ghost.setAttribute('contenteditable', 'false');

    const style = ghost.style;

    style.position = 'fixed';
    style.pointerEvents = 'none';
    style.opacity = '0.4';
    style.zIndex = '50';
    style.overflow = 'hidden';

    if (this.sourceRow) {
      const clone = this.sourceRow.cloneNode(true) as HTMLElement;

      clone.removeAttribute('data-blok-database-drag-source');
      ghost.appendChild(clone);

      copyGhostRadius(this.sourceRow, ghost);

      style.width = `${this.sourceRow.getBoundingClientRect().width}px`;
    }
    style.left = '0px';
    style.top = '0px';
    mountGhost(this.sourceRow ?? this.wrapper, ghost);
    const origin = ghost.getBoundingClientRect();

    this.ghostOrigin = { x: origin.left, y: origin.top };
    this.ghostEl = ghost;
    this.updateGhostPosition(e);
  }

  /** findings-listgallery L21: the row copy follows the pointer on both axes, as Notion's does. */
  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl) {
      return;
    }

    this.ghostEl.style.left = `${e.clientX - this.ghostOffsetX - this.ghostOrigin.x}px`;
    this.ghostEl.style.top = `${e.clientY - this.ghostOffsetY - this.ghostOrigin.y}px`;
  }

  private updateDropIndicator(e: PointerEvent): void {
    const beforeEl = this.getDropPosition(e.clientY).beforeEl;
    // The source row stays in place, so it counts as a neighbour for the line.
    const visible = Array.from(this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]'));

    if (beforeEl instanceof HTMLElement) {
      const rect = beforeEl.getBoundingClientRect();
      const above = visible[visible.indexOf(beforeEl) - 1];
      const centerY = above === undefined ? rect.top : (above.getBoundingClientRect().bottom + rect.top) / 2;

      this.dropLine.showHorizontal({ left: rect.left, centerY, width: rect.width });

      return;
    }

    const last = visible.at(-1);

    if (last === undefined) {
      this.dropLine.hide();

      return;
    }

    const rect = last.getBoundingClientRect();

    this.dropLine.showHorizontal({ left: rect.left, centerY: rect.bottom, width: rect.width });
  }

  private getDropPosition(clientY: number): { beforeEl: Element | null } {
    const rows = Array.from(
      this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]')
    ).filter((row) => row.getAttribute('data-row-id') !== this.rowId);

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        return { beforeEl: row };
      }
    }

    return { beforeEl: null };
  }

  private commitDrop(e: PointerEvent): void {
    const position = this.getDropPosition(e.clientY);
    const rows = Array.from(
      this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]')
    ).filter((row) => row.getAttribute('data-row-id') !== this.rowId);

    const beforeRowId: string | null = position.beforeEl
      ? position.beforeEl.getAttribute('data-row-id')
      : null;

    const beforeIndex = position.beforeEl ? rows.indexOf(position.beforeEl as HTMLElement) : -1;

    const afterRowId = this.resolveAfterRowId(position.beforeEl, rows, beforeIndex);

    this.onDrop({ rowId: this.rowId, beforeRowId, afterRowId });
  }

  private resolveAfterRowId(
    beforeEl: Element | null,
    rows: HTMLElement[],
    beforeIndex: number
  ): string | null {
    if (beforeEl) {
      return beforeIndex > 0 ? rows[beforeIndex - 1].getAttribute('data-row-id') : null;
    }

    return rows.length > 0 ? rows[rows.length - 1].getAttribute('data-row-id') : null;
  }
}
