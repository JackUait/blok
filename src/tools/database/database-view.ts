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
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Kanban board');
    wrapper.style.display = 'flex';
    wrapper.style.overflowX = 'auto';
    wrapper.style.alignItems = 'flex-start';
    wrapper.style.gap = '8px';
    wrapper.style.padding = '2px';

    for (const col of columns) {
      const columnEl = this.createColumnElement(col, getCards(col.id));

      wrapper.appendChild(columnEl);
    }

    if (!this.readOnly) {
      const addColumnBtn = document.createElement('button');

      addColumnBtn.setAttribute('data-blok-database-add-column', '');
      addColumnBtn.setAttribute('aria-label', this.i18n.t('tools.database.addColumn'));
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
    columnEl.setAttribute('role', 'group');
    columnEl.setAttribute('aria-label', col.title);
    columnEl.style.display = 'flex';
    columnEl.style.flexDirection = 'column';
    columnEl.style.minWidth = '220px';
    columnEl.style.flexShrink = '0';

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-column-header', '');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.padding = '6px 8px';
    header.style.borderRadius = '4px';
    header.style.gap = '4px';

    if (col.color !== undefined) {
      header.style.backgroundColor = `var(--blok-color-${col.color}-bg)`;
    }

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-column-title', '');
    titleEl.style.fontWeight = '600';
    titleEl.textContent = col.title;
    header.appendChild(titleEl);

    columnEl.appendChild(header);

    const cardsContainer = document.createElement('div');

    cardsContainer.setAttribute('data-blok-database-cards', '');
    cardsContainer.setAttribute('role', 'list');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.gap = '4px';
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
      addCardBtn.setAttribute('aria-label', this.i18n.t('tools.database.addCard'));
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
    cardEl.setAttribute('role', 'listitem');
    cardEl.style.padding = '8px 10px';
    cardEl.style.borderRadius = '4px';
    cardEl.style.cursor = 'pointer';
    cardEl.style.position = 'relative';

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-card-title', '');
    titleEl.textContent = card.title;
    cardEl.appendChild(titleEl);

    if (!this.readOnly) {
      const deleteBtn = document.createElement('button');

      deleteBtn.setAttribute('data-blok-database-delete-card', '');
      deleteBtn.setAttribute('data-card-id', card.id);
      deleteBtn.setAttribute('aria-label', this.i18n.t('tools.database.deleteCard'));
      deleteBtn.style.position = 'absolute';
      deleteBtn.style.top = '4px';
      deleteBtn.style.right = '4px';
      deleteBtn.textContent = '\u00d7';
      cardEl.appendChild(deleteBtn);
    }

    return cardEl;
  }
}
