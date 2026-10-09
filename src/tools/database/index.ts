import { describeDatabase } from '../../shared/tool-descriptions/database';
import { databaseSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig, SanitizerConfig } from '../../../types';
import type { DatabaseData, DatabaseConfig, DatabasePerson, DatabaseRow, DatabaseRowData, DatabaseRowMeta, PropertyDefinition, PropertySettingsV2, PropertyType, RelationSettings, ViewType, SelectOption, DatabaseViewConfig, PropertyValue } from './types';
import { assignUniqueIds, createDefaultStatusOptions, createDefaultStatusSettings, personIdsOf, statusGroupsOf } from './property-values';
import { planTypeChange } from './property-conversion';
import { openCellEditor } from './cells';
import type { CellContext, CellEditorHandle } from './cells';
import { ComputedProperties } from './computed-properties';
import { openFormulaEditor } from './database-formula-editor';
import type { FormulaEditorHandle } from './database-formula-editor';
import type { DatabaseSource } from './computed-properties';
import { addRelated as addRelatedIds, relationIdsOf, removeRelated as removeRelatedIds } from './relation-values';
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
import { DatabaseGalleryView } from './database-gallery-view';
import type { GalleryGroup } from './database-gallery-view';
import { DatabaseCalendarView } from './database-calendar-view';
import { DatabaseTimelineView, timelineZoomLabelKey } from './database-timeline-view';
import type { TimelineGroup } from './database-timeline-view';
import type { BarWrite } from './timeline-dates';
import { boardLayoutItems, calendarLayoutItems, galleryLayoutItems, timelineLayoutItems } from './database-layout-items';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { pageContentSourceBlocks } from './row-body';
import { resolveLocale, resolveWeekStart, toIsoDay } from './cells/date-format';
import type { TableGroup, TableHandlers, TableState } from './database-table-view';
import type { TableRowDropResult } from './database-table-row-drag';
import { DatabasePropertyTypePopover } from './database-property-type-popover';
import type { ViewChanges } from './database-model';
import {
  TIMELINE_ZOOMS,
  resolveCalendarBy,
  resolveLoadLimit,
  resolveShowTimelineTable,
  resolveTimelineBy,
  resolveTimelineEndBy,
  resolveTimelineZoom,
  resolveViewProperties,
  visibleRowPropertyIds,
  withPropertyOrder,
} from './view-settings';
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
import { DatabaseViewControls } from './database-view-controls';
import type { ViewControlsHost } from './database-view-controls';
import type { ViewGroupEntry } from './database-view-settings-panel';
import { registerGroupToggle } from './database-group-toggle';
import { GROUPABLE_TYPES, groupValueForKey } from './group-keys';
import { resolveRowColors } from './view-data';
import { groupLabel } from './database-group-labels';

interface ChangedBlock {
  id?: unknown;
  name?: unknown;
  parentId?: unknown;
}

/** The block a 'block changed' payload is about, if the payload carries one. */
const changedBlock = (payload: unknown): ChangedBlock | undefined =>
  (payload as { event?: { detail?: { target?: ChangedBlock } } } | undefined)?.event?.detail?.target;

/** A computed value as one line of text, for the formula editor's preview. */
const formatPreview = (value: PropertyValue): string => {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => (typeof item === 'object' && item !== null && 'id' in item ? String(item.id) : String(item))).join(', ');
  }

  return typeof value === 'object' && value !== null ? '' : String(value);
};

/** Events that can end an inline edit or a drag. */
const INTERACTION_END_EVENTS = ['focusout', 'pointerup', 'pointercancel', 'keyup'] as const;

/**
 * Insert-time hint from the toolbox: the layout of the first view. Read once
 * by the constructor and never saved.
 */
const INITIAL_VIEW_KEY = 'initialView';

/** Groups a board shows before "Load more groups" (research/08). */
const BOARD_GROUP_PAGE = 10;

/** Layouts Blok draws; gallery is in the type but falls back to a board. */
const RENDERED_LAYOUTS: readonly ViewType[] = ['table', 'board', 'gallery', 'list', 'timeline', 'calendar'];

/** Select-like groups: their columns are options (or status groups) the user can rename and move. */
const OPTION_GROUP_TYPES: readonly PropertyType[] = ['select', 'multiSelect', 'status'];

const hasGroup = (list: Array<{ id: string }> | undefined, key: string): boolean => (list ?? []).some((group) => group.id === key);

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
  /** Formula, rollup and relation values, worked out on every row sync. */
  private readonly computedValues: ComputedProperties;
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
  private cardDragFromSubGroup: string | null = null;
  private cardCellEditor: CellEditorHandle | null = null;
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
  /** Per gallery view and group: how many cards "Load more" has revealed. Session only. */
  private readonly galleryShown = new Map<string, Map<string, number>>();
  /** Per calendar view: the shown range, for when local storage is blocked. */
  private readonly calendarAnchors = new Map<string, string>();
  /** A day to focus after the calendar redraws into a new range. */
  private calendarFocusDay: string | undefined;
  /** Per timeline view: the centre day, for when local storage is blocked. */
  private readonly timelineCenters = new Map<string, string>();
  private reprojectQueued = false;
  private readonly resolvingRows = new Set<string>();
  private readonly resolveAgainRows = new Set<string>();
  private destroyed = false;
  /** Set while a full redraw waits for an inline edit or drag to end. */
  private redrawWhenIdleRetry: (() => void) | null = null;
  private viewControls: DatabaseViewControls | null = null;
  private unregisterGroupToggle: (() => void) | null = null;
  /** Per board view: how many groups show before "Load more groups". Session only. */
  private readonly groupLimits = new Map<string, number>();

  constructor({ data, config, api, block, readOnly }: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>) {
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
    this.config = config ?? {};

    this.title = (data as DatabaseData | undefined)?.title ?? '';
    this.unknown = unknownKeys(data);
    const initialView = (data as Record<string, unknown> | undefined)?.[INITIAL_VIEW_KEY];

    this.seeded = initialView !== undefined;
    const me = (): string | null => this.config.people?.me?.() ?? null;

    this.model = new DatabaseModel(data, initialView === 'table' ? { defaultViewType: 'table', idSeed: block.id, me } : { me });
    this.computedValues = new ComputedProperties(block.id);
    this.model.setValueProperty((property) => this.computedValues.valueProperty(property));
    const views = this.model.getViews();
    this.activeViewId = (data as DatabaseData | undefined)?.activeViewId ?? (views.length > 0 ? views[0].id : '');

    this.activateView(this.activeViewId);
    this.api.events.on('block changed', this.handleBlockChanged);
  }

  /** Toolbar, filter bar, settings panel and the person's unsaved filters and sorts. Built on first use, after the constructor. */
  private get controls(): DatabaseViewControls {
    if (this.viewControls === null) {
      this.viewControls = new DatabaseViewControls(this.controlsHost());
      this.viewControls.load(this.model.getViews().map((v) => v.id));
    }

    return this.viewControls;
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
    const viewBar = document.createElement('div');

    viewBar.setAttribute('data-blok-database-view-bar', '');
    viewBar.append(this.tabBar.render(), this.controls.toolbar);
    wrapper.append(viewBar, this.controls.filterBar);
    this.syncTitleRowAddBtn();
    this.unregisterGroupToggle ??= registerGroupToggle({
      hasGroups: () => this.activeGroupKeys().length > 0,
      anyExpanded: () => {
        const view = this.model.getView(this.activeViewId);

        return view !== undefined && this.activeGroupKeys().some((key) => !hasGroup(view.collapsedGroups, key));
      },
      setAllCollapsed: (collapsed) => this.setAllGroupsCollapsed(collapsed),
    });

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
    this.controls.refresh();

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
    this.viewControls?.destroy();
    this.unregisterGroupToggle?.();
    this.unregisterGroupToggle = null;
    this.propertyMenu?.destroy();
    this.formulaEditor?.close();
    this.propertyMenu = null;
    this.addPropertyPopover?.destroy();
    this.addPropertyPopover = null;
    this.stopWaitingForIdle();
    this.cardMenuPopover?.destroy();
    this.destroyView();
    this.groupMenuPopover?.destroy();
    this.cardCellEditor?.cancel();
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

    this.model.setRows(this.computedValues.apply(this.model.getSchema(), numbered, {
      databaseId: this.block.id,
      now: new Date(),
      resolveDatabase: (databaseId) => this.readDatabaseSource(databaseId),
    }));
    if (!this.readOnly) {
      this.storeUniqueIds(rows, numbered, children);
    }
  }

  /**
   * Another database block of this document, as relations and rollups read
   * it. Asks the block's tool for its live rows; a block whose tool is not
   * built yet answers from its saved data.
   */
  private readDatabaseSource(databaseId: string): DatabaseSource | undefined {
    const target = this.api.blocks.getById(databaseId);

    if (target === null || target.name !== 'database') return undefined;
    const received: DatabaseSource[] = [];

    target.call('readRelationSource', { receive: (source: DatabaseSource) => received.push(source) });
    if (received[0] !== undefined) return received[0];
    const saved = target.preservedData as Partial<DatabaseData> | undefined;
    const rows = this.api.blocks.getChildren(databaseId)
      .filter((child) => child.name === 'database-row')
      .map((child): DatabaseRow => {
        const live: DatabaseRowData[] = [];

        child.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });
        const data = live[0] ?? child.preservedData as Partial<DatabaseRowData> | undefined;

        return { id: child.id, position: data?.position ?? '', properties: { ...(data?.properties ?? {}) } };
      });

    return { schema: Array.isArray(saved?.schema) ? saved.schema : [], rows };
  }

  /** Read by another database of this document: this database's schema and computed rows. */
  readRelationSource(param: { receive: (source: DatabaseSource) => void }): void {
    param.receive({
      schema: this.model.getSchema(),
      rows: this.model.getOrderedRows(),
      valueProperty: (property) => this.computedValues.valueProperty(property),
    });
  }

  /** Opens one of this database's rows: a relation chip in another database asks for it. */
  openRow(param: { rowId: string }): void {
    if (this.model.getRow(param.rowId) !== undefined) {
      this.handleRowClick(param.rowId);
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
    const target = changedBlock(payload);

    if (this.reprojectQueued || !(this.isOwnRowChange(target) || this.isRelatedChange(target))) {
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

  /**
   * A row or the schema of a database this one relates to: its titles and
   * values feed this database's relation chips and rollups.
   */
  private isRelatedChange(target: ChangedBlock | undefined): boolean {
    const related = this.model.getSchema()
      .flatMap((property) => (property.type === 'relation' && property.relation?.targetDocumentId === undefined ? [property.relation?.targetDatabaseId] : []))
      .filter((id): id is string => id !== undefined && id !== this.block.id);

    if (related.length === 0 || target === undefined) return false;
    if (target.name === 'database') return typeof target.id === 'string' && related.includes(target.id);

    return target.name === 'database-row' && typeof target.parentId === 'string' && related.includes(target.parentId);
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

    // A self-relation chip or a formula can show a row's title: a rename redraws them.
    const titleShownElsewhere = this.model.getSchema().some((property) => property.type === 'formula'
      || (property.type === 'relation' && property.relation?.targetDatabaseId === this.block.id));

    if (retitled === null || (retitled.length > 0 && (titleShownElsewhere || this.activeViewQueries(this.titlePropertyId())))) {
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
    const saved = this.model.getView(this.activeViewId);
    const view = saved === undefined ? undefined : this.controls.effective(saved);

    return view !== undefined && (
      [...view.sorts, ...view.filters].some((rule) => rule.propertyId === propertyId) ||
      JSON.stringify(view.filterTree ?? {}).includes(`"propertyId":${JSON.stringify(propertyId)}`) ||
      (view.colorRules ?? []).some((rule) => rule.propertyId === propertyId) ||
      view.groupBy === propertyId ||
      this.controls.search !== ''
    );
  }

  /** True while an inline rename in the board or a drag is in progress. */
  private isInteracting(): boolean {
    const focused = document.activeElement;

    if (focused instanceof HTMLInputElement && this.boardContainer?.contains(focused) === true) {
      return true;
    }

    if (this.view?.interacting === true) {
      return true;
    }

    return this.cardDrag?.active === true || this.columnDrag?.active === true || this.listRowDrag?.active === true;
  }

  /** Detach the view's listeners before its DOM goes, so its focus, editor or drag do not fire into the next one. */
  private destroyView(): void {
    this.view?.destroy?.();
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
    const remove = (): void => {
      this.unlinkDeletedRow(rowId);
      const blockIndex = this.api.blocks.getBlockIndex(rowId);

      if (blockIndex !== undefined) {
        void this.api.blocks.delete(blockIndex);
      }
    };
    const linked = this.model.getSchema().some((property) => property.type === 'relation');

    if (linked && this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(remove);
    } else {
      remove();
    }

    this.syncRowsFromBlocks();
  }

  private updateRowBlock(rowId: string, propertyChanges: Record<string, PropertyValue>): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rowBlock = children.find((child) => child.id === rowId);
    // Formula and rollup values are computed: a write to one (a drop into a
    // formula group, a paste) would shadow the result with stale data.
    const stored = Object.fromEntries(Object.entries(propertyChanges).filter(([propertyId]) => {
      const type = this.model.getProperty(propertyId)?.type;

      return type !== 'formula' && type !== 'rollup';
    }));

    if (rowBlock !== undefined && Object.keys(stored).length > 0) {
      rowBlock.call('updateProperties', stored);
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
    this.destroyView();

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
    this.controls.refresh();
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
    if (this.model.isDatabaseLocked()) return;
    const statusProp = this.model.getSchema().find((p) => p.type === 'select');
    const defaultNames: Partial<Record<ViewType, string>> = {
      list: DATABASE_DEFAULT_TEXT.viewTypeList,
      table: DATABASE_DEFAULT_TEXT.viewTypeTable,
      gallery: DATABASE_DEFAULT_TEXT.viewTypeGallery,
      calendar: DATABASE_DEFAULT_TEXT.viewTypeCalendar,
      timeline: DATABASE_DEFAULT_TEXT.viewTypeTimeline,
    };
    const newView = this.model.addView(defaultNames[type] ?? DATABASE_DEFAULT_TEXT.viewTypeBoard, type, {
      groupBy: type === 'board' ? statusProp?.id : undefined,
    });
    void this.sync.syncCreateView(structuredClone(newView));
    this.switchView(newView.id);
  }

  renameView(viewId: string, name: string): void {
    if (this.model.isDatabaseLocked()) return;
    this.model.updateView(viewId, { name });
    void this.sync.syncUpdateView({ viewId, changes: { name } });
  }

  duplicateView(viewId: string): void {
    if (this.model.isDatabaseLocked()) return;
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

    if (views.length <= 1 || this.model.isDatabaseLocked()) {
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
    if (this.model.isDatabaseLocked()) return;
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

    if (views.length === 1 && !this.readOnly && !this.model.isDatabaseLocked() && addBtn !== null) {
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

      if (!this.readOnly && !this.model.isDatabaseLocked() && addBtn !== null && tabBarEl !== null && !tabBarEl.contains(addBtn)) {
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
      onEditView: (viewId, anchor) => this.editView(viewId, anchor),
      api: this.api,
      // A locked database keeps its views: no add, rename, delete or reorder.
      readOnly: this.readOnly || this.model.isDatabaseLocked(),
    });
  }

  // ---------------------------------------------------------------------------
  // Board rendering helpers
  // ---------------------------------------------------------------------------

  private renderActiveView(): HTMLDivElement {
    const saved = this.model.getView(this.activeViewId);
    const viewConfig = saved === undefined ? undefined : this.controls.effective(saved);
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const groupByPropId = viewConfig?.groupBy;
    const viewEl = ((): HTMLDivElement => {
      if (viewConfig?.type === 'list') {
        return this.renderListView(titlePropId, groupByPropId, viewConfig);
      }
      if (viewConfig?.type === 'table') {
        return this.renderTableView(titlePropId, viewConfig);
      }
      if (viewConfig?.type === 'gallery') {
        return this.renderGalleryView(titlePropId, viewConfig);
      }
      if (viewConfig?.type === 'calendar') {
        return this.renderCalendarView(titlePropId, viewConfig);
      }
      if (viewConfig?.type === 'timeline') {
        return this.renderTimelineView(titlePropId, viewConfig);
      }

      // Unknown types (a newer client's layout) fall back to a board.
      return this.renderBoardView(titlePropId, groupByPropId, viewConfig);
    })();

    if (viewConfig !== undefined) {
      this.paintRowColors(viewEl, viewConfig);
    }

    return viewEl;
  }

  /** Conditional color: a data attribute on each matching row, card or (table) cell. */
  private paintRowColors(viewEl: HTMLElement, view: DatabaseViewConfig): void {
    const colors = resolveRowColors(this.model.getOrderedRows(), view, this.model.getValueSchema());
    const rowSelector = ':is([data-blok-database-table-row], [data-blok-database-card], [data-blok-database-list-row])';
    const paint = (rowEl: HTMLElement, color: { row?: string; cells: Record<string, string> }): void => {
      if (color.row !== undefined) rowEl.setAttribute('data-blok-database-color', color.row);
      for (const [propertyId, cellColor] of Object.entries(color.cells)) {
        rowEl.querySelector(`[data-property-id="${CSS.escape(propertyId)}"]`)?.setAttribute('data-blok-database-color', cellColor);
      }
    };

    for (const [rowId, color] of colors) {
      viewEl.querySelectorAll<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]${rowSelector}`).forEach((rowEl) => paint(rowEl, color));
    }
  }

  private isOptionGroup(propertyId: string | undefined): boolean {
    const type = propertyId === undefined ? undefined : this.model.getProperty(propertyId)?.type;

    return type !== undefined && OPTION_GROUP_TYPES.includes(type);
  }

  private renderGalleryView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const groupBy = viewConfig.groupBy;
    const grouped = groupBy !== undefined && this.model.getProperty(groupBy) !== undefined;
    const optionGroup = this.isOptionGroup(groupBy);
    const limit = resolveLoadLimit(viewConfig);
    const shown = this.galleryShown.get(viewConfig.id) ?? new Map<string, number>();
    const query = this.pagedQuery(viewConfig, shown, limit);
    const groups: GalleryGroup[] = grouped
      ? this.shownGroupOptions(groupBy, viewConfig).map((option) => ({
        key: option.id,
        label: option.label,
        ...(optionGroup && option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
        ...query(option.id, option.id),
      }))
      : [{ key: '', label: '', ...query('') }];
    const descriptionId = this.model.getSchema().find((p) => p.type === 'richText')?.id;

    this.view = new DatabaseGalleryView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      view: viewConfig,
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      groups,
      grouped,
      titlePropertyId: titlePropId,
      bodyOf: (rowId) => this.rowBodyBlocks(rowId, descriptionId),
      cellContext: this.cellContext(),
      handlers: {
        openRow: (rowId) => this.handleRowClick(rowId),
        addRow: (groupKey) => {
          this.addTableRow(groupKey);
        },
        moveRow: (result) => this.handleTableRowDrop(result),
        loadMore: (groupKey) => {
          shown.set(groupKey, (shown.get(groupKey) ?? limit) + limit);
          this.galleryShown.set(viewConfig.id, shown);
          this.rerenderView({ keepDrawer: true });
        },
      },
    });

    return this.view.createView();
  }

  /** One group's rows cut to what "Load more" has revealed, and the group's total. */
  private pagedQuery(viewConfig: DatabaseViewConfig, shown: Map<string, number>, limit: number) {
    return (key: string, group?: string): Pick<GalleryGroup, 'rows' | 'total'> => {
      const result = this.model.queryRows({ view: viewConfig, ...(group !== undefined ? { group } : {}), limit: shown.get(key) ?? limit });

      return { rows: result.rows, total: result.total ?? result.rows.length };
    };
  }

  /** A row page's body: its child blocks, else the legacy body column. A host `rowPages` body is not readable here. */
  private rowBodyBlocks(rowId: string, descriptionId: string | undefined): Array<{ type: string; data: unknown }> {
    const children = this.api.blocks.getChildren(rowId).filter((child) => child.name !== 'database-row');

    if (children.length > 0) {
      return children.map((child) => ({ type: child.name, data: child.preservedData }));
    }

    const row = this.model.getRow(rowId);

    return row === undefined ? [] : pageContentSourceBlocks(row, this.model.getSchema(), descriptionId);
  }

  /** The active view's own layout rows (board, gallery, timeline, calendar), for the view settings panel. */
  layoutItems(): PopoverItemParams[] {
    const view = this.model.getView(this.activeViewId);
    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);
    const update = (changes: ViewChanges): void => this.updateActiveView(changes);

    if (view?.type === 'gallery') {
      return galleryLayoutItems(view, schema, this.api.i18n, update);
    }

    if (view?.type === 'timeline') {
      return timelineLayoutItems(view, schema, this.api.i18n, update);
    }

    if (view?.type === 'board') {
      return boardLayoutItems(view, schema, this.api.i18n, update);
    }

    return view?.type === 'calendar' ? calendarLayoutItems(view, schema, this.api.i18n, update) : [];
  }

  private calendarStorageKey(viewId: string): string {
    return `blok:database-calendar:${this.block.id}:${viewId}`;
  }

  /** The person's last shown range. Local only: Notion keeps it per user (H-calendars). */
  private calendarAnchor(viewId: string, today: string): string {
    try {
      const stored = window.localStorage.getItem(this.calendarStorageKey(viewId));

      if (stored !== null && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
        return stored;
      }
    } catch {
      // Blocked storage: fall back to this session's value.
    }

    return this.calendarAnchors.get(viewId) ?? today;
  }

  private setCalendarAnchor(viewId: string, anchor: string): void {
    this.calendarAnchors.set(viewId, anchor);
    try {
      window.localStorage.setItem(this.calendarStorageKey(viewId), anchor);
    } catch {
      // Blocked storage: the session map still holds it.
    }
  }

  private renderCalendarView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const schema = this.model.getSchema();
    const dateId = resolveCalendarBy(viewConfig, schema);
    const locale = resolveLocale(undefined);
    const today = toIsoDay(new Date());
    const configured = this.config.weekStart;
    const weekStart = typeof configured === 'number' && Number.isInteger(configured) && configured >= 0 && configured <= 6
      ? configured
      : resolveWeekStart(locale);
    const focusDay = this.calendarFocusDay;

    this.calendarFocusDay = undefined;
    this.view = new DatabaseCalendarView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      view: viewConfig,
      schema: localizeDatabaseSchema(schema, this.api.i18n),
      rows: this.model.queryRows({ view: viewConfig }).rows,
      titlePropertyId: titlePropId,
      datePropertyId: dateId,
      anchor: this.calendarAnchor(viewConfig.id, today),
      today,
      weekStart,
      locale,
      cellContext: this.cellContext(),
      ...(focusDay !== undefined ? { focusDay } : {}),
      handlers: {
        openRow: (rowId) => this.handleRowClick(rowId),
        addRow: (day) => {
          if (dateId !== undefined) {
            this.addCalendarRow(dateId, day);
          }
        },
        setDate: (rowId, value) => {
          if (dateId !== undefined) {
            this.commitTableCell(rowId, dateId, value);
            this.rerenderView({ keepDrawer: true });
          }
        },
        navigate: (anchor, focus) => {
          this.setCalendarAnchor(viewConfig.id, anchor);
          this.calendarFocusDay = focus;
          this.rerenderView({ keepDrawer: true });
        },
      },
    });

    return this.view.createView();
  }

  private timelineStorageKey(viewId: string): string {
    return `blok:database-timeline:${this.block.id}:${viewId}`;
  }

  /** The person's last centre day. Local only, like the calendar range: a shared field would sync every pan. */
  private timelineCenter(viewId: string, today: string): string {
    try {
      const stored = window.localStorage.getItem(this.timelineStorageKey(viewId));

      if (stored !== null && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
        return stored;
      }
    } catch {
      // Blocked storage: fall back to this session's value.
    }

    return this.timelineCenters.get(viewId) ?? today;
  }

  private setTimelineCenter(viewId: string, day: string): void {
    this.timelineCenters.set(viewId, day);
    try {
      window.localStorage.setItem(this.timelineStorageKey(viewId), day);
    } catch {
      // Blocked storage: the session map still holds it.
    }
  }

  private renderTimelineView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const schema = this.model.getSchema();
    const startId = resolveTimelineBy(viewConfig, schema);
    const endId = resolveTimelineEndBy(viewConfig, schema);
    const today = toIsoDay(new Date());
    const groupBy = viewConfig.groupBy;
    const grouped = groupBy !== undefined && this.model.getProperty(groupBy) !== undefined;
    const optionGroup = this.isOptionGroup(groupBy);
    const limit = resolveLoadLimit(viewConfig);
    const shown = this.galleryShown.get(viewConfig.id) ?? new Map<string, number>();
    const query = this.pagedQuery(viewConfig, shown, limit);
    const groups: TimelineGroup[] = grouped
      ? this.shownGroupOptions(groupBy, viewConfig).map((option) => ({
        key: option.id,
        label: option.label,
        ...(optionGroup && option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
        ...query(option.id, option.id),
      }))
      : [{ key: '', label: '', ...query('') }];

    this.view = new DatabaseTimelineView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      view: viewConfig,
      schema: localizeDatabaseSchema(schema, this.api.i18n),
      groups,
      grouped,
      titlePropertyId: titlePropId,
      startPropertyId: startId,
      endPropertyId: endId,
      center: this.timelineCenter(viewConfig.id, today),
      today,
      locale: resolveLocale(undefined),
      handlers: {
        openRow: (rowId) => this.handleRowClick(rowId),
        addRow: (groupKey) => this.addTimelineRow(groupKey, startId, today),
        writeDates: (rowId, write) => this.writeTimelineDates(rowId, write, startId, endId),
        moveRow: (result) => this.handleTableRowDrop(result),
        setZoom: (zoom) => this.updateActiveView({ timelineZoom: zoom }),
        openZoomMenu: (anchor) => this.openTimelineZoomMenu(anchor, viewConfig),
        navigate: (day) => {
          this.setTimelineCenter(viewConfig.id, day);
          this.rerenderView({ keepDrawer: true });
        },
        toggleTable: () => this.updateActiveView({ showTimelineTable: !resolveShowTimelineTable(viewConfig) }),
        loadMore: (groupKey) => {
          shown.set(groupKey, (shown.get(groupKey) ?? limit) + limit);
          this.galleryShown.set(viewConfig.id, shown);
          this.rerenderView({ keepDrawer: true });
        },
      },
    });

    return this.view.createView();
  }

  /** "+ New": a row dated today, so its bar shows, plus what the view's filters and group ask for. */
  private addTimelineRow(groupKey: string | null, startId: string | undefined, today: string): void {
    if (this.readOnly) return;
    const titlePropId = this.titlePropertyId();
    const groupBy = groupKey === null ? undefined : this.model.getView(this.activeViewId)?.groupBy;
    const properties = this.newRowProperties(titlePropId, groupBy, groupKey ?? NO_VALUE_GROUP_KEY);
    const rowData = this.model.createRowData(startId === undefined ? properties : { ...properties, [startId]: today });

    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position: rowData.position, title: '' },
      { parentId: this.block.id, position: 'end', id: rowData.id },
    );
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    this.rerenderView({ keepDrawer: true });
  }

  /** A moved bar may change both of its properties: one row write, one sync, one undo step. */
  private writeTimelineDates(rowId: string, write: BarWrite, startId: string | undefined, endId: string | undefined): void {
    if (this.readOnly || this.destroyed || startId === undefined) return;
    const changes: Record<string, PropertyValue> = {
      ...(write.start !== undefined ? { [startId]: write.start } : {}),
      ...(write.end !== undefined && endId !== undefined ? { [endId]: write.end } : {}),
    };

    if (Object.keys(changes).length === 0) return;
    this.updateRowBlock(rowId, changes);
    this.sync.syncUpdateRow({ rowId, properties: changes });
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.model.getRow(rowId));
    }
    this.rerenderView({ keepDrawer: true });
  }

  private openTimelineZoomMenu(anchor: HTMLElement, viewConfig: DatabaseViewConfig): void {
    const current = resolveTimelineZoom(viewConfig);

    this.showGroupPopover(anchor, TIMELINE_ZOOMS.map((zoom) => ({
      type: PopoverItemType.Default,
      title: this.api.i18n.t(timelineZoomLabelKey(zoom)),
      isActive: zoom === current,
      onActivate: () => this.updateActiveView({ timelineZoom: zoom }),
    })));
  }

  /** "+" on a day: a new row dated that day, plus what the view's filters ask for. */
  private addCalendarRow(dateId: string, day: string): void {
    if (this.readOnly) return;
    const titlePropId = this.titlePropertyId();
    const rowData = this.model.createRowData({ ...this.newRowProperties(titlePropId, undefined, NO_VALUE_GROUP_KEY), [dateId]: day });

    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position: rowData.position, title: '' },
      { parentId: this.block.id, position: 'end', id: rowData.id },
    );
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    this.rerenderView({ keepDrawer: true });
  }

  /**
   * The view's groups in display order. Select-like groups are the options
   * (or status groups) in board order, with the no-value group at the view's
   * stored place, or last; a group sort or "Hide empty groups" reorders or
   * drops them. Other types list the groups their rows fall in (group-keys.ts).
   */
  private groupOptions(groupByPropId: string, view: DatabaseViewConfig | undefined): SelectOption[] {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === groupByPropId);
    const noValue: SelectOption = {
      id: NO_VALUE_GROUP_KEY,
      label: this.api.i18n.t('tools.database.noValueGroup', { property: property?.name ?? '' }),
      position: '',
    };

    if (property !== undefined && view !== undefined && !OPTION_GROUP_TYPES.includes(property.type)) {
      // A formula or rollup groups, and so labels, as its result type; a relation group is a related row.
      const shown = this.computedValues.valueProperty(property);
      const label = (key: string): string => {
        if (key === NO_VALUE_GROUP_KEY) return noValue.label;
        if (shown.type !== 'relation') return groupLabel(shown, key, this.api.i18n, view.groupSettings);
        const title = this.relatedTitle(shown, key);

        return title === undefined || title === '' ? this.api.i18n.t('tools.database.relationUntitled') : title;
      };

      return this.model.listGroups({ ...view, groupBy: groupByPropId }, { search: this.controls.search }).map((group, index) => ({
        id: group.key,
        label: label(group.key),
        position: String(index),
      }));
    }
    const statusBy = view?.groupByStatus;
    const listed = statusBy === 'group' && property?.type === 'status'
      ? statusGroupsOf(property).map((g) => ({ id: g.id, label: g.name, color: g.color, position: g.position }))
      : localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId, { statusBy }), this.api.i18n);
    const sort = view?.groupSettings?.sort ?? 'manual';
    const options = sort === 'manual'
      ? listed
      : [...listed].sort((x, y) => x.label.localeCompare(y.label) * (sort === 'descending' ? -1 : 1));
    const stored = view?.noValueGroupPosition;
    const index = stored === undefined || sort !== 'manual' ? -1 : options.findIndex((option) => option.position > stored);
    const all = index === -1
      ? [...options, noValue]
      : [...options.slice(0, index), noValue, ...options.slice(index)];

    if (view?.groupSettings?.hideEmptyGroups !== true) return all;
    const counts = new Map(this.model.queryGroups({ ...view, groupBy: groupByPropId }, { search: this.controls.search }).map((g) => [g.key, g.count]));

    return all.filter((option) => (counts.get(option.id) ?? 0) > 0);
  }

  /** Groups the view shows: hidden ones dropped. */
  private shownGroupOptions(groupByPropId: string, view: DatabaseViewConfig | undefined): SelectOption[] {
    return this.groupOptions(groupByPropId, view).filter((option) => !hasGroup(view?.hiddenGroups, option.id));
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
    return new Map(optionIds.map((id) => [id, this.model.queryRows({ view: viewConfig, group: id, search: this.controls.search }).rows]));
  }

  /** Group keys the active view draws; empty when it is not grouped. */
  private activeGroupKeys(): string[] {
    const saved = this.model.getView(this.activeViewId);

    if (saved?.groupBy === undefined) return [];

    return this.shownGroupOptions(saved.groupBy, this.controls.effective(saved)).map((o) => o.id);
  }

  /** Cmd/Ctrl+Alt+T: collapse or open every group of the active view, and keep it in the view. */
  private setAllGroupsCollapsed(collapsed: boolean): void {
    const view = this.model.getView(this.activeViewId);

    if (view === undefined || this.readOnly) return;
    const keys = this.activeGroupKeys();
    const others = (view.collapsedGroups ?? []).filter((group) => !keys.includes(group.id));
    const collapsedGroups = collapsed ? [...others, ...keys.map((id) => ({ id }))] : others;

    this.model.updateView(view.id, { collapsedGroups });
    this.block.dispatchChange();
    void this.sync.syncUpdateView({ viewId: view.id, changes: { collapsedGroups } });
    this.rerenderView({ keepDrawer: true });
  }

  /** What the toolbar, filter bar and settings panel ask of the tool. */
  private controlsHost(): ViewControlsHost {
    return {
      i18n: this.api.i18n,
      ...(this.config.viewState !== undefined ? { store: this.config.viewState } : {}),
      fallback: {
        get: (key) => this.api.viewState.get(this.block.id, key),
        set: (key, value) => this.api.viewState.set(this.block.id, key, value),
      },
      savedView: () => this.model.getView(this.activeViewId),
      // Filters and sorts read a formula or rollup as its result type.
      schema: () => localizeDatabaseSchema(this.model.getValueSchema(), this.api.i18n),
      rowCount: () => this.model.getOrderedRows().length,
      locked: () => this.model.isDatabaseLocked(),
      readOnly: () => this.readOnly,
      viewCount: () => this.model.getViews().length,
      layouts: RENDERED_LAYOUTS,
      me: () => this.config.people?.me?.() ?? null,
      people: () => this.people ?? [],
      relatedRows: (property) => this.relationCandidates(property),
      updateView: (changes) => this.updateActiveView(changes),
      setLayout: (type) => this.setActiveLayout(type),
      setLocked: (locked) => this.setDatabaseLocked(locked),
      duplicateView: () => this.duplicateView(this.activeViewId),
      deleteView: () => this.deleteView(this.activeViewId),
      copyViewLink: () => this.copyViewLink(),
      groups: (sub) => this.groupEntries(sub),
      rerender: () => this.rerenderView({ keepDrawer: true }),
      layoutItems: () => this.layoutItems(),
    };
  }

  private groupEntries(sub: boolean): ViewGroupEntry[] {
    const saved = this.model.getView(this.activeViewId);

    if (saved === undefined) return [];
    const view = this.controls.effective(saved);
    const groupBy = sub ? view.subGroupBy : view.groupBy;

    if (groupBy === undefined) return [];
    const grouped = sub ? { ...view, groupBy, groupSettings: view.subGroupSettings } : view;
    const counts = new Map(this.model.queryGroups(grouped, { search: this.controls.search }).map((g) => [g.key, g.count]));

    return this.groupOptions(groupBy, grouped).map((option) => ({ key: option.id, label: option.label, count: counts.get(option.id) ?? 0 }));
  }

  /** A board needs a grouping: the first select-like property, else the first property it can group by. */
  private setActiveLayout(type: ViewType): void {
    const view = this.model.getView(this.activeViewId);

    if (view === undefined || view.type === type) return;
    const schema = this.model.getSchema();
    const groupable = (p: PropertyDefinition): boolean => p.type !== 'title' && GROUPABLE_TYPES.includes(p.type);
    const groupBy = type === 'board' && view.groupBy === undefined
      ? (schema.find((p) => OPTION_GROUP_TYPES.includes(p.type)) ?? schema.find(groupable))?.id
      : undefined;

    if (type === 'board' && view.groupBy === undefined && groupBy === undefined) return;
    // Born empty with the switch: two peers adding the first column would race to create the key.
    const tableProperties = type === 'timeline' && !Array.isArray(view.tableProperties) ? { tableProperties: [] } : {};

    this.updateActiveView({ type, ...(groupBy !== undefined ? { groupBy } : {}), ...tableProperties });
    this.rebuildTabBar();
  }

  /** "Edit view" on a tab: show that view, then its settings under the tab. */
  private editView(viewId: string, anchor: HTMLElement): void {
    this.switchView(viewId);
    const tab = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(viewId)}"]`);

    this.controls.openSettings(tab?.isConnected === true ? tab : anchor, 'root');
  }

  private setDatabaseLocked(locked: boolean): void {
    if (this.readOnly || this.model.isDatabaseLocked() === locked) return;
    this.model.setDatabaseLocked(locked);
    this.block.dispatchChange();
    this.rebuildTabBar();
    this.rerenderView({ keepDrawer: true });
  }

  /** Views have no addressable URL yet: the page URL with the view id as its fragment. */
  private copyViewLink(): void {
    const url = `${window.location.href.split('#')[0]}#view-${this.activeViewId}`;

    void navigator.clipboard?.writeText(url).then(
      () => this.api.notifier.show({ message: this.api.i18n.t('tools.database.viewLinkCopied') }),
      () => undefined
    );
  }

  private renderBoardView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig | undefined): HTMLDivElement {
    const allOptions = groupByPropId !== undefined ? this.groupOptions(groupByPropId, viewConfig) : [];
    const hidden = new Set((viewConfig?.hiddenGroups ?? []).map((group) => group.id));
    const shown = allOptions.filter((option) => !hidden.has(option.id));
    const options = shown.slice(0, this.groupLimits.get(this.activeViewId) ?? BOARD_GROUP_PAGE);
    const groups = viewConfig !== undefined && groupByPropId !== undefined
      ? this.queryGroupRows(viewConfig, options.map((o) => o.id))
      : new Map<string, DatabaseRow[]>();
    const lanes = viewConfig === undefined ? null : this.boardLanes(viewConfig);
    const descriptionId = this.model.getSchema().find((p) => p.type === 'richText')?.id;

    this.view = new DatabaseBoardView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      options,
      getRows: (optionId, subKey) => {
        const rows = groups.get(optionId) ?? [];

        return subKey === undefined || lanes === null ? rows : rows.filter((row) => lanes.keysOf(row).includes(subKey));
      },
      titlePropertyId: titlePropId,
      hideCounts: viewConfig?.hideGroupAggregation === true,
      hiddenGroupCount: allOptions.length - shown.length,
      ...(viewConfig !== undefined ? { view: viewConfig } : {}),
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      bodyOf: (rowId) => this.rowBodyBlocks(rowId, descriptionId),
      locale: resolveLocale(undefined),
      onPropertyEdit: (rowId, propertyId, anchor) => this.editCardProperty(rowId, propertyId, anchor),
      ...(lanes !== null ? { subGroups: lanes.lanes } : {}),
      onTitleEdit: (rowId, newTitle) => {
        const titlePropId = this.titlePropertyId();
        this.updateRowTitleBlock(rowId, titlePropId, newTitle);
        this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: newTitle } });
      },
    });

    const boardEl = this.view.createView();

    // "Color columns" off: columns lose their tint, pills keep their color.
    if (viewConfig?.groupSettings?.colorColumns === false) {
      boardEl.querySelectorAll<HTMLElement>('[data-blok-database-column][data-color], [data-blok-database-board-column-head][data-color]').forEach((column) => {
        column.style.removeProperty('background-color');
        column.removeAttribute('data-color');
      });
    }
    if (shown.length > options.length) {
      (boardEl.querySelector('[data-blok-database-board-heads]') ?? boardEl.querySelector('[data-blok-database-board]'))?.appendChild(this.loadMoreGroupsButton());
    }

    return boardEl;
  }

  /** Notion shows "Load more groups" past ten groups (research/08). */
  private loadMoreGroupsButton(): HTMLElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('data-blok-database-load-more-groups', '');
    button.setAttribute('data-blok-testid', 'database-load-more-groups');
    button.textContent = this.api.i18n.t('tools.database.loadMoreGroups');
    button.addEventListener('click', () => {
      this.groupLimits.set(this.activeViewId, (this.groupLimits.get(this.activeViewId) ?? BOARD_GROUP_PAGE) + BOARD_GROUP_PAGE);
      this.rerenderView({ keepDrawer: true });
    });

    return button;
  }

  /** Board sub-groups (Phase 3 `subGroupBy`): the lanes in order and each row's lane keys. */
  private boardLanes(view: DatabaseViewConfig): { lanes: Array<{ key: string; label: string; option?: SelectOption }>; keysOf: (row: DatabaseRow) => string[] } | null {
    const subGroupBy = view.subGroupBy;

    if (subGroupBy === undefined || subGroupBy === view.groupBy || this.model.getProperty(subGroupBy) === undefined) {
      return null;
    }

    const subView = { ...view, groupBy: subGroupBy, groupSettings: view.subGroupSettings };
    const optionGroup = this.isOptionGroup(subGroupBy);

    return {
      lanes: this.groupOptions(subGroupBy, subView).map((option) => ({
        key: option.id,
        label: option.label,
        ...(optionGroup && option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
      })),
      keysOf: this.model.groupKeysOf(subGroupBy, { settings: view.subGroupSettings ?? {} }),
    };
  }

  /** Inline edit of a board card property (Notion 2022-08-25): the cell editor, no page. */
  private editCardProperty(rowId: string, propertyId: string, anchor: HTMLElement): void {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId);
    const row = this.model.getRow(rowId);

    if (this.readOnly || property === undefined || row === undefined) return;
    this.cardCellEditor?.close();

    const handle = openCellEditor(property, row.properties[propertyId], anchor, {
      ...this.cellContext(),
      i18n: this.api.i18n,
      readOnly: false,
      options: this.model.getProperty(propertyId)?.config?.options ?? [],
      onOptionsChange: (options) => this.handleTableOptionsChange(propertyId, options),
      onCommit: (value) => this.commitTableCell(rowId, propertyId, value),
      onClose: () => {
        this.cardCellEditor = null;
        this.rerenderView({ keepDrawer: true });
      },
    });

    this.cardCellEditor = handle.isOpen ? handle : null;
  }

  private renderTableView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const groupBy = viewConfig.groupBy;
    const groups = groupBy !== undefined && this.model.getProperty(groupBy) !== undefined
      ? this.tableGroups(groupBy, viewConfig)
      : undefined;
    const state = this.tableState(viewConfig.id);

    // Collapse is saved in the view, so peers and reloads see it.
    state.collapsed.clear();
    for (const group of groups ?? []) {
      if (hasGroup(viewConfig.collapsedGroups, group.key)) state.collapsed.add(group.key);
    }

    this.view = new DatabaseTableView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      view: viewConfig,
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      rows: groups === undefined ? this.model.queryRows({ view: viewConfig, search: this.controls.search }).rows : [],
      ...(groups !== undefined ? { groups } : {}),
      titlePropertyId: titlePropId,
      state,
      cellContext: this.cellContext(),
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
    const ordered = this.shownGroupOptions(groupBy, viewConfig);
    const rows = this.queryGroupRows(viewConfig, ordered.map((o) => o.id));
    const optionGroup = this.isOptionGroup(groupBy);

    return ordered.map((option) => ({
      key: option.id,
      label: option.label,
      ...(optionGroup && option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
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
      editFilters: (anchor) => this.controls.openSettings(anchor, 'filter'),
      groupToggled: (key, collapsed) => this.saveGroupCollapse(this.activeViewId, key, collapsed),
      rerender: () => this.rerenderView({ keepDrawer: true }),
      // Locked: no option edits, so the select editor offers no "Create" (research/05 §12).
      ...(this.model.isDatabaseLocked() ? {} : { optionsChange: (propertyId: string, options: SelectOption[]) => this.handleTableOptionsChange(propertyId, options) }),
    };
  }

  /** Filter, Sort and Group from a column header. Filter and sort are personal edits (D4). */
  protected onTableViewAction(action: 'filter' | 'sort' | 'group', propertyId: string, anchor: HTMLElement): void {
    if (action === 'filter') {
      this.controls.filterBy(propertyId, anchor);
    } else if (action === 'sort') {
      this.controls.sortBy(propertyId, anchor);
    } else if (!this.model.isDatabaseLocked()) {
      this.controls.groupBy(propertyId, anchor);
    }
  }

  /**
   * A row dropped in a sorted table. Notion asks "Would you like to remove
   * sorting?" (D7); that prompt lives outside the table. Nothing moves.
   */
  protected onSortedRowDrop(_result: TableRowDropResult): void {
    // Hook only.
  }

  /**
   * While locked, option edits are refused, so drop any option id the schema
   * does not hold: the drawer's editor was built before the lock and may
   * still create one.
   */
  private knownOptionsOnly(propertyId: string, value: PropertyValue): PropertyValue {
    const property = this.model.getProperty(propertyId);

    if (!this.model.isDatabaseLocked() || property === undefined || !this.isOptionGroup(propertyId)) return value;
    const known = new Set((property.config?.options ?? []).map((o) => o.id));

    if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string' && known.has(id));

    return typeof value === 'string' && !known.has(value) ? null : value;
  }

  private commitTableCell(rowId: string, propertyId: string, input: PropertyValue): void {
    if (this.readOnly || this.destroyed) return;
    if (this.model.getProperty(propertyId)?.type === 'relation') {
      this.commitRelation(rowId, propertyId, input);

      return;
    }
    const value = this.knownOptionsOnly(propertyId, input);

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
    if (this.readOnly || this.model.isDatabaseLocked()) return;
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
    if (this.readOnly || this.destroyed || this.model.isDatabaseLocked()) return;
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
    // List badges draw a formula or rollup as its result type.
    const schema = localizeDatabaseSchema(this.model.getValueSchema(), this.api.i18n);

    if (groupByPropId !== undefined) {
      const options = this.shownGroupOptions(groupByPropId, viewConfig);
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
        rows: this.model.queryRows({ view: viewConfig, search: this.controls.search }).rows,
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
          this.handleAddRow(optionId, boardEl, addCardBtn.closest('[data-blok-database-column]')?.getAttribute('data-sub-group') ?? undefined);
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
      animateClose: true,
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

  /** `owner` keeps `data-popover-open` while the menu is up, so its hover-only buttons stay shown. */
  private showGroupPopover(anchor: HTMLElement, items: ReturnType<typeof groupMenuItems>, owner?: HTMLElement): void {
    this.groupMenuPopover?.destroy();

    const popover = new PopoverDesktop({ class: DATABASE_MENU_CLASS, animateClose: true, trigger: anchor, width: 'auto', minWidth: '220px', autoFocusFirstItem: false, items });

    owner?.setAttribute('data-popover-open', '');
    popover.on(PopoverEvent.Closed, () => {
      owner?.removeAttribute('data-popover-open');
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
    }), anchor.closest<HTMLElement>('[data-blok-database-column-header]') ?? undefined);
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
  private newRowProperties(titlePropId: string, groupByPropId: string | undefined, optionId: string, subGroupBy?: string): Record<string, PropertyValue> {
    const saved = this.model.getView(this.activeViewId);
    const filters = (saved === undefined ? [] : this.controls.effective(saved).filters)
      .filter((f) => f.propertyId !== groupByPropId && f.propertyId !== subGroupBy);
    const properties: Record<string, PropertyValue> = { ...newRowValues(filters, this.model.getSchema()), [titlePropId]: '' };

    const value = groupByPropId === undefined || optionId === NO_VALUE_GROUP_KEY ? undefined : this.groupValueFor(groupByPropId, optionId);

    return groupByPropId === undefined || value === undefined ? properties : { ...properties, [groupByPropId]: value };
  }

  /** The value a row takes in a group, or `undefined` when the group is a bucket (a date range, a number range). */
  private groupValueFor(groupByPropId: string, optionId: string): PropertyValue | undefined {
    const property = this.model.getProperty(groupByPropId);
    const view = this.model.getView(this.activeViewId);

    if (property?.type === 'status' && view?.groupByStatus === 'group') {
      return this.model.statusValueForGroup(groupByPropId, optionId, undefined) ?? undefined;
    }

    return property === undefined ? optionId : groupValueForKey(property, optionId, view?.groupSettings ?? {}) ?? undefined;
  }

  /** `subKey` is the lane clicked in, on a sub-grouped board. */
  private handleAddRow(optionId: string, boardEl: HTMLDivElement, subKey?: string): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const subGroupBy = subKey === undefined ? undefined : viewConfig?.subGroupBy;
    const properties = this.newRowProperties(titlePropId, groupByPropId, optionId, subGroupBy);
    const subProperty = subGroupBy === undefined ? undefined : this.model.getProperty(subGroupBy);
    const subValue = subProperty === undefined || subKey === undefined || subKey === NO_VALUE_GROUP_KEY
      ? undefined
      : groupValueForKey(subProperty, subKey, viewConfig?.subGroupSettings ?? {});
    const rowData = this.model.createRowData(subGroupBy === undefined || subValue === undefined ? properties : { ...properties, [subGroupBy]: subValue });

    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position: rowData.position, title: '' },
      { parentId: this.block.id, position: 'end', id: rowData.id },
    );
    this.syncRowsFromBlocks();

    // Lane columns have no header count: a redraw keeps the header and lane counts right.
    if (subKey !== undefined) {
      this.rerenderView({ keepDrawer: true });
      void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });

      return;
    }

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

    if (groupByPropId === undefined || this.model.isDatabaseLocked()) {
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

    if (boardEl.matches('[data-sub-grouped]') || boardEl.querySelector('[data-sub-grouped]') !== null) {
      this.rerenderView({ keepDrawer: true });
    } else {
      this.view.appendGroup?.(boardEl, newOption);
    }
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

    const savedView = this.model.getView(this.activeViewId);
    const viewConfig = savedView === undefined ? undefined : this.controls.effective(savedView);
    const isList = viewConfig?.type === 'list';
    // Table, gallery, calendar and timeline own their gestures. Unknown types render as a board.
    const ownsGestures = viewConfig?.type === 'table' || viewConfig?.type === 'gallery' || viewConfig?.type === 'calendar' || viewConfig?.type === 'timeline';
    const isBoard = !isList && !ownsGestures;

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
    }

    // Columns are options only there: renaming, deleting or moving a date bucket means nothing.
    if (isBoard && this.isOptionGroup(viewConfig?.groupBy) && !this.model.isDatabaseLocked()) {
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
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-table]')
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-gallery]')
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-calendar]')
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-timeline]');

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
        onPropertyValueChange: (rowId, propertyId, input) => {
          if (this.readOnly || this.destroyed) return;
          if (this.model.getProperty(propertyId)?.type === 'relation') {
            this.commitRelation(rowId, propertyId, input);
            this.rerenderView({ keepDrawer: true });

            return;
          }
          const value = this.knownOptionsOnly(propertyId, input);

          // Deleting an option already emptied this row through clearRemovedOptions.
          if (JSON.stringify(this.model.getRow(rowId)?.properties[propertyId] ?? null) === JSON.stringify(value)) return;
          this.updateRowBlock(rowId, { [propertyId]: value });
          this.rerenderView({ keepDrawer: true });
          this.sync.syncUpdateRow({ rowId, properties: { [propertyId]: value } });
        },
        onOptionsChange: (propertyId, options) => {
          if (this.readOnly || this.destroyed || this.model.isDatabaseLocked()) return;
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

        // A sub-grouped board keeps its headers in one row, outside the columns.
        const optId = columnHeader.closest('[data-option-id]')?.getAttribute('data-option-id') ?? null;

        if (optId !== null && optId !== NO_VALUE_GROUP_KEY) {
          e.preventDefault();
          e.stopPropagation();
          this.columnDrag?.beginTracking(optId, e.clientX, e.clientY);
        }

        return;
      }

      // Board: a card property edits in place, so a press there is not a drag.
      if (!this.readOnly && target.closest('[data-blok-database-card-property]') !== null) {
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
          this.cardDragFromSubGroup = cardEl.closest('[data-blok-database-column]')?.getAttribute('data-sub-group') ?? null;
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
      const optId = header.closest('[data-option-id]')?.getAttribute('data-option-id');

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

    const subGroupBy = viewConfig?.subGroupBy;
    const subChange: Record<string, PropertyValue> = subGroupBy !== undefined && subGroupBy !== groupByPropId && result.toSubGroup !== undefined
      ? { [subGroupBy]: this.droppedSubGroupValue(subGroupBy, rowId, result.toSubGroup) }
      : {};

    // Neighbours arrive in sort order, not key order, so positionBetween would
    // throw. A reorder inside the group asks first (D7). A move to another
    // group changes the value only: Notion's answer there is unmeasured.
    if (viewConfig !== undefined && this.controls.effective(viewConfig).sorts.length > 0) {
      const row = this.model.getRow(rowId);
      const sortedChanges = { ...this.changedValues(rowId, subChange) };

      if (row !== undefined && this.model.groupKeysOf(groupByPropId, { statusBy: viewConfig.groupByStatus, settings: viewConfig.groupSettings })(row).includes(toOptionId)) {
        this.askToRemoveSorting(rowId, beforeRowId, afterRowId, sortedChanges);

        return;
      }

      Object.assign(sortedChanges, this.changedValues(rowId, { [groupByPropId]: this.droppedGroupValue(groupByPropId, rowId, toOptionId) }));
      this.writeRowValues(rowId, sortedChanges);

      return;
    }

    const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
    const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
    const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);

    const value = this.droppedGroupValue(groupByPropId, rowId, toOptionId);
    const changes: Record<string, PropertyValue> = { [groupByPropId]: value, ...subChange };

    this.updateRowBlock(rowId, changes);
    this.moveRowBlock(rowId, position);
    this.rerenderView();

    this.sync.syncUpdateRow({ rowId, properties: changes });
    void this.sync.syncMoveRow({ rowId, position });
  }

  /** Only the values that differ from the row's. */
  private changedValues(rowId: string, values: Record<string, PropertyValue>): Record<string, PropertyValue> {
    const current = this.model.getRow(rowId)?.properties ?? {};

    return Object.fromEntries(Object.entries(values).filter(([id, value]) => JSON.stringify(current[id] ?? null) !== JSON.stringify(value)));
  }

  private writeRowValues(rowId: string, changes: Record<string, PropertyValue>): void {
    if (Object.keys(changes).length === 0 || this.model.getRow(rowId) === undefined) {
      return;
    }
    this.updateRowBlock(rowId, changes);
    this.rerenderView();
    this.sync.syncUpdateRow({ rowId, properties: changes });
  }

  /**
   * Notion's D7 flow (research/08): "Remove" deletes the sorts, keeps the sorted
   * order as the manual order and lands the row where it was dropped.
   * "Don't remove" discards the drop.
   */
  /** `changes` is a cross-lane drop's sub-group value: it is kept whatever the answer. */
  private askToRemoveSorting(rowId: string, beforeRowId: string | null, afterRowId: string | null, changes: Record<string, PropertyValue> = {}): void {
    const viewId = this.activeViewId;

    void openDatabaseConfirm({
      title: this.api.i18n.t('tools.database.removeSortingTitle'),
      confirmLabel: this.api.i18n.t('tools.database.removeSortingConfirm'),
      cancelLabel: this.api.i18n.t('tools.database.removeSortingCancel'),
      destructive: true,
      directionSource: this.element,
    }).then((remove) => {
      const view = this.model.getView(viewId);

      if (this.destroyed || this.readOnly) {
        return;
      }
      // A peer may have dropped the sort or the row while the dialog was open.
      if (!remove || view === undefined || view.sorts.length === 0 || this.model.getRow(rowId) === undefined) {
        this.writeRowValues(rowId, changes);

        return;
      }
      this.removeSortingAndPlace(view, rowId, beforeRowId, afterRowId, changes);
    });
  }

  private removeSortingAndPlace(
    view: DatabaseViewConfig, rowId: string, beforeRowId: string | null, afterRowId: string | null, changes: Record<string, PropertyValue> = {}
  ): void {
    // Every row, filtered out or not, so hidden rows keep their sorted place too.
    const sorted = sortRows(this.model.getOrderedRows(), view.sorts, this.model.getSchema());
    const dragged = sorted.find((row) => row.id === rowId);
    const rest = sorted.filter((row) => row.id !== rowId);

    if (dragged === undefined) {
      return;
    }

    const afterIndex = afterRowId === null ? -1 : rest.findIndex((row) => row.id === afterRowId);
    const beforeIndex = beforeRowId === null ? -1 : rest.findIndex((row) => row.id === beforeRowId);
    const insertAt = ((): number => {
      if (afterIndex !== -1) return afterIndex + 1;

      return beforeIndex !== -1 ? beforeIndex : rest.length;
    })();
    const order = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
    const moves: Array<{ rowId: string; position: string }> = [];

    order.reduce<string | null>((previous, row) => {
      const position = DatabaseModel.positionBetween(previous, null);

      if (row.position !== position) {
        moves.push({ rowId: row.id, position });
      }

      return position;
    }, null);

    const hasChanges = Object.keys(changes).length > 0;
    const write = (): void => {
      this.model.updateView(view.id, { sorts: [] });
      this.block.dispatchChange();
      if (hasChanges) {
        this.updateRowBlock(rowId, changes);
      }
      moves.forEach((move) => this.moveRowBlock(move.rowId, move.position));
    };

    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(write);
    } else {
      write();
    }

    this.rerenderView();
    void this.sync.syncUpdateView({ viewId: view.id, changes: { sorts: [] } });
    if (hasChanges) {
      this.sync.syncUpdateRow({ rowId, properties: changes });
    }
    moves.forEach((move) => {
      void this.sync.syncMoveRow(move);
    });
  }

  /** The sub-group property's value after a drop into the `toKey` lane. */
  private droppedSubGroupValue(propertyId: string, rowId: string, toKey: string): PropertyValue {
    const property = this.model.getProperty(propertyId);
    const current = this.model.getRow(rowId)?.properties[propertyId];
    const target = toKey === NO_VALUE_GROUP_KEY ? null : toKey;

    if (property === undefined) return current ?? null;
    if (!this.isOptionGroup(propertyId)) {
      return groupValueForKey(property, toKey, this.model.getView(this.activeViewId)?.subGroupSettings ?? {}) ?? current ?? null;
    }
    if (property.type !== 'multiSelect') {
      return target;
    }

    const from = this.cardDragFromSubGroup;
    const kept = personIdsOf(current).filter((id) => id !== from && id !== target);

    return target === null ? kept : [...kept, target];
  }

  private droppedGroupValue(groupByPropId: string, rowId: string, toOptionId: string): PropertyValue {
    const target = toOptionId === NO_VALUE_GROUP_KEY ? null : toOptionId;
    const property = this.model.getProperty(groupByPropId);
    const type = property?.type;
    const current = this.model.getRow(rowId)?.properties[groupByPropId];

    if (property !== undefined && !this.isOptionGroup(groupByPropId)) {
      // A bucket names no single value: the row keeps the one it has.
      const settings = this.model.getView(this.activeViewId)?.groupSettings ?? {};

      return groupValueForKey(property, toOptionId, settings) ?? current ?? null;
    }

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

    // Lanes repeat every column; a redraw keeps them all in the new order.
    if (boardEl.hasAttribute('data-sub-grouped')) {
      this.rerenderView({ keepDrawer: true });

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

    if (groupByPropId === undefined || this.model.isDatabaseLocked()) {
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

    if (groupByPropId === undefined || this.model.isDatabaseLocked()) {
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

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------

  /** Titles of rows in another document, from the host's `relations.resolve`. */
  private readonly remoteTitles = new Map<string, string>();
  private readonly remoteRequested = new Set<string>();

  /** The database a relation points at: this one, another block of this document, or none. */
  private relatedSource(property: PropertyDefinition): DatabaseSource | undefined {
    const databaseId = property.relation?.targetDatabaseId;

    if (databaseId === undefined || property.relation?.targetDocumentId !== undefined) return undefined;

    return databaseId === this.block.id
      ? { schema: this.model.getSchema(), rows: this.model.getOrderedRows() }
      : this.readDatabaseSource(databaseId);
  }

  private static titleOf(source: DatabaseSource, row: DatabaseRow): string {
    const titleId = source.schema.find((p) => p.type === 'title')?.id;
    const title = titleId === undefined ? undefined : row.properties[titleId];

    return typeof title === 'string' ? title : '';
  }

  private relatedTitle(property: PropertyDefinition, rowId: string): string | undefined {
    const settings = property.relation;

    if (settings?.targetDocumentId !== undefined) {
      this.requestRemoteTitles(property, [rowId]);

      return this.remoteTitles.get(rowId);
    }
    const source = this.relatedSource(property);
    const row = source?.rows.find((r) => r.id === rowId);

    return source === undefined || row === undefined ? undefined : DatabaseTool.titleOf(source, row);
  }

  /** Asks the host once per row for titles in another document, then redraws. */
  private requestRemoteTitles(property: PropertyDefinition, rowIds: string[]): void {
    const settings = property.relation;
    const resolver = this.config.relations;
    const missing = rowIds.filter((id) => !this.remoteRequested.has(id));

    if (settings?.targetDocumentId === undefined || resolver === undefined || missing.length === 0) return;
    missing.forEach((id) => this.remoteRequested.add(id));
    void resolver.resolve({ documentId: settings.targetDocumentId, databaseId: settings.targetDatabaseId, rowIds: missing })
      .then((rows) => {
        if (this.destroyed) return;
        rows.forEach((row) => this.remoteTitles.set(row.id, row.title));
        this.rerenderView({ keepDrawer: true });
      })
      .catch(() => undefined);
  }

  private relationCandidates(property: PropertyDefinition): Array<{ id: string; title: string }> {
    const source = this.relatedSource(property);

    return (source?.rows ?? []).map((row) => ({ id: row.id, title: source === undefined ? '' : DatabaseTool.titleOf(source, row) }));
  }

  private openRelated(property: PropertyDefinition, rowId: string): void {
    const databaseId = property.relation?.targetDatabaseId;

    if (databaseId === undefined || property.relation?.targetDocumentId !== undefined) return;
    if (databaseId === this.block.id) {
      this.handleRowClick(rowId);

      return;
    }
    this.api.blocks.getById(databaseId)?.call('openRow', { rowId });
  }

  /** Writes one row's relation values on another database's row block. */
  private writeForeignRow(databaseId: string, rowId: string, changes: Record<string, PropertyValue>): void {
    if (databaseId === this.block.id) {
      this.updateRowBlock(rowId, changes);

      return;
    }
    const rowBlock = this.api.blocks.getChildren(databaseId).find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updateProperties', changes);
      rowBlock.dispatchChange();
    }
  }

  private storedRelationOf(databaseId: string, rowId: string, propertyId: string): PropertyValue | undefined {
    const source = databaseId === this.block.id
      ? { rows: this.model.getOrderedRows() }
      : this.readDatabaseSource(databaseId);

    return source?.rows.find((r) => r.id === rowId)?.properties[propertyId];
  }

  /**
   * A relation cell's new list. Writes the row's stored ids and, in one undo
   * step, the other side: the synced property of a two-way relation, or the
   * row that points here on a one-way self-relation.
   */
  private commitRelation(rowId: string, propertyId: string, input: PropertyValue): void {
    const property = this.model.getProperty(propertyId);
    const row = this.model.getRow(rowId);
    const settings = property?.relation;

    if (property === undefined || row === undefined || settings === undefined) return;
    const shown = relationIdsOf(row.computed?.[propertyId] ?? row.properties[propertyId]);
    const next = relationIdsOf(input);
    const added = next.filter((id) => !shown.includes(id));
    const removed = shown.filter((id) => !next.includes(id));

    if (added.length === 0 && removed.length === 0) return;
    const stored = relationIdsOf(row.properties[propertyId]);
    const kept = [...stored.filter((id) => !removed.includes(id)), ...added.filter((id) => !stored.includes(id))];
    const own = (settings.limit === 1 ? kept.slice(-1) : kept).map((id) => ({ id }));
    const target = settings.targetDatabaseId;
    const synced = settings.twoWay === true ? settings.syncedPropertyId : undefined;
    const write = (): void => {
      this.updateRowBlock(rowId, { [propertyId]: own });
      if (synced !== undefined) {
        added.forEach((id) => this.writeForeignRow(target, id, { [synced]: addRelatedIds(this.storedRelationOf(target, id, synced), rowId, null) }));
        removed.forEach((id) => this.writeForeignRow(target, id, { [synced]: removeRelatedIds(this.storedRelationOf(target, id, synced), rowId) }));
      } else if (target === this.block.id) {
        // A one-way self-relation shows both ways: drop the pointer on the other row too.
        removed
          .filter((id) => relationIdsOf(this.model.getRow(id)?.properties[propertyId]).includes(rowId))
          .forEach((id) => this.updateRowBlock(id, { [propertyId]: removeRelatedIds(this.model.getRow(id)?.properties[propertyId], rowId) }));
      }
    };

    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(write);
    } else {
      write();
    }
    this.sync.syncUpdateRow({ rowId, properties: { [propertyId]: own } });
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.model.getRow(rowId));
    }
  }

  /**
   * Before a row block goes: take it out of the relations that point at it
   * from this database, so the saved JSON stays clean and one undo brings
   * both back. Rows elsewhere that still name it are skipped on read.
   */
  private unlinkDeletedRow(rowId: string): void {
    const row = this.model.getRow(rowId);

    if (row === undefined || this.readOnly) return;
    for (const property of this.model.getSchema()) {
      const settings = property.relation;

      if (property.type !== 'relation' || settings === undefined) continue;
      const synced = settings.twoWay === true ? settings.syncedPropertyId : undefined;

      if (synced !== undefined) {
        relationIdsOf(row.properties[property.id])
          .forEach((id) => this.writeForeignRow(settings.targetDatabaseId, id, {
            [synced]: removeRelatedIds(this.storedRelationOf(settings.targetDatabaseId, id, synced), rowId),
          }));
      }
      if (settings.targetDatabaseId === this.block.id) {
        this.model.getOrderedRows()
          .filter((other) => other.id !== rowId && relationIdsOf(other.properties[property.id]).includes(rowId))
          .forEach((other) => this.updateRowBlock(other.id, { [property.id]: removeRelatedIds(other.properties[property.id], rowId) }));
      }
    }
  }

  /** What cells need from the host: people, the current user, file uploads. */
  private cellContext(): Partial<CellContext> {
    const uploader = this.api.uploader;
    const canUpload = !this.readOnly && uploader !== undefined && uploader.isConfigured('file', 'uploadByFile');
    const me = this.config.people?.me?.();

    return {
      valueProperty: (property) => this.computedValues.valueProperty(property),
      relationTitle: (property, rowId) => this.relatedTitle(property, rowId),
      relationCandidates: (property) => this.relationCandidates(property),
      openRelated: (property, rowId) => this.openRelated(property, rowId),
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
    // A relation starts as a self-relation; "Related to" then picks the database.
    const settings: PropertySettingsV2 = isStatus ? { status: createDefaultStatusSettings() } : {};

    if (params.type === 'relation') settings.relation = { targetDatabaseId: this.block.id };
    const prop = this.model.addProperty(name, params.type, config, { afterId: params.afterId, beforeId: params.beforeId }, settings);
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
      ...(prop.relation !== undefined ? { relation: prop.relation } : {}),
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
    if (type === 'relation' && plan.property.relation === undefined) {
      plan.property.relation = { targetDatabaseId: this.block.id };
    }
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
  /** The header the property menu opened from: the formula editor opens there too. */
  private propertyMenuAnchor: HTMLElement | null = null;
  private formulaEditor: FormulaEditorHandle | null = null;

  /** Every database block of this document, this one first, by title. */
  private documentDatabases(): Array<{ id: string; title: string }> {
    const others = Array.from({ length: this.api.blocks.getBlocksCount() }, (_, index) => this.api.blocks.getBlockByIndex(index))
      .filter((block): block is BlockAPI => block !== undefined && block.name === 'database' && block.id !== this.block.id)
      .map((block) => {
        const title = (block.preservedData as Partial<DatabaseData> | undefined)?.title;

        return { id: block.id, title: typeof title === 'string' ? title : '' };
      });

    return [{ id: this.block.id, title: this.title }, ...others];
  }

  /** Notion's formula editor, from "Edit property". Saves the stored (id) form. */
  openFormulaEditor(propertyId: string, anchor: HTMLElement | null): void {
    const property = this.model.getProperty(propertyId);
    const at = anchor?.isConnected === true ? anchor : this.element;

    if (this.readOnly || property === undefined || property.type !== 'formula' || at === null) return;
    this.formulaEditor?.close();
    const schema = this.model.getSchema();
    const draft = (source: string): PropertyDefinition => ({ ...property, formula: { expression: source } });
    const sample = this.cardDrawer?.openRowId ?? this.model.getOrderedRows()[0]?.id;
    const relatedSchema = schema
      .flatMap((p) => (p.type === 'relation' && p.relation !== undefined && p.relation.targetDatabaseId !== this.block.id
        ? this.readDatabaseSource(p.relation.targetDatabaseId)?.schema ?? []
        : []));

    this.formulaEditor = openFormulaEditor(at, {
      i18n: this.api.i18n,
      property,
      schema: localizeDatabaseSchema(schema, this.api.i18n),
      relatedSchema,
      compile: (source) => this.computedValues.compile(draft(source), schema.map((p) => (p.id === propertyId ? draft(source) : p))),
      preview: (source) => {
        if (sample === undefined) return null;
        const trial = new ComputedProperties(this.block.id);
        const trialSchema = schema.map((p) => (p.id === propertyId ? draft(source) : p));
        const rows = trial.apply(trialSchema, this.model.getOrderedRows(), {
          databaseId: this.block.id,
          now: new Date(),
          resolveDatabase: (databaseId) => this.readDatabaseSource(databaseId),
        });
        const value = rows.find((row) => row.id === sample)?.computed?.[propertyId];

        return value === undefined || value === null ? '' : formatPreview(value);
      },
      onSave: (stored) => this.updatePropertySettings(propertyId, { formula: { expression: stored } }),
      onClose: () => {
        this.formulaEditor = null;
      },
    });
  }

  /**
   * Two-way on: a mirroring relation on the target database (a second one on
   * this database for a self-relation), filled from this side, all in one
   * undo step. Off: the mirror stays as a one-way relation, as Notion leaves
   * the other property in place.
   */
  setRelationTwoWay(propertyId: string, twoWay: boolean): void {
    const property = this.model.getProperty(propertyId);
    const settings = property?.relation;

    if (this.readOnly || property === undefined || settings === undefined || settings.targetDocumentId !== undefined) return;
    if (!twoWay) {
      const { twoWay: _twoWay, syncedPropertyId: _synced, ...oneWay } = settings;

      this.updatePropertySettings(propertyId, { relation: oneWay });

      return;
    }
    const target = settings.targetDatabaseId;
    const write = (): void => {
      const reverseName = this.api.i18n.t('tools.database.relationReverseName', { name: this.title === '' ? property.name : this.title });
      const reverseRelation = { targetDatabaseId: this.block.id, twoWay: true, syncedPropertyId: propertyId };
      const reverseId = target === this.block.id
        ? this.model.addProperty(reverseName, 'relation', undefined, {}, { relation: reverseRelation }).id
        : this.addForeignRelation(target, reverseName, reverseRelation);

      if (reverseId === null) return;
      this.model.updateProperty(propertyId, { relation: { ...settings, twoWay: true, syncedPropertyId: reverseId } });
      this.block.dispatchChange();
      // Fill the mirror from this side's stored ids.
      this.model.getOrderedRows().forEach((row) => relationIdsOf(row.properties[propertyId]).forEach((id) => {
        this.writeForeignRow(target, id, { [reverseId]: addRelatedIds(this.storedRelationOf(target, id, reverseId), row.id, null) });
      }));
    };

    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(write);
    } else {
      write();
    }
    this.syncRowsFromBlocks();
    void this.sync.syncUpdateProperty({ propertyId, changes: { relation: this.model.getProperty(propertyId)?.relation } });
    this.commitSchema();
  }

  /** "Related to": the databases of this document, this one first. Picking one retargets the relation. */
  private openRelatedToPicker(propertyId: string, anchor: HTMLElement): void {
    if (!anchor.isConnected) return;
    const popover = new PopoverDesktop({
      items: this.documentDatabases().map((database) => ({
        name: `relatedTo-${database.id}`,
        title: database.title === '' ? this.api.i18n.t('tools.database.relationUntitledDatabase') : database.title,
        closeOnActivate: true,
        onActivate: (): void => this.updatePropertySettings(propertyId, { relation: { targetDatabaseId: database.id } }),
      })),
      trigger: anchor,
      width: 'auto',
      minWidth: '240px',
      flippable: true,
      autoFocusFirstItem: false,
    });

    popover.getElement().setAttribute('data-blok-database-related-to', '');
    popover.on(PopoverEvent.Closed, () => queueMicrotask(() => popover.destroy()));
    popover.show();
  }

  /** Adds a relation property to another database block through its tool. */
  private addForeignRelation(databaseId: string, name: string, relation: RelationSettings): string | null {
    const created: string[] = [];

    this.api.blocks.getById(databaseId)?.call('addSyncedRelation', { name, relation, receive: (id: string) => created.push(id) });

    return created[0] ?? null;
  }

  /** Called by another database turning on a two-way relation to this one. */
  addSyncedRelation(param: { name: string; relation: RelationSettings; receive: (propertyId: string) => void }): void {
    if (this.readOnly || this.destroyed) return;
    const prop = this.model.addProperty(param.name, 'relation', undefined, {}, { relation: param.relation });

    void this.sync.syncCreateProperty({ id: prop.id, name: prop.name, type: prop.type, position: prop.position, relation: param.relation });
    this.commitSchema();
    param.receive(prop.id);
  }

  openPropertyMenu(propertyId: string, anchor: HTMLElement): void {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId);

    if (this.readOnly || property === undefined) return;
    // Locked: properties stay as they are, so only the view rows (filter, sort, ...) show.
    if (this.model.isDatabaseLocked()) {
      if (this.view instanceof DatabaseTableView) this.view.openHeaderMenu(propertyId, anchor);

      return;
    }
    this.propertyMenu ??= new DatabasePropertyMenu({
      i18n: this.api.i18n,
      hasPeople: this.hasPeople,
      onRename: (id, name) => this.renameProperty(id, name),
      onUpdate: (id, patch) => this.updatePropertySettings(id, patch),
      onChangeType: (id, type) => this.changePropertyType(id, type),
      onDuplicate: (id) => { this.duplicateProperty(id); },
      onDelete: (id) => this.deleteProperty(id),
      computed: {
        schema: () => this.model.getSchema(),
        databases: () => this.documentDatabases(),
        targetSchema: (databaseId) => (databaseId === this.block.id ? this.model.getSchema() : this.readDatabaseSource(databaseId)?.schema ?? []),
        onEditFormula: (id) => this.openFormulaEditor(id, this.propertyMenuAnchor),
        onSetTwoWay: (id, twoWay) => this.setRelationTwoWay(id, twoWay),
      },
    });
    this.propertyMenuAnchor = anchor;
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
    if (this.readOnly || this.model.isDatabaseLocked()) return;
    this.addPropertyPopover?.destroy();
    this.addPropertyPopover = new DatabasePropertyTypePopover({
      i18n: this.api.i18n,
      hasPeople: this.hasPeople,
      withNameField: true,
      onSelect: (type, name) => {
        const side = placement?.side === 'left' ? 'beforeId' : 'afterId';
        const created = this.addProperty({ name, type, ...(placement === undefined ? {} : { [side]: placement.propertyId }) });

        // research/08: Relation opens "Related to" right away.
        if (created?.type === 'relation') this.openRelatedToPicker(created.id, anchor);
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
    this.destroyView();

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
    this.controls.refresh();
  }
}
