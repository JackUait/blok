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
  private indicator: HTMLElement | null = null;
  private sourceCard: HTMLElement | null = null;

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

    this.indicator?.remove();
    this.indicator = null;

    if (this.sourceCard) {
      this.sourceCard.style.opacity = '';
      this.sourceCard = null;
    }

    this.isDragging = false;
    this.cardId = '';
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
      this.sourceCard.style.opacity = '0.4';
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
    style.opacity = '0.7';
    style.zIndex = '50';

    if (this.sourceCard) {
      const clone = this.sourceCard.cloneNode(true) as HTMLElement;

      clone.style.opacity = '';
      ghost.appendChild(clone);

      const rect = this.sourceCard.getBoundingClientRect();

      style.left = `${rect.left}px`;
      style.top = `${rect.top}px`;
      style.width = `${rect.width}px`;
    } else {
      style.left = `${e.clientX}px`;
      style.top = `${e.clientY}px`;
    }

    document.body.appendChild(ghost);
    this.ghostEl = ghost;
  }

  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl || !this.sourceCard) {
      return;
    }

    const rect = this.sourceCard.getBoundingClientRect();
    const offsetX = this.startX - rect.left;
    const offsetY = this.startY - rect.top;

    this.ghostEl.style.left = `${e.clientX - offsetX}px`;
    this.ghostEl.style.top = `${e.clientY - offsetY}px`;
  }

  private updateDropIndicator(e: PointerEvent): void {
    const targetColumn = this.findTargetColumn(e.clientX);

    if (!targetColumn) {
      this.indicator?.remove();
      this.indicator = null;

      return;
    }

    if (!this.indicator) {
      this.indicator = document.createElement('div');
      this.indicator.setAttribute('data-blok-database-indicator', '');
      this.indicator.setAttribute('contenteditable', 'false');

      const style = this.indicator.style;

      style.position = 'absolute';
      style.height = '2px';
      style.left = '0';
      style.right = '0';
      style.pointerEvents = 'none';
      style.zIndex = '5';
      style.backgroundColor = 'var(--blok-active-icon)';
    }

    const position = this.getDropPosition(targetColumn, e.clientY);

    if (position.beforeEl) {
      targetColumn.insertBefore(this.indicator, position.beforeEl);
    } else {
      targetColumn.appendChild(this.indicator);
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
