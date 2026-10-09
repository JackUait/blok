import { describeDatabase } from '../../shared/tool-descriptions/database';
import { databaseSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig, SanitizerConfig } from '../../../types';
import type { DatabaseData, DatabaseConfig, DatabaseRow, DatabaseRowData, ViewType, SelectOption, DatabaseViewConfig, PropertyType, PropertyValue } from './types';
import { personIdsOf } from './property-values';
import { DatabaseModel, NO_VALUE_GROUP_KEY } from './database-model';
import { newRowValues } from './database-query';
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
import { IconDatabase, IconBoard, IconTrash } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { nanoid } from 'nanoid';
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
  private descriptionPropertyCreation: ReturnType<DatabaseBackendSync['syncCreateProperty']> | null = null;
  private descriptionPropertyNeedsCreate = false;
  private readonly pendingDescriptions = new Map<string, OutputData>();
  private keyboard: DatabaseKeyboard | null = null;
  private cardMenuPopover: PopoverDesktop | null = null;
  /** Per table view: selection, loaded rows, collapsed groups. Session only, never saved. */
  private readonly tableStates = new Map<string, TableState>();
  private propertyTypePopover: DatabasePropertyTypePopover | null = null;
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
    this.stopWaitingForIdle();
    this.cardMenuPopover?.destroy();
    this.propertyTypePopover?.close();
    this.destroyTableView();
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

        return {
          id: child.id,
          position: rowData?.position ?? '',
          properties,
          ...(typeof rowData?.pageId === 'string' && rowData.pageId.length > 0 ? { pageId: rowData.pageId } : {}),
        };
      });
    this.model.setRows(rows);
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

  /**
   * The no-value option must stay first: column drag never drops before it,
   * and handleGroupDrop reads a missing left neighbour as "first real option".
   */
  private groupOptions(groupByPropId: string): SelectOption[] {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === groupByPropId);
    const noValue: SelectOption = {
      id: NO_VALUE_GROUP_KEY,
      label: this.api.i18n.t('tools.database.noValueGroup', { property: property?.name ?? '' }),
      position: '',
    };

    const statusBy = this.model.getView(this.activeViewId)?.groupByStatus;

    return [noValue, ...localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId, { statusBy }), this.api.i18n)];
  }

  /** Each group's rows, queried once per render. */
  private queryGroupRows(viewConfig: DatabaseViewConfig, optionIds: string[]): Map<string, DatabaseRow[]> {
    return new Map(optionIds.map((id) => [id, this.model.queryRows({ view: viewConfig, group: id }).rows]));
  }

  private renderBoardView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig | undefined): HTMLDivElement {
    const options = groupByPropId !== undefined ? this.groupOptions(groupByPropId) : [];
    const groups = viewConfig !== undefined && groupByPropId !== undefined
      ? this.queryGroupRows(viewConfig, options.map((o) => o.id))
      : new Map<string, DatabaseRow[]>();

    this.view = new DatabaseBoardView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      options,
      getRows: (optionId) => groups.get(optionId) ?? [],
      titlePropertyId: titlePropId,
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

  /** Notion lists the no-value group last in a table (research/08). */
  private tableGroups(groupBy: string, viewConfig: DatabaseViewConfig): TableGroup[] {
    const [noValue, ...options] = this.groupOptions(groupBy);
    const ordered = [...options, noValue];
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

  /**
   * Opens a column's header menu. The property menu (rename, type, delete)
   * replaces this and shows `DatabaseTableView.headerItems` after its own rows.
   */
  protected openPropertyMenu(propertyId: string, anchor: HTMLElement): void {
    if (this.view instanceof DatabaseTableView) {
      this.view.openHeaderMenu(propertyId, anchor);
    }
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

  /**
   * "+" in the header, or Insert left/right. The property menu branch
   * replaces this with its own add-property flow.
   */
  protected openAddProperty(anchor: HTMLElement, placement?: { propertyId: string; side: 'left' | 'right' }): void {
    this.propertyTypePopover?.close();
    this.propertyTypePopover = new DatabasePropertyTypePopover({
      i18n: this.api.i18n,
      onSelect: (type) => this.addTableProperty(type, placement),
    });
    this.propertyTypePopover.open(anchor);
  }

  private addTableProperty(type: PropertyType, placement?: { propertyId: string; side: 'left' | 'right' }): void {
    const prop = this.model.addProperty(this.api.i18n.t('tools.database.tableNewProperty'), type);

    void this.sync.syncCreateProperty({ id: prop.id, name: prop.name, type: prop.type, position: prop.position });
    this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    const view = this.model.getView(this.activeViewId);

    if (placement === undefined || view === undefined) {
      this.block.dispatchChange();
      this.rerenderView({ keepDrawer: true });

      return;
    }
    const schema = this.model.getSchema();
    const order = resolveViewProperties(view, schema).map((p) => p.id).filter((id) => id !== prop.id);
    const at = order.indexOf(placement.propertyId);
    const beforeId = placement.side === 'left' ? placement.propertyId : order[at + 1] ?? null;

    this.updateActiveView({ properties: withPropertyOrder(view, schema, prop.id, beforeId) });
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
      const options = this.groupOptions(groupByPropId);
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
    const newOption: SelectOption = {
      id: nanoid(),
      label: this.api.i18n.t('tools.database.columnTitlePlaceholder'),
      position: DatabaseModel.positionBetween(lastPos, null),
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

    // GATED ON D7: a sorted view has no manual order to drag into.
    if (isList && (viewConfig?.sorts.length ?? 0) === 0) {
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
        onDelete: (optionId) => this.handleOptionDelete(optionId),
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
        onAddProperty: (type) => {
          const prop = this.model.addProperty('Property', type);
          void this.sync.syncCreateProperty({
            id: prop.id,
            name: prop.name,
            type: prop.type,
            position: prop.position,
          });
          this.cardDrawer?.refreshSchema(
            localizeDatabaseSchema(this.model.getSchema(), this.api.i18n)
          );
        },
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
        const isPillTarget = target.closest('[data-blok-database-column-pill]') !== null;
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

    // GATED ON D7: neighbours arrive in sort order, not key order, so
    // positionBetween would throw. Only the group value may change.
    if (viewConfig !== undefined && viewConfig.sorts.length > 0) {
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

    const beforeOpt = beforeOptionId !== null ? options.find((o) => o.id === beforeOptionId) : undefined;
    const afterOpt = afterOptionId !== null ? options.find((o) => o.id === afterOptionId) : undefined;
    const newPosition = DatabaseModel.positionBetween(afterOpt?.position ?? null, beforeOpt?.position ?? null);

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
      const value = Array.isArray(current) ? current.filter((id) => id !== optionId) : null;

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
      const ids = Array.isArray(current) ? current : [];
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
