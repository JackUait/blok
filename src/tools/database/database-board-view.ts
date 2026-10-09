import type { I18n } from '../../../types';
import type { SelectOption, DatabaseRow, DatabaseViewConfig, PropertyDefinition, CardSize } from './types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { NO_VALUE_GROUP_KEY } from './database-model';
import { createOptionPill, renderCellValue } from './cells';
import { createCardPreview } from './database-card-preview';
import type { BodyBlock } from './row-body';
import { resolveBoardCardPreview, resolveCardSize, resolveFitImage, resolveViewProperties } from './view-settings';
import { getElementDirection } from '../../components/utils/direction';
import { IconPlus, IconPencil, IconDotsHorizontal } from '../../components/icons';
import { startInlineRename } from '../../components/utils/inline-rename';

interface DatabaseBoardViewOptions {
  readOnly: boolean;
  i18n: I18n;
  options: SelectOption[];
  /** A column's rows; with sub-groups, only those in the `subKey` lane. */
  getRows: (optionId: string, subKey?: string) => DatabaseRow[];
  titlePropertyId: string;
  onTitleEdit?: (rowId: string, newTitle: string) => void;
  /** The view hides each group's row count ("Hide aggregation"). */
  hideCounts?: boolean;
  /** How many groups the view hides; above zero, a button after the columns shows them again. */
  hiddenGroupCount?: number;
  /** The board's view: card size, preview and the properties cards show. Without it cards show only the title. */
  view?: DatabaseViewConfig;
  /** Localized schema. */
  schema?: PropertyDefinition[];
  /** The row's body blocks, for the page cover and page content previews. */
  bodyOf?: (rowId: string) => BodyBlock[];
  locale?: string;
  /** A click on a card property: edit it in place. */
  onPropertyEdit?: (rowId: string, propertyId: string, anchor: HTMLElement) => void;
  /** Sub-groups: one horizontal lane each, holding every column. */
  subGroups?: BoardLane[];
}

export interface BoardLane {
  key: string;
  label: string;
  /** Set for an option-like sub-group, so its label shows as a pill. */
  option?: SelectOption;
}

/** Card widths per card size. Medium (260) is measured (research/07); small and large are unmeasured. */
const CARD_WIDTH: Record<CardSize, number> = { small: 220, medium: 260, large: 320 };
/** The column's 8px padding on each side (research/07). */
const COLUMN_PADDING = 16;

/**
 * DOM rendering layer for the kanban board.
 * Receives ordered data and creates plain DOM elements (NOT contenteditable).
 * All interactive elements use data-blok-database-* attributes for test selectors and event delegation.
 */
export class DatabaseBoardView implements DatabaseViewRenderer {
  private readonly readOnly: boolean;
  private readonly i18n: I18n;
  private readonly options: SelectOption[];
  private readonly getRows: (optionId: string, subKey?: string) => DatabaseRow[];
  private readonly titlePropertyId: string;
  private readonly onTitleEdit: ((rowId: string, newTitle: string) => void) | undefined;
  private readonly hideCounts: boolean;
  private readonly hiddenGroupCount: number;
  private readonly settings: Pick<DatabaseBoardViewOptions, 'view' | 'schema' | 'bodyOf' | 'locale' | 'onPropertyEdit' | 'subGroups'>;

  constructor({
    readOnly, i18n, options, getRows, titlePropertyId, onTitleEdit, hideCounts, hiddenGroupCount, ...settings
  }: DatabaseBoardViewOptions) {
    this.settings = settings;
    this.readOnly = readOnly;
    this.i18n = i18n;
    this.options = options;
    this.getRows = getRows;
    this.titlePropertyId = titlePropertyId;
    this.onTitleEdit = onTitleEdit;
    this.hideCounts = hideCounts ?? false;
    this.hiddenGroupCount = hiddenGroupCount ?? 0;
  }

  /**
   * Creates the full board DOM from option and row data.
   */
  createView(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-tool', 'database');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', this.i18n.t('tools.database.kanbanBoard'));
    wrapper.style.display = 'flex';

    const boardArea = document.createElement('div');

    boardArea.setAttribute('data-blok-database-board', '');
    boardArea.setAttribute('data-blok-keyboard-owner', '');
    boardArea.setAttribute('data-card-size', this.cardSize);
    if (this.settings.view !== undefined && resolveFitImage(this.settings.view)) {
      boardArea.setAttribute('data-fit-image', '');
    }
    boardArea.style.display = 'flex';
    boardArea.style.overflowX = 'auto';
    boardArea.style.alignItems = 'flex-start';
    boardArea.style.gap = '12px';
    boardArea.style.paddingBottom = '24px';
    boardArea.style.flex = '1';
    boardArea.style.minWidth = '0';

    const lanes = this.settings.subGroups ?? [];

    if (lanes.length > 0) {
      boardArea.setAttribute('data-sub-grouped', '');
      boardArea.style.flexWrap = 'wrap';
      lanes.forEach((lane) => boardArea.appendChild(this.createLane(lane)));
    } else {
      for (const option of this.options) {
        boardArea.appendChild(this.createColumnElement(option, this.getRows(option.id), this.titlePropertyId));
      }
    }

    if (this.hiddenGroupCount > 0) {
      const hiddenBtn = document.createElement('button');

      hiddenBtn.type = 'button';
      hiddenBtn.setAttribute('data-blok-database-hidden-groups', '');
      hiddenBtn.setAttribute('aria-haspopup', 'menu');
      hiddenBtn.textContent = this.i18n.t('tools.database.hiddenGroups');
      boardArea.appendChild(hiddenBtn);
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
    boardArea.querySelector<HTMLElement>('[data-blok-database-card]')?.setAttribute('tabindex', '0');
    boardArea.addEventListener('click', this.onCardPropertyClick);
    boardArea.addEventListener('keydown', this.onCardKeyDown);

    return wrapper;
  }

  /** One sub-group: its label and count, then a row of every column holding only its cards. */
  private createLane(lane: BoardLane): HTMLElement {
    const section = document.createElement('section');
    const header = document.createElement('div');
    const columns = document.createElement('div');
    const columnEls = this.options.map((option) => {
      const columnEl = this.createColumnElement(option, this.getRows(option.id, lane.key), this.titlePropertyId);

      columnEl.setAttribute('data-sub-group', lane.key);

      return columnEl;
    });
    const count = document.createElement('span');

    section.setAttribute('data-blok-database-board-lane', '');
    section.setAttribute('data-sub-group', lane.key);
    section.setAttribute('aria-label', lane.label);
    header.setAttribute('data-blok-database-board-lane-header', '');
    if (lane.option !== undefined) {
      header.appendChild(createOptionPill(lane.option));
    } else {
      const label = document.createElement('span');

      label.textContent = lane.label;
      header.appendChild(label);
    }
    count.setAttribute('data-blok-database-board-lane-count', '');
    count.textContent = String(columnEls.reduce((sum, el) => sum + el.querySelectorAll('[data-blok-database-card]').length, 0));
    count.hidden = this.hideCounts;
    header.appendChild(count);
    columns.setAttribute('data-blok-database-board-lane-columns', '');
    columns.append(...columnEls);
    section.append(header, columns);

    return section;
  }

  private get cardSize(): CardSize {
    return this.settings.view === undefined ? 'medium' : resolveCardSize(this.settings.view);
  }

  private readonly onCardPropertyClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const property = target?.closest<HTMLElement>('[data-blok-database-card-property]');
    const rowId = property?.closest('[data-blok-database-card]')?.getAttribute('data-row-id');
    const propertyId = property?.getAttribute('data-property-id');

    if (this.readOnly || this.settings.onPropertyEdit === undefined || property === null || property === undefined
      || rowId === null || rowId === undefined || propertyId === null || propertyId === undefined) {
      return;
    }
    event.stopPropagation();
    this.settings.onPropertyEdit(rowId, propertyId, property);
  };

  /** Arrows move between cards and columns; Enter opens the focused card. */
  private readonly onCardKeyDown = (event: KeyboardEvent): void => {
    const cardEl = event.target instanceof HTMLElement && event.target.hasAttribute('data-blok-database-card') ? event.target : null;

    if (cardEl === null || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      cardEl.click();

      return;
    }

    const next = this.cardTarget(cardEl, event.key);

    if (next === undefined) {
      return;
    }
    event.preventDefault();
    if (next === null) {
      return;
    }
    cardEl.closest('[data-blok-database-board]')?.querySelectorAll('[data-blok-database-card]').forEach((el) => {
      el.setAttribute('tabindex', el === next ? '0' : '-1');
    });
    next.focus();
  };

  /** The card an arrow key goes to; null at an edge; undefined for other keys. */
  private cardTarget(cardEl: HTMLElement, key: string): HTMLElement | null | undefined {
    const columns = [...(cardEl.closest('[data-blok-database-board]')?.querySelectorAll<HTMLElement>('[data-blok-database-column]') ?? [])];
    const cardsOf = (column: HTMLElement | undefined): HTMLElement[] =>
      [...(column?.querySelectorAll<HTMLElement>('[data-blok-database-card]') ?? [])];
    const column = cardEl.closest<HTMLElement>('[data-blok-database-column]') ?? undefined;
    const columnIndex = column === undefined ? -1 : columns.indexOf(column);
    const index = cardsOf(column).indexOf(cardEl);
    const rtl = getElementDirection(cardEl) === 'rtl';
    const across: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      return cardsOf(column)[index + (key === 'ArrowDown' ? 1 : -1)] ?? null;
    }

    if (across[key] === undefined) {
      return undefined;
    }

    const candidates = (across[key] > 0 ? columns.slice(columnIndex + 1) : columns.slice(0, columnIndex).reverse())
      .filter((c) => cardsOf(c).length > 0);
    const target = cardsOf(candidates[0]);

    return target[Math.min(index, target.length - 1)] ?? null;
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

    if (option.id === NO_VALUE_GROUP_KEY) {
      columnEl.setAttribute('data-blok-database-no-value-group', '');
    }

    columnEl.setAttribute('role', 'group');
    columnEl.setAttribute('aria-label', option.label);
    columnEl.style.display = 'flex';
    columnEl.style.flexDirection = 'column';
    const columnWidth = `${CARD_WIDTH[this.cardSize] + COLUMN_PADDING}px`;

    columnEl.style.minWidth = columnWidth;
    columnEl.style.flex = `0 0 ${columnWidth}`;

    if (option.color !== undefined) {
      const c = option.color;

      // Only some hues were measured (colors.css); the rest derive from the option pill.
      columnEl.style.setProperty('--_blok-group-tint', `var(--blok-database-column-${c}-bg, color-mix(in srgb, var(--blok-database-option-${c}-bg) 22%, transparent))`);
      columnEl.style.setProperty('--_blok-group-ring', `var(--blok-database-column-${c}-ring, color-mix(in srgb, var(--blok-database-option-${c}-bg) 49%, transparent))`);
      // Unmeasured hues fall back to the pill text, which holds AA on the tint; the Marker text did not.
      columnEl.style.setProperty('--_blok-group-accent', `var(--blok-database-column-${c}-accent, var(--blok-database-option-${c}-text))`);
      columnEl.setAttribute('data-color', c);
    }

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-column-header', '');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.padding = '0 0 6px 0';
    header.style.gap = '6px';
    header.style.cursor = 'grab';

    const pill = document.createElement('div');

    pill.setAttribute('data-blok-database-column-pill', '');

    if (option.color !== undefined) {
      pill.style.backgroundColor = `var(--blok-database-option-${option.color}-bg)`;
      pill.style.color = `var(--blok-database-option-${option.color}-text)`;

      const dot = document.createElement('span');

      dot.setAttribute('data-blok-database-column-dot', '');
      dot.style.backgroundColor = `var(--blok-color-${option.color}-text)`;
      pill.appendChild(dot);
    }

    const titleEl = document.createElement('div');

    // The no-value label is not a rename target: column controls and rename lookups find the first column-title.
    titleEl.setAttribute(option.id === NO_VALUE_GROUP_KEY ? 'data-blok-database-no-value-label' : 'data-blok-database-column-title', '');
    titleEl.textContent = option.label;
    pill.appendChild(titleEl);

    header.appendChild(pill);

    const countEl = document.createElement('span');

    countEl.setAttribute('data-blok-database-column-count', '');
    countEl.textContent = String(rows.length);

    countEl.hidden = this.hideCounts;
    header.appendChild(countEl);

    if (!this.readOnly) {
      header.appendChild(this.createHeaderActions(option.id));
    }

    columnEl.appendChild(header);

    const cardsContainer = document.createElement('div');

    cardsContainer.setAttribute('data-blok-database-cards', '');
    cardsContainer.setAttribute('role', 'list');
    cardsContainer.setAttribute('data-blok-keyboard-owner', '');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
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

      columnEl.appendChild(addCardBtn);
    }

    return columnEl;
  }

  /** The "New page" (+) and "More group options" (⋯) buttons, shown on header hover. */
  private createHeaderActions(optionId: string): HTMLElement {
    const actions = document.createElement('div');

    actions.setAttribute('data-blok-database-column-actions', '');

    const newPage = document.createElement('button');

    newPage.type = 'button';
    newPage.setAttribute('data-blok-database-column-new-page', '');
    newPage.setAttribute('data-option-id', optionId);
    newPage.setAttribute('aria-label', this.i18n.t('tools.database.newPage'));
    newPage.innerHTML = IconPlus;

    const menu = document.createElement('button');

    menu.type = 'button';
    menu.setAttribute('data-blok-database-column-menu', '');
    menu.setAttribute('data-option-id', optionId);
    menu.setAttribute('aria-label', this.i18n.t('tools.database.groupMenuLabel'));
    menu.setAttribute('aria-haspopup', 'menu');
    menu.innerHTML = IconDotsHorizontal;

    actions.append(newPage, menu);

    return actions;
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
    cardEl.tabIndex = -1;
    cardEl.style.padding = '10px 12px';
    cardEl.style.cursor = 'pointer';
    cardEl.style.position = 'relative';

    const view = this.settings.view;
    const schema = this.settings.schema ?? [];
    const preview = view === undefined
      ? null
      : createCardPreview(resolveBoardCardPreview(view, schema), row, this.settings.bodyOf ?? (() => []), 'card');

    if (preview !== null) {
      cardEl.appendChild(preview);
    }

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

    const properties = this.createCardProperties(row);

    if (properties !== null) {
      cardEl.appendChild(properties);
    }

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

  /** The view's visible properties, empty ones left out. */
  private createCardProperties(row: DatabaseRow): HTMLElement | null {
    const view = this.settings.view;
    const schema = this.settings.schema;

    if (view === undefined || schema === undefined) {
      return null;
    }

    const list = document.createElement('div');

    list.setAttribute('data-blok-database-card-properties', '');
    for (const setting of resolveViewProperties(view, schema)) {
      const property = schema.find((p) => p.id === setting.id);

      if (!setting.visible || property === undefined || property.type === 'title') {
        continue;
      }

      const cell = renderCellValue(property, row.properties[property.id], { i18n: this.i18n, readOnly: true, locale: this.settings.locale });

      if (cell.hasAttribute('data-empty')) {
        continue;
      }

      const item = document.createElement('div');

      item.setAttribute('data-blok-database-card-property', '');
      item.setAttribute('data-property-id', property.id);
      item.setAttribute('data-wrap', String(setting.wrap));
      item.title = property.name;
      item.appendChild(cell);
      list.appendChild(item);
    }

    return list.childElementCount > 0 ? list : null;
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

    // An untitled card shows placeholder text; it must not seed the input or count as the old title.
    const originalTitle = titleEl.hasAttribute('data-placeholder') ? '' : titleEl.textContent ?? '';

    const buildTitleDiv = (title: string): HTMLElement => {
      const div = document.createElement('div');

      div.setAttribute('data-blok-database-card-title', '');

      if (title) {
        div.textContent = title;
      } else {
        div.textContent = this.i18n.t('tools.database.cardTitlePlaceholder');
        div.setAttribute('data-placeholder', '');
      }

      return div;
    };

    startInlineRename({
      target: titleEl,
      currentValue: originalTitle,
      label: this.i18n.t('tools.database.editCardTitle'),
      configureInput: (input) => {
        input.setAttribute('data-blok-database-card-title-input', '');
        input.style.setProperty('width', '100%');
        input.style.setProperty('box-sizing', 'border-box');
      },
      buildRestored: buildTitleDiv,
      onCommit: (newTitle) => {
        if (newTitle !== originalTitle) {
          this.onTitleEdit?.(rowId, newTitle);
        }

        cardEl.toggleAttribute('data-empty', newTitle === '');
      },
    });
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
