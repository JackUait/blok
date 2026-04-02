const DRAG_THRESHOLD = 10;

export interface CardDragResult {
  cardId: string;
  toColumnId: string;
  beforeCardId: string | null;
  afterCardId: string | null;
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
  private cardId = '';
  private startX = 0;
  private startY = 0;
  private ghostEl: HTMLElement | null = null;
  private sourceCard: HTMLElement | null = null;
  private sourceCardHeight = 0;
  private ghostOffsetX = 0;
  private ghostOffsetY = 0;
  private gapTarget: HTMLElement | null = null;
  private gapContainer: HTMLElement | null = null;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: CardDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;

    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Start tracking pointer after a pointerdown on a card.
   */
  public beginTracking(cardId: string, startX: number, startY: number): void {
    this.cleanup();
    this.cardId = cardId;
    this.startX = startX;
    this.startY = startY;
    this.isDragging = false;
    this.sourceCard = this.wrapper.querySelector(`[data-card-id="${cardId}"]`);

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

    this.clearGap();
    this.wrapper.removeAttribute('data-blok-database-dragging');

    if (this.sourceCard) {
      this.sourceCard.style.opacity = '';
      this.sourceCard = null;
    }

    this.isDragging = false;
    this.cardId = '';
    this.sourceCardHeight = 0;
    this.ghostOffsetX = 0;
    this.ghostOffsetY = 0;
  }

  public destroy(): void {
    this.cleanup();
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

      this.sourceCardHeight = rect.height;
      this.ghostOffsetX = this.startX - rect.left;
      this.ghostOffsetY = this.startY - rect.top;
      this.sourceCard.style.opacity = '0.4';
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
    style.opacity = '0.85';
    style.zIndex = '50';
    style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.2), 0 4px 10px rgba(0, 0, 0, 0.1)';
    style.borderRadius = '8px';
    style.overflow = 'hidden';
    style.transform = 'rotate(2deg) scale(1.02)';
    style.transformOrigin = 'center center';

    if (this.sourceCard) {
      const clone = this.sourceCard.cloneNode(true) as HTMLElement;

      clone.style.opacity = '';
      ghost.appendChild(clone);

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
    const targetColumn = this.findTargetColumn(e.clientX);

    if (!targetColumn) {
      this.clearGap();

      return;
    }

    const position = this.getDropPosition(targetColumn, e.clientY);
    const beforeEl = position.beforeEl as HTMLElement | null;

    if (beforeEl) {
      if (beforeEl === this.gapTarget) {
        return;
      }

      this.clearGap();
      beforeEl.style.marginTop = `${this.sourceCardHeight}px`;
      this.gapTarget = beforeEl;
    } else {
      const cardsContainer = targetColumn.querySelector<HTMLElement>(
        '[data-blok-database-cards]'
      );

      if (!cardsContainer) {
        this.clearGap();

        return;
      }

      if (cardsContainer === this.gapContainer) {
        return;
      }

      this.clearGap();
      cardsContainer.style.paddingBottom = `${this.sourceCardHeight}px`;
      this.gapContainer = cardsContainer;
    }
  }

  private clearGap(): void {
    if (this.gapTarget) {
      this.gapTarget.style.marginTop = '';
      this.gapTarget = null;
    }

    if (this.gapContainer) {
      this.gapContainer.style.paddingBottom = '';
      this.gapContainer = null;
    }
  }

  private findTargetColumn(clientX: number): HTMLElement | null {
    const columns = Array.from(this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-column]'));

    for (const col of columns) {
      const rect = col.getBoundingClientRect();

      if (clientX >= rect.left && clientX <= rect.right) {
        return col;
      }
    }

    return null;
  }

  private getDropPosition(column: HTMLElement, clientY: number): { beforeEl: Element | null } {
    const cards = Array.from(column.querySelectorAll<HTMLElement>('[data-blok-database-card]'))
      .filter((card) => card.getAttribute('data-card-id') !== this.cardId);

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        return { beforeEl: card };
      }
    }

    return { beforeEl: null };
  }

  private resolveAfterCardId(
    beforeEl: Element | null,
    cards: HTMLElement[],
    beforeIndex: number
  ): string | null {
    if (beforeEl) {
      return beforeIndex > 0 ? cards[beforeIndex - 1].getAttribute('data-card-id') : null;
    }

    return cards.length > 0 ? cards[cards.length - 1].getAttribute('data-card-id') : null;
  }

  private commitDrop(e: PointerEvent): void {
    const targetColumn = this.findTargetColumn(e.clientX);

    if (!targetColumn) {
      return;
    }

    const toColumnId = targetColumn.getAttribute('data-column-id') ?? '';
    const position = this.getDropPosition(targetColumn, e.clientY);
    const cards = Array.from(targetColumn.querySelectorAll<HTMLElement>('[data-blok-database-card]'))
      .filter((card) => card.getAttribute('data-card-id') !== this.cardId);

    const beforeCardId: string | null = position.beforeEl
      ? position.beforeEl.getAttribute('data-card-id')
      : null;

    const beforeIndex = position.beforeEl ? cards.indexOf(position.beforeEl as HTMLElement) : -1;

    const afterCardId = this.resolveAfterCardId(position.beforeEl, cards, beforeIndex);

    this.onDrop({ cardId: this.cardId, toColumnId, beforeCardId, afterCardId });
  }
}
