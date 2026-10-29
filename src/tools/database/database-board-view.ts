import { fileChipIcon, pageIconElement, showsPageIcon } from './page-icon';
import type { I18n } from '../../../types';
import type { SelectOption, DatabaseRow, DatabaseViewConfig, PropertyDefinition, CardSize } from './types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { NO_VALUE_GROUP_KEY } from './database-model';
import { createOptionPill, renderCellValue } from './cells';
import { shownStatusOption } from './cells/option-colors';
import { rowCellContext } from './reminders';
import type { CellContext } from './cells';
import { readPropertyValue } from './property-values';
import { createCardPreview } from './database-card-preview';
import type { BodyBlock } from './row-body';
import { resolveBoardCardPreview, resolveCardLayout, resolveCardSize, resolveFitImage, resolveViewProperties } from './view-settings';
import { getElementDirection } from '../../components/utils/direction';
import { IconPlus, IconPencilLine, IconDotsHorizontal, IconChevronDown, IconPage, IconSidebarRight } from '../../components/icons';
import { startInlineRename } from '../../components/utils/inline-rename';
import { onHover } from '../../components/utils/tooltip';
import { onPropertyHover } from './property-hint';
import { PROPERTY_TYPE_META } from './database-property-types';
import { syncCommentBadge } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';

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
  /** The board calculation beside a group's name; without it, the card count. Read live: a card add or removal asks again. */
  aggregate?: (optionId: string) => string;
  /** The count's hover hint. None for Count all, as in Notion. */
  aggregateHint?: string;
  /** How many groups the view hides; above zero, a button after the columns shows them again. */
  hiddenGroupCount?: number;
  /** The board's view: card size, preview and the properties cards show. Without it cards show only the title. */
  view?: DatabaseViewConfig;
  /** Localized schema. */
  schema?: PropertyDefinition[];
  /** The row's body blocks, for the page cover and page content previews. */
  bodyOf?: (rowId: string) => BodyBlock[];
  locale?: string;
  /** What cells need from the host: relation titles, computed result types. */
  cellContext?: Partial<CellContext>;
  /** A click on a card property: edit it in place. */
  onPropertyEdit?: (rowId: string, propertyId: string, anchor: HTMLElement) => void;
  /** Sub-groups: one horizontal lane each, holding every column. */
  subGroups?: BoardLane[];
  /** A band's ▼ toggle was clicked. The band folds on screen either way. */
  onLaneToggle?: (key: string, collapsed: boolean) => void;
  /** A column's full row count when `getRows` gives only the first page (load limit). */
  getTotal?: (optionId: string) => number;
  /** "Load more" under a column that holds more rows than it shows. */
  onLoadMore?: (optionId: string) => void;
  /** The host's comment counts. Without it there are no badges. */
  commentBadges?: CommentBadges;
  /** The add-card label: the default template's name (research/27 shot 04). Absent: "New page". */
  addCardLabel?: string;
  /** A lasso from the margin or a drag box over empty board space: these cards become the selection. Absent when read-only. */
  lassoRows?: (rowIds: string[]) => void;
}

/** A card title edit in progress, carried across a redraw so typed text is not lost. */
export interface CardTitleDraft {
  rowId: string;
  value: string;
  /** Enter with a name: make the next new card (feel findings B09). */
  onEnter?: () => void;
}

export interface BoardLane {
  key: string;
  label: string;
  /** Set for an option-like sub-group, so its label shows as a pill. */
  option?: SelectOption;
  /** The view saved this band collapsed. */
  collapsed?: boolean;
}

/** Card widths per card size (research/07; feel findings B30: Small 180, Large 320). */
const CARD_WIDTH: Record<CardSize, number> = { small: 180, medium: 260, large: 320 };
/** The column's 8px padding on each side (research/07). */
const COLUMN_PADDING = 16;
const CELL_LINK = 'a[data-blok-database-cell-link]';
/** Presses that belong to something else: a card, a header, a control. */
const BOX_START_BLOCKERS = [
  '[data-blok-database-card]', '[data-blok-database-column-header]', '[data-blok-database-board-heads]', '[data-blok-database-board-lane-header]',
  'button', 'a', 'input', 'textarea', '[role="button"]', '[contenteditable="true"]',
].join(', ');
/** Pixels a press must move before it draws a box, as in the calendar. */
const BOX_THRESHOLD = 4;

type Band = { left: number; top: number; right: number; bottom: number };

const isBand = (value: unknown): value is Band =>
  typeof value === 'object' && value !== null && 'left' in value && 'top' in value && 'right' in value && 'bottom' in value;

const touches = (el: Element, band: Band): boolean => {
  const r = el.getBoundingClientRect();

  return r.right > band.left && r.left < band.right && r.bottom > band.top && r.top < band.bottom;
};

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
  private readonly aggregate: ((optionId: string) => string) | undefined;
  private readonly aggregateHint: string | undefined;
  private readonly settings: Pick<DatabaseBoardViewOptions, 'view' | 'schema' | 'bodyOf' | 'locale' | 'onPropertyEdit' | 'subGroups' | 'onLaneToggle' | 'cellContext' | 'getTotal' | 'onLoadMore' | 'commentBadges' | 'addCardLabel' | 'lassoRows'>;
  private root: HTMLElement | null = null;
  private box: { startX: number; startY: number; el: HTMLElement | null; picked: string | null } | null = null;
  private readonly editHints = new WeakMap<HTMLElement, HTMLElement>();
  private editing: { rowId: string; input: HTMLInputElement; onEnter?: () => void } | null = null;

  constructor({
    readOnly, i18n, options, getRows, titlePropertyId, onTitleEdit, hideCounts, hiddenGroupCount, aggregate, aggregateHint, ...settings
  }: DatabaseBoardViewOptions) {
    this.aggregate = aggregate;
    this.aggregateHint = aggregateHint;
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
    boardArea.setAttribute('data-card-size', this.cardSize);
    boardArea.setAttribute('data-card-layout', this.settings.view === undefined ? 'list' : resolveCardLayout(this.settings.view));
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

    const lanes = this.settings.subGroups;
    // With lanes, the group buttons go after the one header row.
    const buttonRow = lanes !== undefined ? this.createHeads() : boardArea;

    // Zero lanes (every sub-group hidden) still draws as sub-grouped: an empty board, not every card.
    if (lanes !== undefined) {
      boardArea.setAttribute('data-sub-grouped', '');
      boardArea.style.flexDirection = 'column';
      boardArea.appendChild(buttonRow);
      lanes.forEach((lane) => boardArea.appendChild(this.createLane(lane)));
    } else {
      for (const option of this.options) {
        boardArea.appendChild(this.createColumnElement(option, this.getRows(option.id), this.titlePropertyId));
      }
    }

    // A Status board drops a hidden column without a trace (findings-board B25); Settings › Group lists it.
    if (this.hiddenGroupCount > 0 && !this.readOnly && !this.isStatusBoard) {
      const hiddenBtn = document.createElement('button');

      hiddenBtn.type = 'button';
      hiddenBtn.setAttribute('data-blok-database-hidden-groups', '');
      hiddenBtn.setAttribute('aria-haspopup', 'menu');
      hiddenBtn.textContent = this.i18n.t('tools.database.hiddenGroups');
      buttonRow.appendChild(hiddenBtn);
    }

    // Notion's Status board has no add-group button (findings-board B04).
    if (!this.readOnly && !this.isStatusBoard) {
      const addColumnBtn = document.createElement('button');

      addColumnBtn.setAttribute('data-blok-database-add-column', '');
      addColumnBtn.setAttribute('aria-label', this.i18n.t('tools.database.newGroup'));
      addColumnBtn.textContent = '+ ' + this.i18n.t('tools.database.newGroup');
      addColumnBtn.style.minWidth = '260px';
      addColumnBtn.style.flex = '0 0 260px';
      buttonRow.appendChild(addColumnBtn);
    }

    wrapper.appendChild(boardArea);
    boardArea.querySelector<HTMLElement>('[data-blok-database-card]')?.setAttribute('tabindex', '0');
    boardArea.addEventListener('click', this.onCardPropertyClick);
    boardArea.addEventListener('keydown', this.onCardKeyDown);
    if (!this.readOnly && this.settings.lassoRows !== undefined) {
      // Core leaves Shift-click inside to the tool and hands a margin lasso to onLasso.
      boardArea.setAttribute('data-blok-selection-owner', '');
      boardArea.addEventListener('blok-lasso', this.onLasso);
      boardArea.addEventListener('pointerdown', this.onBoxStart);
    }
    this.root = wrapper;

    return wrapper;
  }

  private readonly onLasso = (event: Event): void => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : null;
    const band = typeof detail === 'object' && detail !== null && 'rect' in detail ? detail.rect : null;

    if (isBand(band)) {
      event.preventDefault();
    }
    this.settings.lassoRows?.(isBand(band) ? this.cardsIn(band) : []);
  };

  /** research/35:237: a drag box from empty board space picks every card it touches. */
  private readonly onBoxStart = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const area = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

    if (target === null || area === null || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || target.closest(BOX_START_BLOCKERS) !== null
      // The area's own horizontal scrollbar sits below its client height.
      || (target === area && event.clientY >= area.getBoundingClientRect().top + area.clientHeight)) {
      return;
    }
    this.box = { startX: event.clientX, startY: event.clientY, el: null, picked: null };
    document.addEventListener('pointermove', this.onBoxMove);
    document.addEventListener('pointerup', this.endBox);
    document.addEventListener('pointercancel', this.endBox);
    document.addEventListener('selectstart', this.preventDefault);
  };

  private readonly preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onBoxMove = (event: PointerEvent): void => {
    const box = this.box;

    if (box === null) {
      return;
    }
    if (box.el === null) {
      if (Math.hypot(event.clientX - box.startX, event.clientY - box.startY) < BOX_THRESHOLD) {
        return;
      }
      box.el = document.createElement('div');
      box.el.setAttribute('data-blok-database-board-lasso', '');
      box.el.setAttribute('aria-hidden', 'true');
      // Fixed, in client coordinates: the board area scrolls sideways and is not positioned.
      Object.assign(box.el.style, { position: 'fixed', zIndex: '2', pointerEvents: 'none', backgroundColor: 'var(--blok-selection-highlight)' });
      this.root?.appendChild(box.el);
    }

    const band = {
      left: Math.min(box.startX, event.clientX),
      top: Math.min(box.startY, event.clientY),
      right: Math.max(box.startX, event.clientX),
      bottom: Math.max(box.startY, event.clientY),
    };

    Object.assign(box.el.style, {
      left: `${band.left}px`, top: `${band.top}px`, width: `${band.right - band.left}px`, height: `${band.bottom - band.top}px`,
    });

    const touched = this.cardsIn(band);
    const key = touched.join(' ');

    if (key !== box.picked) {
      box.picked = key;
      this.settings.lassoRows?.(touched);
    }
  };

  private readonly endBox = (): void => {
    this.box?.el?.remove();
    this.box = null;
    document.removeEventListener('pointermove', this.onBoxMove);
    document.removeEventListener('pointerup', this.endBox);
    document.removeEventListener('pointercancel', this.endBox);
    document.removeEventListener('selectstart', this.preventDefault);
  };

  destroy(): void {
    this.endBox();
  }

  /** Row ids of the shown cards a client-coordinate band touches, in board order. */
  private cardsIn(band: Band): string[] {
    const touched = [...(this.root?.querySelectorAll<HTMLElement>('[data-blok-database-card]') ?? [])]
      .filter((cardEl) => cardEl.closest('[data-blok-database-board-lane][data-collapsed]') === null && touches(cardEl, band))
      .map((cardEl) => cardEl.getAttribute('data-row-id') ?? '');

    return [...new Set(touched)];
  }

  /** Redraws these cards' property lines from the given rows, as a bulk edit types (research/35:234). */
  showDraft(rows: DatabaseRow[]): void {
    rows.forEach((row) => {
      this.root?.querySelectorAll<HTMLElement>(`[data-blok-database-card][data-row-id="${CSS.escape(row.id)}"]`).forEach((cardEl) => {
        const next = this.createCardProperties(row);
        const old = cardEl.querySelector(':scope > [data-blok-database-card-properties]');

        if (next === null) {
          old?.remove();
        } else if (old !== null) {
          old.replaceWith(next);
        } else {
          cardEl.insertBefore(next, cardEl.querySelector(':scope > [data-blok-database-card-actions]'));
        }
      });
    });
  }

  /** Sub-grouped boards show each column header once, above every lane. */
  private createHeads(): HTMLElement {
    const heads = document.createElement('div');

    heads.setAttribute('data-blok-database-board-heads', '');
    for (const option of this.options) {
      const head = document.createElement('div');

      head.setAttribute('data-blok-database-board-column-head', '');
      head.setAttribute('data-option-id', option.id);
      this.applyColumnLook(head, option);
      head.appendChild(this.createColumnHeader(option, this.getRows(option.id).length));
      heads.appendChild(head);
    }

    return heads;
  }

  /** One sub-group: its label (no count, research/31 §3), then a row of every column holding only its cards. */
  private createLane(lane: BoardLane): HTMLElement {
    const section = document.createElement('section');
    const header = document.createElement('div');
    const columns = document.createElement('div');
    const columnEls = this.options.map((option) => {
      const columnEl = this.createColumnElement(option, this.getRows(option.id, lane.key), this.titlePropertyId, false);

      columnEl.setAttribute('data-sub-group', lane.key);

      return columnEl;
    });
    section.setAttribute('data-blok-database-board-lane', '');
    section.setAttribute('data-sub-group', lane.key);
    section.setAttribute('aria-label', lane.label);
    header.setAttribute('data-blok-database-board-lane-header', '');
    header.appendChild(this.createLaneToggle(section, lane));
    if (lane.option !== undefined) {
      header.appendChild(createOptionPill(lane.option));
    } else {
      const label = document.createElement('span');

      label.textContent = lane.label;
      header.appendChild(label);
    }
    columns.setAttribute('data-blok-database-board-lane-columns', '');
    columns.append(...columnEls);
    section.append(header, columns);

    return section;
  }

  /** research/31 §3: only the arrow turns; the cards hide at once. */
  private createLaneToggle(section: HTMLElement, lane: BoardLane): HTMLButtonElement {
    const toggle = document.createElement('button');
    const setCollapsed = (collapsed: boolean): void => {
      section.toggleAttribute('data-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', this.i18n.t(collapsed ? 'tools.database.tableOpen' : 'tools.database.close'));
    };

    toggle.type = 'button';
    toggle.setAttribute('data-blok-database-board-lane-toggle', '');
    toggle.innerHTML = IconChevronDown;
    setCollapsed(lane.collapsed === true);
    toggle.addEventListener('click', () => {
      const collapsed = !section.hasAttribute('data-collapsed');

      setCollapsed(collapsed);
      this.settings.onLaneToggle?.(lane.key, collapsed);
    });

    return toggle;
  }

  /** Columns are a status property's options, not its groups. */
  private get isStatusBoard(): boolean {
    const view = this.settings.view;

    return view !== undefined && view.groupByStatus !== 'group'
      && this.settings.schema?.find((property) => property.id === view.groupBy)?.type === 'status';
  }

  private get cardSize(): CardSize {
    return this.settings.view === undefined ? 'medium' : resolveCardSize(this.settings.view);
  }

  private readonly onCardPropertyClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const property = target?.closest<HTMLElement>('[data-blok-database-card-property]');
    const rowId = property?.closest('[data-blok-database-card]')?.getAttribute('data-row-id');
    const propertyId = property?.getAttribute('data-property-id');

    // research/22 §3: a link on a card is followed; it does not edit.
    if (target !== null && target.closest(CELL_LINK) !== null) {
      return;
    }
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
        titleEl.textContent = this.i18n.t('tools.page.untitled');
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
  private createColumnElement(option: SelectOption, rows: DatabaseRow[], titlePropertyId: string, withHeader = true): HTMLDivElement {
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
    this.applyColumnLook(columnEl, option);

    const total = withHeader ? this.settings.getTotal?.(option.id) ?? rows.length : rows.length;

    if (withHeader) {
      columnEl.appendChild(this.createColumnHeader(option, total));
    }

    const cardsContainer = document.createElement('div');

    cardsContainer.setAttribute('data-blok-database-cards', '');
    cardsContainer.setAttribute('role', 'list');
    cardsContainer.setAttribute('data-blok-keyboard-owner', '');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.paddingTop = '3px';

    for (const row of rows) {
      const cardEl = this.createCardElement(row, titlePropertyId);

      cardsContainer.appendChild(cardEl);
    }

    columnEl.appendChild(cardsContainer);

    if (total > rows.length) {
      const more = document.createElement('button');

      more.type = 'button';
      more.setAttribute('data-blok-database-column-load-more', '');
      more.textContent = this.i18n.t('tools.database.galleryLoadMore');
      more.addEventListener('click', () => this.settings.onLoadMore?.(option.id));
      columnEl.appendChild(more);
    }

    if (!this.readOnly) {
      const addCardBtn = document.createElement('button');

      addCardBtn.setAttribute('data-blok-database-add-card', '');
      addCardBtn.setAttribute('data-option-id', option.id);

      const iconEl = document.createElement('span');

      iconEl.setAttribute('data-blok-database-add-card-icon', '');
      iconEl.innerHTML = IconPlus;
      addCardBtn.appendChild(iconEl);

      const labelEl = document.createElement('span');

      labelEl.textContent = this.settings.addCardLabel ?? this.i18n.t('tools.database.newPage');
      addCardBtn.appendChild(labelEl);

      columnEl.appendChild(addCardBtn);
    }

    return columnEl;
  }

  /** The column width and its group tint, ring and accent. */
  private applyColumnLook(el: HTMLElement, option: SelectOption): void {
    const columnWidth = `${CARD_WIDTH[this.cardSize] + COLUMN_PADDING}px`;

    el.style.setProperty('min-width', columnWidth);
    el.style.setProperty('flex', `0 0 ${columnWidth}`);

    const c = this.columnColor(option);

    // "Color columns" off: columns and cards drop the hue, pills keep it.
    if (c !== undefined && this.settings.view?.groupSettings?.colorColumns !== false) {

      // Only some hues were measured (colors.css); the rest derive from the option pill.
      el.style.setProperty('--_blok-group-tint', `var(--blok-database-column-${c}-bg, color-mix(in srgb, var(--blok-database-option-${c}-bg) 22%, transparent))`);
      el.style.setProperty('--_blok-group-ring', `var(--blok-database-column-${c}-ring, color-mix(in srgb, var(--blok-database-option-${c}-bg) 49%, transparent))`);
      // Unmeasured hues fall back to the pill text, which holds AA on the tint; the Marker text did not.
      el.style.setProperty('--_blok-group-accent', `var(--blok-database-column-${c}-accent, var(--blok-database-option-${c}-text))`);
      // Only dark defines a card tint, and only for measured hues; the rest keep the plain card.
      el.style.setProperty('--_blok-group-card', `var(--blok-database-column-${c}-card-bg, var(--blok-database-card-bg))`);
      el.style.setProperty('--_blok-group-card-hover', `var(--blok-database-column-${c}-card-hover-bg, var(--blok-database-card-bg-hover))`);
      // "+ New page" hovers to the card fill only where measured; other hues keep the list hover.
      el.style.setProperty('--_blok-group-add-hover', `var(--blok-database-column-${c}-add-hover-bg, var(--blok-database-add-hover-bg))`);
      el.setAttribute('data-color', c);
    }
  }

  /** A status option stored without a colour draws a gray pill, but its column stays uncoloured (findings-board B29). */
  private columnColor(option: SelectOption): SelectOption['color'] {
    if (!this.isStatusBoard) return option.color;
    const stored = this.settings.schema?.find((property) => property.id === this.settings.view?.groupBy)?.config?.options.find((o) => o.id === option.id);

    return stored === undefined ? option.color : stored.color;
  }

  /** The pill, the row count and, when editable, the header buttons. */
  private createColumnHeader(option: SelectOption, count: number): HTMLElement {
    const header = document.createElement('div');

    header.setAttribute('data-blok-database-column-header', '');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.padding = '0';
    header.style.gap = '6px';
    header.style.cursor = 'grab';

    const pill = document.createElement('div');
    const status = this.isStatusBoard && option.id !== NO_VALUE_GROUP_KEY;
    // A status header is the cell's status pill: a colourless option draws gray (B01).
    const color = status ? shownStatusOption(option).color : option.color;

    pill.setAttribute('data-blok-database-column-pill', '');
    pill.toggleAttribute('data-status', status);

    if (color !== undefined) {
      pill.style.backgroundColor = `var(--blok-database-option-${color}-bg)`;
      pill.style.color = `var(--blok-database-option-${color}-text)`;

      const dot = document.createElement('span');

      dot.setAttribute('data-blok-database-column-dot', '');
      dot.style.backgroundColor = status ? `var(--blok-database-status-dot-${color})` : `var(--blok-color-${color}-text)`;
      pill.appendChild(dot);
    }

    const titleEl = document.createElement('div');

    // The no-value label is not a rename target: column controls and rename lookups find the first column-title.
    titleEl.setAttribute(option.id === NO_VALUE_GROUP_KEY ? 'data-blok-database-no-value-label' : 'data-blok-database-column-title', '');
    titleEl.textContent = option.label;
    pill.appendChild(titleEl);

    header.appendChild(pill);

    // Read-only cannot change the calculation, so the number is not a button there.
    const countEl = document.createElement(this.readOnly ? 'span' : 'button');

    if (countEl instanceof HTMLButtonElement) {
      countEl.type = 'button';
      countEl.setAttribute('aria-haspopup', 'menu');
    }
    countEl.setAttribute('data-blok-database-column-count', '');
    countEl.setAttribute('data-blok-testid', 'database-column-count');
    countEl.setAttribute('data-option-id', option.id);
    countEl.textContent = this.aggregate?.(option.id) ?? String(count);
    // research/30 B26: the hint sits above the value.
    if (this.aggregateHint !== undefined) {
      onHover(countEl, this.aggregateHint, { placement: 'top' });
    }

    countEl.hidden = this.hideCounts;
    header.appendChild(countEl);

    if (!this.readOnly) {
      header.appendChild(this.createHeaderActions(option.id));
    }

    return header;
  }

  /** The "More group options" (⋯) and "New page" (+) buttons, shown on header hover. */
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

    actions.append(menu, newPage);

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
      titleEl.textContent = this.i18n.t('tools.page.untitled');
      titleEl.setAttribute('data-placeholder', '');
      cardEl.setAttribute('data-empty', '');
    }

    const icon = showsPageIcon(this.settings.view) ? pageIconElement(row) : null;

    if (icon !== null) {
      cardEl.appendChild(icon);
    }
    cardEl.appendChild(titleEl);
    if (this.settings.commentBadges !== undefined) syncCommentBadge(titleEl, row.id, this.settings.commentBadges, this.i18n);

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
      editBtn.innerHTML = IconPencilLine;
      // One hint node: the title edit swaps its text while the button opens the peek.
      const editHint = document.createElement('span');

      editHint.setAttribute('data-blok-database-edit-card-hint', '');
      editHint.textContent = this.i18n.t('tools.database.galleryCardEdit');
      onHover(editBtn, editHint);
      this.editHints.set(cardEl, editHint);
      // While editing, the button is Open in side peek: keep the caret in the title until the click lands.
      editBtn.addEventListener('mousedown', (e) => {
        if (cardEl.hasAttribute('data-editing')) e.preventDefault();
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.editing?.rowId === row.id && cardEl.hasAttribute('data-editing')) {
          this.editing.input.blur();
          cardEl.click();

          return;
        }
        this.startCardTitleEdit(cardEl, row.id);
      });

      const menuBtn = document.createElement('button');

      menuBtn.setAttribute('data-blok-database-card-menu', '');
      menuBtn.setAttribute('data-row-id', row.id);
      menuBtn.setAttribute('aria-label', this.i18n.t('tools.database.cardMenuLabel'));
      menuBtn.innerHTML = IconDotsHorizontal;
      onHover(menuBtn, this.i18n.t('tools.database.galleryCardMore'));

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

      const cell = renderCellValue(property, readPropertyValue(row, property), {
        ...this.settings.cellContext, i18n: this.i18n, readOnly: true, locale: this.settings.locale, ...rowCellContext(row, property.id),
      });

      if (cell.hasAttribute('data-empty')) {
        continue;
      }
      cell.querySelectorAll('[data-blok-database-file-chip]').forEach((chip) => chip.prepend(fileChipIcon()));
      // notion-spec-2 §21.7: a card's checkbox has the property name beside it.
      if (property.type === 'checkbox') {
        const name = document.createElement('span');

        name.setAttribute('data-blok-database-checkbox-name', '');
        name.setAttribute('aria-hidden', 'true');
        name.textContent = property.name;
        cell.appendChild(name);
      }

      const item = document.createElement('div');

      item.setAttribute('data-blok-database-card-property', '');
      item.setAttribute('data-property-id', property.id);
      item.setAttribute('data-wrap', String(setting.wrap));
      // research/35 §4: left of the card in Notion; Blok anchors on the value.
      onPropertyHover(item, property.name, property.description);
      item.appendChild(cell);
      list.appendChild(item);
    }

    return list.childElementCount > 0 ? list : null;
  }

  /** Edits a card's title in place; `value` seeds a draft carried over a redraw. */
  editTitle(rowId: string, options: { value?: string; onEnter?: () => void } = {}): void {
    const cardEl = this.root?.querySelector<HTMLElement>(`[data-blok-database-card][data-row-id="${CSS.escape(rowId)}"]`);

    if (this.readOnly || cardEl === null || cardEl === undefined) {
      return;
    }
    this.startCardTitleEdit(cardEl, rowId, options);
  }

  /** The edit in progress, taken off this board: its input will not save when the board goes away. */
  captureTitleDraft(): CardTitleDraft | null {
    const editing = this.editing;

    if (editing === null) {
      return null;
    }
    this.editing = null;

    return { rowId: editing.rowId, value: editing.input.value, ...(editing.onEnter !== undefined ? { onEnter: editing.onEnter } : {}) };
  }

  restoreTitleDraft(draft: CardTitleDraft): void {
    this.editTitle(draft.rowId, { value: draft.value, ...(draft.onEnter !== undefined ? { onEnter: draft.onEnter } : {}) });
  }

  /**
   * Swaps the card title for an input at the title's own size, caret at the end
   * (research/36 §4). While it is open the card shows the page glyph and the
   * pencil turns into Open in side peek (feel findings B22).
   */
  private startCardTitleEdit(cardEl: HTMLElement, rowId: string, options: { value?: string; onEnter?: () => void } = {}): void {
    const titleEl = cardEl.querySelector<HTMLElement>('[data-blok-database-card-title]');

    if (titleEl === null) {
      return;
    }

    // An untitled card shows placeholder text; it must not seed the input or count as the old title.
    const originalTitle = titleEl.hasAttribute('data-placeholder') ? '' : titleEl.textContent ?? '';
    const state: { viaEnter: boolean; input: HTMLInputElement | null } = { viaEnter: false, input: null };
    const editBtn = cardEl.querySelector<HTMLElement>('[data-blok-database-edit-card]');
    const editHint = this.editHints.get(cardEl);
    const endEditing = (): void => {
      cardEl.removeAttribute('data-editing');
      cardEl.querySelector(':scope > [data-blok-database-card-edit-glyph]')?.remove();
      cardEl.querySelectorAll('[data-blok-database-card-property][data-ghost]').forEach((ghost) => ghost.remove());
      const list = cardEl.querySelector(':scope > [data-blok-database-card-properties]');

      if (list !== null && list.childElementCount === 0) list.remove();
      if (editBtn !== null) {
        editBtn.innerHTML = IconPencilLine;
        editBtn.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
      }
      if (editHint !== undefined) editHint.textContent = this.i18n.t('tools.database.galleryCardEdit');
    };

    const buildTitleDiv = (title: string): HTMLElement => {
      const div = document.createElement('div');

      div.setAttribute('data-blok-database-card-title', '');

      if (title) {
        div.textContent = title;
      } else {
        div.textContent = this.i18n.t('tools.page.untitled');
        div.setAttribute('data-placeholder', '');
      }

      return div;
    };

    startInlineRename({
      target: titleEl,
      currentValue: originalTitle,
      label: this.i18n.t('tools.database.editCardTitle'),
      // research/35 §9: Notion saves a card rename on Escape.
      escapeCommits: true,
      configureInput: (input) => {
        input.setAttribute('data-blok-database-card-title-input', '');
        input.setAttribute('placeholder', this.i18n.t('tools.database.cardNamePlaceholder'));
        if (options.value !== undefined) Object.assign(input, { value: options.value });
        // Added before the rename's own keydown listener, so it runs first.
        input.addEventListener('keydown', (event) => {
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- Keep the IME 229 fallback when isComposing is false.
          state.viaEnter = event.key === 'Enter' && !event.isComposing && event.keyCode !== 229;
        });
        state.input = input;
        this.editing = { rowId, input, ...(options.onEnter !== undefined ? { onEnter: options.onEnter } : {}) };
      },
      buildRestored: buildTitleDiv,
      onCommit: (newTitle) => {
        const editing = this.editing;

        // A redraw took the draft (captureTitleDraft): the new board saves it.
        if (editing === null || editing.input !== state.input) {
          return;
        }
        this.editing = null;
        endEditing();
        if (newTitle !== originalTitle) {
          this.onTitleEdit?.(rowId, newTitle);
        }

        cardEl.toggleAttribute('data-empty', newTitle === '');
        // An empty Enter makes no next card: held Enter would make one after another (Notion unmeasured).
        if (state.viaEnter && newTitle !== '') {
          editing.onEnter?.();
        }
      },
    });

    const input = state.input;

    if (input === null || this.editing?.input !== input) {
      return;
    }
    input.setSelectionRange(input.value.length, input.value.length);
    cardEl.setAttribute('data-editing', '');
    // A page with its own icon keeps it; the blank page glyph stands in for none.
    if (cardEl.querySelector(':scope > [data-blok-database-page-icon]') === null) {
      const glyph = document.createElement('span');

      glyph.setAttribute('data-blok-database-card-edit-glyph', '');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = IconPage;
      input.before(glyph);
    }
    if (editBtn !== null) {
      editBtn.innerHTML = IconSidebarRight;
      editBtn.setAttribute('aria-label', this.i18n.t('tools.page.openInSidePeek'));
    }
    if (editHint !== undefined) editHint.textContent = this.i18n.t('tools.page.openInSidePeek');
    this.addGhostProperties(cardEl, rowId);
  }

  /**
   * Faint "Add <property>" rows for the card's empty visible properties, shown
   * only while its title is edited (feel findings B09, B22).
   */
  private addGhostProperties(cardEl: HTMLElement, rowId: string): void {
    const view = this.settings.view;
    const schema = this.settings.schema;

    if (view === undefined || schema === undefined) {
      return;
    }
    const shown = new Set([...cardEl.querySelectorAll('[data-blok-database-card-property]')].map((el) => el.getAttribute('data-property-id')));
    const empty = resolveViewProperties(view, schema)
      .map((setting) => (setting.visible ? schema.find((p) => p.id === setting.id) : undefined))
      .filter((property): property is PropertyDefinition => property !== undefined && property.type !== 'title' && !shown.has(property.id));

    if (empty.length === 0) {
      return;
    }
    const list = cardEl.querySelector(':scope > [data-blok-database-card-properties]') ?? document.createElement('div');

    list.setAttribute('data-blok-database-card-properties', '');
    for (const property of empty) {
      const ghost = document.createElement('div');
      const glyph = document.createElement('span');

      ghost.setAttribute('data-blok-database-card-property', '');
      ghost.setAttribute('data-ghost', '');
      ghost.setAttribute('data-property-id', property.id);
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = PROPERTY_TYPE_META[property.type].icon;
      ghost.append(glyph, this.i18n.t('tools.database.cardAddProperty', { property: property.name }));
      // Keep the caret in the title until the click: a blur would drop this row first.
      ghost.addEventListener('mousedown', (event) => event.preventDefault());
      ghost.addEventListener('click', (event) => {
        event.stopPropagation();
        this.editing?.input.blur();
        if (cardEl.isConnected) this.settings.onPropertyEdit?.(rowId, property.id, cardEl);
      });
      list.appendChild(ghost);
    }
    if (list.parentElement === null) {
      cardEl.insertBefore(list, cardEl.querySelector(':scope > [data-blok-database-card-actions]'));
    }
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
      const optionId = columnEl.getAttribute('data-option-id');
      const cardCount = cardsContainer.querySelectorAll('[data-blok-database-card]').length;

      countEl.textContent = this.aggregate !== undefined && optionId !== null ? this.aggregate(optionId) : String(cardCount);
    }
  }
}
