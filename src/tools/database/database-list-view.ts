import { pageIconElement, pagePlaceholderIcon } from './page-icon';
import type { I18n } from '../../../types';
import type { DatabaseRow, PropertyDefinition, PropertyValue, SelectOption } from './types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { filesOf, readPropertyValue } from './property-values';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import { createOptionPill, renderCellValue } from './cells';
import { shownStatusOption } from './cells/option-colors';
import { rowCellContext } from './reminders';
import type { CellContext } from './cells';
import { IconChevronDown, IconDotsHorizontal, IconMenu, IconPencil, IconPlus, IconSidebarRight } from '../../components/icons';
import { startInlineRename } from '../../components/utils/inline-rename';
import { onHover } from '../../components/utils/tooltip';
import { propertyHint } from './property-hint';
import { syncCommentBadge } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';

interface DatabaseListViewOptions {
  readOnly: boolean;
  i18n: I18n;
  rows: DatabaseRow[];
  titlePropertyId: string;
  schema: PropertyDefinition[];
  visiblePropertyIds: string[];
  options?: SelectOption[];
  getRows?: (optionId: string) => DatabaseRow[];
  /** Groups the view saved collapsed. */
  collapsedGroupIds?: ReadonlySet<string>;
  onToggleCollapse?: (optionId: string, collapsed: boolean) => void;
  /** Show each row's page icon before its title. Default true. */
  showPageIcon?: boolean;
  /** What cells need from the host: people, computed result types, relation titles. */
  cellContext?: Partial<CellContext>;
  /** The host's comment counts. Without it there are no badges. */
  commentBadges?: CommentBadges;
  locale?: string;
  /** A click or Enter on an editable property: edit it in place. */
  onPropertyEdit?: (rowId: string, propertyId: string, anchor: HTMLElement) => void;
  /** Shift+Enter on a row: a new item below it, in the same group (`null` when ungrouped). */
  onNewBelow?: (rowId: string, groupKey: string | null) => void;
  onTitleEdit?: (rowId: string, title: string) => void;
  /** Open in side peek on a title being edited. Saving the title may redraw the view, so a bubbling click is not enough. */
  onOpenRow?: (rowId: string) => void;
  /** Rows the flat list holds in all, when `rows` is only the first page (load limit). */
  total?: number;
  /** A group's full row count when `getRows` gives only the first page. */
  getTotal?: (optionId: string) => number;
  /** "Load more" for a group, or `''` for the flat list. */
  onLoadMore?: (groupKey: string) => void;
  /** A lasso from the page margin: these rows become the selection. Absent when read-only. */
  lassoRows?: (rowIds: string[]) => void;
}

/** Types without an editor: computed, or written by Blok itself. */
const NOT_EDITABLE = new Set<PropertyDefinition['type']>([
  'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId', 'formula', 'rollup', 'button',
]);

const ROW_SELECTOR = '[data-blok-database-list-row]';
const EDITABLE_SLOT_SELECTOR = '[data-blok-database-list-row-property][data-editable]';

/**
 * DOM rendering layer for the flat list view.
 * Renders rows as a flat list with optional property badges.
 * All interactive elements use data-blok-database-* attributes for test selectors and event delegation.
 */
export class DatabaseListView implements DatabaseViewRenderer {
  private readonly readOnly: boolean;
  private readonly i18n: I18n;
  private readonly rows: DatabaseRow[];
  private readonly titlePropertyId: string;
  private readonly schema: PropertyDefinition[];
  private readonly visiblePropertyIds: string[];
  private readonly groupOptions: SelectOption[] | undefined;
  private readonly getGroupRows: ((optionId: string) => DatabaseRow[]) | undefined;
  private readonly collapsedGroupIds: ReadonlySet<string>;
  private readonly showPageIcon: boolean;
  private readonly onToggleCollapse: ((optionId: string, collapsed: boolean) => void) | undefined;
  private readonly settings: Pick<DatabaseListViewOptions,
    'cellContext' | 'commentBadges' | 'locale' | 'onPropertyEdit' | 'onNewBelow' | 'onTitleEdit' | 'onOpenRow' | 'total' | 'getTotal' | 'onLoadMore' | 'lassoRows'>;
  private wrapper: HTMLDivElement | null = null;
  /** Where a Shift+Arrow selection started (findings-listgallery L20). */
  private selectionAnchor: HTMLElement | null = null;

  constructor({ readOnly, i18n, rows, titlePropertyId, schema, visiblePropertyIds, options, getRows, collapsedGroupIds, onToggleCollapse, showPageIcon, ...settings }: DatabaseListViewOptions) {
    this.settings = settings;
    this.showPageIcon = showPageIcon !== false;
    this.readOnly = readOnly;
    this.i18n = i18n;
    this.rows = rows;
    this.titlePropertyId = titlePropertyId;
    this.schema = schema;
    this.visiblePropertyIds = visiblePropertyIds;
    this.groupOptions = options;
    this.getGroupRows = getRows;
    this.collapsedGroupIds = collapsedGroupIds ?? new Set();
    this.onToggleCollapse = onToggleCollapse;
  }

  /**
   * Creates the full list DOM from row data.
   * When options are provided, renders grouped sections; otherwise renders a flat list.
   */
  createView(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-database-list', '');
    // Tab and Shift+Enter belong to the list, not to Blok's block indent and split.
    wrapper.setAttribute('data-blok-keyboard-owner', '');

    if (this.groupOptions !== undefined && this.groupOptions.length > 0 && this.getGroupRows !== undefined) {
      for (const option of this.groupOptions) {
        const rows = this.getGroupRows(option.id);
        const groupEl = this.createGroupElement(option, rows);

        wrapper.appendChild(groupEl);
      }
    } else {
      // role="list" may hold list items only, so the buttons go after it.
      const rowsEl = document.createElement('div');

      rowsEl.setAttribute('data-blok-database-list-rows', '');
      rowsEl.setAttribute('role', 'list');
      rowsEl.setAttribute('aria-label', this.i18n.t('tools.database.listView'));
      for (const row of this.rows) {
        rowsEl.appendChild(this.createRowElement(row));
      }
      wrapper.appendChild(rowsEl);

      const more = this.createLoadMore('', this.rows.length, this.settings.total);

      if (more !== null) {
        wrapper.appendChild(more);
      }

      if (!this.readOnly) {
        const addRowBtn = this.createAddRowButton();

        wrapper.appendChild(addRowBtn);
      }
    }

    wrapper.querySelector(ROW_SELECTOR)?.setAttribute('tabindex', '0');
    wrapper.addEventListener('click', this.onClick);
    // Open in side peek keeps the caret in the title until its click lands.
    wrapper.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null;

      if ((target?.closest('[data-blok-database-list-row][data-editing] [data-blok-database-list-row-edit]') ?? null) !== null) {
        event.preventDefault();
      }
    });
    wrapper.addEventListener('keydown', this.onKeyDown);
    if (!this.readOnly && this.settings.lassoRows !== undefined) {
      // Core leaves Shift-click inside to the tool and hands a margin lasso to onLasso.
      wrapper.setAttribute('data-blok-selection-owner', '');
      wrapper.addEventListener('blok-lasso', this.onLasso);
    }
    this.wrapper = wrapper;

    return wrapper;
  }

  /** research/35:238: a lasso from the right margin picks every row it touches. */
  private readonly onLasso = (event: Event): void => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : null;
    const band = typeof detail === 'object' && detail !== null && 'rect' in detail ? detail.rect : null;

    if (!isBand(band)) {
      this.settings.lassoRows?.([]);

      return;
    }
    event.preventDefault();
    const touched = [...(this.wrapper?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])]
      .filter((rowEl) => rowEl.closest('[data-blok-database-list-group][data-collapsed]') === null && touches(rowEl, band))
      .map((rowEl) => rowEl.getAttribute('data-row-id') ?? '');

    this.settings.lassoRows?.([...new Set(touched)]);
  };

  /** Redraws these rows' properties from the given rows, as a bulk edit types (research/35:235). */
  showDraft(rows: DatabaseRow[]): void {
    rows.forEach((row) => {
      this.wrapper?.querySelectorAll(`${ROW_SELECTOR}[data-row-id="${CSS.escape(row.id)}"] > [data-blok-database-list-row-properties]`)
        .forEach((old) => old.replaceWith(this.createPropertiesElement(row)));
    });
  }

  /**
   * Swaps a row's title for an input; Enter or blur commits through `onTitleEdit`.
   * While it is open the row shows the page glyph, and the pencil turns into
   * Open in side peek (findings-listgallery L05).
   */
  editTitle(rowId: string): void {
    const rowEl = this.rowElement(rowId);
    const titleEl = rowEl?.querySelector<HTMLElement>('[data-blok-database-list-row-title]');

    if (this.readOnly || rowEl === null || rowEl === undefined || titleEl === null || titleEl === undefined) {
      return;
    }
    const original = titleEl.hasAttribute('data-placeholder') ? '' : titleEl.textContent ?? '';
    const edit = rowEl.querySelector<HTMLElement>('[data-blok-database-list-row-edit]');
    const glyph = rowEl.querySelector('[data-blok-database-page-icon]') === null ? pagePlaceholderIcon() : null;
    const endEditing = (): void => {
      rowEl.removeAttribute('data-editing');
      glyph?.remove();
      if (edit !== null) {
        edit.innerHTML = IconPencil;
        edit.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
      }
    };

    startInlineRename({
      target: titleEl,
      currentValue: original,
      allowEmpty: true,
      label: this.i18n.t('tools.database.editCardTitle'),
      configureInput: (input) => {
        input.setAttribute('data-blok-database-list-title-input', '');
        input.setAttribute('placeholder', this.i18n.t('tools.database.cardNamePlaceholder'));
      },
      buildRestored: (title) => this.createTitleElement(title),
      onCommit: (title) => {
        endEditing();
        if (title !== original) {
          this.settings.onTitleEdit?.(rowId, title);
        }
        this.focusRow(rowEl);
      },
      onCancel: () => {
        endEditing();
        this.focusRow(rowEl);
        // findings-listgallery L20: Escape from the title selects the row.
        this.selectByKey([rowEl], rowEl, rowEl);
      },
    });
    rowEl.setAttribute('data-editing', '');
    if (glyph !== null) {
      rowEl.querySelector('[data-blok-database-list-row-main]')?.before(glyph);
    }
    if (edit !== null) {
      edit.innerHTML = IconSidebarRight;
      edit.setAttribute('aria-label', this.i18n.t('tools.page.openInSidePeek'));
    }
  }

  private rowElement(rowId: string): HTMLElement | null {
    return this.wrapper?.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-row-id="${CSS.escape(rowId)}"]`) ?? null;
  }

  private createLoadMore(groupKey: string, shown: number, total: number | undefined): HTMLButtonElement | null {
    if (total === undefined || total <= shown || this.settings.onLoadMore === undefined) {
      return null;
    }
    const more = document.createElement('button');

    more.type = 'button';
    more.setAttribute('data-blok-database-list-load-more', '');
    more.setAttribute('data-group-key', groupKey);
    more.textContent = this.i18n.t('tools.database.tableLoadMore');

    return more;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const more = target?.closest<HTMLElement>('[data-blok-database-list-load-more]');

    if (more !== null && more !== undefined) {
      this.settings.onLoadMore?.(more.getAttribute('data-group-key') ?? '');

      return;
    }
    const rowEl = target?.closest<HTMLElement>(ROW_SELECTOR);

    // The gutter "+" and the Edit pencil act here, so the row never opens.
    if (rowEl !== null && rowEl !== undefined && target?.closest('[data-blok-database-list-row-add]') !== null) {
      event.stopPropagation();
      this.newBelow(rowEl);

      return;
    }
    if (rowEl !== null && rowEl !== undefined && target?.closest('[data-blok-database-list-row-edit]') !== null) {
      event.stopPropagation();
      // While editing it is Open in side peek: save the title, then open the row.
      if (rowEl.hasAttribute('data-editing')) {
        rowEl.querySelector<HTMLInputElement>('[data-blok-database-list-title-input]')?.blur();
        this.settings.onOpenRow?.(rowEl.getAttribute('data-row-id') ?? '');

        return;
      }
      this.editTitle(rowEl.getAttribute('data-row-id') ?? '');

      return;
    }
    const slot = target?.closest<HTMLElement>(EDITABLE_SLOT_SELECTOR);

    // A link inside the value keeps its own click.
    if (slot === null || slot === undefined || target?.closest('a[href]') !== null) {
      return;
    }
    event.stopPropagation();
    this.editSlot(slot);
  };

  private editSlot(slot: HTMLElement): void {
    const rowId = slot.closest(ROW_SELECTOR)?.getAttribute('data-row-id');
    const propertyId = slot.getAttribute('data-property-id');

    if (rowId !== null && rowId !== undefined && propertyId !== null) {
      this.settings.onPropertyEdit?.(rowId, propertyId, slot);
    }
  }

  /** Notion's list keys (research/03 §5): Tab walks a row's properties, Shift+Enter adds an item below. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const slot = target?.matches(EDITABLE_SLOT_SELECTOR) === true ? target : null;
    const rowEl = target?.matches(ROW_SELECTOR) === true ? target : slot?.closest<HTMLElement>(ROW_SELECTOR) ?? null;

    if (rowEl === null || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const handled = slot === null ? this.onRowKey(rowEl, event) : this.onSlotKey(rowEl, slot, event);

    // Immediate: the tool's own Escape listener sits on this same element.
    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private onRowKey(rowEl: HTMLElement, event: KeyboardEvent): boolean {
    if (event.key === 'Enter' && event.shiftKey) {
      return this.newBelow(rowEl);
    }
    if (event.key === 'Enter') {
      rowEl.click();

      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = this.visibleRows();
      const next = rows[rows.indexOf(rowEl) + (event.key === 'ArrowDown' ? 1 : -1)];

      if (next !== undefined) {
        this.focusRow(next);
        this.selectByKey(rows, next, event.shiftKey ? this.selectionAnchor ?? rowEl : next);
      }

      return true;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      const first = this.slotsOf(rowEl)[0];

      first?.focus();

      return first !== undefined;
    }

    return false;
  }

  /** Arrows select the row they reach; Shift+Arrow selects from the anchor to it. The tint is the gray selection. */
  private selectByKey(rows: HTMLElement[], target: HTMLElement, anchor: HTMLElement): void {
    if (this.readOnly || this.settings.lassoRows === undefined) {
      return;
    }
    // A redraw may have dropped the old anchor: start again from the target.
    const start = rows.includes(anchor) ? anchor : target;
    const [from, to] = [rows.indexOf(start), rows.indexOf(target)].sort((a, b) => a - b);

    this.selectionAnchor = start;
    this.settings.lassoRows(rows.slice(from, to + 1).map((el) => el.getAttribute('data-row-id') ?? ''));
  }

  private onSlotKey(rowEl: HTMLElement, slot: HTMLElement, event: KeyboardEvent): boolean {
    if (event.key === 'Enter' && event.shiftKey) {
      return this.newBelow(rowEl);
    }
    if (event.key === 'Enter') {
      this.editSlot(slot);

      return true;
    }
    if (event.key === 'Escape') {
      this.focusRow(rowEl);

      return true;
    }
    if (event.key === 'Tab') {
      const slots = this.slotsOf(rowEl);
      const next = event.shiftKey ? slots[slots.indexOf(slot) - 1] ?? rowEl : slots[slots.indexOf(slot) + 1];

      next?.focus();

      return next !== undefined;
    }

    return false;
  }

  private newBelow(rowEl: HTMLElement): boolean {
    const rowId = rowEl.getAttribute('data-row-id');

    if (this.readOnly || rowId === null || this.settings.onNewBelow === undefined) {
      return false;
    }
    this.settings.onNewBelow(rowId, rowEl.closest('[data-blok-database-list-group]')?.getAttribute('data-option-id') ?? null);

    return true;
  }

  private focusRow(rowEl: HTMLElement): void {
    this.wrapper?.querySelectorAll(ROW_SELECTOR).forEach((el) => el.setAttribute('tabindex', el === rowEl ? '0' : '-1'));
    rowEl.setAttribute('tabindex', '0');
    rowEl.focus();
  }

  /** Rows of expanded groups, in order. */
  private visibleRows(): HTMLElement[] {
    return [...(this.wrapper?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])]
      .filter((el) => el.closest('[data-blok-database-list-group][data-collapsed]') === null);
  }

  private slotsOf(rowEl: HTMLElement): HTMLElement[] {
    return [...rowEl.querySelectorAll<HTMLElement>(EDITABLE_SLOT_SELECTOR)];
  }

  /**
   * Creates a collapsible group element for a select option.
   */
  private createGroupElement(option: SelectOption, rows: DatabaseRow[]): HTMLDivElement {
    const groupEl = document.createElement('div');

    groupEl.setAttribute('data-blok-database-list-group', '');
    groupEl.setAttribute('data-option-id', option.id);

    const header = this.createGroupHeader(option);

    // Rows container
    const rowsContainer = document.createElement('div');

    rowsContainer.setAttribute('data-blok-database-list-rows', '');
    rowsContainer.setAttribute('role', 'list');

    for (const row of rows) {
      const rowEl = this.createRowElement(row);

      rowsContainer.appendChild(rowEl);
    }

    const more = this.createLoadMore(option.id, rows.length, this.settings.getTotal?.(option.id));

    // Add-row button
    const addRowBtn = this.readOnly ? null : this.createAddRowButton(option.id);

    // Rows show and hide at once; only the caret turns (database.css, research/08).
    const toggle = header.querySelector<HTMLElement>('[data-blok-database-list-group-toggle]');
    const setCollapsed = (collapsed: boolean): void => {
      rowsContainer.style.display = collapsed ? 'none' : '';
      groupEl.toggleAttribute('data-collapsed', collapsed);
      toggle?.setAttribute('aria-expanded', String(!collapsed));
      toggle?.setAttribute('aria-label', this.i18n.t(collapsed ? 'tools.database.tableExpandGroup' : 'tools.database.tableCollapseGroup'));
      if (more !== null) {
        more.style.display = collapsed ? 'none' : '';
      }

      if (addRowBtn !== null) {
        addRowBtn.style.display = collapsed ? 'none' : '';
      }
    };

    if (this.collapsedGroupIds.has(option.id)) {
      setCollapsed(true);
    }

    header.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;

      if ((target?.closest('[data-blok-database-list-group-actions]') ?? null) !== null) {
        // "+" adds through the group's own "+ New page"; "…" is the host's group menu.
        if (target.closest('[data-blok-database-list-group-add]') !== null) {
          groupEl.querySelector<HTMLElement>(':scope > [data-blok-database-add-row]')?.click();
        }

        return;
      }
      const collapsed = !groupEl.hasAttribute('data-collapsed');

      setCollapsed(collapsed);
      this.onToggleCollapse?.(option.id, collapsed);
    });

    groupEl.appendChild(header);
    groupEl.appendChild(rowsContainer);
    if (more !== null) {
      groupEl.appendChild(more);
    }

    if (addRowBtn !== null) {
      groupEl.appendChild(addRowBtn);
    }

    return groupEl;
  }

  /** The board header's parts (findings-listgallery L08): caret, the value as its pill, then "…" and "+". */
  private createGroupHeader(option: SelectOption): HTMLDivElement {
    const header = document.createElement('div');
    const toggle = document.createElement('button');
    const label = document.createElement('span');

    header.setAttribute('data-blok-database-list-group-header', '');
    toggle.type = 'button';
    toggle.setAttribute('data-blok-database-list-group-toggle', '');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', this.i18n.t('tools.database.tableCollapseGroup'));
    toggle.innerHTML = IconChevronDown;
    label.setAttribute('data-blok-database-list-group-label', '');
    label.appendChild(this.groupValue(option));
    header.append(toggle, label);

    if (!this.readOnly) {
      const actions = document.createElement('span');
      const menu = document.createElement('button');
      const add = document.createElement('button');

      actions.setAttribute('data-blok-database-list-group-actions', '');
      menu.type = 'button';
      // The board's group menu attribute: the host opens the same menu.
      menu.setAttribute('data-blok-database-column-menu', '');
      menu.setAttribute('data-option-id', option.id);
      menu.setAttribute('aria-label', this.i18n.t('tools.database.groupMenuLabel'));
      menu.setAttribute('aria-haspopup', 'menu');
      menu.innerHTML = IconDotsHorizontal;
      add.type = 'button';
      add.setAttribute('data-blok-database-list-group-add', '');
      add.setAttribute('aria-label', this.i18n.t('tools.database.newPage'));
      add.innerHTML = IconPlus;
      actions.append(menu, add);
      header.appendChild(actions);
    }

    return header;
  }

  /** An option group shows the pill a cell draws; any other group, its label. */
  private groupValue(option: SelectOption): HTMLElement {
    const property = this.schema.find((p) => p.config?.options.some((o) => o.id === option.id) === true);

    if (property?.type === 'status') {
      const pill = createOptionPill(shownStatusOption(option));
      const kind = property.status?.groups.find((group) => group.id === option.groupId)?.kind;

      pill.setAttribute('data-status-group', kind ?? 'todo');

      return pill;
    }
    if (property !== undefined) {
      return createOptionPill(option);
    }
    const title = document.createElement('span');

    title.setAttribute('data-blok-database-list-group-title', '');
    title.textContent = option.label;

    return title;
  }

  /**
   * Creates a row element and inserts it before the add-row button (if present), else appends.
   */
  appendRow(container: HTMLElement, row: DatabaseRow): void {
    const rowEl = this.createRowElement(row);
    // The flat list's wrapper holds its rows in a role="list" child.
    const target = container.querySelector<HTMLElement>(':scope > [data-blok-database-list-rows]') ?? container;
    const addRowBtn = target.querySelector(':scope > [data-blok-database-add-row]');

    if (addRowBtn !== null) {
      target.insertBefore(rowEl, addRowBtn);
    } else {
      target.appendChild(rowEl);
    }
  }

  /**
   * Removes a row element from the wrapper by its data-row-id.
   */
  removeRow(wrapper: HTMLElement, rowId: string): void {
    const rowEl = wrapper.querySelector(`[data-row-id="${rowId}"]`);

    rowEl?.remove();
  }

  /**
   * Updates the visible title of a row element found by its data-row-id.
   */
  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const rowEl = wrapper.querySelector(`[data-row-id="${rowId}"]`);
    const titleEl = rowEl?.querySelector('[data-blok-database-list-row-title]');

    if (titleEl === null || titleEl === undefined) {
      return;
    }

    if (title) {
      titleEl.textContent = title;
      titleEl.removeAttribute('data-placeholder');
    } else {
      titleEl.textContent = this.i18n.t('tools.database.rowTitlePlaceholder');
      titleEl.setAttribute('data-placeholder', '');
    }
  }

  /**
   * Creates a single row element.
   */
  private createRowElement(row: DatabaseRow): HTMLDivElement {
    const rowEl = document.createElement('div');
    const title = (row.properties[this.titlePropertyId] as string) ?? '';

    rowEl.setAttribute('data-blok-database-list-row', '');
    rowEl.setAttribute('data-row-id', row.id);
    rowEl.setAttribute('role', 'listitem');
    rowEl.setAttribute('tabindex', '-1');

    if (!this.readOnly) {
      rowEl.appendChild(this.createGutter(row.id));
    }

    const icon = this.showPageIcon ? pageIconElement(row) : null;

    if (icon !== null) {
      rowEl.appendChild(icon);
    }
    const titleEl = this.createTitleElement(title);
    // Notion's title box: the title, then the Edit pencil, with a 120px floor (findings-listgallery L01, L04).
    const main = document.createElement('div');

    main.setAttribute('data-blok-database-list-row-main', '');
    main.appendChild(titleEl);
    if (!this.readOnly) {
      main.appendChild(this.createEditButton());
    }
    rowEl.appendChild(main);
    if (this.settings.commentBadges !== undefined) syncCommentBadge(titleEl, row.id, this.settings.commentBadges, this.i18n);

    const propertiesEl = this.createPropertiesElement(row);

    rowEl.appendChild(propertiesEl);

    return rowEl;
  }

  /** The ⋮⋮ left of the row: drags the row, and a click opens the row menu (research/12 §3, 66-list-handle-click.png). */
  private createGutter(rowId: string): HTMLElement {
    const gutter = document.createElement('div');
    const handle = document.createElement('button');

    gutter.setAttribute('data-blok-database-list-row-gutter', '');
    const add = document.createElement('button');

    add.type = 'button';
    add.setAttribute('data-blok-database-list-row-add', '');
    add.setAttribute('aria-label', this.i18n.t('tools.database.tableAddBelow'));
    add.tabIndex = -1;
    add.innerHTML = IconPlus;
    gutter.appendChild(add);
    handle.type = 'button';
    handle.setAttribute('data-blok-database-list-row-handle', '');
    handle.setAttribute('data-row-id', rowId);
    handle.setAttribute('aria-label', this.i18n.t('tools.database.tableDragHandle'));
    handle.tabIndex = -1;
    handle.innerHTML = IconMenu;
    gutter.appendChild(handle);

    return gutter;
  }

  /** Notion's white "Edit" pencil after the title: renames the row in place (findings-listgallery L04). */
  private createEditButton(): HTMLButtonElement {
    const edit = document.createElement('button');

    edit.type = 'button';
    edit.setAttribute('data-blok-database-list-row-edit', '');
    edit.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
    edit.tabIndex = -1;
    edit.innerHTML = IconPencil;

    return edit;
  }

  private createTitleElement(title: string): HTMLDivElement {
    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-list-row-title', '');

    if (title) {
      titleEl.textContent = title;
    } else {
      titleEl.textContent = this.i18n.t('tools.database.rowTitlePlaceholder');
      titleEl.setAttribute('data-placeholder', '');
    }

    return titleEl;
  }

  /**
   * Creates the properties container with the filled property slots.
   */
  private createPropertiesElement(row: DatabaseRow): HTMLDivElement {
    const propertiesEl = document.createElement('div');

    propertiesEl.setAttribute('data-blok-database-list-row-properties', '');

    for (const propId of this.visiblePropertyIds) {
      const propDef = this.schema.find(p => p.id === propId);

      if (propDef === undefined) {
        continue;
      }

      const badge = this.createPropertyBadge(propDef, readPropertyValue(row, propDef), row);

      if (badge !== null) {
        propertiesEl.appendChild(badge);
      }
    }

    return propertiesEl;
  }

  /**
   * One property slot: the shared cell display, or null when it shows
   * nothing (the list shows only filled properties, as the board does).
   */
  private createPropertyBadge(propDef: PropertyDefinition, value: PropertyValue | undefined, row: DatabaseRow): HTMLSpanElement | null {
    const cell = renderCellValue(propDef, value, {
      ...this.settings.cellContext,
      i18n: this.i18n,
      readOnly: true,
      ...rowCellContext(row, propDef.id),
      ...(this.settings.locale !== undefined ? { locale: this.settings.locale } : {}),
    });

    // A stale option id or a value of the wrong type draws nothing, though it is not empty.
    if (cell.hasAttribute('data-empty') || !cell.hasChildNodes()) {
      return null;
    }
    if (propDef.type === 'files') {
      showImageThumbnails(cell, value);
    }
    // Notion's list shows a person as the avatar alone; the name stays for screen readers.
    cell.querySelectorAll('[data-blok-database-person-chip]').forEach((chip) => {
      chip.childNodes.forEach((node) => {
        if (node.nodeType !== Node.TEXT_NODE) return;
        const name = document.createElement('span');

        name.setAttribute('data-blok-database-sr-only', '');
        name.textContent = node.textContent;
        node.replaceWith(name);
      });
    });

    const badge = document.createElement('span');

    badge.setAttribute('data-blok-database-list-row-property', '');
    badge.setAttribute('data-property-id', propDef.id);
    badge.setAttribute('data-type', propDef.type);
    if (!this.readOnly && !NOT_EDITABLE.has(propDef.type)) {
      badge.setAttribute('data-editable', '');
      badge.setAttribute('tabindex', '-1');
      // A value with its own link stays a plain slot: a button around a link is a nested control.
      if (cell.querySelector('a[href], button, [role="link"], [role="button"]') === null) {
        badge.setAttribute('role', 'button');
        badge.setAttribute('aria-label', `${propDef.name}: ${(cell.textContent ?? '').trim()}`);
      }
    }
    badge.appendChild(cell);
    // research/35 §4: the name, plus the description, below the value.
    onHover(badge, propertyHint(propDef.name, propDef.description), { placement: 'bottom', bare: true });

    return badge;
  }

  /**
   * Creates the "+ New" add-row button.
   * When optionId is provided, sets data-option-id on the button.
   */
  private createAddRowButton(optionId?: string): HTMLButtonElement {
    const addRowBtn = document.createElement('button');

    addRowBtn.setAttribute('data-blok-database-add-row', '');
    addRowBtn.setAttribute('aria-label', this.i18n.t('tools.database.addRow'));
    // findings-listgallery L18: Notion's plus glyph, then "New page".
    const icon = document.createElement('span');
    const label = document.createElement('span');

    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconPlus;
    label.textContent = this.i18n.t('tools.database.newPage');
    addRowBtn.append(icon, label);

    if (optionId !== undefined) {
      addRowBtn.setAttribute('data-option-id', optionId);
    }

    return addRowBtn;
  }
}

/**
 * A zero-size anchor at the pointer, inside the row so it keeps the row's
 * tokens (findings-listgallery L16). It corrects for a transformed ancestor,
 * where a fixed box at 0,0 is not the viewport corner. The caller removes it.
 */
export const pointerAnchor = (rowEl: HTMLElement, event: MouseEvent): HTMLElement => {
  const point = document.createElement('span');

  point.setAttribute('data-blok-database-menu-point', '');
  point.setAttribute('aria-hidden', 'true');
  Object.assign(point.style, { position: 'fixed', left: '0px', top: '0px', width: '0px', height: '0px', pointerEvents: 'none' });
  rowEl.appendChild(point);
  const origin = point.getBoundingClientRect();

  point.style.left = `${event.clientX - origin.left}px`;
  point.style.top = `${event.clientY - origin.top}px`;

  return point;
};

/** Image file names and data URLs; any other file keeps its chip. */
const IMAGE_FILE = /(\.(png|jpe?g|gif|webp|avif|svg|bmp)([?#].*)?$)|^data:image\//i;

/** findings-listgallery L02: Notion's list shows an image file as a 30x20 thumbnail. */
const showImageThumbnails = (cell: HTMLElement, value: PropertyValue | undefined): void => {
  for (const file of filesOf(value)) {
    const chip = cell.querySelector(`[data-blok-database-file-chip][data-file-id="${CSS.escape(file.id)}"]`);
    const src = IMAGE_FILE.test(file.name) || IMAGE_FILE.test(file.url) ? safeImageSrc(file.url) : null;

    if (chip !== null && src !== null) {
      const img = document.createElement('img');

      img.setAttribute('data-blok-database-list-file-thumb', '');
      img.alt = file.name;
      img.loading = 'lazy';
      img.draggable = false;
      img.src = src;
      chip.replaceWith(img);
    }
  }
};

type Band = { left: number; top: number; right: number; bottom: number };

const isBand = (value: unknown): value is Band =>
  typeof value === 'object' && value !== null && 'left' in value && 'top' in value && 'right' in value && 'bottom' in value;

const touches = (el: Element, band: Band): boolean => {
  const r = el.getBoundingClientRect();

  return r.right > band.left && r.left < band.right && r.bottom > band.top && r.top < band.bottom;
};
