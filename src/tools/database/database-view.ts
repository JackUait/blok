import type { I18n } from '../../../types';
import type { KanbanColumnData, KanbanCardData } from './types';

interface DatabaseViewConfig {
  readOnly: boolean;
  i18n: I18n;
}

/**
 * DOM rendering layer for the kanban board.
 * Receives ordered data and creates plain DOM elements (NOT contenteditable).
 * All interactive elements use data-blok-database-* attributes for test selectors and event delegation.
 */
export class DatabaseView {
  private readonly readOnly: boolean;
  private readonly i18n: I18n;

  constructor({ readOnly, i18n }: DatabaseViewConfig) {
    this.readOnly = readOnly;
    this.i18n = i18n;
  }

  /**
   * Creates the full board DOM from column and card data.
   */
  createBoard(columns: KanbanColumnData[], getCards: (columnId: string) => KanbanCardData[]): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-tool', 'database');
    wrapper.style.display = 'flex';
    wrapper.style.overflowX = 'auto';

    for (const col of columns) {
      const columnEl = this.createColumnElement(col, getCards(col.id));

      wrapper.appendChild(columnEl);
    }

    if (!this.readOnly) {
      const addColumnBtn = document.createElement('button');

      addColumnBtn.setAttribute('data-blok-database-add-column', '');
      addColumnBtn.textContent = this.i18n.t('tools.database.addColumn');
      wrapper.appendChild(addColumnBtn);
    }

    return wrapper;
  }

  /**
   * Creates and appends a card element to a cards container.
   */
  appendCard(cardsContainer: HTMLElement, card: KanbanCardData): void {
    const cardEl = this.createCardElement(card);

    cardsContainer.appendChild(cardEl);
  }

  /**
   * Removes a card element from the wrapper by its data-card-id.
   */
  removeCard(wrapper: HTMLElement, cardId: string): void {
    const cardEl = wrapper.querySelector(`[data-card-id="${cardId}"]`);

    cardEl?.remove();
  }

  /**
   * Creates and inserts a column element before the add-column button.
   */
  appendColumn(wrapper: HTMLElement, col: KanbanColumnData): void {
    const columnEl = this.createColumnElement(col, []);
    const addColumnBtn = wrapper.querySelector('[data-blok-database-add-column]');

    if (addColumnBtn) {
      wrapper.insertBefore(columnEl, addColumnBtn);
    } else {
      wrapper.appendChild(columnEl);
    }
  }

  /**
   * Removes a column element from the wrapper by its data-column-id.
   */
  removeColumn(wrapper: HTMLElement, columnId: string): void {
    const columnEl = wrapper.querySelector(`[data-column-id="${columnId}"]`);

    columnEl?.remove();
  }

  /**
   * Creates a single column element with header, cards container, and optional add-card button.
   */
  private createColumnElement(col: KanbanColumnData, cards: KanbanCardData[]): HTMLDivElement {
    const columnEl = document.createElement('div');

    columnEl.setAttribute('data-blok-database-column', '');
    columnEl.setAttribute('data-column-id', col.id);

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-column-header', '');

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-column-title', '');
    titleEl.textContent = col.title;
    header.appendChild(titleEl);

    columnEl.appendChild(header);

    const cardsContainer = document.createElement('div');

    cardsContainer.setAttribute('data-blok-database-cards', '');
    cardsContainer.style.minHeight = '40px';

    for (const card of cards) {
      const cardEl = this.createCardElement(card);

      cardsContainer.appendChild(cardEl);
    }

    columnEl.appendChild(cardsContainer);

    if (!this.readOnly) {
      const addCardBtn = document.createElement('button');

      addCardBtn.setAttribute('data-blok-database-add-card', '');
      addCardBtn.setAttribute('data-column-id', col.id);
      addCardBtn.textContent = this.i18n.t('tools.database.addCard');
      columnEl.appendChild(addCardBtn);
    }

    return columnEl;
  }

  /**
   * Creates a single card element.
   */
  private createCardElement(card: KanbanCardData): HTMLDivElement {
    const cardEl = document.createElement('div');

    cardEl.setAttribute('data-blok-database-card', '');
    cardEl.setAttribute('data-card-id', card.id);

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-card-title', '');
    titleEl.textContent = card.title;
    cardEl.appendChild(titleEl);

    return cardEl;
  }
}
