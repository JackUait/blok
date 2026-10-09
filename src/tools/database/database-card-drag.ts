import { copyGhostRadius } from './copy-ghost-radius';
import { DatabaseDropLine } from './database-drop-line';

const DRAG_THRESHOLD = 10;

/** Half the 8px gap between cards, so the line sits in the gap. */
const HALF_GAP = 4;

export interface CardDragResult {
  rowId: string;
  toOptionId: string;
  /** The sub-group lane dropped in, on a sub-grouped board. */
  toSubGroup?: string;
  beforeRowId: string | null;
  afterRowId: string | null;
}

export interface CardDragOptions {
  wrapper: HTMLElement;
  onDrop: (result: CardDragResult) => void;
}

/**
 * Handles pointer-based drag-and-drop for kanban cards.
 * Supports 2D movement: across columns (horizontal) and within columns (vertical).
 */
export class DatabaseCardDrag {
  private readonly wrapper: HTMLElement;
  private readonly onDrop: (result: CardDragResult) => void;

  private isDragging = false;
  private rowId = '';
  private startX = 0;
  private startY = 0;
  private ghostEl: HTMLElement | null = null;
  private sourceCard: HTMLElement | null = null;
  private ghostOffsetX = 0;
  private ghostOffsetY = 0;
  private readonly dropLine: DatabaseDropLine;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: CardDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;
    this.dropLine = new DatabaseDropLine(options.wrapper);

    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Start tracking pointer after a pointerdown on a card.
   * A multiSelect board draws one card per option, so pass the pressed card.
   */
  public beginTracking(rowId: string, startX: number, startY: number, sourceCard?: HTMLElement): void {
    this.cleanup();
    this.rowId = rowId;
    this.startX = startX;
    this.startY = startY;
    this.isDragging = false;
    this.sourceCard = sourceCard ?? this.wrapper.querySelector(`[data-row-id="${rowId}"]`);

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
    this.wrapper.removeAttribute('data-blok-database-dragging');

    if (this.sourceCard) {
      this.sourceCard.removeAttribute('data-blok-database-drag-source');
      this.sourceCard = null;
    }

    this.isDragging = false;
    this.rowId = '';
    this.ghostOffsetX = 0;
    this.ghostOffsetY = 0;
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
    const dx = Math.abs(e.clientX - this.startX);
    const dy = Math.abs(e.clientY - this.startY);

    if (!this.isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
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
    if (this.sourceCard) {
      const rect = this.sourceCard.getBoundingClientRect();

      this.ghostOffsetX = this.startX - rect.left;
      this.ghostOffsetY = this.startY - rect.top;
      this.sourceCard.setAttribute('data-blok-database-drag-source', '');
    }

    this.wrapper.setAttribute('data-blok-database-dragging', '');
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

    if (this.sourceCard) {
      const clone = this.sourceCard.cloneNode(true) as HTMLElement;

      clone.style.opacity = '';
      clone.removeAttribute('data-blok-database-drag-source');
      ghost.appendChild(clone);

      copyGhostRadius(this.sourceCard, ghost);

      const rect = this.sourceCard.getBoundingClientRect();

      style.left = `${e.clientX - this.ghostOffsetX}px`;
      style.top = `${e.clientY - this.ghostOffsetY}px`;
      style.width = `${rect.width}px`;
    } else {
      style.left = `${e.clientX}px`;
      style.top = `${e.clientY}px`;
    }

    document.body.appendChild(ghost);
    this.ghostEl = ghost;
  }

  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl) {
      return;
    }

    this.ghostEl.style.left = `${e.clientX - this.ghostOffsetX}px`;
    this.ghostEl.style.top = `${e.clientY - this.ghostOffsetY}px`;
  }

  private updateDropIndicator(e: PointerEvent): void {
    const targetColumn = this.findTargetColumn(e.clientX, e.clientY);

    if (!targetColumn) {
      this.dropLine.hide();

      return;
    }

    const beforeEl = this.getDropPosition(targetColumn, e.clientY).beforeEl;
    // The source card stays in place, so it counts as a neighbour for the line.
    const visible = Array.from(targetColumn.querySelectorAll<HTMLElement>('[data-blok-database-card]'));

    if (beforeEl instanceof HTMLElement) {
      const rect = beforeEl.getBoundingClientRect();
      const above = visible[visible.indexOf(beforeEl) - 1];
      const centerY = above === undefined ? rect.top - HALF_GAP : (above.getBoundingClientRect().bottom + rect.top) / 2;

      this.dropLine.showHorizontal({ left: rect.left, centerY, width: rect.width });

      return;
    }

    const last = visible.at(-1);

    if (last !== undefined) {
      const rect = last.getBoundingClientRect();

      this.dropLine.showHorizontal({ left: rect.left, centerY: rect.bottom + HALF_GAP, width: rect.width });

      return;
    }

    const cardsContainer = targetColumn.querySelector<HTMLElement>('[data-blok-database-cards]');

    if (!cardsContainer) {
      this.dropLine.hide();

      return;
    }

    const rect = cardsContainer.getBoundingClientRect();

    this.dropLine.showHorizontal({ left: rect.left, centerY: rect.top + 2, width: rect.width });
  }

  /** The column under the pointer. Sub-group lanes stack columns, so the row of the pointer picks among them. */
  private findTargetColumn(clientX: number, clientY: number): HTMLElement | null {
    const columns = Array.from(this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-column]'))
      .filter((col) => {
        const rect = col.getBoundingClientRect();

        return clientX >= rect.left && clientX <= rect.right;
      });

    return columns.find((col) => {
      const rect = col.getBoundingClientRect();

      return clientY >= rect.top && clientY <= rect.bottom;
    }) ?? columns[0] ?? null;
  }

  private getDropPosition(column: HTMLElement, clientY: number): { beforeEl: Element | null } {
    const cards = Array.from(column.querySelectorAll<HTMLElement>('[data-blok-database-card]'))
      .filter((card) => card.getAttribute('data-row-id') !== this.rowId);

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        return { beforeEl: card };
      }
    }

    return { beforeEl: null };
  }

  private resolveAfterRowId(
    beforeEl: Element | null,
    cards: HTMLElement[],
    beforeIndex: number
  ): string | null {
    if (beforeEl) {
      return beforeIndex > 0 ? cards[beforeIndex - 1].getAttribute('data-row-id') : null;
    }

    return cards.length > 0 ? cards[cards.length - 1].getAttribute('data-row-id') : null;
  }

  private commitDrop(e: PointerEvent): void {
    const targetColumn = this.findTargetColumn(e.clientX, e.clientY);

    if (!targetColumn) {
      return;
    }

    const toOptionId = targetColumn.getAttribute('data-option-id') ?? '';
    const position = this.getDropPosition(targetColumn, e.clientY);
    const cards = Array.from(targetColumn.querySelectorAll<HTMLElement>('[data-blok-database-card]'))
      .filter((card) => card.getAttribute('data-row-id') !== this.rowId);

    const beforeRowId: string | null = position.beforeEl
      ? position.beforeEl.getAttribute('data-row-id')
      : null;

    const beforeIndex = position.beforeEl ? cards.indexOf(position.beforeEl as HTMLElement) : -1;

    const afterRowId = this.resolveAfterRowId(position.beforeEl, cards, beforeIndex);

    const toSubGroup = targetColumn.getAttribute('data-sub-group');

    this.onDrop({ rowId: this.rowId, toOptionId, ...(toSubGroup !== null ? { toSubGroup } : {}), beforeRowId, afterRowId });
  }
}
