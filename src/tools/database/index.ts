import { describeDatabase } from '../../shared/tool-descriptions/database';
import { databaseSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig, SanitizerConfig } from '../../../types';
import type { DatabaseData, DatabaseConfig, DatabasePerson, DatabaseRow, DatabaseRowData, DatabaseRowMeta, PropertyDefinition, PropertySettingsV2, PropertyType, ViewType, SelectOption, DatabaseViewConfig, PropertyValue } from './types';
import { assignUniqueIds, createDefaultStatusOptions, createDefaultStatusSettings, personIdsOf, statusGroupsOf } from './property-values';
import { planTypeChange } from './property-conversion';
import type { CellContext } from './cells';
import { DatabasePropertyMenu } from './database-property-menu';
import { propertyTypeMeta } from './database-property-types';
import { DatabaseModel, NO_VALUE_GROUP_KEY } from './database-model';
import { newRowValues, sortRows } from './database-query';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { DATABASE_MENU_CLASS, groupMenuItems } from './database-group-menu';
import { optionColorOf, type OptionColor } from './cells/option-colors';
import { DatabaseBoardView } from './database-board-view';
import { DatabaseListView } from './database-list-view';
import { DatabaseTableView, createTableState } from './database-table-view';
import type { TableGroup, TableHandlers, TableState } from './database-table-view';
import type { TableRowDropResult } from './database-table-row-drag';
import { DatabasePropertyTypePopover } from './database-property-type-popover';
import type { ViewChanges } from './database-model';
import { resolveViewProperties, visibleRowPropertyIds, withPropertyOrder } from './view-settings';
import { getPlaceholderClasses, setupPlaceholder } from '../../components/utils/placeholder';
import { firstStrongDirection } from '../../shared/text-direction';
import { equalsOutputData } from '../../shared/output-data';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { DatabaseBackendSync } from './database-backend-sync';
import { DatabaseCardDrag } from './database-card-drag';
import type { CardDragResult } from './database-card-drag';
import { DatabaseColumnDrag } from './database-column-drag';
import type { GroupDragResult } from './database-column-drag';
import { DatabaseColumnControls } from './database-column-controls';
import { DatabaseListRowDrag } from './database-list-row-drag';
import type { ListRowDragResult } from './database-list-row-drag';
import { DatabaseCardDrawer } from './database-card-drawer';
import { DatabaseKeyboard } from './database-keyboard';
import { DatabaseTabBar } from './database-tab-bar';
import { IconDatabase, IconBoard, IconTrash, IconCheck } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { nanoid } from 'nanoid';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import {
  DATABASE_DEFAULT_TEXT,
  localizeDatabaseSchema,
  localizeDatabaseSelectOptions,
  localizeDatabaseViews,
} from './database-localization';
import { renderBoardPreview, renderDatabasePreview } from './preview';

interface ChangedBlock {
  id?: unknown;
  name?: unknown;
  parentId?: unknown;
}

/** The block a 'block changed' payload is about, if the payload carries one. */
const changedBlock = (payload: unknown): ChangedBlock | undefined =>
  (payload as { event?: { detail?: { target?: ChangedBlock } } } | undefined)?.event?.detail?.target;

/** Events that can end an inline edit or a drag. */
const INTERACTION_END_EVENTS = ['focusout', 'pointerup', 'pointercancel', 'keyup'] as const;

/**
 * Insert-time hint from the toolbox: the layout of the first view. Read once
 * by the constructor and never saved.
 */
const INITIAL_VIEW_KEY = 'initialView';

const KNOWN_KEYS: ReadonlySet<string> = new Set(['title', 'schema', 'views', 'activeViewId', INITIAL_VIEW_KEY]);

/**
 * Top-level keys this version does not know, kept as they came. A full save
 * prunes every key it leaves out from the shared document, so dropping a
 * newer version's key here would delete it for every client.
 */
const unknownKeys = (data: DatabaseData | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => !KNOWN_KEYS.has(key)));

/**
 * DatabaseTool — a multi-view Kanban board block tool for Blok.
 *
 * Orchestrates a single DatabaseModel (schema + rows + view configs), DatabaseView (DOM),
 * DatabaseBackendSync (adapter), and a DatabaseTabBar for view switching.
 */
/** A row block's creation and edit metadata, without absent fields. */
const rowMetaOf = (child: BlockAPI): DatabaseRowMeta => ({
  ...(typeof child.createdAt === 'number' ? { createdAt: child.createdAt } : {}),
  ...(typeof child.createdBy === 'string' ? { createdBy: child.createdBy } : {}),
  ...(typeof child.lastEditedAt === 'number' ? { lastEditedAt: child.lastEditedAt } : {}),
  ...(typeof child.lastEditedBy === 'string' ? { lastEditedBy: child.lastEditedBy } : {}),
});

export class DatabaseTool implements BlockTool {
  public static describe = describeDatabase;

  private readonly api: API;
  private readonly block: BlockAPI;
  private readOnly: boolean;
  private readonly config: DatabaseConfig;

  private title: string;
  private unknown: Record<string, unknown>;
  /** Set when the insert data carried the toolbox seed, which the document still holds. */
  private seeded: boolean;
  private activeViewId: string;
  private model: DatabaseModel;
  private view!: DatabaseViewRenderer;
  private sync!: DatabaseBackendSync;

  private element: HTMLDivElement | null = null;
  private titleElement: HTMLElement | null = null;
  private titleRowElement: HTMLDivElement | null = null;
  private boardContainer: HTMLDivElement | null = null;
  private tabBar: DatabaseTabBar | null = null;

  private cardDrag: DatabaseCardDrag | null = null;
  /** Group of the card the pointer pressed; a multiSelect drop replaces this option. */
  private cardDragFromOptionId: string | null = null;
  private columnDrag: DatabaseColumnDrag | null = null;
  private columnControls: DatabaseColumnControls | null = null;
  private listRowDrag: DatabaseListRowDrag | null = null;
  private cardDrawer: DatabaseCardDrawer | null = null;
  private propertyMenu: DatabasePropertyMenu | null = null;
  private addPropertyPopover: DatabasePropertyTypePopover | null = null;
  private descriptionPropertyCreation: ReturnType<DatabaseBackendSync['syncCreateProperty']> | null = null;
  private descriptionPropertyNeedsCreate = false;
  private readonly pendingDescriptions = new Map<string, OutputData>();
  private keyboard: DatabaseKeyboard | null = null;
  private cardMenuPopover: PopoverDesktop | null = null;
  /** Per table view: selection, loaded rows, collapsed groups. Session only, never saved. */
  private readonly tableStates = new Map<string, TableState>();
  private groupMenuPopover: PopoverDesktop | null = null;
  private reprojectQueued = false;
  private readonly resolvingRows = new Set<string>();
  private readonly resolveAgainRows = new Set<string>();
  private destroyed = false;
  /** Set while a full redraw waits for an inline edit or drag to end. */
  private redrawWhenIdleRetry: (() => void) | null = null;

  constructor({ data, config, api, block, readOnly }: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>) {
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
    this.config = config ?? {};

    this.title = (data as DatabaseData | undefined)?.title ?? '';
    this.unknown = unknownKeys(data);
    const initialView = (data as Record<string, unknown> | undefined)?.[INITIAL_VIEW_KEY];

    this.seeded = initialView !== undefined;
    this.model = new DatabaseModel(data, initialView === 'table' ? { defaultViewType: 'table', idSeed: block.id } : {});
    const views = this.model.getViews();
    this.activeViewId = (data as DatabaseData | undefined)?.activeViewId ?? (views.length > 0 ? views[0].id : '');

    this.activateView(this.activeViewId);
    this.api.events.on('block changed', this.handleBlockChanged);
  }

  static get toolbox(): ToolboxConfig {
    return [
      {
        icon: IconDatabase,
        titleKey: 'database',
        name: 'database',
        searchTerms: ['database', 'kanban', 'board', 'cards', 'columns'],
        section: 'database',
        preview: { render: renderDatabasePreview, descriptionKey: 'toolbox.preview.database' },
        // Notion starts a new database as a table.
        data: { [INITIAL_VIEW_KEY]: 'table' },
      },
      {
        icon: IconBoard,
        titleKey: 'board',
        name: 'board',
        searchTerms: ['board', 'kanban', 'cards', 'columns', 'database'],
        section: 'database',
        preview: { render: renderBoardPreview, descriptionKey: 'toolbox.preview.board' },
      },
    ];
  }

  /**
   * Plain text and bare URLs: an HTML parse would cut text at `<` and turn `&` into `&amp;`.
   */
  static get sanitize(): SanitizerConfig {
    return databaseSanitize();
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  render(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-blok-tool', 'database');
    wrapper.setAttribute('data-blok-database-wrapper', '');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    this.element = wrapper;
    this.loadPeople();

    const titleEl = this.createTitleElement();
    this.titleElement = titleEl;

    const titleRow = document.createElement('div');
    titleRow.setAttribute('data-blok-database-title-row', '');
    titleRow.appendChild(titleEl);
    this.titleRowElement = titleRow;
    wrapper.appendChild(titleRow);

    this.tabBar = this.createTabBar();
    wrapper.appendChild(this.tabBar.render());
    this.syncTitleRowAddBtn();

    const boardContainer = document.createElement('div');
    boardContainer.setAttribute('data-blok-database-board-container', '');
    boardContainer.style.overflow = 'hidden';
    boardContainer.style.position = 'relative';
    this.boardContainer = boardContainer;
    wrapper.appendChild(boardContainer);

    this.syncRowsFromBlocks();
    const boardEl = this.renderActiveView();
    boardContainer.appendChild(boardEl);

    if (!this.readOnly) {
      this.attachViewListeners(boardEl);
      this.initSubsystems(boardEl);
    }

    return wrapper;
  }

  private createTitleElement(): HTMLElement {
    const titleEl = document.createElement('div');
    titleEl.setAttribute('data-blok-database-title', '');
    titleEl.textContent = this.title;

    titleEl.style.fontSize = '1.5rem';
    titleEl.style.fontWeight = '600';
    titleEl.style.lineHeight = '1.3';
    titleEl.style.color = 'var(--blok-text-primary)';
    titleEl.style.outline = 'none';
    titleEl.style.cursor = 'text';
    titleEl.style.wordBreak = 'break-word';

    const syncTitleDirection = (): void => DatabaseTool.syncTitleDirection(titleEl);

    syncTitleDirection();
    titleEl.addEventListener('input', syncTitleDirection);
    titleEl.className = getPlaceholderClasses('always').join(' ');
    setupPlaceholder(titleEl, this.api.i18n.t('tools.database.titlePlaceholder'));

    if (!this.readOnly) {
      titleEl.setAttribute('contenteditable', 'true');
    }

    // Always attached: setReadOnly flips the title in place without re-rendering.
    titleEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.readOnly) {
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        titleEl.blur();
      }
    });

    return titleEl;
  }

  /**
   * Own dir from its text, so core skips it and an RTL title does not flip
   * the grid. No dir when there is no letter: `dir="auto"` would resolve an
   * empty title to LTR and push the placeholder out of an RTL column.
   */
  private static syncTitleDirection(titleEl: HTMLElement): void {
    const direction = firstStrongDirection(titleEl.textContent ?? '');

    if (direction === null) {
      titleEl.removeAttribute('dir');
    } else {
      titleEl.setAttribute('dir', direction);
    }
  }

  rendered(): void {
    this.block.stretched = true;

    // The insert wrote the raw seed into the shared document; one save
    // replaces it with the real schema and views. Every client that renders
    // the seed does this, which is safe only because the ids derive from the
    // block id (idSeed).
    if (this.seeded && !this.readOnly) {
      this.seeded = false;
      this.block.dispatchChange();
    }

    const hadRows = this.model.getOrderedRows().length > 0;

    this.syncRowsFromBlocks();

    if (!hadRows && this.model.getOrderedRows().length > 0) {
      this.rerenderView();
    }

    if (this.config.adapter !== undefined) {
      void this.loadFromBackend();
    }
  }

  private async loadFromBackend(): Promise<void> {
    const data = await this.sync.syncLoadDatabase();

    if (data === undefined) {
      return;
    }

    this.model.hydrate(data);
    const views = this.model.getViews();

    if (views.length > 0 && !views.some((v) => v.id === this.activeViewId)) {
      this.activeViewId = views[0].id;
    }

    this.rerenderView();
  }

  save(_blockContent: HTMLElement): DatabaseData {
    const currentTitle = this.titleElement?.textContent ?? this.title;

    return {
      ...structuredClone(this.unknown),
      ...this.model.snapshot(),
      title: currentTitle,
      activeViewId: this.activeViewId,
    };
  }

  validate(savedData: DatabaseData): boolean {
    const titleCount = savedData.schema?.filter((p) => p.type === 'title').length ?? 0;
    const hasExactlyOneTitle = titleCount === 1;
    const hasViews = savedData.views !== undefined && savedData.views.length > 0;
    const boardViewsValid = savedData.views?.filter((v) => v.type === 'board')
      .every((v) => v.groupBy !== undefined) ?? true;
    return hasExactlyOneTitle && hasViews && boardViewsValid;
  }

  destroy(): void {
    this.destroyed = true;
    this.api.events.off('block changed', this.handleBlockChanged);
    this.propertyMenu?.destroy();
    this.propertyMenu = null;
    this.addPropertyPopover?.destroy();
    this.addPropertyPopover = null;
    this.stopWaitingForIdle();
    this.cardMenuPopover?.destroy();
    this.destroyTableView();
    this.groupMenuPopover?.destroy();
    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.listRowDrag?.destroy();
    this.listRowDrag = null;
    this.cardDrawer?.destroy();
    this.keyboard?.destroy();
    this.tabBar?.destroy();
    this.sync.flushPendingUpdates();
    this.sync.flushPendingPropertyUpdates();
    this.sync.destroy();
    this.element = null;
    this.boardContainer = null;
    this.tabBar = null;
  }

  /**
   * Toggles read-only mode in place without triggering a full save→clear→render
   * cycle. This enables the fast-path in the ReadOnly module (which requires all
   * tools to implement setReadOnly()).
   *
   * Entering read-only:
   *   - Makes the title non-editable
   *   - Removes the tab bar from DOM
   *   - Re-renders the active view in read-only mode (which skips subsystem init)
   *
   * Exiting read-only:
   *   - Makes the title editable
   *   - Recreates the tab bar before the board container
   *   - Re-renders the active view in edit mode (which re-inits subsystems)
   */
  setReadOnly(state: boolean): void {
    if (this.readOnly === state) {
      return;
    }

    this.readOnly = state;

    if (this.titleElement !== null) {
      this.titleElement.setAttribute('contenteditable', state ? 'false' : 'true');
    }

    this.tabBar?.setReadOnly(state);
    this.syncTitleRowAddBtn();

    this.rerenderView();
  }

  /**
   * Applies data from the document (undo, redo or a peer) without rebuilding
   * the block, so the holder and an open card page survive. Returns false
   * when the data cannot be shown in place; core then re-renders the block.
   * Must not dispatch a change: core holds its write-back window open
   * around this call.
   */
  setData(data: DatabaseData): boolean {
    if (!Array.isArray(data.schema) || data.schema.length === 0 || !Array.isArray(data.views) || data.views.length === 0) {
      return false;
    }

    this.unknown = unknownKeys(data);
    this.title = typeof data.title === 'string' ? data.title : '';

    if (this.titleElement !== null && this.titleElement.textContent !== this.title) {
      this.titleElement.textContent = this.title;
      DatabaseTool.syncTitleDirection(this.titleElement);
    }

    this.model.replaceDefinition(data);

    const views = this.model.getViews();
    const activeViewId = [data.activeViewId, this.activeViewId].find((id) => views.some((view) => view.id === id)) ?? views[0].id;

    if (activeViewId !== this.activeViewId) {
      this.sync.flushPendingUpdates();
      this.sync.flushPendingPropertyUpdates();
      this.activeViewId = activeViewId;
    }

    this.rebuildTabBar();
    this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.redrawWhenIdle();

    return true;
  }

  /**
   * Returns the title element so the block toolbar vertically centers on the
   * database title line rather than on the outer wrapper's top edge.
   */
  getToolbarAnchorElement(): HTMLElement | undefined {
    return this.titleElement ?? undefined;
  }

  // ---------------------------------------------------------------------------
  // Row projection from child blocks
  // ---------------------------------------------------------------------------

  private syncRowsFromBlocks(): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const titlePropId = this.titlePropertyId();
    const rows: DatabaseRow[] = children
      .filter((child) => child.name === 'database-row')
      .map((child) => {
        const live: DatabaseRowData[] = [];

        child.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });
        const rowData = live[0] ?? child.preservedData as DatabaseRowData | undefined;
        const properties = { ...(rowData?.properties ?? {}) };
        const mergedTitle = rowData?.title;

        // A row born with a top-level `title` keeps the MERGED title there;
        // `properties[titlePropId]` is a mirror a concurrent burst can leave
        // stale, so read the merged value and heal the mirror from it. A row
        // written before `title` existed has none, reads the mirror as before,
        // and is never written to.
        if (mergedTitle !== undefined && titlePropId !== '') {
          if (properties[titlePropId] !== mergedTitle) {
            properties[titlePropId] = mergedTitle;
            child.call('updateProperties', { [titlePropId]: mergedTitle });
            child.dispatchChange();
          }
        }

        const meta = rowMetaOf(child);

        return {
          id: child.id,
          position: rowData?.position ?? '',
          properties,
          ...(typeof rowData?.pageId === 'string' && rowData.pageId.length > 0 ? { pageId: rowData.pageId } : {}),
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        };
      });
    const numbered = this.model.getSchema()
      .filter((property) => property.type === 'uniqueId')
      .reduce((acc, property) => assignUniqueIds(acc, property.id), rows);

    this.model.setRows(numbered);
    if (!this.readOnly) {
      this.storeUniqueIds(rows, numbered, children);
    }
  }

  /**
   * Store the IDs `assignUniqueIds` worked out. Derived: every peer computes
   * the same numbers, so this is not anyone's edit and not an undo step.
   */
  private storeUniqueIds(before: DatabaseRow[], after: DatabaseRow[], children: BlockAPI[]): void {
    const idProperties = this.model.getSchema().filter((property) => property.type === 'uniqueId').map((property) => property.id);

    after.forEach((row, index) => {
      const changes = Object.fromEntries(idProperties
        .filter((id) => before[index]?.properties[id] !== row.properties[id])
        .map((id) => [id, row.properties[id]]));
      const child = children.find((block) => block.id === row.id);

      if (Object.keys(changes).length === 0 || child === undefined) return;
      child.call('updateProperties', changes);
      child.dispatchChange({ derived: true });
    });
  }

  /**
   * Redraw the board when a row changed under it: undo/redo, a peer, or a row
   * added or removed by either. A microtask keeps the redraw inside the
   * reconcile window; after it closes, this block's write-back would be a new
   * undo step. The tool's own row writes re-sync the model before this runs,
   * so they compare equal and redraw nothing.
   */
  private readonly handleBlockChanged = (payload: unknown): void => {
    if (this.reprojectQueued || !this.isOwnRowChange(changedBlock(payload))) {
      return;
    }

    this.reprojectQueued = true;
    queueMicrotask(() => {
      this.reprojectQueued = false;
      this.reprojectRows();
    });
  };

  /**
   * A row of this database, or one it showed until now (moved out or removed).
   * An unreadable parent counts as ours: the compare after it drops no-ops.
   */
  private isOwnRowChange(target: ChangedBlock | undefined): boolean {
    if (target?.name !== 'database-row') {
      return false;
    }

    if (typeof target.parentId !== 'string' || target.parentId === this.block.id) {
      return true;
    }

    return typeof target.id === 'string' && this.model.getRow(target.id) !== undefined;
  }

  private reprojectRows(): void {
    if (this.boardContainer === null) {
      return;
    }

    const before = this.model.getOrderedRows();

    this.syncRowsFromBlocks();

    const after = this.model.getOrderedRows();

    this.resolveMovedRows(before, after);
    const retitled = this.retitledRows(before, after);
    const openRowId = this.cardDrawer?.openRowId ?? null;

    if (openRowId !== null) {
      const openBefore = before.find((row) => row.id === openRowId);
      const openAfter = this.model.getRow(openRowId);

      if (JSON.stringify(openBefore) !== JSON.stringify(openAfter)) {
        this.cardDrawer?.syncOpenRow(openAfter);
      }
    }

    if (retitled === null || (retitled.length > 0 && this.activeViewQueries(this.titlePropertyId()))) {
      this.redrawWhenIdle();

      return;
    }

    const currentView = this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]')
      ?? this.boardContainer.querySelector<HTMLElement>('[data-blok-database-list]')
      ?? this.boardContainer.querySelector<HTMLElement>('[data-blok-database-table]');
    const titlePropId = this.titlePropertyId();

    if (currentView === null) {
      return;
    }

    for (const row of retitled) {
      this.view.updateRowTitle(currentView, row.id, (row.properties[titlePropId] as string | undefined) ?? '');
    }
  }

  /**
   * Rows whose title is the only thing that changed, or null when anything
   * else changed (rows added, removed, moved or regrouped).
   */
  private retitledRows(before: DatabaseRow[], after: DatabaseRow[]): DatabaseRow[] | null {
    if (before.length !== after.length) {
      return null;
    }

    const titlePropId = this.titlePropertyId();
    const withoutTitle = (row: DatabaseRow): string => {
      const { [titlePropId]: _title, ...rest } = row.properties;

      return JSON.stringify({ ...row, properties: rest });
    };
    const retitled: DatabaseRow[] = [];

    for (const [index, row] of after.entries()) {
      const old = before[index];

      if (withoutTitle(old) !== withoutTitle(row)) {
        return null;
      }

      if (old.properties[titlePropId] !== row.properties[titlePropId]) {
        retitled.push(row);
      }
    }

    return retitled;
  }

  /** True when the active view sorts or filters by the property, so a new value can move or hide a row. */
  private activeViewQueries(propertyId: string): boolean {
    const view = this.model.getView(this.activeViewId);

    return view !== undefined && [...view.sorts, ...view.filters].some((rule) => rule.propertyId === propertyId);
  }

  /** True while an inline rename in the board or a drag is in progress. */
  private isInteracting(): boolean {
    const focused = document.activeElement;

    if (focused instanceof HTMLInputElement && this.boardContainer?.contains(focused) === true) {
      return true;
    }

    if (this.view instanceof DatabaseTableView && this.view.interacting) {
      return true;
    }

    return this.cardDrag?.active === true || this.columnDrag?.active === true || this.listRowDrag?.active === true;
  }

  /** Detach the table's listeners before its DOM goes, so its focus and editor do not fire into the next one. */
  private destroyTableView(): void {
    if (this.view instanceof DatabaseTableView) {
      this.view.destroy();
    }
  }

  /**
   * Redraw the board now, or once the inline edit or drag ends. A redraw
   * replaces the board and would throw away the open input or the drag.
   */
  private redrawWhenIdle(): void {
    if (!this.isInteracting()) {
      this.rerenderView({ keepDrawer: true });

      return;
    }

    if (this.redrawWhenIdleRetry !== null) {
      return;
    }

    // A timeout, not a microtask: the edit commits and the drop lands in
    // listeners that may run after this one.
    const retry = (): void => {
      setTimeout(() => {
        if (this.redrawWhenIdleRetry === retry && !this.isInteracting()) {
          this.rerenderView({ keepDrawer: true });
        }
      }, 0);
    };

    this.redrawWhenIdleRetry = retry;
    INTERACTION_END_EVENTS.forEach((type) => document.addEventListener(type, retry, true));
  }

  private stopWaitingForIdle(): void {
    const retry = this.redrawWhenIdleRetry;

    if (retry === null) {
      return;
    }

    this.redrawWhenIdleRetry = null;
    INTERACTION_END_EVENTS.forEach((type) => document.removeEventListener(type, retry, true));
  }

  /** Id of the schema's title column, or '' when the schema has none. */
  private titlePropertyId(): string {
    return this.model.getSchema().find((p) => p.type === 'title')?.id ?? '';
  }

  /**
   * Write a row title through the row block. Goes to the row's top-level
   * `title` (merged per character by the CRDT) AND to the published
   * `properties[titlePropId]` mirror — see DatabaseRowTool.updateTitle.
   */
  private updateRowTitleBlock(rowId: string, titlePropId: string, title: string): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rowBlock = children.find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updateTitle', { title, titlePropertyId: titlePropId });
      rowBlock.dispatchChange();
    }

    this.syncRowsFromBlocks();
  }

  private deleteRowBlock(rowId: string): void {
    this.pendingDescriptions.delete(rowId);
    const blockIndex = this.api.blocks.getBlockIndex(rowId);

    if (blockIndex !== undefined) {
      void this.api.blocks.delete(blockIndex);
    }

    this.syncRowsFromBlocks();
  }

  private updateRowBlock(rowId: string, propertyChanges: Record<string, PropertyValue>): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rowBlock = children.find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updateProperties', propertyChanges);
      rowBlock.dispatchChange();
    }

    this.syncRowsFromBlocks();
  }

  private async copyLegacyRowBody(rowId: string, propertyId: string, body: OutputData): Promise<void> {
    const rowPages = this.config.rowPages;

    if (rowPages === undefined) return;

    const propertyCreation = this.descriptionPropertyCreation;
    const failure: { generic: boolean; backend?: { error: unknown } } = { generic: false };

    this.cardDrawer?.setBodyMigrationPending(rowId, true);
    try {
      const created = propertyCreation === null ? undefined : await propertyCreation;

      if (propertyCreation !== null && created === undefined && this.config.adapter !== undefined) return;
      if (this.model.getRow(rowId) === undefined) return;
      // A row is copied at most once: a second copy would replace its page.
      const existing = await this.lookupForCopy(rowId);

      if (this.destroyed) return;
      if (existing !== null) {
        await this.adoptRowPage(rowId, existing);

        return;
      }
      const written = this.config.adapter === undefined
        ? undefined
        : await this.sync.syncUpdateRowNow({ rowId, properties: { [propertyId]: body } }, (error) => {
          failure.backend = { error };
        });

      if (this.config.adapter !== undefined && written === undefined) {
        failure.generic = true;
        return;
      }
      const beforeCopy = this.model.getRow(rowId)?.properties[propertyId];

      if (beforeCopy === null || typeof beforeCopy !== 'object' || Array.isArray(beforeCopy)
        || !equalsOutputData(beforeCopy, body)) return;

      const request = { rowId, operationId: nanoid(), body };
      const outcome = await rowPages.copyFromLegacy(request).catch(() => rowPages.copyFromLegacy(request))
        .then((receipt) => ({ receipt }), async (error: unknown) => {
          // Refused because another client moved the row meanwhile.
          const moved = await this.lookupForCopy(rowId);

          if (moved === null) throw error;

          return { moved };
        });

      if ('moved' in outcome) {
        await this.adoptRowPage(rowId, outcome.moved);

        return;
      }
      if (this.destroyed) return;
      const { receipt } = outcome;
      const current = this.model.getRow(rowId)?.properties[propertyId];

      if (typeof receipt.pageId !== 'string' || receipt.pageId.length === 0
        || typeof receipt.transactionId !== 'string' || receipt.transactionId.length === 0
        || !equalsOutputData(receipt.acceptedBody, body)
        || current === null || typeof current !== 'object' || Array.isArray(current)
        || !equalsOutputData(current, body)) {
        throw new Error('Copy receipt did not match the current row body');
      }

      const rowBlock = this.api.blocks.getChildren(this.block.id).find((child) => child.id === rowId);

      if (rowBlock === undefined) return;
      rowBlock.call('updatePageId', { pageId: receipt.pageId });
      // The host committed it: undo must not strip it.
      rowBlock.dispatchChange({ derived: true });
      this.syncRowsFromBlocks();
      if (this.cardDrawer?.openRowId === rowId) {
        this.cardDrawer.syncOpenRow(this.model.getRow(rowId));
      }
    } catch {
      failure.generic = true;
    } finally {
      this.cardDrawer?.setBodyMigrationPending(rowId, false);
      if (failure.backend !== undefined) {
        this.showBackendError(failure.backend.error);
      } else if (failure.generic) {
        this.api.notifier.show({ message: this.api.i18n.t('tools.stub.error'), style: 'error' });
      }
    }
  }

  private moveRowBlock(rowId: string, position: string): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rowBlock = children.find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updatePosition', { position });
      rowBlock.dispatchChange();
    }

    this.syncRowsFromBlocks();
  }

  // ---------------------------------------------------------------------------
  // View management
  // ---------------------------------------------------------------------------

  private showBackendError(error: unknown): void {
    // Adapter errors are untrusted; the notifier renders HTML.
    const message = String(error)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    this.api.notifier.show({ message, style: 'error' });
  }

  private activateView(viewId: string): void {
    const viewConfig = this.model.getView(viewId);

    if (viewConfig === undefined) {
      return;
    }

    this.activeViewId = viewId;
    this.sync = new DatabaseBackendSync(this.config.adapter, (error) => this.showBackendError(error));
  }

  private switchView(viewId: string): void {
    if (viewId === this.activeViewId || this.boardContainer === null) {
      return;
    }

    // Destroy per-view subsystems (not cardDrawer)
    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.listRowDrag?.destroy();
    this.keyboard?.destroy();
    this.cardDrag = null;
    this.columnDrag = null;
    this.columnControls = null;
    this.listRowDrag = null;
    this.keyboard = null;
    this.destroyTableView();

    this.sync.flushPendingUpdates();
    this.sync.flushPendingPropertyUpdates();
    this.sync.destroy();

    const previousViewId = this.activeViewId;

    this.activateView(viewId);

    this.boardContainer.innerHTML = '';
    this.syncRowsFromBlocks();
    const newBoardWrapper = this.renderActiveView();
    this.boardContainer.appendChild(newBoardWrapper);

    if (!this.readOnly) {
      this.attachViewListeners(newBoardWrapper);
      this.initSubsystems(newBoardWrapper);
    }

    this.rebuildTabBar();
    this.fadeTabBackground(previousViewId, viewId);
  }

  /**
   * The rebuilt bar starts with the old tab still painted active and the new one
   * blank, then drops both marks so the 100ms background transition in
   * database.css plays (research/08). The body already swapped in one frame.
   */
  private fadeTabBackground(fromViewId: string, toViewId: string): void {
    const bar = this.element?.querySelector('[data-blok-database-tab-bar]');
    const from = bar?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${fromViewId}"]`);
    const to = bar?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${toViewId}"]`);

    if (from === null || from === undefined || to === null || to === undefined) {
      return;
    }
    from.setAttribute('data-blok-database-tab-was-active', '');
    to.setAttribute('data-blok-database-tab-activating', '');
    // Commit the start state, or the browser skips straight to the end.
    void to.getBoundingClientRect();
    from.removeAttribute('data-blok-database-tab-was-active');
    to.removeAttribute('data-blok-database-tab-activating');
  }

  addView(type: ViewType): void {
    const statusProp = this.model.getSchema().find((p) => p.type === 'select');
    const defaultNames: Partial<Record<ViewType, string>> = {
      list: DATABASE_DEFAULT_TEXT.viewTypeList,
      table: DATABASE_DEFAULT_TEXT.viewTypeTable,
    };
    const newView = this.model.addView(defaultNames[type] ?? DATABASE_DEFAULT_TEXT.viewTypeBoard, type, {
      groupBy: type === 'board' ? statusProp?.id : undefined,
    });
    void this.sync.syncCreateView(structuredClone(newView));
    this.switchView(newView.id);
  }

  renameView(viewId: string, name: string): void {
    this.model.updateView(viewId, { name });
    void this.sync.syncUpdateView({ viewId, changes: { name } });
  }

  duplicateView(viewId: string): void {
    const sourceView = this.model.getView(viewId);

    if (sourceView === undefined) {
      return;
    }

    const { id: _id, name, type, position: _position, ...settings } = sourceView;
    const newView = this.model.addView(name, type, settings);

    void this.sync.syncCreateView(structuredClone(newView));
    this.switchView(newView.id);
  }

  deleteView(viewId: string): void {
    const views = this.model.getViews();

    if (views.length <= 1) {
      return;
    }

    const index = views.findIndex((v) => v.id === viewId);

    if (index === -1) {
      return;
    }

    const wasActive = viewId === this.activeViewId;

    this.model.deleteView(viewId);
    void this.sync.syncDeleteView({ viewId });

    if (wasActive) {
      const remaining = this.model.getViews();
      const neighborIndex = Math.min(index, remaining.length - 1);
      this.switchView(remaining[neighborIndex].id);
    } else {
      this.rebuildTabBar();
    }
  }

  reorderView(viewId: string, newPosition: string): void {
    this.model.updateView(viewId, { position: newPosition });
    void this.sync.syncUpdateView({ viewId, changes: { position: newPosition } });
    this.rebuildTabBar();
  }

  private rebuildTabBar(): void {
    if (this.element === null || this.tabBar === null) {
      return;
    }

    const oldBarEl = this.element.querySelector('[data-blok-database-tab-bar]');

    this.tabBar.destroy();
    this.tabBar = this.createTabBar();
    const newBarEl = this.tabBar.render();

    if (oldBarEl !== null) {
      oldBarEl.replaceWith(newBarEl);
    } else {
      // Tab bar should be first child (before boardContainer)
      this.element.insertBefore(newBarEl, this.boardContainer);
    }

    this.syncTitleRowAddBtn();
  }

  private syncTitleRowAddBtn(): void {
    if (this.element === null || this.titleRowElement === null || this.tabBar === null) {
      return;
    }

    const tabBarEl = this.element.querySelector('[data-blok-database-tab-bar]');
    const views = this.model.getViews();
    const addBtn = this.tabBar.getAddBtnEl();

    if (views.length === 1 && !this.readOnly && addBtn !== null) {
      this.titleRowElement.appendChild(addBtn);
      this.titleRowElement.setAttribute('data-single-view', '');
      if (tabBarEl instanceof HTMLElement) {
        tabBarEl.style.display = 'none';
      }
    } else {
      this.titleRowElement.removeAttribute('data-single-view');
      // Remove all stale addBtn(s) from titleRow before re-attaching cleanly
      const staleInTitleRow = this.titleRowElement.querySelectorAll('[data-blok-database-add-view]');
      staleInTitleRow.forEach((el) => {
        el.remove();
      });

      if (!this.readOnly && addBtn !== null && tabBarEl !== null && !tabBarEl.contains(addBtn)) {
        tabBarEl.appendChild(addBtn);
      }
      if (tabBarEl instanceof HTMLElement) {
        tabBarEl.style.display = views.length >= 2 ? '' : 'none';
      }
    }
  }

  private createTabBar(): DatabaseTabBar {
    return new DatabaseTabBar({
      views: localizeDatabaseViews(this.model.getViews(), this.api.i18n),
      activeViewId: this.activeViewId,
      onTabClick: (viewId) => this.switchView(viewId),
      onAddView: (type) => this.addView(type),
      onRename: (viewId, name) => this.renameView(viewId, name),
      onDuplicate: (viewId) => this.duplicateView(viewId),
      onDelete: (viewId) => this.deleteView(viewId),
      onReorder: (viewId, newPosition) => this.reorderView(viewId, newPosition),
      api: this.api,
      readOnly: this.readOnly,
    });
  }

  // ---------------------------------------------------------------------------
  // Board rendering helpers
  // ---------------------------------------------------------------------------

  private renderActiveView(): HTMLDivElement {
    const viewConfig = this.model.getView(this.activeViewId);
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const groupByPropId = viewConfig?.groupBy;

    if (viewConfig?.type === 'list') {
      return this.renderListView(titlePropId, groupByPropId, viewConfig);
    }

    if (viewConfig?.type === 'table') {
      return this.renderTableView(titlePropId, viewConfig);
    }

    return this.renderBoardView(titlePropId, groupByPropId, viewConfig);
  }

  /** Option groups in board order. The no-value group sits at the view's stored place, or last. */
  private groupOptions(groupByPropId: string, view: DatabaseViewConfig | undefined): SelectOption[] {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === groupByPropId);
    const noValue: SelectOption = {
      id: NO_VALUE_GROUP_KEY,
      label: this.api.i18n.t('tools.database.noValueGroup', { property: property?.name ?? '' }),
      position: '',
    };
    const statusBy = view?.groupByStatus;
    const options = statusBy === 'group' && property?.type === 'status'
      ? statusGroupsOf(property).map((g) => ({ id: g.id, label: g.name, color: g.color, position: g.position }))
      : localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId, { statusBy }), this.api.i18n);
    const stored = view?.noValueGroupPosition;
    const index = stored === undefined ? -1 : options.findIndex((option) => option.position > stored);

    return index === -1
      ? [...options, noValue]
      : [...options.slice(0, index), noValue, ...options.slice(index)];
  }

  /**
   * The no-value group's position in the option key space. When the view stores
   * none, it is just past the last option, ignoring `excludeId` (the option moving).
   */
  private noValuePosition(view: DatabaseViewConfig, options: SelectOption[], excludeId?: string): string {
    if (view.noValueGroupPosition !== undefined) {
      return view.noValueGroupPosition;
    }
    const last = options.filter((option) => option.id !== excludeId).at(-1);

    return DatabaseModel.positionBetween(last?.position ?? null, null);
  }

  /** Stores the no-value group's place so options placed after it stay after it. */
  private pinNoValuePosition(view: DatabaseViewConfig, position: string): void {
    if (view.noValueGroupPosition === position) {
      return;
    }
    this.model.updateView(view.id, { noValueGroupPosition: position });
    this.block.dispatchChange();
    void this.sync.syncUpdateView({ viewId: view.id, changes: { noValueGroupPosition: position } });
  }

  /** Each group's rows, queried once per render. */
  private queryGroupRows(viewConfig: DatabaseViewConfig, optionIds: string[]): Map<string, DatabaseRow[]> {
    return new Map(optionIds.map((id) => [id, this.model.queryRows({ view: viewConfig, group: id }).rows]));
  }

  private renderBoardView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig | undefined): HTMLDivElement {
    const allOptions = groupByPropId !== undefined ? this.groupOptions(groupByPropId, viewConfig) : [];
    const hidden = new Set((viewConfig?.hiddenGroups ?? []).map((group) => group.id));
    const options = allOptions.filter((option) => !hidden.has(option.id));
    const groups = viewConfig !== undefined && groupByPropId !== undefined
      ? this.queryGroupRows(viewConfig, options.map((o) => o.id))
      : new Map<string, DatabaseRow[]>();

    this.view = new DatabaseBoardView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      options,
      getRows: (optionId) => groups.get(optionId) ?? [],
      titlePropertyId: titlePropId,
      hideCounts: viewConfig?.hideGroupAggregation === true,
      hiddenGroupCount: allOptions.length - options.length,
      onTitleEdit: (rowId, newTitle) => {
        const titlePropId = this.titlePropertyId();
        this.updateRowTitleBlock(rowId, titlePropId, newTitle);
        this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: newTitle } });
      },
    });

    return this.view.createView();
  }

  private renderTableView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const groupBy = viewConfig.groupBy;
    const groupType = groupBy === undefined ? undefined : this.model.getProperty(groupBy)?.type;
    const groups = groupBy !== undefined && (groupType === 'select' || groupType === 'multiSelect')
      ? this.tableGroups(groupBy, viewConfig)
      : undefined;

    this.view = new DatabaseTableView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      view: viewConfig,
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      rows: groups === undefined ? this.model.queryRows({ view: viewConfig }).rows : [],
      ...(groups !== undefined ? { groups } : {}),
      titlePropertyId: titlePropId,
      state: this.tableState(viewConfig.id),
      ...(this.readOnly ? {} : { handlers: this.tableHandlers() }),
    });

    return this.view.createView();
  }

  private tableState(viewId: string): TableState {
    const existing = this.tableStates.get(viewId);

    if (existing !== undefined) {
      return existing;
    }
    const state = createTableState();

    this.tableStates.set(viewId, state);

    return state;
  }

  /** Notion lists the no-value group last in a table too (research/08), unless the view placed it. */
  private tableGroups(groupBy: string, viewConfig: DatabaseViewConfig): TableGroup[] {
    const ordered = this.groupOptions(groupBy, viewConfig);
    const rows = this.queryGroupRows(viewConfig, ordered.map((o) => o.id));

    return ordered.map((option) => ({
      key: option.id,
      label: option.label,
      ...(option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
      rows: rows.get(option.id) ?? [],
    }));
  }

  /** What the table view asks of the tool. Each write goes through the row block or the view, then the backend. */
  private tableHandlers(): TableHandlers {
    return {
      commitCell: (rowId, propertyId, value) => this.commitTableCell(rowId, propertyId, value),
      editEnded: () => this.redrawWhenIdle(),
      addRow: (groupKey, afterRowId) => this.addTableRow(groupKey, afterRowId),
      deleteRows: (rowIds) => this.deleteTableRows(rowIds),
      duplicateRow: (rowId) => this.duplicateTableRow(rowId),
      openRow: (rowId) => this.handleRowClick(rowId),
      copyRowLink: (rowId) => this.copyRowLink(rowId),
      editRowIcon: () => undefined,
      updateView: (changes) => this.updateActiveView(changes),
      openPropertyMenu: (propertyId, anchor) => this.openPropertyMenu(propertyId, anchor),
      addProperty: (anchor, placement) => this.openAddProperty(anchor, placement),
      viewAction: (action, propertyId, anchor) => this.onTableViewAction(action, propertyId, anchor),
      moveRow: (result) => this.handleTableRowDrop(result),
      sortedRowDrop: (result) => this.onSortedRowDrop(result),
      bulkEdit: () => undefined,
      editFilters: () => undefined,
      rerender: () => this.rerenderView({ keepDrawer: true }),
      optionsChange: (propertyId, options) => this.handleTableOptionsChange(propertyId, options),
    };
  }

  /** Filter, Sort and Group from a column header. Phase 3 owns their panels. */
  protected onTableViewAction(_action: 'filter' | 'sort' | 'group', _propertyId: string, _anchor: HTMLElement): void {
    // Hook only.
  }

  /**
   * A row dropped in a sorted table. Notion asks "Would you like to remove
   * sorting?" (D7); that prompt lives outside the table. Nothing moves.
   */
  protected onSortedRowDrop(_result: TableRowDropResult): void {
    // Hook only.
  }

  private commitTableCell(rowId: string, propertyId: string, value: PropertyValue): void {
    if (this.readOnly || this.destroyed) return;
    if (JSON.stringify(this.model.getRow(rowId)?.properties[propertyId] ?? null) === JSON.stringify(value)) return;
    const titlePropId = this.titlePropertyId();

    if (propertyId === titlePropId) {
      this.updateRowTitleBlock(rowId, titlePropId, typeof value === 'string' ? value : '');
    } else {
      this.updateRowBlock(rowId, { [propertyId]: value });
    }
    this.sync.syncUpdateRow({ rowId, properties: { [propertyId]: value } });
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.model.getRow(rowId));
    }
  }

  /** Inserts a row block at the end, or right after `afterRowId`. */
  private addTableRow(groupKey: string | null, afterRowId?: string): string | null {
    if (this.readOnly) return null;
    const titlePropId = this.titlePropertyId();
    const groupBy = groupKey === null ? undefined : this.model.getView(this.activeViewId)?.groupBy;
    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupBy, groupKey ?? NO_VALUE_GROUP_KEY));
    const ordered = this.model.getOrderedRows();
    const afterIndex = afterRowId === undefined ? -1 : ordered.findIndex((row) => row.id === afterRowId);
    const position = afterIndex === -1
      ? rowData.position
      : DatabaseModel.positionBetween(ordered[afterIndex].position, ordered[afterIndex + 1]?.position ?? null);

    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position, title: '' },
      { parentId: this.block.id, position: 'end', id: rowData.id },
    );
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position });
    this.rerenderView({ keepDrawer: true });

    return rowData.id;
  }

  private deleteTableRows(rowIds: string[]): void {
    if (this.readOnly) return;
    for (const rowId of rowIds) {
      if (this.cardDrawer?.openRowId === rowId) {
        this.cardDrawer.close();
      }
      this.deleteRowBlock(rowId);
      void this.sync.syncDeleteRow({ rowId });
    }
    this.rerenderView({ keepDrawer: true });
  }

  private duplicateTableRow(rowId: string): void {
    const row = this.model.getRow(rowId);

    if (row === undefined || this.readOnly) return;
    const ordered = this.model.getOrderedRows();
    const index = ordered.findIndex((r) => r.id === rowId);
    const position = DatabaseModel.positionBetween(row.position, ordered[index + 1]?.position ?? null);
    const titlePropId = this.titlePropertyId();
    const title = row.properties[titlePropId];
    const id = nanoid();
    const properties = structuredClone(row.properties);

    this.api.blocks.insertAt(
      'database-row',
      { properties, position, title: typeof title === 'string' ? title : '' },
      { parentId: this.block.id, position: 'end', id },
    );
    void this.sync.syncCreateRow({ id, properties, position });
    this.rerenderView({ keepDrawer: true });
  }

  /** Rows have no addressable URL yet: copies the page URL with the row id as its fragment. */
  private copyRowLink(rowId: string): void {
    const url = `${window.location.href.split('#')[0]}#${rowId}`;

    void navigator.clipboard?.writeText(url).then(
      () => this.api.notifier.show({ message: this.api.i18n.t('tools.database.tableLinkCopied') }),
      () => undefined
    );
  }

  private updateActiveView(changes: ViewChanges): void {
    if (this.readOnly) return;
    this.model.updateView(this.activeViewId, changes);
    this.block.dispatchChange();
    void this.sync.syncUpdateView({ viewId: this.activeViewId, changes: structuredClone(changes) });
    this.rerenderView({ keepDrawer: true });
  }

  private handleTableRowDrop(result: TableRowDropResult): void {
    const { rowId, beforeRowId, afterRowId, groupKey, fromGroupKey } = result;
    const groupBy = this.model.getView(this.activeViewId)?.groupBy;

    if (this.readOnly) return;
    if (groupBy !== undefined && groupKey !== fromGroupKey) {
      this.cardDragFromOptionId = fromGroupKey;
      const value = this.droppedGroupValue(groupBy, rowId, groupKey);

      this.updateRowBlock(rowId, { [groupBy]: value });
      this.sync.syncUpdateRow({ rowId, properties: { [groupBy]: value } });
    }
    const before = beforeRowId === null ? undefined : this.model.getRow(beforeRowId);
    const after = afterRowId === null ? undefined : this.model.getRow(afterRowId);
    const position = DatabaseModel.positionBetween(after?.position ?? null, before?.position ?? null);

    this.moveRowBlock(rowId, position);
    void this.sync.syncMoveRow({ rowId, position });
    this.rerenderView({ keepDrawer: true });
  }

  /** Same as the drawer: a label the user kept goes back as the saved (unlocalized) one. */
  private handleTableOptionsChange(propertyId: string, options: SelectOption[]): void {
    if (this.readOnly || this.destroyed) return;
    const saved = this.model.getProperty(propertyId)?.config?.options ?? [];
    const shown = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId)?.config?.options ?? [];
    const next = options.map((option) => {
      const before = shown.find((o) => o.id === option.id);
      const savedOption = saved.find((o) => o.id === option.id);

      return before !== undefined && savedOption !== undefined && before.label === option.label
        ? { ...option, label: savedOption.label }
        : option;
    });

    this.clearRemovedOptions(propertyId, next);
    this.model.updateProperty(propertyId, { config: { options: next } });
    this.block.dispatchChange();
    this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    void this.sync.syncUpdateProperty({ propertyId, changes: { config: { options: next } } });
  }

  private renderListView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);

    if (groupByPropId !== undefined) {
      const options = this.groupOptions(groupByPropId, viewConfig);
      const groups = this.queryGroupRows(viewConfig, options.map((o) => o.id));

      this.view = new DatabaseListView({
        readOnly: this.readOnly,
        i18n: this.api.i18n,
        rows: [],
        titlePropertyId: titlePropId,
        schema,
        visiblePropertyIds: visibleRowPropertyIds(viewConfig, this.model.getSchema()),
        options,
        getRows: (optionId) => groups.get(optionId) ?? [],
        collapsedGroupIds: new Set((viewConfig.collapsedGroups ?? []).map((group) => group.id)),
        onToggleCollapse: (optionId, collapsed) => this.saveGroupCollapse(viewConfig.id, optionId, collapsed),
      });
    } else {
      this.view = new DatabaseListView({
        readOnly: this.readOnly,
        i18n: this.api.i18n,
        rows: this.model.queryRows({ view: viewConfig }).rows,
        titlePropertyId: titlePropId,
        schema,
        visiblePropertyIds: visibleRowPropertyIds(viewConfig, this.model.getSchema()),
      });
    }

    return this.view.createView();
  }

  // ---------------------------------------------------------------------------
  // Event listeners & subsystems
  // ---------------------------------------------------------------------------

  /**
   * Attaches a single click listener on the board element for event delegation.
   */
  private attachViewListeners(boardEl: HTMLDivElement): void {
    boardEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const addCardBtn = target.closest('[data-blok-database-add-card]');

      if (addCardBtn !== null) {
        const optionId = addCardBtn.getAttribute('data-option-id');

        if (optionId !== null) {
          this.handleAddRow(optionId, boardEl);
        }

        return;
      }

      const headerNewPage = target.closest('[data-blok-database-column-new-page]');

      if (headerNewPage !== null) {
        const optionId = headerNewPage.getAttribute('data-option-id');

        if (optionId !== null) {
          this.handleAddRow(optionId, boardEl);
        }

        return;
      }

      const groupMenuBtn = target.closest<HTMLElement>('[data-blok-database-column-menu]');

      if (groupMenuBtn !== null) {
        const optionId = groupMenuBtn.getAttribute('data-option-id');

        if (optionId !== null) {
          event.stopPropagation();
          this.openGroupMenu(groupMenuBtn, optionId);
        }

        return;
      }

      const hiddenGroupsBtn = target.closest<HTMLElement>('[data-blok-database-hidden-groups]');

      if (hiddenGroupsBtn !== null) {
        event.stopPropagation();
        this.openHiddenGroupsMenu(hiddenGroupsBtn);

        return;
      }

      const addColumnBtn = target.closest('[data-blok-database-add-column]');

      if (addColumnBtn !== null) {
        this.handleAddColumn(boardEl);

        return;
      }

      const cardMenuBtn = target.closest('[data-blok-database-card-menu]');

      if (cardMenuBtn instanceof HTMLElement) {
        const rowId = cardMenuBtn.getAttribute('data-row-id');
        const cardEl = cardMenuBtn.closest('[data-blok-database-card]');

        if (rowId !== null && cardEl instanceof HTMLElement) {
          event.stopPropagation();
          this.openCardMenu(cardMenuBtn, cardEl, rowId, boardEl);
        }

        return;
      }

      // List: add row
      const addRowBtn = target.closest('[data-blok-database-add-row]');

      if (addRowBtn !== null) {
        const optionId = addRowBtn.getAttribute('data-option-id');
        this.handleAddListRow(optionId, boardEl);
        return;
      }

      // List: delete row
      const deleteRowBtn = target.closest('[data-blok-database-delete-row]');

      if (deleteRowBtn !== null) {
        const rowId = deleteRowBtn.getAttribute('data-row-id');

        if (rowId !== null) {
          event.stopPropagation();
          this.deleteRowBlock(rowId);
          this.view.removeRow(boardEl, rowId);
          void this.sync.syncDeleteRow({ rowId });
        }

        return;
      }

      // List: row click
      const listRowEl = target.closest('[data-blok-database-list-row]');

      if (listRowEl !== null) {
        const rowId = listRowEl.getAttribute('data-row-id');

        if (rowId !== null) {
          this.handleRowClick(rowId);
        }

        return;
      }

      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl !== null) {
        const rowId = cardEl.getAttribute('data-row-id');

        if (rowId !== null) {
          this.handleRowClick(rowId);
        }
      }
    });
  }

  private openCardMenu(anchor: HTMLElement, cardEl: HTMLElement, rowId: string, boardEl: HTMLElement): void {
    cardEl.setAttribute('data-popover-open', '');

    this.cardMenuPopover = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '140px',
      autoFocusFirstItem: false,
      items: [
        {
          type: PopoverItemType.Default,
          title: this.api.i18n.t('tools.database.deleteCard'),
          icon: IconTrash,
          onActivate: () => {
            this.deleteRowBlock(rowId);
            this.view.removeRow(boardEl, rowId);
            void this.sync.syncDeleteRow({ rowId });
          },
        },
      ],
    });

    this.cardMenuPopover.on(PopoverEvent.Closed, () => {
      cardEl.removeAttribute('data-popover-open');
      if (this.cardMenuPopover !== null) {
        const p = this.cardMenuPopover;
        this.cardMenuPopover = null;
        p.destroy();
      }
    });

    this.cardMenuPopover.show();
  }

  /** Every group of the active board, hidden ones included, in board order. */
  private boardGroups(): Array<{ id: string; label: string; hidden: boolean; color: OptionColor | undefined }> {
    const view = this.model.getView(this.activeViewId);

    if (view?.groupBy === undefined) {
      return [];
    }
    const hidden = new Set((view.hiddenGroups ?? []).map((group) => group.id));

    return this.groupOptions(view.groupBy, view).map((option) => ({
      id: option.id,
      label: option.label,
      hidden: hidden.has(option.id),
      color: option.id === NO_VALUE_GROUP_KEY ? undefined : optionColorOf(option),
    }));
  }

  private showGroupPopover(anchor: HTMLElement, items: ReturnType<typeof groupMenuItems>): void {
    this.groupMenuPopover?.destroy();

    const popover = new PopoverDesktop({ class: DATABASE_MENU_CLASS, trigger: anchor, width: 'auto', minWidth: '220px', autoFocusFirstItem: false, items });

    popover.on(PopoverEvent.Closed, () => {
      if (this.groupMenuPopover === popover) {
        this.groupMenuPopover = null;
        popover.destroy();
      }
    });
    this.groupMenuPopover = popover;
    popover.show();
  }

  private openGroupMenu(anchor: HTMLElement, groupId: string): void {
    const view = this.model.getView(this.activeViewId);
    const groups = this.boardGroups();
    const group = groups.find((g) => g.id === groupId);

    if (view === undefined || group === undefined) {
      return;
    }

    this.showGroupPopover(anchor, groupMenuItems({
      i18n: this.api.i18n,
      isNoValue: groupId === NO_VALUE_GROUP_KEY,
      color: group.color,
      aggregationHidden: view.hideGroupAggregation === true,
      groups,
      onToggleGroup: (id) => this.toggleGroupHidden(id),
      onToggleAggregation: () => this.updateActiveView({ hideGroupAggregation: view.hideGroupAggregation !== true }),
      onHide: () => this.toggleGroupHidden(groupId),
      onTrash: () => this.trashGroup(groupId),
      onRecolor: (color) => this.recolorGroup(groupId, color),
    }));
  }

  /** Lists every group with a check mark on the shown ones; a pick shows or hides it. */
  private openHiddenGroupsMenu(anchor: HTMLElement): void {
    this.showGroupPopover(anchor, this.boardGroups().map((group) => ({
      name: `group-${group.id}`,
      title: group.label,
      trailingIcon: group.hidden ? undefined : IconCheck,
      closeOnActivate: true,
      onActivate: () => this.toggleGroupHidden(group.id),
    })));
  }

  /** Kept on the view without a redraw, so the caret's turn plays out. Read-only keeps it on screen only. */
  private saveGroupCollapse(viewId: string, groupId: string, collapsed: boolean): void {
    const current = this.model.getView(viewId)?.collapsedGroups ?? [];

    if (this.readOnly || this.destroyed || current.some((group) => group.id === groupId) === collapsed) {
      return;
    }
    const collapsedGroups = collapsed ? [...current, { id: groupId }] : current.filter((group) => group.id !== groupId);

    this.model.updateView(viewId, { collapsedGroups });
    this.block.dispatchChange();
    void this.sync.syncUpdateView({ viewId, changes: { collapsedGroups } });
  }

  private toggleGroupHidden(groupId: string): void {
    const current = this.model.getView(this.activeViewId)?.hiddenGroups ?? [];
    const hiddenGroups = current.some((group) => group.id === groupId)
      ? current.filter((group) => group.id !== groupId)
      : [...current, { id: groupId }];

    this.updateActiveView({ hiddenGroups });
  }

  private recolorGroup(optionId: string, color: OptionColor): void {
    const groupBy = this.model.getView(this.activeViewId)?.groupBy;
    const options = groupBy === undefined ? undefined : this.model.getProperty(groupBy)?.config?.options;

    if (this.readOnly || groupBy === undefined || options === undefined) {
      return;
    }
    const next = options.map((option) => (option.id === optionId ? { ...option, color } : option));

    this.model.updateProperty(groupBy, { config: { options: next } });
    this.block.dispatchChange();
    this.rerenderView({ keepDrawer: true });
    void this.sync.syncUpdateProperty({ propertyId: groupBy, changes: { config: { options: next } } });
  }

  /** "Move to Trash" on a group deletes the rows the view shows in it, after a confirm (research/08). */
  private trashGroup(groupId: string): void {
    const viewId = this.activeViewId;

    void openDatabaseConfirm({
      title: this.api.i18n.t('tools.database.groupTrashConfirm'),
      confirmLabel: this.api.i18n.t('tools.database.groupMoveToTrash'),
      cancelLabel: this.api.i18n.t('tools.database.optionDeleteCancel'),
      destructive: true,
      directionSource: this.element,
    }).then((trash) => {
      const view = this.model.getView(viewId);

      if (!trash || this.destroyed || this.readOnly || view === undefined) {
        return;
      }
      // Read at confirm time: a peer may have changed the group while the dialog was open.
      const rows = this.queryGroupRows(view, [groupId]).get(groupId) ?? [];
      const remove = (): void => rows.forEach((row) => this.deleteRowBlock(row.id));

      if (this.api.blocks.transact !== undefined) {
        this.api.blocks.transact(remove);
      } else {
        remove();
      }
      this.rerenderView({ keepDrawer: true });
      rows.forEach((row) => {
        void this.sync.syncDeleteRow({ rowId: row.id });
      });
    });
  }

  private handleAddListRow(optionId: string | null, viewEl: HTMLDivElement): void {
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    const groupProp = optionId === null ? undefined : groupByPropId;
    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupProp, optionId ?? NO_VALUE_GROUP_KEY));
    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position: rowData.position, title: '' },
      { parentId: this.block.id, position: 'end', id: rowData.id },
    );
    this.syncRowsFromBlocks();

    // A grouped list keeps its "+ New" inside each group, so the row must go into that group's rows list.
    const groupRows = optionId === null
      ? null
      : viewEl.querySelector(`[data-blok-database-list-group][data-option-id="${optionId}"] [data-blok-database-list-rows]`);

    this.view.appendRow(groupRows instanceof HTMLElement ? groupRows : viewEl, rowData);

    void this.sync.syncCreateRow({
      id: rowData.id,
      properties: rowData.properties,
      position: rowData.position,
    });
  }

  /** The clicked group's value wins over a filter on the same property. */
  private newRowProperties(titlePropId: string, groupByPropId: string | undefined, optionId: string): Record<string, PropertyValue> {
    const filters = (this.model.getView(this.activeViewId)?.filters ?? []).filter((f) => f.propertyId !== groupByPropId);
    const properties: Record<string, PropertyValue> = { ...newRowValues(filters, this.model.getSchema()), [titlePropId]: '' };

    return groupByPropId === undefined || optionId === NO_VALUE_GROUP_KEY
      ? properties
      : { ...properties, [groupByPropId]: this.groupValueFor(groupByPropId, optionId) };
  }

  private groupValueFor(groupByPropId: string, optionId: string): PropertyValue {
    return this.model.getProperty(groupByPropId)?.type === 'multiSelect' ? [optionId] : optionId;
  }

  private handleAddRow(optionId: string, boardEl: HTMLDivElement): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupByPropId, optionId));

    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position: rowData.position, title: '' },
      { parentId: this.block.id, position: 'end', id: rowData.id },
    );
    this.syncRowsFromBlocks();

    const columnEl = boardEl.querySelector(`[data-option-id="${optionId}"][data-blok-database-column]`);

    if (columnEl === null) {
      return;
    }

    const cardsContainer = columnEl.querySelector('[data-blok-database-cards]');

    if (cardsContainer === null) {
      return;
    }

    this.view.appendRow(cardsContainer as HTMLElement, rowData);

    void this.sync.syncCreateRow({
      id: rowData.id,
      properties: rowData.properties,
      position: rowData.position,
    });
  }

  private handleAddColumn(boardEl: HTMLDivElement): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    // Sort by position, not array order: a column reorder rewrites a position in
    // place, so the last array element is not necessarily the last column.
    const existingOptions = [...prop.config.options].sort((a, b) => (a.position < b.position ? -1 : 1));
    const lastPos = existingOptions.length > 0 ? existingOptions[existingOptions.length - 1].position : null;
    // A new group goes after the no-value group, which keeps its place (research/08).
    const noValuePos = viewConfig === undefined ? lastPos : this.noValuePosition(viewConfig, existingOptions);

    if (viewConfig !== undefined && noValuePos !== null) {
      this.pinNoValuePosition(viewConfig, noValuePos);
    }

    const newOption: SelectOption = {
      id: nanoid(),
      label: this.api.i18n.t('tools.database.columnTitlePlaceholder'),
      position: DatabaseModel.positionBetween(noValuePos !== null && (lastPos === null || noValuePos > lastPos) ? noValuePos : lastPos, null),
    };

    this.model.updateProperty(groupByPropId, {
      config: { options: [...existingOptions, newOption] },
    });

    this.view.appendGroup?.(boardEl, newOption);
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: [...existingOptions, newOption] } } });
  }

  /**
   * Initializes all subsystems: card drag, column drag, column controls, card drawer, keyboard.
   * boardEl is the current board element for drag/column operations.
   * cardDrawer is attached to this.element (outer wrapper) so it persists across view switches.
   */
  private initSubsystems(boardEl: HTMLDivElement): void {
    if (this.element === null) {
      return;
    }

    const viewConfig = this.model.getView(this.activeViewId);
    const isList = viewConfig?.type === 'list';
    const isBoard = !isList && viewConfig?.type !== 'table';

    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const descriptionProp = this.model.getSchema().find((p) => p.type === 'richText');
    const descriptionPropId = descriptionProp?.id;

    if (isList) {
      this.listRowDrag = new DatabaseListRowDrag({
        wrapper: boardEl,
        onDrop: (result) => this.handleListRowDrop(result),
      });
    } else if (isBoard) {
      this.cardDrag = new DatabaseCardDrag({
        wrapper: boardEl,
        onDrop: (result) => this.handleRowDrop(result),
      });

      this.columnDrag = new DatabaseColumnDrag({
        wrapper: boardEl,
        onDrop: (result) => this.handleGroupDrop(result),
      });

      this.columnControls = new DatabaseColumnControls({
        i18n: this.api.i18n,
        onRename: (optionId, label) => this.handleOptionRename(optionId, label),
        onDelete: (optionId) => {
          void openDatabaseConfirm({
            title: this.api.i18n.t('tools.database.optionDeleteConfirm'),
            confirmLabel: this.api.i18n.t('tools.database.optionDelete'),
            cancelLabel: this.api.i18n.t('tools.database.optionDeleteCancel'),
            destructive: true,
            directionSource: this.element,
          }).then((confirmed) => {
            if (confirmed && !this.destroyed && !this.readOnly) {
              this.handleOptionDelete(optionId);
            }
          });
        },
        onRenameInput: (optionId, label) => {
          // Instant local save — update the model immediately so save() captures latest value
          this.handleOptionRename(optionId, label);
        },
        onRenameCommit: (optionId, label) => {
          // Debounced backend persist
          const viewConfig = this.model.getView(this.activeViewId);
          const groupByPropId = viewConfig?.groupBy;
          if (groupByPropId === undefined) return;
          const prop = this.model.getProperty(groupByPropId);
          if (prop?.config === undefined) return;
          const options = prop.config.options.map((o) => (o.id === optionId ? { ...o, label } : o));
          this.sync.syncUpdatePropertyDebounced({ propertyId: groupByPropId, changes: { config: { options } } });
        },
      });

      this.makeColumnHeadersEditable(boardEl);
    }

    // cardDrawer is attached to outer wrapper so it stays across view switches
    if (this.cardDrawer === null) {
      this.cardDrawer = new DatabaseCardDrawer({
        wrapper: this.element,
        readOnly: this.readOnly,
        i18n: this.api.i18n,
        events: this.api.events,
        toolsConfig: this.api.tools.getToolsConfig(),
        rowPages: this.config.rowPages,
        titlePropertyId: titlePropId,
        descriptionPropertyId: descriptionPropId,
        schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
        onTitleChange: (rowId, title) => {
          this.updateRowTitleBlock(rowId, titlePropId, title);
          const currentView = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]')
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-list]')
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-table]');

          if (currentView !== null && currentView !== undefined) {
            this.view.updateRowTitle(currentView, rowId, title);
          }

          this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: title } });
        },
        onDescriptionChange: (rowId, description: OutputData) => {
          const row = this.model.getRow(rowId);

          if (row === undefined || (this.config.rowPages !== undefined && row.pageId !== undefined)) return;
          const schema = this.model.getSchema();
          const designated = schema.find((property) => property.type === 'richText');
          const existing = schema.find((property) => property.type === 'richText'
            && property.name === designated?.name
            && row?.properties[property.id] !== undefined && row?.properties[property.id] !== null)
            ?? designated;
          const property = existing ?? this.model.addProperty(this.api.i18n.t('tools.database.cardDetails'), 'richText');

          if (existing === undefined) {
            this.block.dispatchChange();
            this.descriptionPropertyNeedsCreate = true;
          }

          if (this.descriptionPropertyNeedsCreate && this.descriptionPropertyCreation === null) {
            const creation = this.sync.syncCreateProperty({
              id: property.id,
              name: property.name,
              type: property.type,
              position: property.position,
            });

            this.descriptionPropertyCreation = creation;
            void creation.then((created) => {
              this.descriptionPropertyCreation = null;
              if (created === undefined && this.config.adapter !== undefined) {
                return;
              }
              this.descriptionPropertyNeedsCreate = false;

              if (this.config.rowPages === undefined) {
                for (const [pendingRowId, pendingDescription] of this.pendingDescriptions) {
                  this.sync.syncUpdateRow({ rowId: pendingRowId, properties: { [property.id]: pendingDescription } });
                }
                this.pendingDescriptions.clear();
                this.sync.flushPendingUpdates();
              }
            });
          }

          this.cardDrawer?.setDescriptionPropertyId(property.id);
          this.updateRowBlock(rowId, { [property.id]: description });
          if (this.config.rowPages !== undefined) {
            void this.copyLegacyRowBody(rowId, property.id, description);
          } else if (this.descriptionPropertyCreation !== null) {
            this.pendingDescriptions.set(rowId, description);
          } else {
            this.sync.syncUpdateRow({ rowId, properties: { [property.id]: description } });
          }
        },
        onClose: () => { /* no-op; drawer handles its own DOM cleanup */ },
        onAddProperty: (type, name) => {
          if (this.addProperty({ name, type }) !== null) {
            this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
          }
        },
        onOpenPropertyMenu: (propertyId, anchor) => this.openPropertyMenu(propertyId, anchor),
        hasPeople: this.hasPeople,
        cellContext: () => this.cellContext(),
        onPropertyValueChange: (rowId, propertyId, value) => {
          if (this.readOnly || this.destroyed) return;
          // Deleting an option already emptied this row through clearRemovedOptions.
          if (JSON.stringify(this.model.getRow(rowId)?.properties[propertyId] ?? null) === JSON.stringify(value)) return;
          this.updateRowBlock(rowId, { [propertyId]: value });
          this.rerenderView({ keepDrawer: true });
          this.sync.syncUpdateRow({ rowId, properties: { [propertyId]: value } });
        },
        onOptionsChange: (propertyId, options) => {
          if (this.readOnly || this.destroyed) return;
          this.clearRemovedOptions(propertyId, options);
          this.model.updateProperty(propertyId, { config: { options } });
          this.block.dispatchChange();
          this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
          this.rerenderView({ keepDrawer: true });
          void this.sync.syncUpdateProperty({ propertyId, changes: { config: { options } } });
        },
        savedOptionsOf: (propertyId) => this.model.getProperty(propertyId)?.config?.options,
        peekHost: () => this.element?.closest<HTMLElement>(`[${DATA_ATTR.editor}]`) ?? null,
      });
    }

    this.keyboard = new DatabaseKeyboard({
      wrapper: boardEl,
      onEscape: () => {
        if (this.cardDrawer?.isOpen) {
          this.cardDrawer.close();

          return true;
        }

        return false;
      },
    });
    this.keyboard.attach();

    boardEl.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;

      // Board: column header drag
      const columnHeader = target.closest('[data-blok-database-column-header]');

      if (columnHeader !== null) {
        // Do not start drag when the click originates from the pill (title element or its input)
        // or from a header button.
        const isPillTarget = target.closest('[data-blok-database-column-pill], [data-blok-database-column-actions]') !== null;
        if (isPillTarget) return;

        const columnEl = columnHeader.closest<HTMLElement>('[data-blok-database-column]');
        const optId = columnEl?.getAttribute('data-option-id') ?? null;

        if (optId !== null && optId !== NO_VALUE_GROUP_KEY) {
          e.preventDefault();
          e.stopPropagation();
          this.columnDrag?.beginTracking(optId, e.clientX, e.clientY);
        }

        return;
      }

      // Board: card drag
      const cardEl = target.closest<HTMLElement>('[data-blok-database-card]');

      if (cardEl !== null) {
        const rowId = cardEl.getAttribute('data-row-id');

        if (rowId !== null) {
          e.preventDefault();
          e.stopPropagation();
          this.cardDragFromOptionId = cardEl.closest('[data-blok-database-column]')?.getAttribute('data-option-id') ?? null;
          this.cardDrag?.beginTracking(rowId, e.clientX, e.clientY, cardEl);
        }

        return;
      }

      // List: row drag
      const listRowEl = target.closest('[data-blok-database-list-row]');

      if (listRowEl !== null) {
        const rowId = listRowEl.getAttribute('data-row-id');

        if (rowId !== null) {
          e.preventDefault();
          e.stopPropagation();
          this.listRowDrag?.beginTracking(rowId, e.clientX, e.clientY);
        }
      }
    });
  }

  private makeColumnHeadersEditable(boardEl: HTMLDivElement): void {
    if (this.columnControls === null) {
      return;
    }

    const headers = Array.from(boardEl.querySelectorAll<HTMLElement>('[data-blok-database-column-header]'));

    for (const header of headers) {
      const columnEl = header.closest<HTMLElement>('[data-blok-database-column]');
      const optId = columnEl?.getAttribute('data-option-id');

      if (optId !== null && optId !== undefined && optId !== NO_VALUE_GROUP_KEY) {
        this.columnControls.makePillTitleEditable(header, optId);
        this.columnControls.appendDeleteButton(header, optId);
      }
    }
  }

  private handleListRowDrop(result: ListRowDragResult): void {
    const { rowId, beforeRowId, afterRowId } = result;

    if ((this.model.getView(this.activeViewId)?.sorts.length ?? 0) > 0) {
      this.askToRemoveSorting(rowId, beforeRowId, afterRowId);

      return;
    }

    const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
    const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
    const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);

    this.moveRowBlock(rowId, position);
    this.rerenderView();

    void this.sync.syncMoveRow({ rowId, position });
  }

  private handleRowDrop(result: CardDragResult): void {
    const { rowId, toOptionId, beforeRowId, afterRowId } = result;
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    // Neighbours arrive in sort order, not key order, so positionBetween would
    // throw. A reorder inside the group asks first (D7). A move to another
    // group changes the value only: Notion's answer there is unmeasured.
    if (viewConfig !== undefined && viewConfig.sorts.length > 0) {
      const row = this.model.getRow(rowId);

      if (row !== undefined && this.model.groupKeysOf(groupByPropId)(row).includes(toOptionId)) {
        this.askToRemoveSorting(rowId, beforeRowId, afterRowId);

        return;
      }

      const sortedValue = this.droppedGroupValue(groupByPropId, rowId, toOptionId);

      if (JSON.stringify(this.model.getRow(rowId)?.properties[groupByPropId] ?? null) !== JSON.stringify(sortedValue)) {
        this.updateRowBlock(rowId, { [groupByPropId]: sortedValue });
        this.rerenderView();
        this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: sortedValue } });
      }

      return;
    }

    const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
    const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
    const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);

    const value = this.droppedGroupValue(groupByPropId, rowId, toOptionId);

    this.updateRowBlock(rowId, { [groupByPropId]: value });
    this.moveRowBlock(rowId, position);
    this.rerenderView();

    this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: value } });
    void this.sync.syncMoveRow({ rowId, position });
  }

  /**
   * Notion's D7 flow (research/08): "Remove" deletes the sorts, keeps the sorted
   * order as the manual order and lands the row where it was dropped.
   * "Don't remove" discards the drop.
   */
  private askToRemoveSorting(rowId: string, beforeRowId: string | null, afterRowId: string | null): void {
    const viewId = this.activeViewId;

    void openDatabaseConfirm({
      title: this.api.i18n.t('tools.database.removeSortingTitle'),
      confirmLabel: this.api.i18n.t('tools.database.removeSortingConfirm'),
      cancelLabel: this.api.i18n.t('tools.database.removeSortingCancel'),
      destructive: true,
      directionSource: this.element,
    }).then((remove) => {
      const view = this.model.getView(viewId);

      // A peer may have dropped the sort or the row while the dialog was open.
      if (!remove || this.destroyed || this.readOnly || view === undefined || view.sorts.length === 0
        || this.model.getRow(rowId) === undefined) {
        return;
      }
      this.removeSortingAndPlace(view, rowId, beforeRowId, afterRowId);
    });
  }

  private removeSortingAndPlace(view: DatabaseViewConfig, rowId: string, beforeRowId: string | null, afterRowId: string | null): void {
    // Every row, filtered out or not, so hidden rows keep their sorted place too.
    const sorted = sortRows(this.model.getOrderedRows(), view.sorts, this.model.getSchema());
    const dragged = sorted.find((row) => row.id === rowId);
    const rest = sorted.filter((row) => row.id !== rowId);

    if (dragged === undefined) {
      return;
    }

    const afterIndex = afterRowId === null ? -1 : rest.findIndex((row) => row.id === afterRowId);
    const beforeIndex = beforeRowId === null ? -1 : rest.findIndex((row) => row.id === beforeRowId);
    const insertAt = afterIndex !== -1 ? afterIndex + 1 : beforeIndex !== -1 ? beforeIndex : rest.length;
    const order = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
    const moves: Array<{ rowId: string; position: string }> = [];

    order.reduce<string | null>((previous, row) => {
      const position = DatabaseModel.positionBetween(previous, null);

      if (row.position !== position) {
        moves.push({ rowId: row.id, position });
      }

      return position;
    }, null);

    const write = (): void => {
      this.model.updateView(view.id, { sorts: [] });
      this.block.dispatchChange();
      moves.forEach((move) => this.moveRowBlock(move.rowId, move.position));
    };

    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(write);
    } else {
      write();
    }

    this.rerenderView();
    void this.sync.syncUpdateView({ viewId: view.id, changes: { sorts: [] } });
    moves.forEach((move) => {
      void this.sync.syncMoveRow(move);
    });
  }

  private droppedGroupValue(groupByPropId: string, rowId: string, toOptionId: string): PropertyValue {
    const target = toOptionId === NO_VALUE_GROUP_KEY ? null : toOptionId;
    const type = this.model.getProperty(groupByPropId)?.type;
    const current = this.model.getRow(rowId)?.properties[groupByPropId];

    if (type === 'status' && target !== null && this.model.getView(this.activeViewId)?.groupByStatus === 'group') {
      return this.model.statusValueForGroup(groupByPropId, target, current);
    }
    if (type !== 'multiSelect') {
      return target;
    }

    const list = personIdsOf(current);
    const from = this.cardDragFromOptionId;
    const next = list.some((id) => id === from)
      ? list.map((id) => (id === from ? target : id))
      : [...list, target];

    return [...new Set(next.filter((id): id is string => id !== null))];
  }

  private handleGroupDrop(result: GroupDragResult): void {
    const { optionId, beforeOptionId, afterOptionId } = result;
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    // Keep the stored array in position order so every later reader (add-column,
    // neighbour lookup) sees the same order the board renders in.
    const options = [...prop.config.options].sort((a, b) => (a.position < b.position ? -1 : 1));
    const draggedIdx = options.findIndex((o) => o.id === optionId);

    if (draggedIdx === -1) {
      return;
    }

    const positionOf = (id: string | null): string | null => {
      if (id === NO_VALUE_GROUP_KEY && viewConfig !== undefined) {
        return this.noValuePosition(viewConfig, options, optionId);
      }

      return id === null ? null : options.find((o) => o.id === id)?.position ?? null;
    };

    if (afterOptionId === NO_VALUE_GROUP_KEY && viewConfig !== undefined) {
      this.pinNoValuePosition(viewConfig, this.noValuePosition(viewConfig, options, optionId));
    }

    const newPosition = beforeOptionId === NO_VALUE_GROUP_KEY && viewConfig?.noValueGroupPosition === undefined
      ? DatabaseModel.positionBetween(positionOf(afterOptionId), null)
      : DatabaseModel.positionBetween(positionOf(afterOptionId), positionOf(beforeOptionId));

    options[draggedIdx] = { ...options[draggedIdx], position: newPosition };
    options.sort((a, b) => (a.position < b.position ? -1 : 1));
    this.model.updateProperty(groupByPropId, { config: { options } });

    this.moveColumnInDom(optionId, beforeOptionId);
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options } } });
  }

  /**
   * Moves a column element to a new position in the DOM without full re-render.
   */
  private moveColumnInDom(optionId: string, beforeOptionId: string | null): void {
    const boardEl = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]');

    if (boardEl === null || boardEl === undefined) {
      return;
    }

    const columnEl = boardEl.querySelector<HTMLElement>(`[data-option-id="${optionId}"]`);

    if (columnEl === null) {
      return;
    }

    if (beforeOptionId !== null) {
      const beforeEl = boardEl.querySelector(`[data-option-id="${beforeOptionId}"]`);

      if (beforeEl !== null) {
        boardEl.insertBefore(columnEl, beforeEl);
      }
    } else {
      const addColumnBtn = boardEl.querySelector('[data-blok-database-add-column]');

      if (addColumnBtn !== null) {
        boardEl.insertBefore(columnEl, addColumnBtn);
      } else {
        boardEl.appendChild(columnEl);
      }
    }
  }

  private handleOptionRename(optionId: string, label: string): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    const options = prop.config.options.map((o) => o.id === optionId ? { ...o, label } : o);
    this.model.updateProperty(groupByPropId, { config: { options } });
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options } } });
  }

  private handleOptionDelete(optionId: string): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    if (prop.config.options.length <= 1) {
      return;
    }

    const rowsInGroup = this.model.getRowsGroupedBy(groupByPropId).get(optionId) ?? [];

    for (const row of rowsInGroup) {
      const current = row.properties[groupByPropId];
      const value = Array.isArray(current) ? personIdsOf(current).filter((id) => id !== optionId) : null;

      this.updateRowBlock(row.id, { [groupByPropId]: value });
      this.sync.syncUpdateRow({ rowId: row.id, properties: { [groupByPropId]: value } });
    }

    const filteredOptions = prop.config.options.filter((o) => o.id !== optionId);
    this.model.updateProperty(groupByPropId, { config: { options: filteredOptions } });
    this.rerenderView();
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: filteredOptions } } });
  }

  /** A deleted option leaves its rows in place with the value emptied, as Notion does (research/08, D9). */
  private clearRemovedOptions(propertyId: string, next: SelectOption[]): void {
    const kept = new Set(next.map((option) => option.id));
    const removed = (this.model.getProperty(propertyId)?.config?.options ?? []).filter((option) => !kept.has(option.id));

    if (removed.length === 0) return;
    const gone = new Set(removed.map((option) => option.id));

    for (const row of this.model.getOrderedRows()) {
      const current = row.properties[propertyId];
      const ids = Array.isArray(current) ? personIdsOf(current) : [];
      const value = Array.isArray(current) ? ids.filter((id) => !gone.has(id)) : null;
      const holdsRemoved = typeof current === 'string' ? gone.has(current) : ids.some((id) => gone.has(id));

      if (holdsRemoved) {
        this.updateRowBlock(row.id, { [propertyId]: value });
        this.sync.syncUpdateRow({ rowId: row.id, properties: { [propertyId]: value } });
      }
    }
  }

  private handleRowClick(rowId: string): void {
    const row = this.model.getRow(rowId);

    // Already shown: a fresh lookup would drop the open editor unsaved.
    if (row === undefined || this.cardDrawer?.openRowId === rowId) {
      return;
    }

    if (this.config.rowPages !== undefined && !this.readOnly && row.pageId === undefined) {
      this.cardDrawer?.setRowPageLookup(rowId, 'pending');
    }
    this.cardDrawer?.open(row);
    void this.resolveRowPage(rowId);
  }

  /**
   * Ask the host about rows an older client touched: one that lost `pageId`
   * (its save prunes keys it does not know), or a moved row whose legacy body
   * changed.
   */
  private resolveMovedRows(before: DatabaseRow[], after: DatabaseRow[]): void {
    if (this.config.rowPages === undefined || this.readOnly) return;
    for (const row of after) {
      const previous = before.find(({ id }) => id === row.id);

      if (previous === undefined || (previous.pageId === undefined && row.pageId === undefined)) continue;
      if (row.pageId === undefined || !equalsOutputData(this.legacyBodyOf(previous), this.legacyBodyOf(row))) {
        void this.resolveRowPage(row.id);
      }
    }
  }

  private legacyBodyOf(row: DatabaseRow | undefined): OutputData | undefined {
    for (const property of this.model.getSchema()) {
      const value = row?.properties[property.id];

      if (property.type === 'richText' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value;
      }
    }

    return undefined;
  }

  /** Look the row's page up and adopt it; the drawer waits for the answer. */
  private async resolveRowPage(rowId: string): Promise<void> {
    const rowPages = this.config.rowPages;

    if (rowPages === undefined || this.readOnly || this.destroyed) return;
    if (this.resolvingRows.has(rowId)) {
      this.resolveAgainRows.add(rowId);

      return;
    }
    this.resolvingRows.add(rowId);
    const stage = { lookedUp: false };

    try {
      const page = await rowPages.lookup({ rowId });

      stage.lookedUp = true;
      if (page !== null) {
        await this.adoptRowPage(rowId, page);
      }
      if (!this.destroyed) this.cardDrawer?.setRowPageLookup(rowId, 'done');
    } catch {
      // A row whose page is shown loses nothing when a background lookup
      // fails: its legacy body stays for the next check.
      const quiet = !stage.lookedUp && this.model.getRow(rowId)?.pageId !== undefined;

      if (!this.destroyed && !quiet) {
        this.cardDrawer?.setRowPageLookup(rowId, 'failed');
        this.api.notifier.show({ message: this.api.i18n.t('tools.stub.error'), style: 'error' });
      }
    } finally {
      this.resolvingRows.delete(rowId);
      if (this.resolveAgainRows.delete(rowId)) {
        void this.resolveRowPage(rowId);
      }
    }
  }

  /** `lookup` for the copy path; a failure leaves the body non-editable. */
  private async lookupForCopy(rowId: string): Promise<{ pageId: string; acceptedBody: OutputData } | null> {
    const rowPages = this.config.rowPages;

    if (rowPages === undefined) return null;
    try {
      return await rowPages.lookup({ rowId });
    } catch (error) {
      if (!this.destroyed) this.cardDrawer?.setRowPageLookup(rowId, 'failed');
      throw error;
    }
  }

  /**
   * Point the row at the host's page. A legacy body an older client changed
   * after the copy is merged into the page first, so neither body is lost.
   * Never writes the legacy body.
   */
  private async adoptRowPage(rowId: string, page: { pageId: string; acceptedBody: OutputData }): Promise<void> {
    const rowPages = this.config.rowPages;

    if (rowPages === undefined || this.readOnly || this.destroyed) return;
    if (typeof page.pageId !== 'string' || page.pageId.length === 0) {
      throw new Error('Row page lookup returned no page id');
    }
    const legacy = this.legacyBodyOf(this.model.getRow(rowId));

    if (legacy !== undefined && !equalsOutputData(legacy, page.acceptedBody)) {
      const request = { rowId, pageId: page.pageId, operationId: nanoid(), body: legacy, acceptedBody: page.acceptedBody };
      const receipt = await rowPages.reconcileLegacy(request).catch(() => rowPages.reconcileLegacy(request));

      if (receipt.pageId !== page.pageId
        || typeof receipt.transactionId !== 'string' || receipt.transactionId.length === 0
        || !equalsOutputData(receipt.acceptedBody, legacy)) {
        throw new Error('Reconcile receipt did not match the legacy body');
      }
      if (this.readOnly || this.destroyed) return;
      // Changed again meanwhile. The change may not have touched pageId, so no
      // reprojection would rerun this: queue it here.
      if (!equalsOutputData(this.legacyBodyOf(this.model.getRow(rowId)), legacy)) {
        void this.resolveRowPage(rowId);

        return;
      }
    }

    const rowBlock = this.api.blocks.getChildren(this.block.id).find((child) => child.id === rowId);

    if (rowBlock === undefined || this.model.getRow(rowId)?.pageId === page.pageId) return;
    rowBlock.call('updatePageId', { pageId: page.pageId });
    // Host-derived, not a user step: undo must not strip it again.
    rowBlock.dispatchChange({ derived: true });
    this.syncRowsFromBlocks();
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.model.getRow(rowId));
    }
  }

  /**
   * Full re-render of the active board: tears down subsystems, rebuilds DOM, re-inits.
   *
   * Board DOM structure:
   *   boardContainer
   *     boardWrapper  (div returned by createBoard / renderActiveBoard)
   *           boardArea  ([data-blok-database-board] — scrollable area with columns)
   */
  // ---------------------------------------------------------------------------
  // Property operations. The property menu, the drawer and the views call
  // these; each writes the database block (and rows) once, so it is one
  // undo step.
  // ---------------------------------------------------------------------------

  /** People from the host directory, once loaded. */
  private people: DatabasePerson[] | undefined;
  private peopleLoad: Promise<void> | null = null;

  /** Loads the host's people once, then redraws so names replace placeholders. */
  private loadPeople(): void {
    const directory = this.config.people;

    if (directory === undefined || this.peopleLoad !== null) return;
    this.peopleLoad = directory.list().then((people) => {
      if (this.destroyed) return;
      this.people = people;
      this.rerenderView({ keepDrawer: true });
    }).catch(() => undefined);
  }

  /** What cells need from the host: people, the current user, file uploads. */
  private cellContext(): Partial<CellContext> {
    const uploader = this.api.uploader;
    const canUpload = !this.readOnly && uploader !== undefined && uploader.isConfigured('file', 'uploadByFile');
    const me = this.config.people?.me?.();

    return {
      ...(this.people !== undefined ? { people: this.people } : {}),
      ...(typeof me === 'string' ? { me } : {}),
      ...(canUpload
        ? {
          uploadFile: (file: File) => uploader.uploadByFile(file, { kind: 'file', tool: 'database' })
            .then((asset) => ({ url: asset.url, ...(asset.fileName !== undefined ? { name: asset.fileName } : {}) })),
        }
        : {}),
    };
  }

  /** Whether the person property can be offered: the host gave a people directory. */
  private get hasPeople(): boolean {
    return this.config.people !== undefined;
  }

  /** Writes the schema and redraws. */
  private commitSchema(): void {
    this.block.dispatchChange();
    this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.rerenderView({ keepDrawer: true });
  }

  /**
   * Adds a property, named after its type when `name` is empty. Status
   * starts with Notion's three options in its three groups. Returns null
   * when the type cannot be added (person without a people directory) or
   * the block is read-only.
   */
  addProperty(params: { name: string; type: PropertyType; afterId?: string; beforeId?: string }): PropertyDefinition | null {
    if (this.readOnly || this.destroyed || params.type === 'title' || (params.type === 'person' && !this.hasPeople)) {
      return null;
    }
    const name = params.name.trim() === '' ? this.api.i18n.t(propertyTypeMeta(params.type).labelKey) : params.name.trim();
    const isStatus = params.type === 'status';
    const config = isStatus
      ? {
        options: createDefaultStatusOptions({
          notStarted: DATABASE_DEFAULT_TEXT.statusNotStarted,
          inProgress: DATABASE_DEFAULT_TEXT.statusInProgress,
          done: DATABASE_DEFAULT_TEXT.statusDone,
        }),
      }
      : undefined;
    const prop = this.model.addProperty(name, params.type, config, { afterId: params.afterId, beforeId: params.beforeId }, isStatus ? { status: createDefaultStatusSettings() } : {});
    const view = this.model.getView(this.activeViewId);

    if (view !== undefined && (params.afterId !== undefined || params.beforeId !== undefined)) {
      const schema = this.model.getSchema();
      // The view's column order, not the schema's: a user may have dragged the columns.
      const order = resolveViewProperties(view, schema).map((p) => p.id).filter((id) => id !== prop.id);
      const beforeId = params.beforeId ?? order[order.indexOf(params.afterId ?? '') + 1] ?? null;
      const properties = withPropertyOrder(view, schema, prop.id, beforeId);

      this.model.updateView(view.id, { properties });
      void this.sync.syncUpdateView({ viewId: view.id, changes: { properties } });
    }
    void this.sync.syncCreateProperty({
      id: prop.id,
      name: prop.name,
      type: prop.type,
      position: prop.position,
      ...(prop.config !== undefined ? { config: prop.config } : {}),
      ...(prop.status !== undefined ? { status: prop.status } : {}),
    });
    this.commitSchema();

    return prop;
  }

  renameProperty(propertyId: string, name: string): void {
    if (this.readOnly || this.destroyed || name.trim() === '' || this.model.getProperty(propertyId) === undefined) return;
    this.model.updateProperty(propertyId, { name: name.trim() });
    void this.sync.syncUpdateProperty({ propertyId, changes: { name: name.trim() } });
    this.commitSchema();
  }

  /** Icon, description, page visibility, and the number, date, status and ID settings. */
  updatePropertySettings(propertyId: string, patch: Partial<PropertySettingsV2>): void {
    if (this.readOnly || this.destroyed || this.model.getProperty(propertyId) === undefined) return;
    this.model.updateProperty(propertyId, patch);
    void this.sync.syncUpdateProperty({ propertyId, changes: patch });
    this.commitSchema();
  }

  /**
   * Changes a property's type and converts every row's value in the same
   * step (see planTypeChange). The title never changes type.
   */
  changePropertyType(propertyId: string, type: PropertyType): void {
    const property = this.model.getProperty(propertyId);

    if (this.readOnly || this.destroyed || property === undefined || (type === 'person' && !this.hasPeople)) return;
    const children = this.api.blocks.getChildren(this.block.id).filter((child) => child.name === 'database-row');
    const kept = new Map(children.map((child) => {
      const live: DatabaseRowData[] = [];

      child.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });

      return [child.id, (live[0] ?? child.preservedData as DatabaseRowData | undefined)?.convertedValues] as const;
    }));
    const plan = planTypeChange(property, type, this.model.getOrderedRows().map((row) => ({ ...row, convertedValues: kept.get(row.id) })));

    if (plan === null) return;
    this.model.replaceProperty(plan.property);
    for (const write of plan.writes) {
      const child = children.find((block) => block.id === write.rowId);

      if (child === undefined) continue;
      child.call('updateProperties', { [propertyId]: write.value });
      if (write.stash !== undefined) {
        child.call('updateConvertedValues', { [propertyId]: write.stash });
      }
      child.dispatchChange();
      this.sync.syncUpdateRow({ rowId: write.rowId, properties: { [propertyId]: write.value } });
    }
    this.syncRowsFromBlocks();
    const { id: _id, position: _position, ...changes } = plan.property;

    void this.sync.syncUpdateProperty({ propertyId, changes });
    this.commitSchema();
  }

  /** Copies a property and every row's value of it, right after the original. */
  duplicateProperty(propertyId: string): PropertyDefinition | null {
    const property = this.model.getProperty(propertyId);

    if (this.readOnly || this.destroyed || property === undefined || property.type === 'title' || property.type === 'uniqueId') return null;
    const { id: _id, name, type, position: _position, config, ...settings } = structuredClone(property);
    const copy = this.model.addProperty(
      this.api.i18n.t('tools.database.duplicatePropertyName').replace('{name}', name),
      type,
      config,
      { afterId: propertyId },
      settings
    );

    for (const row of this.model.getOrderedRows()) {
      const value = row.properties[propertyId];

      if (value !== undefined && value !== null) {
        this.updateRowBlock(row.id, { [copy.id]: structuredClone(value) });
        this.sync.syncUpdateRow({ rowId: row.id, properties: { [copy.id]: value } });
      }
    }
    void this.sync.syncCreateProperty({ ...settings, id: copy.id, name: copy.name, type, position: copy.position, ...(config !== undefined ? { config } : {}) });
    this.commitSchema();

    return copy;
  }

  /** Removes a property from the schema. Row values stay (D9). The title cannot be deleted. */
  deleteProperty(propertyId: string): void {
    const property = this.model.getProperty(propertyId);

    if (this.readOnly || this.destroyed || property === undefined || property.type === 'title') return;
    this.model.deleteProperty(propertyId);
    void this.sync.syncDeleteProperty({ propertyId });
    this.commitSchema();
  }

  /**
   * The property menu for a column header or a drawer row. Views call this;
   * its view-level rows (filter, sort, freeze…) are theirs to add.
   */
  openPropertyMenu(propertyId: string, anchor: HTMLElement): void {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId);

    if (this.readOnly || property === undefined) return;
    this.propertyMenu ??= new DatabasePropertyMenu({
      i18n: this.api.i18n,
      hasPeople: this.hasPeople,
      onRename: (id, name) => this.renameProperty(id, name),
      onUpdate: (id, patch) => this.updatePropertySettings(id, patch),
      onChangeType: (id, type) => this.changePropertyType(id, type),
      onDuplicate: (id) => { this.duplicateProperty(id); },
      onDelete: (id) => this.deleteProperty(id),
    });
    const saved = this.model.getProperty(propertyId);

    if (saved === undefined) return;
    // The saved property, shown with its localized name: a settings patch the
    // menu builds from it must never carry a translated label into the data.
    const viewItems = this.view instanceof DatabaseTableView ? this.view.headerItems(propertyId, anchor) : [];

    this.propertyMenu.open({ ...saved, name: property.name }, anchor, viewItems);
  }

  /**
   * Notion's "+" flow: a name field over the type list. With a placement
   * (Insert left/right), the new column lands beside that one in the active
   * view's column order.
   */
  openAddProperty(anchor: HTMLElement, placement?: { propertyId: string; side: 'left' | 'right' }): void {
    if (this.readOnly) return;
    this.addPropertyPopover?.destroy();
    this.addPropertyPopover = new DatabasePropertyTypePopover({
      i18n: this.api.i18n,
      hasPeople: this.hasPeople,
      withNameField: true,
      onSelect: (type, name) => {
        const side = placement?.side === 'left' ? 'beforeId' : 'afterId';

        this.addProperty({ name, type, ...(placement === undefined ? {} : { [side]: placement.propertyId }) });
      },
    });
    this.addPropertyPopover.open(anchor);
  }


  private rerenderView(options: { keepDrawer?: boolean } = {}): void {
    if (this.boardContainer === null) {
      return;
    }

    this.stopWaitingForIdle();

    // The old board wrapper is the first/only direct child of boardContainer
    const oldBoardWrapper = this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]')
      ?.closest<HTMLElement>('[data-blok-tool]')
      ?? this.boardContainer.querySelector<HTMLElement>('[data-blok-database-list]')
      ?? this.boardContainer.firstElementChild as HTMLElement | null;

    // The board and the table each scroll sideways in their own element.
    const scrollSelector = '[data-blok-database-board], [data-blok-database-table-scroller]';
    const oldBoardArea = this.boardContainer.querySelector<HTMLElement>(scrollSelector);
    const savedScrollLeft = oldBoardArea?.scrollLeft ?? 0;

    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.listRowDrag?.destroy();
    this.listRowDrag = null;
    this.keyboard?.destroy();
    this.destroyTableView();

    // The drawer hangs off the outer wrapper, not the board, so it can stay.
    if (options.keepDrawer !== true) {
      this.cardDrawer?.destroy();
      this.cardDrawer = null;
    }

    this.syncRowsFromBlocks();
    const newBoardWrapper = this.renderActiveView();

    if (oldBoardWrapper !== null && oldBoardWrapper !== undefined) {
      oldBoardWrapper.replaceWith(newBoardWrapper);
    } else {
      this.boardContainer.appendChild(newBoardWrapper);
    }

    // Restore horizontal scroll on the new board area
    const newBoardArea = newBoardWrapper.querySelector<HTMLElement>(scrollSelector);

    if (newBoardArea !== null) {
      newBoardArea.scrollLeft = savedScrollLeft;
    }

    // Same gate as render() and switchView(): rows arriving after boot,
    // undo/peer reprojection and setReadOnly all rerender through here.
    if (!this.readOnly) {
      this.attachViewListeners(newBoardWrapper);
      this.initSubsystems(newBoardWrapper);
    }
  }
}
