import type { I18n } from '../../../types';
import type { SelectOption, DatabaseRow } from './types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { IconPlus, IconPencil, IconDotsHorizontal } from '../../components/icons';

interface DatabaseBoardViewOptions {
  readOnly: boolean;
  i18n: I18n;
  options: SelectOption[];
  getRows: (optionId: string) => DatabaseRow[];
  titlePropertyId: string;
  onTitleEdit?: (rowId: string, newTitle: string) => void;
}

/**
 * DOM rendering layer for the kanban board.
 * Receives ordered data and creates plain DOM elements (NOT contenteditable).
 * All interactive elements use data-blok-database-* attributes for test selectors and event delegation.
 */
export class DatabaseBoardView implements DatabaseViewRenderer {
  private readonly readOnly: boolean;
  private readonly i18n: I18n;
  private readonly options: SelectOption[];
  private readonly getRows: (optionId: string) => DatabaseRow[];
  private readonly titlePropertyId: string;
  private readonly onTitleEdit: ((rowId: string, newTitle: string) => void) | undefined;

  constructor({ readOnly, i18n, options, getRows, titlePropertyId, onTitleEdit }: DatabaseBoardViewOptions) {
    this.readOnly = readOnly;
    this.i18n = i18n;
    this.options = options;
    this.getRows = getRows;
    this.titlePropertyId = titlePropertyId;
    this.onTitleEdit = onTitleEdit;
  }

  /**
   * Creates the full board DOM from option and row data.
   */
  createView(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-tool', 'database');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Kanban board');
    wrapper.style.display = 'flex';

    const boardArea = document.createElement('div');

    boardArea.setAttribute('data-blok-database-board', '');
    boardArea.style.display = 'flex';
    boardArea.style.overflowX = 'auto';
    boardArea.style.alignItems = 'flex-start';
    boardArea.style.gap = '12px';
    boardArea.style.paddingBottom = '24px';
    boardArea.style.flex = '1';
    boardArea.style.minWidth = '0';

    for (const option of this.options) {
      const columnEl = this.createColumnElement(option, this.getRows(option.id), this.titlePropertyId);

      boardArea.appendChild(columnEl);
    }

    if (!this.readOnly) {
      const addColumnBtn = document.createElement('button');

      addColumnBtn.setAttribute('data-blok-database-add-column', '');
      addColumnBtn.setAttribute('aria-label', this.i18n.t('tools.database.addColumn'));
      addColumnBtn.textContent = '+ ' + this.i18n.t('tools.database.addColumn');
      addColumnBtn.style.minWidth = '260px';
      addColumnBtn.style.flex = '0 0 260px';
      boardArea.appendChild(addColumnBtn);
    }

    wrapper.appendChild(boardArea);

    return wrapper;
  }

  /**
   * Creates and appends a row element to a cards container.
   */
  appendRow(cardsContainer: HTMLElement, row: DatabaseRow): void {
    const cardEl = this.createCardElement(row, this.titlePropertyId);

    cardsContainer.appendChild(cardEl);
    this.updateColumnCount(cardsContainer);
  }

  /**
   * Removes a row element from the wrapper by its data-row-id.
   */
  removeRow(wrapper: HTMLElement, rowId: string): void {
    const cardEl = wrapper.querySelector(`[data-row-id="${rowId}"]`);
    const cardsContainer = cardEl?.closest('[data-blok-database-cards]') as HTMLElement | null;

    cardEl?.remove();

    if (cardsContainer !== null) {
      this.updateColumnCount(cardsContainer);
    }
  }

  /**
   * Updates the visible title of a row element found by its data-row-id.
   */
  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const cardEl = wrapper.querySelector(`[data-row-id="${rowId}"]`);
    const titleEl = cardEl?.querySelector('[data-blok-database-card-title]');

    if (titleEl !== null && titleEl !== undefined) {
      if (title) {
        titleEl.textContent = title;
        titleEl.removeAttribute('data-placeholder');
        cardEl?.removeAttribute('data-empty');
      } else {
        titleEl.textContent = this.i18n.t('tools.database.cardTitlePlaceholder');
        titleEl.setAttribute('data-placeholder', '');
        cardEl?.setAttribute('data-empty', '');
      }
    }
  }

  /**
   * Creates and inserts a group (column) element before the add-column button.
   */
  appendGroup(wrapper: HTMLElement, option: SelectOption): void {
    const columnEl = this.createColumnElement(option, [], '');
    const boardArea = wrapper.querySelector('[data-blok-database-board]');
    const container = (boardArea as HTMLElement | null) ?? wrapper;
    const addColumnBtn = container.querySelector('[data-blok-database-add-column]');

    if (addColumnBtn) {
      container.insertBefore(columnEl, addColumnBtn);
    } else {
      container.appendChild(columnEl);
    }
  }

  /**
   * Removes a group (column) element from the wrapper by its data-option-id.
   */
  removeGroup(wrapper: HTMLElement, optionId: string): void {
    const columnEl = wrapper.querySelector(`[data-option-id="${optionId}"]`);

    columnEl?.remove();
  }

  /**
   * Creates a single column element with header, cards container, and optional add-card button.
   */
  private createColumnElement(option: SelectOption, rows: DatabaseRow[], titlePropertyId: string): HTMLDivElement {
    const columnEl = document.createElement('div');

    columnEl.setAttribute('data-blok-database-column', '');
    columnEl.setAttribute('data-option-id', option.id);
    columnEl.setAttribute('role', 'group');
    columnEl.setAttribute('aria-label', option.label);
    columnEl.style.display = 'flex';
    columnEl.style.flexDirection = 'column';
    columnEl.style.minWidth = '260px';
    columnEl.style.flex = '0 0 260px';

    if (option.color !== undefined) {
      columnEl.style.backgroundColor = `var(--blok-color-${option.color}-bg)`;
      columnEl.setAttribute('data-color', option.color);
    }

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-column-header', '');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.padding = '0 0 6px 0';
    header.style.borderRadius = '4px';
    header.style.gap = '6px';
    header.style.cursor = 'grab';

    const pill = document.createElement('div');

    pill.setAttribute('data-blok-database-column-pill', '');

    if (option.color !== undefined) {
      pill.style.backgroundColor = `color-mix(in srgb, var(--blok-color-${option.color}-text) 20%, var(--blok-color-${option.color}-bg))`;
      pill.style.color = `var(--blok-color-${option.color}-text)`;

      const dot = document.createElement('span');

      dot.setAttribute('data-blok-database-column-dot', '');
      dot.style.backgroundColor = `var(--blok-color-${option.color}-text)`;
      pill.appendChild(dot);
    }

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-column-title', '');
    titleEl.textContent = option.label;
    pill.appendChild(titleEl);

    header.appendChild(pill);

    const countEl = document.createElement('span');

    countEl.setAttribute('data-blok-database-column-count', '');
    countEl.textContent = String(rows.length);

    if (option.color !== undefined) {
      countEl.style.color = `var(--blok-color-${option.color}-text)`;
    }

    header.appendChild(countEl);

    columnEl.appendChild(header);

    const cardsContainer = document.createElement('div');

    cardsContainer.setAttribute('data-blok-database-cards', '');
    cardsContainer.setAttribute('role', 'list');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.gap = '8px';
    cardsContainer.style.paddingTop = '6px';
    cardsContainer.style.minHeight = '40px';

    for (const row of rows) {
      const cardEl = this.createCardElement(row, titlePropertyId);

      cardsContainer.appendChild(cardEl);
    }

    columnEl.appendChild(cardsContainer);

    if (!this.readOnly) {
      const addCardBtn = document.createElement('button');

      addCardBtn.setAttribute('data-blok-database-add-card', '');
      addCardBtn.setAttribute('data-option-id', option.id);
      addCardBtn.setAttribute('aria-label', this.i18n.t('tools.database.addCard'));

      const iconEl = document.createElement('span');

      iconEl.setAttribute('data-blok-database-add-card-icon', '');
      iconEl.innerHTML = IconPlus;
      addCardBtn.appendChild(iconEl);

      const labelEl = document.createElement('span');

      labelEl.textContent = this.i18n.t('tools.database.newPage');
      addCardBtn.appendChild(labelEl);

      if (option.color !== undefined) {
        addCardBtn.style.borderColor = `color-mix(in srgb, var(--blok-color-${option.color}-text) 30%, transparent)`;
        addCardBtn.style.color = `var(--blok-color-${option.color}-text)`;
      }

      columnEl.appendChild(addCardBtn);
    }

    return columnEl;
  }

  /**
   * Creates a single card element.
   */
  private createCardElement(row: DatabaseRow, titlePropertyId: string): HTMLDivElement {
    const cardEl = document.createElement('div');
    const title = (row.properties[titlePropertyId] as string) ?? '';

    cardEl.setAttribute('data-blok-database-card', '');
    cardEl.setAttribute('data-row-id', row.id);
    cardEl.setAttribute('role', 'listitem');
    cardEl.style.padding = '10px 12px';
    cardEl.style.borderRadius = '10px';
    cardEl.style.cursor = 'pointer';
    cardEl.style.position = 'relative';
    cardEl.style.backgroundColor = 'var(--blok-database-card-bg)';
    cardEl.style.boxShadow = 'var(--blok-database-card-shadow)';

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-card-title', '');

    if (title) {
      titleEl.textContent = title;
    } else {
      titleEl.textContent = this.i18n.t('tools.database.cardTitlePlaceholder');
      titleEl.setAttribute('data-placeholder', '');
      cardEl.setAttribute('data-empty', '');
    }

    cardEl.appendChild(titleEl);

    if (!this.readOnly) {
      const actionsEl = document.createElement('div');

      actionsEl.setAttribute('data-blok-database-card-actions', '');

      const editBtn = document.createElement('button');

      editBtn.setAttribute('data-blok-database-edit-card', '');
      editBtn.setAttribute('data-row-id', row.id);
      editBtn.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
      editBtn.innerHTML = IconPencil;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startCardTitleEdit(cardEl, row.id);
      });

      const menuBtn = document.createElement('button');

      menuBtn.setAttribute('data-blok-database-card-menu', '');
      menuBtn.setAttribute('data-row-id', row.id);
      menuBtn.setAttribute('aria-label', this.i18n.t('tools.database.cardMenuLabel'));
      menuBtn.innerHTML = IconDotsHorizontal;

      actionsEl.appendChild(editBtn);
      actionsEl.appendChild(menuBtn);
      cardEl.appendChild(actionsEl);
    }

    return cardEl;
  }

  /**
   * Replaces the card title div with an inline input for editing.
   * Mirrors the input-swap pattern in DatabaseColumnControls.
   */
  private startCardTitleEdit(cardEl: HTMLElement, rowId: string): void {
    const titleEl = cardEl.querySelector<HTMLElement>('[data-blok-database-card-title]');

    if (titleEl === null) {
      return;
    }

    const originalTitle = titleEl.textContent ?? '';
    const input = document.createElement('input');

    input.type = 'text';
    input.value = originalTitle;
    input.setAttribute('data-blok-database-card-title-input', '');
    input.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';

    const state = { committed: false };

    const commit = (): void => {
      if (state.committed) return;
      state.committed = true;
      const newTitle = input.value.trim() || originalTitle;
      const restoredDiv = document.createElement('div');

      restoredDiv.setAttribute('data-blok-database-card-title', '');
      restoredDiv.textContent = newTitle;
      input.replaceWith(restoredDiv);

      if (newTitle !== originalTitle) {
        this.onTitleEdit?.(rowId, newTitle);
      }

      if (newTitle) {
        cardEl.removeAttribute('data-empty');
      }
    };

    const cancel = (): void => {
      if (state.committed) return;
      state.committed = true;
      const restoredDiv = document.createElement('div');

      restoredDiv.setAttribute('data-blok-database-card-title', '');
      restoredDiv.textContent = originalTitle;
      input.replaceWith(restoredDiv);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ke) => {
      ke.stopPropagation();
      if (ke.key === 'Enter') {
        input.removeEventListener('blur', commit);
        commit();
      } else if (ke.key === 'Escape') {
        input.removeEventListener('blur', commit);
        cancel();
      }
    });

    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  /**
   * Updates the card count badge for the column containing the given cards container.
   */
  private updateColumnCount(cardsContainer: HTMLElement): void {
    const columnEl = cardsContainer.closest('[data-blok-database-column]');

    if (columnEl === null) {
      return;
    }

    const countEl = columnEl.querySelector('[data-blok-database-column-count]');

    if (countEl !== null) {
      const cardCount = cardsContainer.querySelectorAll('[data-blok-database-card]').length;

      countEl.textContent = String(cardCount);
    }
  }
}
