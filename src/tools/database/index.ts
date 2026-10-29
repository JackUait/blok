import { openModalDialog } from '../../components/utils/modal-dialog';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';
import { DATABASE_EMPTY_AUTOMATIONS } from '../../shared/tool-actions/load-defaults';
import { describeDatabase } from '../../shared/tool-descriptions/database';
import { DATABASE_ACTION_HANDLERS } from '../../shared/tool-actions/database';
import { DATABASE_COMMENT_HANDLERS } from '../../shared/tool-actions/database-comments';
import { databaseSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, BlockToolData, OutputData, ToolboxConfig, ToolboxConfigEntry, SanitizerConfig } from '../../../types';
import type { AgentRun } from '../../../types/api';
import type { BlockReplayCapture } from '../../../types/events/editor-events';
import type { AutofillSettings, ButtonAction, ButtonCallbackAction, ButtonSendNotificationAction, DatabaseAdapter, DatabaseData, DatabaseIcon, FilterConfig, DatabaseSavedAutomations, DatabaseConfig, DatabaseFormSubmission, DatabasePerson, DatabaseRow, DatabaseRowData, DatabaseRowMeta, OpenPagesIn, FormSettings, PropertyDefinition, PropertySettingsV2, PropertyType, DatabaseSourceRef, DatabaseLinkedSourceSnapshot, RelationRole, RelationSettings, TemplateRepeat, ViewType, SelectOption, DatabaseViewConfig, PropertyValue, DatabasePermissionAction, DashboardWidget, PageVisibility, DatabaseBacklink, DateReminderOffset, DatabaseMapLngLat, PlaceValue } from './types';
import { countFilterRules } from './filter-tree';
import { adapterRowValues, assignUniqueIds, createDefaultStatusOptions, createDefaultStatusSettings, personIdsOf, readPropertyValue, statusGroupsOf, isListValueType, withEmptyLists, isReadOnlyType } from './property-values';
import { isOutputData, isPlaceValue } from './tier3-values';
import { DatabaseHostLevers } from './database-host-levers';
import { DatabaseFormView, isAutoQuestion } from './database-form-view';
import { DatabaseMapView, resolveMapBy } from './database-map-view';
import { drawMapLibrePlace } from './database-maplibre';
import { DatabaseDashboardView } from './database-dashboard-view';
import type { DashboardMount } from './database-dashboard-view';
import { planTypeChange } from './property-conversion';
import { openCellEditor } from './cells';
import type { CellContext, CellEditorHandle } from './cells';
import { ComputedProperties } from './computed-properties';
import { openFormulaEditor } from './database-formula-editor';
import type { FormulaEditorHandle } from './database-formula-editor';
import type { DatabaseSource } from './computed-properties';
import { addRelated as addRelatedIds, relationEdit, relationIdsOf, removeRelated as removeRelatedIds } from './relation-values';
import { agentMessageOf, askConfirmations, needsConfirmation, runButtonActions } from './database-button';
import { buttonHasError } from './database-button-menu';
import { dueRun, isTemplateData, nextRun } from './templates';
import { copiedReminders, dueReminder, storedReminderDueAt, viewerTimeZone } from './reminders';
import { descendantsOf, nestRows, parentMap, relationPair, resolveSubItemsDisplay } from './sub-items';
import { comparePositions, positionsBetween } from './positions';
import { mapRowValues } from './row-move';
import { dependencyArrows, shiftDependents } from './dependencies';
import { templateMenuItems, templateRepeatItems, templateRepeatSummary } from './database-template-menu';
import type { TemplateRepeatHost } from './database-template-menu';
import { resolveDynamicProperties } from './dynamic-values';
import { safeHref } from '../../components/utils/sanitize-url';
import { bulkCloseClearsSelection, bulkEditableProperties, bulkStartValue, createSelectionBar, watchBulkCloseKey } from './database-selection-bar';
import { calculationItems, moveTargetItems, openMenu, rowMenuFooter, rowMenuItems } from './database-table-menus';
import type { RowFavorite } from './database-table-menus';
import { EmojiPicker, prefetchEmojiPickerData } from '../callout/emoji-picker';
import { refreshCommentBadges } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';
import { DatabasePropertyMenu } from './database-property-menu';
import { propertyTypeMeta } from './database-property-types';
import { DatabaseModel, NO_VALUE_GROUP_KEY } from './database-model';
import { openLinkedAddView, openLinkedPicker } from './database-linked-picker';
import { openNewSourcePanel } from './database-new-source-panel';
import { planAiSetup } from './database-ai-setup';
import { DATABASE_STARTERS, buildStarter, galleryStarters, suggestedStarters } from './database-starters';
import type { StarterId, StarterMeta } from './database-starters';
import { openStarterCustomize } from './database-starter-modal';
import { openTemplateGallery } from './database-template-gallery';
import type { StarterPicks } from './database-starter-modal';
import type { LinkedPickerSource } from './database-linked-picker';
import { newRowValues, prefillFilters, rowOrderKey, sortRows } from './database-query';
import { UNORDERED_VIEW_TYPES } from '../../shared/database/row-order';
import { openDatabaseChoice, openDatabaseConfirm } from './database-confirm-dialog';
import { draftOf, openAutofillSetup, presetDraft } from './database-autofill-setup';
import type { AutofillDraft } from './database-autofill-setup';
import { DATABASE_MENU_CLASS, groupMenuItems } from './database-group-menu';
import { groupCalculationHint, groupCalculationItems, groupCalculationText } from './database-board-calculation';
import { optionColorOf, type OptionColor } from './cells/option-colors';
import { DatabaseBoardView } from './database-board-view';
import { DatabaseListView, pointerAnchor } from './database-list-view';
import { DatabaseTableView, createTableState } from './database-table-view';
import { DatabaseGalleryView } from './database-gallery-view';
import type { GalleryGroup } from './database-gallery-view';
import { DatabaseCalendarView } from './database-calendar-view';
import { addDays, eventSpan } from './calendar-dates';
import { formatDateValue } from '../../shared/database/date-value';
import { freePropertyName } from '../../shared/database/schema-ops';
import { OPTION_GROUP_TYPES, layoutChange } from '../../shared/database/view-changes';
import { DatabaseTimelineView, timelineZoomLabelKey } from './database-timeline-view';
import type { TimelineGroup } from './database-timeline-view';
import type { BarWrite } from './timeline-dates';
import { boardLayoutItems, calendarLayoutItems, galleryLayoutItems, timelineLayoutItems } from './database-layout-items';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { legacyBodyInserts, pageContentSourceBlocks, rowDescription } from './row-body';
import { applyDateDisplayChange, editorLocale, resolveWeekStart, toIsoDay } from './cells/date-format';
import type { DateDisplayChange } from './cells/date-format';
import type { TableAutofill, TableGroup, TableHandlers, TableNesting, TableState } from './database-table-view';
import type { CellChange } from './database-table-grid';
import type { TableRowDropResult } from './database-table-row-drag';
import { DatabasePropertyTypePopover } from './database-property-type-popover';
import type { ViewChanges } from './database-model';
import type { ViewPropertyPatch } from './view-settings';
import type { PageLayoutOp } from './page-layout';
import { inTabOrder, setTabsId } from './page-layout';
import {
  TIMELINE_ZOOMS,
  resolveArrowsBy,
  resolveCalculations,
  resolveCalendarBy,
  resolveLoadLimit,
  resolveOpenPagesIn,
  resolveShowTimelineTable,
  resolveTimelineBy,
  resolveTimelineEndBy,
  resolveTimelineZoom,
  defaultVisible,
  revealedInLegacyView,
  resolveViewProperties,
  visibleRowPropertyIds,
  withCalculation,
  withCalculationCap,
  resolveCountCaps,
  withPropertyOrder,
  withPropertySetting,
  groupCalculationCapped,
  groupCalculationFor,
  resolveGroupCalculation,
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
import { readRowPageHash } from './row-page-takeover';
import type { DrawerBacklink, LayoutTab, LayoutTabsDraft, LayoutTabsHost } from './database-card-drawer';
import { relatedTabSources, thisPageFilter } from './layout-tab-relations';
import { DatabaseKeyboard } from './database-keyboard';
import { DatabaseTabBar, VIEW_ICONS } from './database-tab-bar';
import { IconArrowDiagonal, IconCalendar, IconCreditCard, IconCurrency, IconDatabase, IconDatabaseInline, IconDatabaseLinked, IconFolderQuestion, IconFanDeck, IconPackage, IconPaintBrush, IconTicket, IconEmojiFlag, IconEmojiLightbulb, IconEmojiSmile, IconFileDoc, IconMap, IconMessage, IconTrash, IconCheck, IconChevronRight, IconCopy, IconDownload, IconImage, IconListChecklist, IconMergeCells, IconPageLayout, IconTable, IconTimeline, IconUpload, IconWand } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { nanoid } from 'nanoid';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { isAnnotationBlock, mountChildBlocks } from '../nested-blocks';
import { BuiltInCommentsUi } from './database-comments';
import { isAnnotationType } from '../../shared/annotation-blocks';
import { moveElementToEnd } from '../../components/utils/html';
import { showsPageIcon } from './page-icon';
import {
  DATABASE_DEFAULT_TEXT,
  localizeDatabaseSchema,
  localizeDatabaseSelectOptions,
  localizeDatabaseViews,
} from './database-localization';
import {
  renderBoardPreview,
  renderCalendarViewPreview,
  renderDatabasePreview,
  renderFeedViewPreview,
  renderFormPreview,
  renderGalleryViewPreview,
  renderLinkedDatabasePreview,
  renderListViewPreview,
  renderMapViewPreview,
  renderTableViewPreview,
  renderTimelineViewPreview,
} from './preview';
import { DatabaseViewControls } from './database-view-controls';
import type { ViewControlsHost } from './database-view-controls';
import type { ViewStateFallback } from './database-view-state';
import { TabDisplayPreference } from './database-tab-display';
import type { DataSourceChoice, ViewGroupEntry, StarterRow, ViewSettingsAction, ViewSettingsContext } from './database-view-settings-panel';
import { openFilterList } from './database-view-settings-panel';
import type { DatabasePanel } from './database-panel';
import { registerGroupToggle } from './database-group-toggle';
import { GROUPABLE_TYPES, defaultGroupSort, groupValueForKey } from './group-keys';
import { resolveRowColors } from './view-data';
import { groupLabel } from './database-group-labels';
import { buildChartData, foldChartData } from './chart-data';
import type { ChartGroupInput, ChartPoint, ChartSeriesInput } from './chart-data';
import { resolveChartSettings } from './chart-settings';
import { chartLayoutItems, chartMeasureLabel } from './chart-layout-items';
import { DatabaseChartView } from './database-chart-view';
import { openChartDrilldown } from './database-chart-drilldown';
import { DatabaseFeedView } from './database-feed-view';
import type { FeedReactions } from './database-feed-view';
import { rowReactions } from './row-reactions';
import { csvCellText, csvDatabaseBlocks, csvMergeTargets, parseCsv, planCsvMerge, serializeCsv, type CsvColumnTarget, type CsvImportSettings, type CsvMergeTarget } from './database-csv';
import { openCsvImportDialog } from './database-csv-import-dialog';
import { formatNumberValue } from './cells/number-format';
import { downloadBlob } from './database-download';
import { chartExportPage } from './database-chart-export';
import { LAYOUT_MAKER_ABSENCE_MS, layoutDraftSession, type LayoutDraftSession } from './layout-drafts';
import { layoutDraftOf } from '../tabs/draft';
import { scanBacklinkSources } from './backlinks';
import type { BacklinkSource } from './backlinks';
import { DatabaseRowTool } from '../database-row';
import { DatabaseCommentTool } from '../database-comment';
import type { BaseToolConstructable } from '../../../types/tools';

interface DrawerAuthority {
  writable(): boolean;
}

interface DashboardWidgetState {
  table: TableState;
  shown: Map<string, number>;
  expanded: Set<string>;
  authority: DrawerAuthority;
  controls?: DatabaseViewControls;
  cellEditor: CellEditorHandle | null;
  pendingTitle: string | null;
}

interface NativeWidgetContext {
  readonly owner: DatabaseTool;
  readonly viewId: string;
  readonly view: DatabaseViewConfig;
  readonly controls: DatabaseViewControls;
  readonly root: HTMLDivElement;
  readonly authority: DrawerAuthority;
  readonly fallback: ViewStateFallback;
  readonly store?: DatabaseConfig['viewState'];
  state: DashboardWidgetState;
  current(): boolean;
  writable(): boolean;
  redraw(allowed?: () => boolean): void;
  onDispose(cancel: () => void): void;
  openRow(rowId: string, mode?: OpenPagesIn): void;
}

interface ChangedBlock {
  id?: unknown;
  name?: unknown;
  parentId?: unknown;
}

/** What an agent's block event carries (BlockMutationEventDetail and BlockMovedEventDetail). */
interface AgentChangeDetail {
  origin?: unknown;
  replaySource?: unknown;
  agent?: unknown;
  target?: ChangedBlock;
  parentId?: string | null;
  oldParentId?: string | null;
}

/** A button step a shared action recorded (tool-actions/database pressButton). */
const isButtonAction = <Type extends 'callback' | 'sendNotification'>(value: unknown, type: Type): value is Extract<ButtonAction, { type: Type }> =>
  typeof value === 'object' && value !== null && 'type' in value && value.type === type && 'id' in value && typeof value.id === 'string';

/** Only a callback step's declared fields reach the host. */
const callbackStep = (action: ButtonCallbackAction): ButtonCallbackAction =>
  ({ id: action.id, type: 'callback', ...(typeof action.name === 'string' && { name: action.name }) });

/** Only a notification step's declared fields reach the host. */
const notifyStep = (action: ButtonSendNotificationAction): ButtonSendNotificationAction => {
  const given = action.recipients;
  const people = given?.type === 'people' && Array.isArray(given.people)
    ? { type: 'people' as const, people: given.people.flatMap((person) => (typeof person.id === 'string' ? [{ id: person.id }] : [])) }
    : undefined;
  const property = given?.type === 'property' && typeof given.propertyId === 'string' ? { type: 'property' as const, propertyId: given.propertyId } : undefined;
  const recipients = people ?? property;

  return { id: action.id, type: 'sendNotification', ...(recipients !== undefined && { recipients }), ...(typeof action.message === 'string' && { message: action.message }) };
};

/** A form answer a shared action recorded (tool-actions/database submitForm). */
const isFormSubmission = (value: unknown): value is DatabaseFormSubmission =>
  typeof value === 'object' && value !== null && 'databaseId' in value && typeof value.databaseId === 'string'
  && 'viewId' in value && typeof value.viewId === 'string' && 'values' in value && typeof value.values === 'object';

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

/** Emitted on the editor's own event bus when a database block has rendered. */
const DATABASE_RENDERED_EVENT = 'database rendered';

/** Events that can end an inline edit or a drag. */
const INTERACTION_END_EVENTS = ['focusout', 'pointerup', 'pointercancel', 'keyup'] as const;

/**
 * Insert-time hint from the toolbox: the layout of the first view. Read once
 * by the constructor and never saved.
 */
const INITIAL_VIEW_KEY = 'initialView';

/**
 * Template glyphs, after Notion's (research/33 §3.13). `feed` and `comment` both draw IconMessage,
 * Blok's Feed view glyph. `database` stays for icons saved before a glyph existed.
 */
const ICON_GLYPHS: Record<DatabaseIcon['glyph'], string> = {
  check: IconCheck, timeline: IconTimeline, wand: IconWand, doc: IconFileDoc, idea: IconEmojiLightbulb, calendar: IconCalendar, flag: IconEmojiFlag,
  comment: IconMessage, person: IconEmojiSmile, map: IconMap, database: IconDatabase,
  ticket: IconTicket, feed: IconMessage, currency: IconCurrency, card: IconCreditCard, paintBrush: IconPaintBrush, package: IconPackage, fanDeck: IconFanDeck,
};
const ICON_COLORS: ReadonlySet<string> = new Set<DatabaseIcon['color']>(['green', 'blue', 'gray', 'red', 'orange', 'yellow', 'purple', 'pink']);

/** A saved icon Blok can draw, else undefined. */
const iconOf = (data: Partial<DatabaseData> | undefined): DatabaseIcon | undefined => {
  const icon = data?.icon as Partial<DatabaseIcon> | undefined;

  return icon !== undefined && typeof icon.glyph === 'string' && Object.hasOwn(ICON_GLYPHS, icon.glyph) && typeof icon.color === 'string' && ICON_COLORS.has(icon.color)
    ? { glyph: icon.glyph, color: icon.color }
    : undefined;
};

const starterOf = (data: Partial<DatabaseData> | undefined): StarterId | undefined =>
  DATABASE_STARTERS.find((starter) => starter.id === data?.starter)?.id;

/**
 * The toolbox merges the saved data of an empty block (a board) under its
 * seed, so a seed drops that schema and those views and builds its own.
 */
const seedWins = <T extends DatabaseData | undefined>(data: T): T => {
  if (data === undefined || (data as unknown as Record<string, unknown>)[INITIAL_VIEW_KEY] === undefined) return data;
  const seed: Partial<DatabaseData> = { ...data };

  delete seed.schema;
  delete seed.views;
  delete seed.activeViewId;

  return seed as T;
};

/** Groups a board shows before "Load more groups" (research/08). */
const BOARD_GROUP_PAGE = 10;

/** Layouts Blok draws; gallery is in the type but falls back to a board. */
const RENDERED_LAYOUTS: readonly ViewType[] = ['table', 'board', 'gallery', 'list', 'chart', 'timeline', 'feed', 'calendar', 'form', 'map'];

/** Layouts a dashboard widget draws natively, with its own toolbar. */
const WIDGET_LAYOUTS: readonly ViewType[] = ['table', 'list'];

/** Select-like groups: their columns are options (or status groups) the user can rename and move. */

const hasGroup = (list: Array<{ id: string }> | undefined, key: string): boolean => (list ?? []).some((group) => group.id === key);

/** Card and row controls that act on their own and never open the row page. */
const ROW_CONTROL_SELECTOR = [
  '[data-blok-database-add-card]',
  '[data-blok-database-column-new-page]',
  '[data-blok-database-column-menu]',
  '[data-blok-database-column-count]',
  '[data-blok-database-hidden-groups]',
  '[data-blok-database-add-column]',
  '[data-blok-database-card-menu]',
  '[data-blok-database-list-row-handle]',
  '[data-blok-database-add-row]',
  '[data-blok-database-delete-row]',
  '[data-blok-database-list-row-property][data-editable]',
  '[data-blok-database-list-title-input]',
  // research/22 §3: a url, email or phone link is followed, not the card.
  'a[data-blok-database-cell-link]',
].join(', ');

/**
 * Insert-time hint from the "Linked view of data source" toolbox entry: show
 * the source picker. Never saved: a linked view left unpicked saves as an
 * ordinary empty database.
 */
const LINK_PICKER_KEY = 'linkPicker';

/**
 * Insert-time hint from the "Table view" entry only: no "New database" panel
 * when it is the page's only block (research/30 B7a). Never saved.
 */
const ALONE_SKIPS_PANEL_KEY = 'aloneSkipsPanel';

/** "New <layout> view" on a linked view's add-view panel (research 20 §2b). The add-view menu offers no form there, and no dashboard anywhere. */
const LINKED_NEW_VIEW_KEYS: Readonly<Record<Exclude<ViewType, 'form' | 'dashboard'>, string>> = {
  table: 'tools.database.linkedNewTableView',
  board: 'tools.database.linkedNewBoardView',
  gallery: 'tools.database.linkedNewGalleryView',
  list: 'tools.database.linkedNewListView',
  chart: 'tools.database.linkedNewChartView',
  timeline: 'tools.database.linkedNewTimelineView',
  feed: 'tools.database.linkedNewFeedView',
  map: 'tools.database.linkedNewMapView',
  calendar: 'tools.database.linkedNewCalendarView',
};

/** Emitted on the editor's own event bus when a database block's tool goes away. */
const DATABASE_GONE_EVENT = 'database gone';

/** Rows each database deleted from its backend, kept past the tool so an undo can create them again. */
const deletedBackendRows = new WeakMap<DatabaseAdapter, Map<string, Set<string>>>();

const deletedBackendRowsOf = (adapter: DatabaseAdapter | undefined, databaseId: string): Set<string> => {
  if (adapter === undefined) return new Set();
  const byDatabase = deletedBackendRows.get(adapter) ?? new Map<string, Set<string>>();
  const rows = byDatabase.get(databaseId) ?? new Set<string>();

  byDatabase.set(databaseId, rows);
  deletedBackendRows.set(adapter, byDatabase);

  return rows;
};

/** Backlinks are counted again this long after the last block change, so typing never scans per keystroke. */
const BACKLINKS_SETTLE_MS = 300;

// `icon` and `starter` stay in the passthrough: a value this client cannot draw (a newer glyph) is saved back as it came.
const KNOWN_KEYS: ReadonlySet<string> = new Set(['title', 'schema', 'views', 'activeViewId', 'source', 'automations', 'hideDataSourceTitles', 'fullPage', INITIAL_VIEW_KEY, LINK_PICKER_KEY, ALONE_SKIPS_PANEL_KEY]);

const sourceRefOf = (data: DatabaseData | undefined): DatabaseSourceRef | undefined => {
  const source = data?.source as unknown;

  if (typeof source !== 'object' || source === null) return undefined;
  const { databaseId, documentId } = source as Record<string, unknown>;

  if (typeof databaseId !== 'string' || databaseId === '') return undefined;

  return { databaseId, ...(typeof documentId === 'string' && documentId !== '' ? { documentId } : {}) };
};

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

/** An anonymous answer's metadata: no author ids, even ones an older save left behind. */
const anonymousRowMeta = ({ createdBy: _createdBy, lastEditedBy: _lastEditedBy, ...meta }: DatabaseRowMeta): DatabaseRowMeta =>
  ({ ...meta, anonymous: true });

/** The `#rowId` link whose page the user closed in this page load. */
const rowLink: { closed: string | null } = { closed: null };

/** The `#view-<id>` link a database already applied in this page load. */
const viewLink: { applied: string | null } = { applied: null };

/**
 * The view a "Copy link to view" fragment (`#view-<id>`) names, if `owns` it.
 * Applied once per page load: a later render (undo, a peer replace) must not
 * undo the user's own tab switch.
 */
const consumeViewLink = (owns: (viewId: string) => boolean): string | null => {
  const hash = window.location.hash.slice(1);

  if (!hash.startsWith('view-') || hash === viewLink.applied) return null;
  // A malformed escape in someone else's hash must not break the render.
  const viewId = ((): string => {
    try {
      return decodeURIComponent(hash.slice('view-'.length));
    } catch {
      return '';
    }
  })();

  if (viewId === '' || !owns(viewId)) return null;
  viewLink.applied = hash;

  return viewId;
};

export class DatabaseTool implements BlockTool {
  public static describe = describeDatabase;
  public static actionHandlers = { ...DATABASE_ACTION_HANDLERS, ...DATABASE_COMMENT_HANDLERS };
  /** Rows and comments are blocks of their own; registering `database` brings both. */
  public static companionTools: Record<string, BaseToolConstructable> = {
    'database-row': DatabaseRowTool,
    'database-comment': DatabaseCommentTool,
  };

  /**
   * Rows, a second data source and the page layout's tabs block. Rows come
   * first: core demotes a disallowed insert to allow[0].
   */
  public static get childTools(): { allow: string[] } {
    return { allow: ['database-row', 'database', 'tabs', 'database-comment'] };
  }

  /** Deleting a database deletes its rows, sources and comments. Promoting them would drop rows into the parent. */
  public static get deletesChildren(): boolean {
    return true;
  }

  private readonly api: API;
  private readonly block: BlockAPI;
  /** Linked views also check their source's permission. */
  private ownReadOnly: boolean;
  private checkingRowPermission = false;
  /** A button press that messages the agent is waiting on its questions. */
  private agentPressOpen = false;
  /** The editor's own read-only state, before `config.permissions`. */
  private editorReadOnly: boolean;
  /** No `editStructure` permission: acts as a locked database. */
  private structureDenied = false;
  /**
   * Rows this tool's sync created in its backend and has not deleted. Never
   * seeded from the document: a row here can be missing from the backend.
   */
  private readonly backendRows = new Set<string>();
  /** True until the paste or duplicate that made this copy has placed its rows. */
  private copiedRowsPending = false;
  private readonly config: DatabaseConfig;

  private title: string;
  private backlinksTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wakes the block when the next reminder or template run comes due. Armed from the first render. */
  private dueTimer: ReturnType<typeof setTimeout> | null = null;
  private dueWatching = false;
  /** Reminder and run keys this block has offered: a later wake must not offer them again. */
  private readonly offeredDue = new Set<string>();
  /** The host's backlinks of the last row whose page opened. */
  private hostBacklinks: { rowId: string; items: DatabaseBacklink[] } | null = null;
  private unknown: Record<string, unknown>;
  private savedAutomations: DatabaseSavedAutomations | undefined;
  /** Set when the insert data carried the toolbox seed, which the document still holds. */
  private seeded: boolean;
  /** A user just inserted this database: rendered() opens the "New database" panel once. */
  private offerNewDatabasePanel: boolean;
  private aloneSkipsPanel: boolean;
  /** A user just inserted a Timeline view: rendered() adds "Card 1-3" once. */
  private sampleCardsPending: boolean;
  /** Those cards: a panel choice that replaces the database (template, CSV, AI, link) deletes them. */
  private sampleCardIds: string[] = [];
  private activeViewId: string;
  private model: DatabaseModel;
  /** Linked database: the block whose rows and schema this one shows. */
  private source: DatabaseSourceRef | undefined;
  /** Linked database: the schema it saves, a stand-in older clients can read. */
  private stubSchema: PropertyDefinition[];
  /** A new "Linked view of data source" that has not picked its source yet. */
  private linkPicker: boolean;
  /** The open "New database" / "New view" panel of a linked view. */
  private sourcePicker: DatabasePanel | null = null;
  /** "Hide data source titles": one setting for the whole block (per view is unmeasured). */
  private dataSourceTitlesHidden: boolean;
  /** The database is the whole page: the page title is its title. */
  private fullPage: boolean;
  private databaseIcon: DatabaseIcon | undefined;
  /** The Suggested template this database was made from (research/27 §1). */
  private starter: StarterId | undefined;
  private iconElement: HTMLElement | null = null;
  /** The source's name as last read: a deleted source still shows it. */
  private lastSourceTitle = '';
  /** A source in another document, as the host last answered: `null` when it is gone. */
  private remoteSnapshot: DatabaseLinkedSourceSnapshot | null | undefined;
  /** Each host read gets the next number; only the newest one lands. */
  private remoteReads = 0;
  /** The source the host subscription listens to, and how to stop it. */
  private remoteWatch: { key: string; stop: () => void } | null = null;
  /** The blank view a remote pick shows until the host answers; then it copies the source's first table view. */
  private remotePlaceholderView: string | null = null;
  /** Rows whose sub-item toggle is open. This person's, for this session. */
  private readonly expandedSubItems = new Set<string>();
  /** Template rows, by position. Kept out of the model's rows. */
  private templates: DatabaseRow[] = [];
  /** What every row's empty-page prompt last drew from. */
  private rowPromptKey = '';
  /** Formula, rollup and relation values, worked out on every row sync. */
  private readonly computedValues: ComputedProperties;
  private view!: DatabaseViewRenderer;
  private sync!: DatabaseBackendSync;
  /**
   * Form views showing their confirmation, with the answer behind it. Session
   * only, so a redraw keeps it.
   */
  private readonly submittedForms = new Map<string, DatabaseFormSubmission | null>();
  private formQuestionEdit = false;
  private formPromptAbort: AbortController | null = null;
  /** Automations and AI autofill. Made once: every view switch makes a new sync with it. */
  private readonly hostLevers: DatabaseHostLevers;

  private element: HTMLDivElement | null = null;
  private titleElement: HTMLElement | null = null;
  private titleRowElement: HTMLDivElement | null = null;
  /** The title line of a view on a second source; null on this block's own views. */
  private sourceTitleElement: HTMLElement | null = null;
  private boardContainer: HTMLDivElement | null = null;
  /**
   * A dashboard can populate this model after render() drew no rows. Only
   * then does the first rendered() redraw: redrawing a current view swaps
   * the cards and closes a drawer the user opens before the backend answers.
   */
  private initialProjectionPending = true;
  /** Hidden home of the row holders, so their page bodies never show at the editor root. */
  private rowPool: HTMLDivElement | null = null;
  /** Holds the row page's layout tabs block (plan 11 §2.1). Chrome: find and own-text skip it, it is no database content. */
  private layoutPool: HTMLDivElement | null = null;
  private tabBar: DatabaseTabBar | null = null;

  private cardDrag: DatabaseCardDrag | null = null;
  /** Group of the card the pointer pressed; a multiSelect drop replaces this option. */
  private cardDragFromOptionId: string | null = null;
  private cardDragFromSubGroup: string | null = null;
  private cardCellEditor: CellEditorHandle | null = null;
  /** Every cell editor open over this database's rows, on any surface. Filled by `openCellEditor` via `cellContext()`. */
  private readonly openCellEditors = new Set<CellEditorHandle>();
  private columnDrag: DatabaseColumnDrag | null = null;
  private columnControls: DatabaseColumnControls | null = null;
  private listRowDrag: DatabaseListRowDrag | null = null;
  private cardDrawer: DatabaseCardDrawer | null = null;
  private cardDrawerSession: { origin: DrawerAuthority | undefined; readOnly: boolean } | null = null;
  private propertyMenu: DatabasePropertyMenu | null = null;
  /** The linked or dashboard view whose column header the property menu opened from. */
  private propertyMenuContext: NativeWidgetContext | null = null;
  /** Unsaved AI Autofill setups by property: Close keeps them for this editor only. */
  private readonly autofillDrafts = new Map<string, AutofillDraft>();
  private autofillSetup: { close: () => void } | null = null;
  private titleIconMenu: { menu: DatabasePropertyMenu; context: NativeWidgetContext; showPageIcon: boolean } | null = null;
  private addPropertyPopover: DatabasePropertyTypePopover | null = null;
  private descriptionPropertyCreation: ReturnType<DatabaseBackendSync['syncCreateProperty']> | null = null;
  private descriptionPropertyNeedsCreate = false;
  private readonly pendingDescriptions = new Map<string, OutputData>();
  private keyboard: DatabaseKeyboard | null = null;
  private cardMenuPopover: PopoverDesktop | null = null;
  private reactionPicker: EmojiPicker | null = null;
  private stopComments: (() => void) | undefined;
  /** Comments in the document, used only when the host gives no `comments` hook. */
  private readonly builtInComments: BuiltInCommentsUi;
  /** Per table view: selection, loaded rows, collapsed groups. Session only, never saved. */
  private readonly tableStates = new Map<string, TableState>();
  private readonly dashboardStates = new Map<string, DashboardWidgetState>();
  private readonly dashboardSources = new Set<string>();
  /**
   * Set while this block is a second data source drawn by the database that
   * holds it: the view, its toolbar and its redraws are that database's.
   */
  private binding: NativeWidgetContext | null = null;
  /** The layout this block draws while bound; its own board container is gone. */
  private boundRoot: HTMLElement | null = null;
  private groupMenuPopover: PopoverDesktop | null = null;
  /** Per gallery view and group: how many cards "Load more" has revealed. Session only. */
  private readonly galleryShown = new Map<string, Map<string, number>>();
  /** Per chart view: groups and series a legend click turned off. Session only, never saved (H-charts). */
  private readonly chartHidden = new Map<string, Set<string>>();
  /** Per feed view: how many cards "Load more" has revealed. Session only. */
  private readonly feedShown = new Map<string, number>();
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
  private tabDisplayPref: TabDisplayPreference | null = null;
  private unregisterGroupToggle: (() => void) | null = null;
  /** Per board view: how many groups show before "Load more groups". Session only. */
  private readonly groupLimits = new Map<string, number>();
  /** Board and list rows picked with Cmd/Ctrl- or Shift-click. Session only. */
  private readonly rowSelection = new Set<string>();
  /** The last row a click picked: a Shift-click selects from it. */
  private selectionAnchor: string | null = null;
  private bulkEditor: CellEditorHandle | null = null;
  /** The board/list selection bar, when shown. */
  private rowSelectionBar: HTMLElement | null = null;
  /** A row "+ New" just made, with the values it was born with. Escape deletes it while it stays so. */
  private freshRow: { id: string; properties: string } | null = null;

  constructor({ data: given, config, api, block, readOnly, origin }: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>) {
    const data = seedWins(given);

    this.api = api;
    this.block = block;
    this.config = config ?? {};
    this.editorReadOnly = readOnly;
    this.ownReadOnly = this.editorReadOnly;
    this.refreshPermissions();

    this.title = (data as DatabaseData | undefined)?.title ?? '';
    this.unknown = unknownKeys(data);
    this.dataSourceTitlesHidden = data?.hideDataSourceTitles === true;
    this.fullPage = data?.fullPage === true;
    this.databaseIcon = iconOf(data);
    this.starter = starterOf(data);
    this.savedAutomations = structuredClone(data?.automations);
    const initialView = (data as Record<string, unknown> | undefined)?.[INITIAL_VIEW_KEY];

    this.seeded = initialView !== undefined;
    const me = (): string | null => this.config.people?.me?.() ?? null;
    const page = (): string | null => this.thisPage;

    this.source = sourceRefOf(data);
    this.stubSchema = Array.isArray(data?.schema) ? structuredClone(data.schema) : [];
    this.linkPicker = this.source === undefined && (data as Record<string, unknown> | undefined)?.[LINK_PICKER_KEY] === true;
    // Only a user's insert: a load, undo, redo or a peer's insert never opens it. Form opens none (research/28 §3).
    this.offerNewDatabasePanel = origin === 'user' && this.seeded && !this.linkPicker && initialView !== 'form';
    this.aloneSkipsPanel = (data as Record<string, unknown> | undefined)?.[ALONE_SKIPS_PANEL_KEY] === true;
    // research/28 §3: written once, by the inserting client only, so peers never add a second set.
    this.sampleCardsPending = origin === 'user' && initialView === 'timeline';
    if (origin === 'user' && initialView === 'form' && this.title === '') this.title = this.api.i18n.t('tools.database.seedNewForm');
    // A pasted or duplicated copy brings rows with new ids that no backend has yet.
    this.copiedRowsPending = origin === 'paste';
    // An adapter that does not store a view's own order keeps the shared one.
    const viewRowOrder = this.config.adapter === undefined || this.config.adapter.viewRowOrder === true;

    const seedLayout = RENDERED_LAYOUTS.find((layout) => layout === initialView);

    this.model = new DatabaseModel(data, seedLayout !== undefined
      ? { defaultViewType: seedLayout, idSeed: block.id, me, page, databaseId: this.dataId, viewRowOrder }
      : { me, page, databaseId: this.dataId, viewRowOrder });
    this.computedValues = new ComputedProperties(this.dataId);
    this.pullLinkedSchema();
    this.model.setValueProperty((property) => this.computedValues.valueProperty(property));
    const views = this.model.getViews();
    this.activeViewId = consumeViewLink((viewId) => this.model.getView(viewId) !== undefined)
      ?? (data as DatabaseData | undefined)?.activeViewId ?? (views.length > 0 ? views[0].id : '');

    this.builtInComments = new BuiltInCommentsUi({
      api: this.api,
      locale: () => editorLocale(this.api.i18n),
      me: () => this.config.people?.me?.() ?? null,
      personName: (id) => this.people?.find((person) => person.id === id)?.name,
      permitted: () => this.config.comments === undefined && this.permits('comment'),
      // A source in another document has no row blocks here to write to.
      readOnly: () => this.editorReadOnly || this.source?.documentId !== undefined,
      onChange: () => {
        const lever = this.commentBadgeLever().commentBadges;

        if (!this.destroyed && lever !== undefined && this.element !== null) refreshCommentBadges(this.element, lever, this.api.i18n);
      },
    });
    this.hostLevers = new DatabaseHostLevers({
      databaseId: block.id,
      isDestroyed: () => this.destroyed,
      canTriggerAutomations: () => !this.model.isDatabaseLocked(),
      savedAutomations: () => this.savedAutomations,
      schema: () => this.model.getSchema(),
      rowValues: (rowId) => this.model.getRow(rowId)?.properties,
      writeHostValues: (rowId, changes) => this.writeHostValues(rowId, changes),
      addRow: (properties) => this.addHostRow(properties),
      fillingChanged: (rowId, propertyId) => this.repaintAutofillCell(rowId, propertyId),
      matchesView: (rowId, viewId) => {
        const view = this.model.getView(viewId);

        return view !== undefined && this.model.queryRows({ view }).rows.some((row) => row.id === rowId);
      },
    }, this.config.automations, this.config.ai);
    this.activateView(this.activeViewId);
    this.api.events.on('block changed', this.handleBlockChanged);
    this.api.events.on('block replayed', this.handleBlockReplayed);
    this.api.events.on(DATABASE_RENDERED_EVENT, this.handleDatabaseRendered);
    this.api.events.on(DATABASE_GONE_EVENT, this.handleDatabaseGone);
    this.api.events.on('block changed', this.handleBodyEdit);
    this.api.events.on('block changed', this.handleAgentRowWrite);
    this.api.events.on('block changed', this.scheduleBacklinks);
    this.builtInComments.listen();
    this.api.events.on('block replayed', this.scheduleBacklinks);
    this.api.events.on('collaboration:status', this.handleCollaborationStatus);
  }

  /**
   * "When page content is edited": a local edit of a block under one of this
   * database's rows. Undo and redo carry a `replaySource`; a peer or another
   * tab carries another origin. Only content changes count: an added or
   * removed block may be the tool's own write (template, duplicate, migration).
   * The row block itself is skipped, so a property write never counts.
   */
  private readonly handleBodyEdit = (payload: unknown): void => {
    const event = (payload as { event?: { type?: unknown; detail?: { origin?: unknown; replaySource?: unknown; target?: ChangedBlock } } } | undefined)?.event;

    if (this.linked || this.destroyed || this.config.ai?.autofill === undefined || event?.type !== 'block-changed'
      || event.detail?.origin !== 'local' || event.detail.replaySource !== undefined
      || !this.model.getSchema().some((property) => property.autofill?.onEditContent === true)) return;
    // A comment is not page content (18-comments-design §4).
    if (isAnnotationType(event.detail.target?.name)) return;
    const row = this.nearestRow(event.detail.target?.parentId, new Set());

    // Another database's row or a template reads no values, so it fills nothing.
    if (row !== undefined) this.hostLevers.bodyEdited(row);
  };

  /**
   * An agent's row write fires what the person's own write fires (the sync:
   * adapter, automations, autofill). Its row changes reach the tool as block
   * events, not through the tool's methods. Only the owning database: a
   * linked view shows the same rows and would fire them twice.
   */
  private readonly handleAgentRowWrite = (payload: unknown): void => {
    const event = (payload as { event?: { type?: unknown; detail?: AgentChangeDetail } } | undefined)?.event;
    const detail = event?.detail;
    const target = detail?.target;

    if (this.source !== undefined || detail?.agent === undefined || detail.origin !== 'local' || detail.replaySource !== undefined
      || typeof target?.id !== 'string') return;
    if (target.name === 'database' && target.id === this.block.id && event?.type === 'block-changed') {
      this.syncAgentRowOrders();

      return;
    }
    if (target.name !== 'database-row') return;
    const rowId = target.id;

    if (event?.type === 'block-moved') {
      this.syncAgentRelocation(rowId, detail.oldParentId, detail.parentId);

      return;
    }
    if (event?.type === 'block-changed' && target.parentId === this.dataId) {
      // Read now: the model still holds the values from before this write.
      const before = this.model.getRow(rowId) ?? this.templates.find((template) => template.id === rowId);
      const data = this.liveRowData(rowId);
      const changes = Object.fromEntries(Object.entries(data?.properties ?? {})
        .filter(([propertyId, value]) => JSON.stringify(value) !== JSON.stringify(before?.properties[propertyId] ?? null)));

      if (this.destroyed || this.readOnly) return;
      if (Object.keys(changes).length > 0) this.sync.syncUpdateRow({ rowId, properties: changes });
      // A write the same batch then moves to another database is part of that move: the move's delete covers it.
      if (before !== undefined && typeof data?.position === 'string' && data.position !== before.position && !this.leavesWith(detail.agent)) {
        void this.sync.syncMoveRow({ rowId, position: data.position });
      }

      return;
    }
    if (event?.type !== 'block-added') return;
    // An insert sets the parent after its event.
    queueMicrotask(() => {
      const data = this.liveRowData(rowId);

      if (this.destroyed || this.readOnly || data === undefined || this.api.blocks.getById(rowId)?.parentId !== this.dataId) return;
      void this.sync.syncCreateRow({ id: rowId, properties: { ...data.properties }, position: data.position, ...(isTemplateData(data) ? { template: true } : {}) });
    });
  };

  private leavesWith(agent: unknown): boolean {
    return typeof agent === 'object' && agent !== null && 'movingTo' in agent && agent.movingTo !== this.dataId;
  }

  /** A view's own row order the agent changed goes to the backend, as placeRow sends it. */
  private syncAgentRowOrders(): void {
    if (this.destroyed || this.readOnly) return;
    const views = (this.block.preservedData as Partial<DatabaseData> | undefined)?.views ?? [];

    views.forEach((view) => {
      const before = this.model.getView(view.id);

      if (before === undefined || view.rowOrder === undefined || JSON.stringify(view.rowOrder) === JSON.stringify(before.rowOrder)) return;
      void this.sync.syncUpdateView({ viewId: view.id, changes: { rowOrder: structuredClone(view.rowOrder) } });
    });
  }

  /** As moveRowTo: the old database deletes the row from its backend, the new one adopts it. */
  private syncAgentRelocation(rowId: string, from: string | null | undefined, to: string | null | undefined): void {
    if (this.destroyed || this.readOnly || from === to) return;
    if (from === this.dataId) {
      void this.sync.syncDeleteRow({ rowId }, true);

      return;
    }
    if (to === this.dataId) queueMicrotask(() => this.adoptMovedRow({ rowId }));
  }

  private liveRowData(rowId: string): DatabaseRowData | undefined {
    const row = this.api.blocks.getById(rowId);
    const live: DatabaseRowData[] = [];

    row?.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });

    return live[0] ?? row?.preservedData as DatabaseRowData | undefined;
  }

  /**
   * A block changed while a row page is open: count its backlinks again once
   * edits settle. Each event only resets the timer; the scan runs once.
   */
  private readonly scheduleBacklinks = (): void => {
    if (this.destroyed || this.cardDrawer?.openRowId === null || this.cardDrawer?.openRowId === undefined) return;
    if (this.backlinksTimer !== null) clearTimeout(this.backlinksTimer);
    this.backlinksTimer = setTimeout(() => {
      this.backlinksTimer = null;
      if (!this.destroyed) this.cardDrawer?.refreshBacklinks();
    }, BACKLINKS_SETTLE_MS);
  };

  /** The pages that mention the row (research/17 §2): this document's, then the host's. */
  private backlinksFor(rowId: string): DrawerBacklink[] {
    const row = this.model.getRow(rowId);

    // api.ui.nodes is read when the API is built, before the editor wrapper exists.
    const root = this.element?.closest<HTMLElement>(`[${DATA_ATTR.editor}]`) ?? null;

    if (row === undefined || this.destroyed || root === null) return [];
    const ids = [rowId, ...(row.pageId === undefined ? [] : [row.pageId])];
    const sources = scanBacklinkSources({
      root,
      rowId,
      ids,
      block: (id) => {
        const block = this.api.blocks.getById(id);

        if (block === null || block === undefined) return undefined;
        const editedAt = block.lastEditedAt ?? block.createdAt;

        return { id: block.id, name: block.name, parentId: block.parentId ?? null, ...(editedAt === undefined ? {} : { editedAt }) };
      },
    });
    const local = sources.map((source) => this.documentBacklink(source, root));
    const seen = new Set(local.flatMap((link) => link.pageIds));
    // The host gives one entry per mention, newest first: one row per page, at its first (newest) entry.
    const hostPages = new Map<string, { link: DatabaseBacklink; mentions: number }>();

    for (const link of this.hostBacklinks?.rowId === rowId ? this.hostBacklinks.items : []) {
      const page = hostPages.get(link.pageId);

      if (seen.has(link.pageId)) continue;
      if (page === undefined) hostPages.set(link.pageId, { link, mentions: 1 });
      else page.mentions += 1;
    }
    const hosted = [...hostPages.values()].map(({ link, mentions }): DrawerBacklink => ({
      key: `host-${link.pageId}`,
      title: link.title !== undefined && link.title.trim() !== '' ? link.title : this.api.i18n.t('tools.database.relationUntitled'),
      path: link.path ?? [],
      mentions,
      open: () => this.config.backlinks?.open(link),
    }));

    if (this.hostBacklinks?.rowId !== rowId) void this.loadHostBacklinks(rowId, row.pageId);

    return [...local.map((link) => link.item), ...hosted];
  }

  /** Asks the host once per opened row; a late answer for a row no longer open is dropped. */
  private async loadHostBacklinks(rowId: string, pageId: string | undefined): Promise<void> {
    const lever = this.config.backlinks;

    if (lever === undefined) return;
    const request = { rowId, items: [] as Awaited<ReturnType<typeof lever.list>> };

    this.hostBacklinks = request;
    try {
      const items = await lever.list({ databaseId: this.dataId, rowId, ...(pageId === undefined ? {} : { pageId }) });

      if (this.hostBacklinks !== request || this.destroyed || !Array.isArray(items)) return;
      request.items = items.filter((item) => typeof item?.pageId === 'string' && item.pageId !== '');
    } catch {
      return;
    }
    if (this.cardDrawer?.openRowId === rowId) this.cardDrawer.refreshBacklinks();
  }

  /** A page of this document that mentions the row: another row's page, or the document itself. */
  private documentBacklink(source: BacklinkSource, root: HTMLElement): { item: DrawerBacklink; pageIds: string[] } {
    const untitled = this.api.i18n.t('tools.database.relationUntitled');
    const go = (): void => {
      const target = source.blockId;

      // Next frame: the row's body is attached to its page by then.
      requestAnimationFrame(() => this.api.blocks.scrollToBlock?.(target, { select: false }));
    };

    if (source.rowId === null) {
      // The title may be mounted outside the editor; then the page reads "Untitled".
      const title = root.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent?.trim() ?? '';

      return {
        item: { key: 'document', title: title === '' ? untitled : title, path: [], mentions: source.mentions, open: () => { this.cardDrawer?.close(); go(); } },
        pageIds: [],
      };
    }
    const rowId = source.rowId;
    const rowBlock = this.api.blocks.getById(rowId);
    const live: DatabaseRowData[] = [];

    rowBlock?.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });
    const data = live[0];
    const databaseId = rowBlock?.parentId ?? null;
    const databaseTitle = databaseId === this.dataId ? this.title
      : this.api.blocks.getById(databaseId ?? '')?.preservedData.title;
    const title = typeof data?.title === 'string' && data.title.trim() !== '' ? data.title : untitled;

    return {
      item: {
        key: rowId,
        title,
        mentions: source.mentions,
        path: [typeof databaseTitle === 'string' && databaseTitle.trim() !== '' ? databaseTitle : this.api.i18n.t('tools.database.relationUntitledDatabase')],
        ...(typeof data?.icon === 'string' && data.icon !== '' ? { icon: data.icon } : {}),
        open: () => {
          if (databaseId !== this.dataId) this.cardDrawer?.close();
          if (databaseId !== null) this.api.blocks.getById(databaseId)?.call('openRow', { rowId });
          go();
        },
      },
      pageIds: [rowId, ...(typeof data?.pageId === 'string' ? [data.pageId] : [])],
    };
  }

  /** The nearest database-row at or above `id`: a nested database's row body belongs to that database. */
  private nearestRow(id: unknown, seen: Set<string>): string | undefined {
    if (typeof id !== 'string' || seen.has(id)) return undefined;
    seen.add(id);
    const block = this.api.blocks.getById(id);

    if (block === null || block === undefined) return undefined;

    return block.name === 'database-row' ? block.id : this.nearestRow(block.parentId, seen);
  }

  /** The linked source's tool went away: deleted, or the editor closing. Redraw once its block is gone. */
  private readonly handleDatabaseGone = (payload: unknown): void => {
    const databaseId = (payload as { databaseId?: unknown } | undefined)?.databaseId;

    if (this.destroyed || this.source === undefined || databaseId !== this.source.databaseId) return;
    queueMicrotask(() => {
      if (this.destroyed || !this.sourceMissing()) return;
      this.rebuildTabBar();
      this.rerenderView();
    });
  };

  /**
   * A linked view with no source yet (findings-creation N18): a Table view
   * pill, the folder glyph, "New table" and the button that opens the source
   * panel. The block's title and toolbar hide (CSS on data-blok-database-unlinked).
   */
  private renderSourcePicker(): HTMLDivElement {
    const picker = document.createElement('div');
    const pill = document.createElement('span');
    const glyph = document.createElement('span');
    const caption = document.createElement('span');
    const button = document.createElement('button');
    const t = (key: string): string => this.api.i18n.t(key);

    picker.setAttribute('data-blok-database-source-picker', '');
    pill.setAttribute('data-blok-database-source-picker-pill', '');
    pill.innerHTML = VIEW_ICONS.table;
    pill.append(t('tools.database.viewTypeTable'));
    glyph.setAttribute('data-blok-database-source-picker-glyph', '');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = IconFolderQuestion;
    caption.setAttribute('data-blok-database-source-picker-caption', '');
    caption.textContent = t('tools.database.csvNewTable');
    button.type = 'button';
    button.textContent = t('tools.database.linkedLinkSource');
    button.disabled = this.readOnly;
    button.addEventListener('click', () => this.openSourcePicker());
    picker.append(pill, glyph, caption, button);

    return picker;
  }

  /** "Linked view of data source" (research 20 §2a): pick a source, then the first view. */
  private openSourcePicker(): void {
    // The title row is hidden while the view has no source.
    const anchor = this.element;

    if (this.readOnly || this.sourcePicker !== null || anchor === null) return;

    this.sourcePicker = openLinkedPicker({
      anchor,
      t: (key, vars) => this.api.i18n.t(key, vars),
      sources: () => this.pickerSources(),
      ...(this.config.linkedSources?.search !== undefined ? { remoteSources: (query: string) => this.remotePickerSources(query) } : {}),
      views: (source) => (source.documentId === undefined ? this.sourceViews(source.id) : this.remoteSnapshot?.views ?? [])
        .filter((view) => view.type !== 'form' && view.type !== 'dashboard'),
      newEmpty: (title) => this.unlinkPicker(title),
      pickSource: (source) => (source.documentId === undefined ? this.linkTo(source.id) : this.linkToRemote(source.documentId, source)),
      newTableView: () => {
        const view = this.model.addView(DATABASE_DEFAULT_TEXT.viewTypeTable, 'table');

        this.replaceLinkedView({ ...view, position: 'a0' });
      },
      copyView: (view) => this.replaceLinkedView({ ...structuredClone(view), id: nanoid(), position: 'a0' }),
      onClose: () => {
        this.sourcePicker = null;
      },
    });
  }

  /**
   * Every block of the document is this block or one of its rows. Notion's two
   * samples do not tell "first block", "empty page" and "first database" apart
   * (research/30 B7a), so the skip needs all three.
   */
  private aloneInDocument(): boolean {
    const inThisBlock = (block: BlockAPI | null | undefined, seen = new Set<string>()): boolean => {
      if (block === null || block === undefined || seen.has(block.id)) return false;
      if (block.id === this.block.id) return true;
      seen.add(block.id);

      return block.parentId !== null && inThisBlock(this.api.blocks.getById(block.parentId), seen);
    };

    return Array.from({ length: this.api.blocks.getBlocksCount() }, (_, index) => this.api.blocks.getBlockByIndex(index))
      .every((block) => inThisBlock(block));
  }

  /**
   * research/26 §2, research/20 §1a: a new database's panel. The AI prompt box
   * is on top only with the host's ai.setupDatabase. Closing it keeps the empty database.
   */
  private openNewDatabasePanel(): void {
    const anchor = this.titleRowElement ?? this.element;

    if (this.readOnly || this.structureLocked() || this.sourcePicker !== null || anchor === null) return;
    const panel = openNewSourcePanel({
      anchor,
      t: (key, vars) => this.api.i18n.t(key, vars),
      sources: () => this.pickerSources(),
      linkExisting: (id) => this.linkTo(id),
      newDatabase: true,
      ...(this.config.ai?.setupDatabase !== undefined ? { prompt: { submit: (text: string) => this.setupFromPrompt(text) } } : {}),
      importCsv: () => this.openCsvImport((file, targets, settings) => this.importCsvHere(file.text, targets, settings)),
      starters: {
        list: suggestedStarters(this.usedStarters()).map((starter) => ({
          id: starter.id,
          label: this.api.i18n.t(starter.nameKey),
          icon: ICON_GLYPHS[starter.glyph],
          tint: starter.tint,
        })),
        pick: (id) => this.pickStarter(id),
        more: () => this.openTemplateGallery(),
      },
      onClose: () => {
        if (this.sourcePicker === panel) this.sourcePicker = null;
      },
    });

    this.sourcePicker = panel;
  }

  /**
   * "Import CSV" in the "New database" panel: this database takes the file's
   * columns and rows, in one undo step. research/27 §2: the title stays as it was.
   */
  private importCsvHere(text: string, targets?: CsvColumnTarget[], settings?: CsvImportSettings): void {
    if (this.destroyed || this.readOnly || this.structureLocked()) return;
    const table = parseCsv(text);

    if (table.length === 0) {
      this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvEmpty') });

      return;
    }
    const built = this.csvBlocks(table, targets, settings);
    // The title property keeps its id: a backend already has it.
    const titleId = this.titlePropertyId();
    const newTitle = built.data.schema.find((p) => p.type === 'title')?.id;
    const remap = (id: string): string => (id === newTitle && titleId !== '' ? titleId : id);
    const schema = built.data.schema.map((p) => ({ ...p, id: remap(p.id) }));
    const views = built.data.views.map((view) => ({ ...view, visibleProperties: view.visibleProperties.map(remap) }));
    const rows = built.rows.map((row) => ({
      ...row,
      data: { ...row.data, properties: Object.fromEntries(Object.entries(row.data.properties).map(([id, value]) => [remap(id), value])) },
    }));
    const oldSchema = this.model.getSchema();
    const oldViews = this.model.getViews();

    this.inOneStep(() => {
      this.dropSampleCards();
      // The definition first: a database write inside a row insert's sync window reads as an echo.
      this.writeDefinition({ schema, views, activeViewId: built.data.activeViewId });
      for (const row of rows) {
        this.api.blocks.insertAt('database-row', row.data, { parentId: this.dataId, position: 'end', id: row.id });
      }
    });
    this.syncDefinition(oldSchema, oldViews, schema, views);
    for (const row of rows) void this.sync.syncCreateRow({ id: row.id, properties: row.data.properties, position: row.data.position });
    this.syncRowsFromBlocks();
    this.rebuildTabBar();
    this.rerenderView();
    this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvImported', { count: rows.length }) });
  }

  /** Asks the host to set this database up. True when it did. */
  private async setupFromPrompt(prompt: string): Promise<boolean> {
    const setup = this.config.ai?.setupDatabase;

    if (setup === undefined) return false;
    const answer = await setup({
      databaseId: this.block.id,
      prompt,
      schema: structuredClone(this.model.getSchema()),
      views: structuredClone(this.model.getViews()),
    }).catch((error: unknown) => {
      this.api.notifier.show({ message: this.api.i18n.t('assistant.failed', { error: error instanceof Error ? error.message : String(error) }), style: 'error' });

      return null;
    });

    if (this.destroyed || this.readOnly || this.structureLocked()) return false;
    const plan = planAiSetup({ schema: this.model.getSchema(), views: this.model.getViews() }, answer, () => nanoid());

    if (plan === null) return false;
    const oldSchema = this.model.getSchema();
    const oldViews = this.model.getViews();

    this.inOneStep(() => {
      this.dropSampleCards();
      this.writeDefinition(plan);
    });
    this.syncDefinition(oldSchema, oldViews, plan.schema, plan.views);
    this.rebuildTabBar();
    this.rerenderView();

    return true;
  }

  /** A new definition and title, written into the block. */
  private writeDefinition(plan: { schema: PropertyDefinition[]; views: DatabaseViewConfig[]; activeViewId: string; title?: string }): void {
    this.model.replaceDefinition({ schema: plan.schema, views: plan.views });
    this.activeViewId = plan.activeViewId;
    if (plan.title !== undefined) {
      this.title = plan.title;
      if (this.titleElement !== null) {
        this.titleElement.textContent = plan.title;
        DatabaseTool.syncTitleDirection(this.titleElement);
      }
    }
    this.block.dispatchChange();
  }

  /** Templates a database of this document was made from. */
  private usedStarters(): Set<StarterId> {
    const used = new Set<StarterId>();

    if (this.starter !== undefined) used.add(this.starter);
    for (const database of this.documentDatabases().filter((entry) => entry.id !== this.dataId)) {
      const block = this.api.blocks.getById(database.id);
      const read: Array<StarterId | undefined> = [];

      // The live tool answers; a block whose tool never ran keeps its saved data.
      block?.call('readStarter', { receive: (id: StarterId | undefined) => read.push(id) });
      const id = read.length > 0 ? read[0] : starterOf(block?.preservedData);

      if (id !== undefined) used.add(id);
    }

    return used;
  }

  /** Another database asks which template made this one. */
  readStarter(param: { receive: (id: StarterId | undefined) => void }): void {
    param.receive(this.starter);
  }

  /** "More templates" (research/27 §1e): Empty database keeps this one empty, a source links to it. */
  private openTemplateGallery(): void {
    if (this.readOnly || this.structureLocked()) return;
    const t = (key: string, vars?: Record<string, string>): string => this.api.i18n.t(key, vars);

    openTemplateGallery({
      t,
      templates: galleryStarters(this.usedStarters()).map((starter) => ({
        id: starter.id,
        name: t(starter.nameKey),
        description: t(starter.descriptionKey),
        icon: ICON_GLYPHS[starter.glyph],
        tint: starter.tint,
        columns: starter.thumbnail.columns.map((key) => t(key)),
        // A status pill carries Notion's dot (findings-creation N07).
        pills: starter.thumbnail.pills.map(([key, color]) => ({ label: t(key), color, ...(key.startsWith('tools.database.defaultStatus') ? { dot: true } : {}) })),
        ...(starter.thumbnail.pillColumn === undefined ? {} : { pillColumn: starter.thumbnail.pillColumn }),
      })),
      sources: this.pickerSources(),
      onEmpty: () => undefined,
      onSource: (id) => this.linkTo(id),
      onTemplate: (id) => this.pickStarter(id, true),
      directionSource: this.element,
    });
  }

  /** A Suggested template picked in the "New database" panel (research/27 §1). Skills has no Customize step. */
  private pickStarter(id: string, fromGallery = false): void {
    const meta = DATABASE_STARTERS.find((starter) => starter.id === id);

    if (meta === undefined) return;
    if (meta.features.length === 0) {
      this.createFromStarter(meta.id);

      return;
    }
    void openStarterCustomize({
      meta,
      t: (key, vars) => this.api.i18n.t(key, vars),
      preview: (picks) => buildStarter(meta.id, { t: (key, vars) => this.api.i18n.t(key, vars), newId: () => nanoid(), titleId: this.titlePropertyId(), ...picks }),
      ...(fromGallery ? { onBack: () => this.openTemplateGallery() } : {}),
      directionSource: this.element,
    }).then((picks) => {
      if (picks !== null) this.createFromStarter(meta.id, picks);
    });
  }

  /** The template's schema, views, rows and row bodies, as one undo step. */
  private createFromStarter(id: StarterId, picks?: StarterPicks): void {
    if (this.destroyed || this.readOnly || this.structureLocked()) return;
    const made = buildStarter(id, { t: (key, vars) => this.api.i18n.t(key, vars), newId: () => nanoid(), titleId: this.titlePropertyId(), ...picks });
    const oldSchema = this.model.getSchema();
    const oldViews = this.model.getViews();

    this.inOneStep(() => {
      this.dropSampleCards();
      this.databaseIcon = made.icon;
      this.starter = id;
      delete this.unknown.icon;
      delete this.unknown.starter;
      this.paintDatabaseIcon();
      // The definition first: a database write inside a row insert's sync window reads as an echo.
      this.writeDefinition(made);
      for (const row of [...made.rows, ...made.templates]) {
        this.api.blocks.insertAt('database-row', row.data, { parentId: this.dataId, position: 'end', id: row.id });
        for (const block of row.body.filter((b) => this.api.tools.isInstalled(b.tool))) {
          this.api.blocks.insertAt(block.tool, block.data, { parentId: row.id, position: 'end' });
        }
      }
    });
    this.syncDefinition(oldSchema, oldViews, made.schema, made.views);
    for (const row of made.rows) void this.sync.syncCreateRow({ id: row.id, properties: row.data.properties, position: row.data.position });
    for (const row of made.templates) void this.sync.syncCreateRow({ id: row.id, properties: row.data.properties, position: row.data.position, template: true });
    this.syncRowsFromBlocks();
    this.rebuildTabBar();
    this.rerenderView();
  }

  private starterRow(): StarterRow | undefined {
    if (this.readOnly) return undefined;
    const meta = DATABASE_STARTERS.find((starter) => starter.id === this.starter);
    const t = (key: string): string => this.api.i18n.t(key);

    if (meta?.undoKey !== undefined) return { kind: 'undo', label: t(meta.undoKey), onClick: () => void this.undoStarter(meta) };

    return {
      kind: 'turnInto',
      label: t('tools.database.starterTurnInto'),
      choices: [
        { label: t('tools.database.starterTurnIntoTasks'), testId: 'database-settings-turn-into-tasks' },
        { label: t('tools.database.starterTurnIntoSkills'), testId: 'database-settings-turn-into-skills' },
      ],
    };
  }

  /**
   * "Undo … database" (research/33 §3.10): asks first, then drops only the
   * Tasks / Skills designation. Title, icon, views, properties and rows stay.
   */
  private async undoStarter(meta: StarterMeta): Promise<void> {
    const t = (key: string): string => this.api.i18n.t(key);
    const confirmed = await openDatabaseConfirm({
      title: t(meta.undoTitleKey ?? meta.undoKey ?? ''),
      ...(meta.undoDescriptionKey === undefined ? {} : { description: t(meta.undoDescriptionKey) }),
      confirmLabel: t('tools.database.starterUndoRemove'),
      cancelLabel: t('tools.database.optionDeleteCancel'),
      destructive: true,
      focusConfirm: true,
      directionSource: this.element,
    });

    // The dialog is async: the database may have changed under it.
    if (!confirmed || this.destroyed || this.readOnly || this.structureLocked() || this.starter !== meta.id) return;
    this.inOneStep(() => {
      this.starter = undefined;
      delete this.unknown.starter;
      this.block.dispatchChange();
    });
  }

  /**
   * research/28 §3: a new timeline shows "Card 1" to "Card 3". Measured with
   * today on Oct 20: Oct 15–19, 17–21 and 19–23. Status and Assign stay empty
   * (their values were not read).
   */
  private addSampleCards(): void {
    const date = this.model.getSchema().find((p) => p.type === 'date');
    const titleId = this.titlePropertyId();

    if (this.readOnly || date === undefined || titleId === '') return;
    const today = toIsoDay(new Date());
    const rows = [[-5, -1], [-3, 1], [-1, 3]].map(([from, to], index) => {
      const title = this.api.i18n.t('tools.database.seedCard', { number: index + 1 });
      const properties: Record<string, PropertyValue> = { [titleId]: title, [date.id]: formatDateValue({ start: addDays(today, from), end: addDays(today, to) }) };

      for (const p of this.model.getSchema()) if (isListValueType(p.type)) properties[p.id] = [];

      return { id: nanoid(), data: { properties, title, position: `a${index}` } };
    });

    this.inOneStep(() => {
      for (const row of rows) this.api.blocks.insertAt('database-row', row.data, { parentId: this.dataId, position: 'end', id: row.id });
    });
    this.sampleCardIds = rows.map((row) => row.id);
    for (const row of rows) void this.sync.syncCreateRow({ id: row.id, properties: row.data.properties, position: row.data.position });
    this.syncRowsFromBlocks();
    this.rerenderView();
  }

  /** Call inside the step that replaces the definition. */
  private dropSampleCards(): void {
    const ids = this.sampleCardIds;

    this.sampleCardIds = [];
    for (const id of ids) this.removeRowBlock(id);
  }

  /** The backend gets a diff: an echoed id is an update, never a second create. */
  private syncDefinition(oldSchema: PropertyDefinition[], oldViews: DatabaseViewConfig[], schema: PropertyDefinition[], views: DatabaseViewConfig[]): void {
    const plan = { schema, views };
    const before = new Map(oldSchema.map((p) => [p.id, p]));
    const after = new Set(plan.schema.map((p) => p.id));

    for (const p of plan.schema) {
      const was = before.get(p.id);

      if (was === undefined) {
        void this.sync.syncCreateProperty({ id: p.id, name: p.name, type: p.type, position: p.position, ...(p.config !== undefined ? { config: p.config } : {}) });
      } else if (JSON.stringify([was.name, was.type, was.config]) !== JSON.stringify([p.name, p.type, p.config])) {
        void this.sync.syncUpdateProperty({ propertyId: p.id, changes: {
          ...(was.name !== p.name ? { name: p.name } : {}),
          ...(was.type !== p.type ? { type: p.type } : {}),
          ...(JSON.stringify(was.config) !== JSON.stringify(p.config) ? { config: p.config } : {}),
        } });
      }
    }
    for (const p of oldSchema.filter((candidate) => !after.has(candidate.id))) void this.sync.syncDeleteProperty({ propertyId: p.id });
    // New views first, so the backend never holds a database without one.
    for (const view of plan.views) void this.sync.syncCreateView(structuredClone(view));
    for (const view of oldViews) void this.sync.syncDeleteView({ viewId: view.id });
  }

  /** The host's databases in other documents, for the picker. */
  private async remotePickerSources(query: string): Promise<LinkedPickerSource[]> {
    const search = this.config.linkedSources?.search;
    const hits = search === undefined ? [] : await search({ query });
    const untitled = this.api.i18n.t('tools.database.relationUntitled');

    return hits.map((hit) => ({
      id: hit.databaseId,
      documentId: hit.documentId,
      title: hit.title,
      parent: hit.path === undefined || hit.path.trim() === '' ? untitled : hit.path,
    }));
  }

  /**
   * Turns this block into a linked view of a database in another document.
   * Only the pointer is saved: the host's `resolve` hands the rows over.
   */
  private async linkToRemote(documentId: string, picked: LinkedPickerSource): Promise<void> {
    if (this.readOnly) return;
    const title = this.model.getSchema().find((p) => p.type === 'title');

    this.stubSchema = title === undefined ? [] : [structuredClone(title)];
    this.source = { databaseId: picked.id, documentId };
    this.linkPicker = false;
    this.lastSourceTitle = picked.title;
    const view: DatabaseViewConfig = { id: nanoid(), name: this.api.i18n.t('tools.database.viewTypeTable'), type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

    this.model.replaceDefinition({ schema: this.model.getSchema(), views: [view] });
    this.model.setRows([]);
    this.activeViewId = view.id;
    this.remotePlaceholderView = view.id;
    this.block.dispatchChange();
    this.rebuildTabBar();
    this.rerenderView();
    await this.watchRemoteSource();
  }

  /** The databases a linked view can show, each with the page it sits on. */
  private pickerSources(): LinkedPickerSource[] {
    const root = this.element?.closest<HTMLElement>(`[${DATA_ATTR.editor}]`) ?? null;
    // The title may be mounted outside the editor; then the page reads "Untitled".
    const pageTitle = root?.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent?.trim() ?? '';
    const untitled = this.api.i18n.t('tools.database.relationUntitled');

    return this.documentDatabases()
      .filter((database) => database.id !== this.block.id && !this.isLinkedBlock(database.id))
      .map((database) => {
        const rowId = this.nearestRow(this.api.blocks.getById(database.id)?.parentId, new Set());
        const live: DatabaseRowData[] = [];

        if (rowId !== undefined) this.api.blocks.getById(rowId)?.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });
        const parent = rowId === undefined ? pageTitle : live[0]?.title?.trim() ?? '';

        return { id: database.id, title: this.databaseTitleOf(database.id) ?? database.title, parent: parent === '' ? untitled : parent };
      });
  }

  /** Another database's name as typed now, else as saved. */
  private databaseTitleOf(databaseId: string): string | undefined {
    const block = this.api.blocks.getById(databaseId);
    const titles: string[] = [];

    block?.call('readTitle', { receive: (title: string) => titles.push(title) });
    const title: unknown = titles[0] ?? block?.preservedData.title;

    return typeof title === 'string' ? title : undefined;
  }

  /** "New empty data source": this block stays an ordinary database, named after the search. */
  private unlinkPicker(title: string): void {
    if (this.readOnly || !this.linkPicker) return;
    this.linkPicker = false;
    if (title !== '') {
      this.title = title;
      if (this.titleElement !== null) {
        this.titleElement.textContent = title;
        DatabaseTool.syncTitleDirection(this.titleElement);
      }
      this.block.dispatchChange();
    }
    this.rerenderView();
  }

  /** The linked view's one view, picked on the "New view" page. */
  private replaceLinkedView(view: DatabaseViewConfig): void {
    // A source in another document always reads read-only; the block's own views are still its own.
    if ((this.source?.documentId === undefined ? this.readOnly : this.ownReadOnly) || !this.linked) return;
    this.remotePlaceholderView = null;
    this.model.replaceDefinition({ schema: this.model.getSchema(), views: [view] });
    this.activeViewId = view.id;
    this.block.dispatchChange();
    this.rebuildTabBar();
    this.rerenderView();
  }

  /**
   * A linked view's title (research 20 §2b): "↗ <source name>", a link to
   * the source, never editable. A deleted source keeps its last name, unlinked.
   */
  private paintLinkedTitle(): void {
    const titleEl = this.titleElement;

    if (titleEl === null) return;
    const saved = this.shownView();

    // "Show data source title" (research/20 §1f, R-2022-03-15). The title row stays: it can hold the add-view "+".
    const hidden = this.fullPage || this.dataSourceTitlesHidden
      || (this.linked && saved !== undefined && this.controls.effective(saved).showDataSourceTitle === false);
    const source = this.linked ? this : this.activeSource();

    titleEl.hidden = hidden || source !== this;
    this.paintSourceTitle(source === this ? undefined : source, hidden);
    if (!this.linked || this.source === undefined) return;
    const missing = this.sourceMissing();
    const live = missing || this.source.documentId !== undefined ? undefined : this.databaseTitleOf(this.source.databaseId);

    if (live !== undefined) this.lastSourceTitle = live;
    const name = this.lastSourceTitle.trim() !== '' ? this.lastSourceTitle : this.api.i18n.t('tools.database.relationUntitledDatabase');
    const target = this.source.databaseId;
    const tag = missing || this.source.documentId !== undefined ? 'span' : 'a';
    const shown = titleEl.querySelector('[data-blok-database-linked-title]');

    // Same name, same target: keep the DOM, so a redraw makes no title mutation.
    if (shown?.localName === tag && shown.textContent?.trim() === name && shown.getAttribute('data-database-id') === target) return;
    const label = document.createElement(tag);
    const arrow = document.createElement('span');

    titleEl.removeAttribute('contenteditable');
    titleEl.style.cursor = 'default';
    label.setAttribute('data-blok-database-linked-title', '');
    label.setAttribute('data-database-id', target);
    arrow.setAttribute('data-blok-database-linked-arrow', '');
    arrow.innerHTML = IconArrowDiagonal;
    label.append(arrow, name);
    if (label instanceof HTMLAnchorElement) {
      // No href: the source is a block of this page, reached by scrolling.
      label.setAttribute('role', 'link');
      label.tabIndex = 0;
      const go = (): void => {
        this.api.blocks.scrollToBlock?.(target, { select: false });
        // WebKit does not focus a clicked link.
        label.focus({ preventScroll: true });
      };

      label.addEventListener('click', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        go();
      });
      label.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        go();
      });
    }
    titleEl.replaceChildren(label);
    DatabaseTool.syncTitleDirection(titleEl);
  }

  /**
   * A view on a second source shows that source's title (research/23 §10).
   * Its own element: save() reads this block's title from titleElement.
   */
  private paintSourceTitle(source: DatabaseTool | undefined, hidden: boolean): void {
    const titleEl = this.titleElement;

    if (source === undefined || titleEl === null) {
      this.sourceTitleElement?.remove();
      this.sourceTitleElement = null;

      return;
    }
    const name = source.titleElement?.textContent ?? source.title;
    const shown = this.sourceTitleElement?.getAttribute('data-database-id') === source.block.id ? this.sourceTitleElement : null;
    const el = shown ?? this.createSourceTitle(source);

    if (shown === null) {
      this.sourceTitleElement?.remove();
      this.sourceTitleElement = el;
      titleEl.after(el);
    }
    // Never under the caret: a redraw while typing would move it.
    if (el.textContent !== name && document.activeElement !== el) {
      el.textContent = name;
      DatabaseTool.syncTitleDirection(el);
    }
    el.hidden = hidden;
  }

  private createSourceTitle(source: DatabaseTool): HTMLElement {
    const el = this.createTitleElement();

    el.setAttribute('data-blok-database-source-title', '');
    el.setAttribute('data-database-id', source.block.id);
    const placeholder = this.api.i18n.t('tools.database.newDataSource');

    el.setAttribute('data-placeholder', placeholder);
    if (el.hasAttribute('aria-placeholder')) el.setAttribute('aria-placeholder', placeholder);
    // Another database's name is renamed there, never from a view here.
    const ownSource = this.api.blocks.getById(source.block.id)?.parentId === this.block.id;

    if (!ownSource || !source.titleEditable()) el.removeAttribute('contenteditable');
    if (ownSource) el.addEventListener('input', () => source.renameAsSource(el.textContent ?? ''));

    return el;
  }

  /** The title typed on a view of this source in the database that holds it. */
  private renameAsSource(title: string): void {
    if (this.destroyed || !this.titleEditable()) return;
    this.title = title;
    if (this.titleElement !== null) {
      this.titleElement.textContent = title;
      DatabaseTool.syncTitleDirection(this.titleElement);
    }
    this.block.dispatchChange();
  }

  private isLinkedBlock(blockId: string): boolean {
    const block = this.api.blocks.getById(blockId);

    return sourceRefOf(block?.preservedData as DatabaseData | undefined) !== undefined;
  }

  /**
   * Turns this block into a linked view of `databaseId`. Its first view
   * copies the source's first table view (Notion, R:2021-12-23): sorts,
   * column order and visibility.
   */
  private linkTo(databaseId: string): void {
    if (this.readOnly) return;
    const target = this.readDatabaseSource(databaseId);
    const view = this.linkedFirstView(databaseId);
    const title = this.model.getSchema().find((p) => p.type === 'title');

    this.stubSchema = title === undefined ? [] : [structuredClone(title)];
    this.source = { databaseId };
    this.linkPicker = false;
    this.inOneStep(() => {
      this.dropSampleCards();
      this.model.replaceDefinition({ schema: target?.schema ?? this.model.getSchema(), views: [view] });
      this.activeViewId = view.id;
      this.block.dispatchChange();
    });
    this.rebuildTabBar();
    this.rerenderView();
  }

  /** The source's views: live from its tool, else from its saved data. */
  private sourceViews(databaseId: string): DatabaseViewConfig[] {
    const live: DatabaseViewConfig[][] = [];

    this.api.blocks.getById(databaseId)?.call('readViews', { receive: (views: DatabaseViewConfig[]) => live.push(views) });

    return live[0] ?? (this.api.blocks.getById(databaseId)?.preservedData)?.views ?? [];
  }

  private linkedFirstView(databaseId: string): DatabaseViewConfig {
    const sourceViews = this.sourceViews(databaseId);
    const first = sourceViews.find((view) => view.type === 'table') ?? sourceViews[0];

    return first === undefined
      ? { id: nanoid(), name: this.api.i18n.t('tools.database.viewTypeTable'), type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }
      : { ...structuredClone(first), id: nanoid(), position: 'a0' };
  }

  /** Read by a linked view: this database's name as typed now. */
  readTitle(param: { receive: (title: string) => void }): void {
    if (!this.destroyed) param.receive(this.linked ? this.title : this.titleElement?.textContent ?? this.title);
  }

  /** Read by a linked view being made: this database's views, to copy the first table view. */
  readViews(param: { receive: (views: DatabaseViewConfig[]) => void }): void {
    param.receive(structuredClone(this.model.getViews()));
  }

  readDashboardOwner(param: { receive: (owner: DatabaseTool) => void }): void {
    if (!this.destroyed) param.receive(this);
  }

  private dashboardOwner(databaseId: string): DatabaseTool | undefined {
    if (databaseId === this.block.id) return this.destroyed ? undefined : this;
    const owners: DatabaseTool[] = [];

    this.api.blocks.getById(databaseId)?.call('readDashboardOwner', {
      receive: (owner: DatabaseTool) => owners.push(owner),
    });

    return owners[0];
  }

  /** Toolbar, filter bar, settings panel and the person's unsaved filters and sorts. Built on first use, after the constructor. */
  /**
   * The database block whose rows and schema this one shows: its own id, or
   * a linked database's source. Rows are child blocks of this block.
   */
  private get dataId(): string {
    return this.source?.databaseId ?? this.block.id;
  }

  private get readOnly(): boolean {
    if (this.ownReadOnly || this.source?.documentId !== undefined) return true;
    if (this.source === undefined) return false;
    const allowed: unknown[] = [];

    this.api.blocks.getById(this.source.databaseId)?.call('readRowWritePermission', {
      receive: (value: unknown): void => { allowed.push(value); },
    });

    return allowed[0] !== true;
  }

  private get linked(): boolean {
    return this.source !== undefined;
  }

  /** A linked source in this document that no longer exists. */
  private sourceMissing(): boolean {
    if (this.source?.documentId !== undefined) return this.remoteSnapshot === null;

    return this.source !== undefined && this.api.blocks.getById(this.source.databaseId)?.name !== 'database';
  }

  /** Linked: the model takes the source's live schema. Views stay this block's own. */
  private pullLinkedSchema(): void {
    if (this.source === undefined || this.source.documentId !== undefined || this.sourceMissing()) return;
    const schema = this.readDatabaseSource(this.source.databaseId)?.schema;

    if (schema !== undefined && schema.length > 0) {
      this.model.replaceDefinition({ schema, views: this.model.getViews() });
    }
  }

  /**
   * Called on a source database by one of its linked views: a property
   * edit made there. The source writes it as its own.
   */
  adoptLinkedSchema(param: { schema: PropertyDefinition[] }): void {
    if (this.readOnly || this.destroyed || this.linked) return;
    this.model.replaceDefinition({ schema: structuredClone(param.schema), views: this.model.getViews() });
    this.block.dispatchChange();
    this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.rerenderView({ keepDrawer: true });
  }

  private get controls(): DatabaseViewControls {
    return this.binding?.controls ?? this.ownControls;
  }

  /** This block's controls, also while bound: `controls` is then the holder's. */
  private get ownControls(): DatabaseViewControls {
    if (this.viewControls === null) {
      this.viewControls = new DatabaseViewControls(this.controlsHost());
      this.viewControls.load(this.model.getViews().map((v) => v.id));
    }

    return this.viewControls;
  }

  private get tabDisplay(): TabDisplayPreference {
    if (this.tabDisplayPref === null) {
      this.tabDisplayPref = new TabDisplayPreference({
        ...(this.config.viewState !== undefined ? { store: this.config.viewState } : {}),
        fallback: this.viewStateFallback(),
        onChange: () => this.rebuildTabBar(),
      });
      void this.tabDisplayPref.load();
    }

    return this.tabDisplayPref;
  }

  /** Fails closed: a gate that throws denies. */
  private permits(action: DatabasePermissionAction): boolean {
    const gate = this.config.permissions;

    if (gate === undefined) return true;
    try {
      return gate.can(action, { databaseId: this.block.id });
    } catch {
      return false;
    }
  }

  /** Read on construction and on setReadOnly; a host redraws or calls setReadOnly after a change. */
  private refreshPermissions(): void {
    this.ownReadOnly = this.editorReadOnly || !this.permits('editContent');
    this.structureDenied = !this.permits('editStructure');
  }

  /**
   * Core asks this for its block menu, selection deletes and agent writes,
   * here and on every row and row page body block. Only the host gate counts:
   * a linked view's own read-only must not stop deleting the view block.
   */
  isReadOnly(): boolean {
    return !this.permits('editContent');
  }

  /** Without editStructure the database block's own data (schema, views, title) is frozen; its rows are not. */
  isDataReadOnly(): boolean {
    return !this.permits('editStructure');
  }

  /**
   * Whether the person at this editor could write a built-in comment here now.
   * An agent's comment writes ask this instead of isReadOnly (editor-applier.ts):
   * commenting needs `comment`, not `editContent`.
   */
  public commentsWritable(param: { receive: (writable: boolean) => void }): void {
    param.receive(this.builtInComments.writable());
  }

  /** The host's comments for a row or a cell, else the built-in ones, unless permissions deny `comment`. */
  private commentLever(): { comment?: (rowId: string, propertyId: string | undefined, anchor: HTMLElement) => void; commentBadges?: CommentBadges } {
    const comments = this.config.comments;

    if (comments === undefined && this.builtInComments.enabled()) {
      return {
        comment: (rowId, propertyId, anchor) => this.builtInComments.open(rowId, propertyId, anchor),
        ...this.commentBadgeLever(),
      };
    }
    if (comments === undefined || !this.permits('comment')) return {};

    return {
      comment: (rowId, propertyId, anchor) => comments.open({ databaseId: this.block.id, rowId, ...(propertyId !== undefined ? { propertyId } : {}) }, anchor),
      ...this.commentBadgeLever(),
    };
  }

  /** "Manage in Calendar" for one view. It changes no document, so read-only gets it too. */
  private calendarLever(databaseId: string, viewId: string): { manageInCalendar?: { label: string; onClick: () => void } } {
    const calendar = this.config.calendar;

    if (calendar === undefined) return {};

    return {
      manageInCalendar: {
        label: calendar.label ?? this.api.i18n.t('tools.database.manageInCalendar'),
        onClick: () => calendar.manage({ databaseId, viewId }),
      },
    };
  }

  /**
   * The row menu's Add to Favorites, asked fresh on each open. It changes no
   * document, so read-only gets it too. A throw counts as not a favorite.
   */
  private favoriteFor(rowId: string): RowFavorite | undefined {
    const favorites = this.config.favorites;

    if (favorites === undefined) return undefined;
    const input = { databaseId: this.dataId, rowId };
    const on = ((): boolean => {
      try {
        return favorites.isFavorite(input);
      } catch {
        return false;
      }
    })();

    return {
      on,
      onToggle: () => {
        favorites.onToggle({ ...input, favorite: !on });
        // The open page's star may show this row.
        this.cardDrawer?.syncFavoriteButton();
      },
    };
  }

  /** Row comment counts, when the host gives `count` or comments are built in. A throw counts as zero. */
  private commentBadgeLever(): { commentBadges?: CommentBadges } {
    const comments = this.config.comments;

    if (comments === undefined && this.builtInComments.enabled()) {
      return {
        commentBadges: {
          databaseId: this.block.id,
          count: (rowId) => this.builtInComments.count(rowId),
          open: (rowId, anchor) => this.builtInComments.open(rowId, undefined, anchor),
        },
      };
    }

    if (comments?.count === undefined || !this.permits('comment')) return {};

    return {
      commentBadges: {
        databaseId: this.block.id,
        count: (rowId) => {
          try {
            const count = comments.count?.({ databaseId: this.block.id, rowId });

            return typeof count === 'number' && count > 0 ? count : 0;
          } catch {
            return 0;
          }
        },
        open: (rowId, anchor) => comments.open({ databaseId: this.block.id, rowId }, anchor),
      },
    };
  }

  /** The host says comments changed: badges update in place, since its thread popover is anchored to one. */
  private subscribeComments(): void {
    const comments = this.config.comments;

    if (this.stopComments !== undefined || comments?.subscribe === undefined) return;
    this.stopComments = (): void => undefined;
    try {
      const stop = comments.subscribe(this.block.id, () => {
        const lever = this.commentBadgeLever().commentBadges;

        if (this.destroyed || lever === undefined || this.element === null) return;
        refreshCommentBadges(this.element, lever, this.api.i18n);
      });

      if (typeof stop === 'function') this.stopComments = stop;
    } catch {
      // Fails closed, like `count`: the badges just stop updating.
    }
  }

  /** Locked by the document, or by the host's permissions. A linked view also by its own "Lock views". */
  private structureLocked(): boolean {
    return this.structureDenied || this.model.isDatabaseLocked() || this.viewsLocked() || this.holderLocked();
  }

  /** A second data source (a child database) follows the lock of the database that holds it. */
  private holderLocked(): boolean {
    const holder = this.isHeldSource() ? this.dashboardOwner(this.block.parentId ?? '') : undefined;

    return holder !== undefined && holder !== this && holder.structureLocked();
  }

  /** Leaves only the pools: a second data source shows through its holder. */
  private dropChrome(): void {
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
    this.tabBar?.destroy();
    this.tabBar = null;
    this.unregisterGroupToggle?.();
    this.unregisterGroupToggle = null;
    this.titleElement = null;
    this.titleRowElement = null;
    this.boardContainer = null;
    [...this.element?.children ?? []].forEach((child) => {
      if (child !== this.rowPool && child !== this.layoutPool) child.remove();
    });
  }

  /** A second data source: a database block whose parent is a database (research/23 §10). */
  private isHeldSource(): boolean {
    const parentId = this.block.parentId;

    return typeof parentId === 'string' && this.api.blocks.getById(parentId)?.name === 'database';
  }

  /** A linked view's own lock, kept on its stand-in title property. Never the source's. */
  private viewsLocked(): boolean {
    return this.linked && this.stubSchema.some((property) => property.type === 'title' && property.databaseLocked === true);
  }

  private titleEditable(): boolean {
    return !this.readOnly && !this.structureDenied && !this.linked;
  }

  /**
   * Notion's "/" Database section, in its order (research/28 §1a). Not built:
   * Dashboard view (paid), the five charts (insert unmeasured) and
   * Database - Full page (a page block's body is host-owned). Each caption is
   * Notion's hover hint (§1c); Blok shows it under a preview card.
   */
  static get toolbox(): ToolboxConfig {
    // titleKey and descriptionKey stay literals: the i18n lifecycle test reads them from source.
    const view = (entry: { name: string; aloneSkipsPanel?: true; titleKey: string; layout: ViewType; searchTerms: string[]; render: () => HTMLElement; descriptionKey: string }): ToolboxConfigEntry => ({
      icon: VIEW_ICONS[entry.layout],
      titleKey: entry.titleKey,
      name: entry.name,
      searchTerms: entry.searchTerms,
      section: 'database',
      preview: { render: entry.render, descriptionKey: entry.descriptionKey },
      data: { [INITIAL_VIEW_KEY]: entry.layout, ...(entry.aloneSkipsPanel === true ? { [ALONE_SKIPS_PANEL_KEY]: true } : {}) },
    });

    return [
      view({ name: 'tableView', aloneSkipsPanel: true, titleKey: 'tableView', layout: 'table', searchTerms: ['table view', 'database', 'view'], render: renderTableViewPreview, descriptionKey: 'toolbox.preview.tableView' }),
      view({ name: 'board', titleKey: 'board', layout: 'board', searchTerms: ['board view', 'board', 'kanban', 'database', 'view'], render: renderBoardPreview, descriptionKey: 'toolbox.preview.board' }),
      view({ name: 'galleryView', titleKey: 'galleryView', layout: 'gallery', searchTerms: ['gallery view', 'gallery', 'database', 'view'], render: renderGalleryViewPreview, descriptionKey: 'toolbox.preview.galleryView' }),
      view({ name: 'listView', titleKey: 'listView', layout: 'list', searchTerms: ['list view', 'list', 'database', 'view'], render: renderListViewPreview, descriptionKey: 'toolbox.preview.listView' }),
      view({ name: 'feedView', titleKey: 'feedView', layout: 'feed', searchTerms: ['feed view', 'feed', 'database', 'view'], render: renderFeedViewPreview, descriptionKey: 'toolbox.preview.feedView' }),
      view({ name: 'calendarView', titleKey: 'calendarView', layout: 'calendar', searchTerms: ['calendar view', 'calendar', 'database', 'view'], render: renderCalendarViewPreview, descriptionKey: 'toolbox.preview.calendarView' }),
      view({ name: 'timelineView', titleKey: 'timelineView', layout: 'timeline', searchTerms: ['timeline view', 'timeline', 'gantt', 'database', 'view'], render: renderTimelineViewPreview, descriptionKey: 'toolbox.preview.timelineView' }),
      view({ name: 'mapView', titleKey: 'mapView', layout: 'map', searchTerms: ['map view', 'map', 'place', 'location', 'database', 'view'], render: renderMapViewPreview, descriptionKey: 'toolbox.preview.mapView' }),
      // No "New database" panel (§3): the form opens on its builder.
      view({ name: 'databaseForm', titleKey: 'tools.database.viewTypeForm', layout: 'form', searchTerms: ['form', 'survey', 'database'], render: renderFormPreview, descriptionKey: 'toolbox.preview.form' }),
      {
        icon: IconDatabaseInline,
        titleKey: 'databaseInline',
        name: 'database',
        searchTerms: ['database', 'inline', 'database inline'],
        section: 'database',
        preview: { render: renderDatabasePreview, descriptionKey: 'toolbox.preview.database' },
        data: { [INITIAL_VIEW_KEY]: 'table' },
      },
      {
        icon: IconDatabaseLinked,
        titleKey: 'linkedDatabase',
        name: 'linkedDatabase',
        searchTerms: ['linked', 'linked view', 'database', 'view'],
        section: 'database',
        preview: { render: renderLinkedDatabasePreview, descriptionKey: 'toolbox.preview.linkedDatabase' },
        data: { [INITIAL_VIEW_KEY]: 'table', [LINK_PICKER_KEY]: true },
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
    wrapper.toggleAttribute('data-blok-database-page', this.fullPage);
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    this.element = wrapper;
    this.loadPeople();

    // First slot in the wrapper: core mounts a new row into a database's first slot.
    const rowPool = document.createElement('div');

    rowPool.setAttribute(DATA_ATTR.nestedBlocks, '');
    rowPool.setAttribute('data-blok-database-row-pool', '');
    rowPool.setAttribute(DATA_ATTR.mutationFree, 'true');
    rowPool.hidden = true;
    this.rowPool = rowPool;
    wrapper.appendChild(rowPool);

    const layoutPool = document.createElement('div');

    layoutPool.setAttribute('data-blok-database-layout-pool', '');
    layoutPool.setAttribute(DATA_ATTR.chrome, '');
    layoutPool.setAttribute(DATA_ATTR.mutationFree, 'true');
    layoutPool.hidden = true;
    this.layoutPool = layoutPool;
    wrapper.appendChild(layoutPool);

    // A second data source draws no chrome: the database holding it shows its
    // views, and a hidden copy would answer that database's DOM lookups.
    if (this.isHeldSource()) {
      this.syncRowsFromBlocks();

      return wrapper;
    }

    const titleEl = this.createTitleElement();
    this.titleElement = titleEl;

    const titleRow = document.createElement('div');
    titleRow.setAttribute('data-blok-database-title-row', '');
    titleRow.appendChild(titleEl);
    this.titleRowElement = titleRow;
    this.paintDatabaseIcon();
    wrapper.appendChild(titleRow);

    this.tabBar = this.createTabBar();
    const viewBar = document.createElement('div');

    viewBar.setAttribute('data-blok-database-view-bar', '');
    viewBar.append(this.tabBar.render(), this.controls.toolbar);
    wrapper.append(viewBar, this.controls.filterBar);
    this.syncTitleRowAddBtn();
    this.unregisterGroupToggle ??= registerGroupToggle({
      // A locked database cannot save its folds, so it must not vote in the toggle.
      hasGroups: () => !this.structureLocked() && this.activeGroupKeys().length > 0,
      anyExpanded: () => {
        const view = this.shownView();

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
    this.initialProjectionPending &&= this.model.getOrderedRows().length === 0;
    const boardEl = this.renderActiveView();
    boardContainer.appendChild(boardEl);

    this.wireView(boardEl);
    this.controls.refresh();

    return wrapper;
  }

  /** research/27:42: the icon a template gave, before the title. */
  private paintDatabaseIcon(): void {
    const icon = this.databaseIcon;

    if (icon === undefined || this.titleRowElement === null || this.titleElement === null) {
      this.iconElement?.remove();
      this.iconElement = null;

      return;
    }
    const el = this.iconElement ?? document.createElement('span');

    el.setAttribute('data-blok-database-icon', icon.color);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = ICON_GLYPHS[icon.glyph];
    if (el.nextElementSibling !== this.titleElement) this.titleRowElement.insertBefore(el, this.titleElement);
    this.iconElement = el;
  }

  private createTitleElement(): HTMLElement {
    const titleEl = document.createElement('div');
    titleEl.setAttribute('data-blok-database-title', '');
    titleEl.textContent = this.title;

    titleEl.style.fontSize = '1.5rem';
    titleEl.style.fontWeight = '600';
    titleEl.style.lineHeight = '1.3';
    titleEl.style.color = 'var(--blok-database-ink)';
    titleEl.style.outline = 'none';
    titleEl.style.cursor = 'text';
    titleEl.style.wordBreak = 'break-word';

    const syncTitleDirection = (): void => DatabaseTool.syncTitleDirection(titleEl);

    syncTitleDirection();
    titleEl.addEventListener('input', syncTitleDirection);
    titleEl.className = getPlaceholderClasses('always').join(' ');
    setupPlaceholder(titleEl, this.api.i18n.t('tools.database.titlePlaceholder'));

    if (this.titleEditable()) {
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

  /** A local delete of this database (or of a block that takes it along) deletes its rows from the backend. */
  removed(removal?: { deleted: boolean }): void {
    if (removal?.deleted !== true || this.linked || this.readOnly) return;
    [...this.model.getOrderedRows(), ...this.templates].forEach((row) => void this.sync.syncDeleteRow({ rowId: row.id }));
  }

  /** Called by a row this client deleted on its own; the row's backend copy goes too. */
  rowDeleted({ rowId }: { rowId: string }): void {
    if (this.destroyed || this.linked || this.readOnly) return;
    void this.sync.syncDeleteRow({ rowId });
  }

  /** A row this client deleted from the backend is back (undo): create it there again. */
  private recreateDeletedRows(): void {
    if (this.destroyed || this.linked || this.readOnly) return;
    const schema = this.model.getSchema();

    this.model.getOrderedRows().filter((row) => this.sync.deletedRow(row.id)).forEach((row) => this.sync.createRelocatedRow({
      id: row.id, properties: adapterRowValues(row.properties, schema).properties, position: row.position,
    }));
    this.templates.filter((row) => this.sync.deletedRow(row.id)).forEach((row) => this.sync.createRelocatedRow({
      id: row.id, properties: adapterRowValues(row.properties, schema).properties, position: row.position, template: true,
    }));
  }

  /** Creates a pasted or duplicated copy's rows in the backend, once each. */
  private createCopiedRows(): void {
    if (!this.copiedRowsPending || this.destroyed || this.linked || this.readOnly) return;
    const schema = this.model.getSchema();
    const fresh = (row: DatabaseRow): boolean => !this.sync.holdsRow(row.id) && !this.sync.deletedRow(row.id);

    this.model.getOrderedRows().filter(fresh).forEach((row) => this.sync.createRelocatedRow({
      id: row.id, properties: adapterRowValues(row.properties, schema).properties, position: row.position,
    }));
    this.templates.filter(fresh).forEach((row) => this.sync.createRelocatedRow({
      id: row.id, properties: adapterRowValues(row.properties, schema).properties, position: row.position, template: true,
    }));
  }

  rendered(): void {
    this.block.stretched = true;
    // Paste and duplicate place every row in the same task; rows added later are not part of the copy.
    if (this.copiedRowsPending) {
      setTimeout(() => {
        this.createCopiedRows();
        this.copiedRowsPending = false;
      }, 0);
    }
    // On load the holder is not known at render time.
    if (this.isHeldSource() && this.boardContainer !== null) this.dropChrome();
    this.mountRows();

    // The insert wrote the raw seed into the shared document; one save
    // replaces it with the real schema and views. Every client that renders
    // the seed does this, which is safe only because the ids derive from the
    // block id (idSeed).
    if (this.seeded && !this.readOnly) {
      this.seeded = false;
      this.block.dispatchChange();
    }

    const initialProjection = this.initialProjectionPending;

    this.initialProjectionPending = false;
    const hadRows = this.model.getOrderedRows().length > 0;

    this.syncRowsFromBlocks();
    this.subscribeComments();
    // A database that rendered first read this one before its tool existed.
    this.api.events.emit(DATABASE_RENDERED_EVENT, { databaseId: this.block.id });
    this.queueDraftCleanup();
    this.dueWatching = true;
    document.addEventListener('visibilitychange', this.handleDueVisibility);
    window.addEventListener('popstate', this.followRowPageHistory);
    this.offerDue();
    this.openLinkedRow();
    if (this.sampleCardsPending) {
      this.sampleCardsPending = false;
      this.addSampleCards();
    }
    if (this.linkPicker) this.openSourcePicker();
    if (this.offerNewDatabasePanel) {
      this.offerNewDatabasePanel = false;
      // The insert puts the caret in the title after rendered(); the panel takes focus after it.
      requestAnimationFrame(() => {
        if (!this.destroyed && !(this.aloneSkipsPanel && this.aloneInDocument())) this.openNewDatabasePanel();
      });
    }

    if ((initialProjection || !hadRows) && this.model.getOrderedRows().length > 0) {
      this.rerenderView();
    }

    // A linked view's adapter answer would replace its own views with the source's.
    if (this.config.adapter !== undefined && !this.linked) {
      void this.loadFromBackend();
    }
    void this.watchRemoteSource();
  }

  /**
   * Loads a source in another document and keeps listening to it, once per
   * source: a new source stops the old subscription, no source stops it.
   */
  private async watchRemoteSource(): Promise<void> {
    const source = this.source?.documentId === undefined ? undefined : { documentId: this.source.documentId, databaseId: this.source.databaseId };
    const key = source === undefined ? '' : `${source.documentId}\u0000${source.databaseId}`;

    if (this.remoteWatch?.key === key) return;
    this.remoteWatch?.stop();
    this.remoteWatch = null;
    this.remoteSnapshot = undefined;
    if (source === undefined || this.destroyed) return;
    const watch = { key, stop: (): void => undefined };

    this.remoteWatch = watch;
    try {
      const stop = this.config.linkedSources?.subscribe?.(source, () => {
        if (this.remoteWatch === watch) void this.loadRemoteSource(source.documentId, source.databaseId);
      });

      if (typeof stop === 'function') watch.stop = stop;
    } catch {
      // The view just stops updating, like `comments.subscribe`.
    }
    await this.loadRemoteSource(source.documentId, source.databaseId);
  }

  /**
   * A linked source in another document: Blok cannot read it, so the host's
   * `config.linkedSources.resolve` lever hands its schema and rows over. The
   * view stays read-only: there is no row block to write to. `null` means
   * the source is gone; a throw is a backend error and changes nothing.
   */
  /**
   * As `linkedFirstView` for a local pick (R:2021-12-23): the blank view of
   * a fresh remote pick becomes a copy of the source's first table view.
   */
  private adoptRemoteFirstView(sourceViews: DatabaseViewConfig[]): DatabaseViewConfig[] {
    const views = this.model.getViews();
    const placeholder = this.remotePlaceholderView;

    this.remotePlaceholderView = null;
    if (placeholder === null || views.length !== 1 || views[0].id !== placeholder) return views;
    const listed = sourceViews.filter((view) => view.type !== 'form' && view.type !== 'dashboard');
    const first = listed.find((view) => view.type === 'table') ?? listed[0];

    if (first === undefined) return views;
    const copy = { ...structuredClone(first), id: nanoid(), position: 'a0' };

    if (this.activeViewId === placeholder) this.activeViewId = copy.id;
    this.block.dispatchChange();

    return [copy];
  }

  private async loadRemoteSource(documentId: string, databaseId: string): Promise<void> {
    const resolve = this.config.linkedSources?.resolve;

    if (resolve === undefined) return;
    const read = ++this.remoteReads;
    const found = await resolve({ documentId, databaseId }).then(
      (snapshot) => ({ snapshot }),
      (error: unknown) => {
        this.showBackendError(error);

        return undefined;
      }
    );

    if (found === undefined || this.destroyed || read !== this.remoteReads) return;
    if (this.source?.documentId !== documentId || this.source.databaseId !== databaseId) return;
    const wasMissing = this.sourceMissing();
    const viewsBefore = this.model.getViews();

    this.remoteSnapshot = found.snapshot === null ? null : structuredClone(found.snapshot);
    if (found.snapshot === null) {
      this.model.setRows([]);
    } else {
      if (found.snapshot.title !== undefined) this.lastSourceTitle = found.snapshot.title;
      this.model.replaceDefinition({ schema: structuredClone(found.snapshot.schema), views: this.adoptRemoteFirstView(found.snapshot.views ?? []) });
      this.model.setRows(structuredClone(found.snapshot.rows));
    }
    // The banner hides the add-view "+"; an adopted first view is a new tab.
    if (wasMissing !== this.sourceMissing() || this.model.getViews()[0]?.id !== viewsBefore[0]?.id) this.rebuildTabBar();
    this.rerenderView();
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
    // A linked view's title element shows the source's name, not its own.
    const currentTitle = this.linked ? this.title : this.titleElement?.textContent ?? this.title;

    return {
      ...structuredClone(this.unknown),
      ...this.model.snapshot(),
      // Written even when empty: two peers that each create this key keep only one (serializer.ts objectToYMap).
      automations: structuredClone(this.savedAutomations ?? DATABASE_EMPTY_AUTOMATIONS),
      // Linked: a reference, never a copy of the source's schema.
      ...(this.source !== undefined ? { schema: structuredClone(this.stubSchema), source: { ...this.source } } : {}),
      ...(this.dataSourceTitlesHidden ? { hideDataSourceTitles: true } : {}),
      ...(this.fullPage ? { fullPage: true } : {}),
      ...(this.databaseIcon !== undefined ? { icon: { ...this.databaseIcon } } : {}),
      ...(this.starter !== undefined ? { starter: this.starter } : {}),
      title: currentTitle,
      activeViewId: this.activeViewId,
    };
  }

  validate(savedData: DatabaseData): boolean {
    if (sourceRefOf(savedData) !== undefined) {
      return Array.isArray(savedData.views) && savedData.views.length > 0;
    }
    const titleCount = savedData.schema?.filter((p) => p.type === 'title').length ?? 0;
    const hasExactlyOneTitle = titleCount === 1;
    const hasViews = savedData.views !== undefined && savedData.views.length > 0;
    const boardViewsValid = savedData.views?.filter((v) => v.type === 'board')
      .every((v) => v.groupBy !== undefined) ?? true;
    return hasExactlyOneTitle && hasViews && boardViewsValid;
  }

  destroy(): void {
    this.destroyed = true;
    this.sourcePicker?.close();
    this.formPreview?.close();
    this.formPromptAbort?.abort();
    this.api.events.off(DATABASE_GONE_EVENT, this.handleDatabaseGone);
    this.api.events.emit(DATABASE_GONE_EVENT, { databaseId: this.block.id });
    this.hostLevers.destroy();
    document.removeEventListener('keydown', this.handleSelectionKeys, true);
    this.bulkEditor?.close();
    this.openCellEditors.clear();
    this.api.events.off('block changed', this.handleBlockChanged);
    this.api.events.off('block replayed', this.handleBlockReplayed);
    this.api.events.off('block changed', this.handleBodyEdit);
    this.api.events.off('block changed', this.handleAgentRowWrite);
    this.api.events.off('block changed', this.scheduleBacklinks);
    this.api.events.off('block replayed', this.scheduleBacklinks);
    if (this.backlinksTimer !== null) clearTimeout(this.backlinksTimer);
    this.dueWatching = false;
    this.scheduleDue();
    document.removeEventListener('visibilitychange', this.handleDueVisibility);
    window.removeEventListener('popstate', this.followRowPageHistory);
    this.api.events.off(DATABASE_RENDERED_EVENT, this.handleDatabaseRendered);
    this.api.events.off('collaboration:status', this.handleCollaborationStatus);
    if (this.draftGraceTimer !== null) clearTimeout(this.draftGraceTimer);
    this.viewControls?.destroy();
    this.dashboardStates.clear();
    this.dashboardSources.clear();
    this.unregisterGroupToggle?.();
    this.unregisterGroupToggle = null;
    this.propertyMenu?.destroy();
    this.formulaEditor?.close();
    this.propertyMenu = null;
    this.autofillSetup?.close();
    this.buttonFilter?.close();
    this.buttonFilter = null;
    this.addPropertyPopover?.destroy();
    this.addPropertyPopover = null;
    this.stopWaitingForIdle();
    this.cardMenuPopover?.destroy();
    this.reactionPicker?.close();
    this.reactionPicker?.getElement().remove();
    this.reactionPicker = null;
    this.stopComments?.();
    this.remoteWatch?.stop();
    this.remoteWatch = null;
    this.builtInComments.destroy();
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
    this.rowPool = null;
    this.layoutPool = null;
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
  setReadOnly(requested: boolean): void {
    const before = { readOnly: this.readOnly, structureDenied: this.structureDenied };

    this.editorReadOnly = requested;
    this.refreshPermissions();
    if (before.readOnly === this.readOnly && before.structureDenied === this.structureDenied) {
      return;
    }

    if (this.titleElement !== null) {
      this.titleElement.setAttribute('contenteditable', this.titleEditable() ? 'true' : 'false');
    }

    this.tabBar?.setReadOnly(this.readOnly || this.structureLocked());
    this.syncTitleRowAddBtn();
    this.scheduleDue();

    this.rerenderView();
    this.api.events.emit(DATABASE_RENDERED_EVENT, { databaseId: this.block.id });
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

    const formState = this.view instanceof DatabaseFormView
      ? {
        id: this.activeViewId,
        readOnly: this.readOnly,
        structureLocked: this.structureLocked(),
        source: this.source,
        closed: this.shownView()?.form?.closed === true,
      }
      : undefined;

    this.unknown = unknownKeys(data);
    this.dataSourceTitlesHidden = data.hideDataSourceTitles === true;
    this.fullPage = data.fullPage === true;
    this.element?.toggleAttribute('data-blok-database-page', this.fullPage);
    this.databaseIcon = iconOf(data);
    this.starter = starterOf(data);
    this.paintDatabaseIcon();
    this.savedAutomations = structuredClone(data.automations);
    this.title = typeof data.title === 'string' ? data.title : '';

    if (this.titleElement !== null && sourceRefOf(data) === undefined && this.titleElement.textContent !== this.title) {
      this.titleElement.textContent = this.title;
      DatabaseTool.syncTitleDirection(this.titleElement);
    }

    this.source = sourceRefOf(data);
    if (this.source !== undefined) {
      this.stubSchema = structuredClone(data.schema);
      this.model.replaceDefinition({ schema: this.model.getSchema(), views: data.views });
      this.pullLinkedSchema();
    } else {
      this.model.replaceDefinition(data);
    }
    void this.watchRemoteSource();

    const views = this.model.getViews();
    const activeViewId = [data.activeViewId, this.activeViewId].find((id) => views.some((view) => view.id === id)) ?? views[0].id;

    if (activeViewId !== this.activeViewId) {
      this.sync.flushPendingUpdates();
      this.sync.flushPendingPropertyUpdates();
      this.activeViewId = activeViewId;
    }

    this.rebuildTabBar();
    this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.refreshRowPrompts();
    if (formState !== undefined && (
      formState.id !== this.activeViewId ||
      this.shownView()?.type !== 'form' ||
      formState.closed !== (this.shownView()?.form?.closed === true) ||
      formState.source?.databaseId !== this.source?.databaseId ||
      formState.source?.documentId !== this.source?.documentId ||
      formState.readOnly !== this.readOnly ||
      formState.structureLocked !== this.structureLocked()
    )) {
      this.rerenderView({ keepDrawer: true });
    } else {
      this.redrawWhenIdle();
    }

    return true;
  }

  /**
   * Returns the title element so the block toolbar vertically centers on the
   * database title line rather than on the outer wrapper's top edge.
   */
  getToolbarAnchorElement(): HTMLElement | undefined {
    return this.sourceTitleElement ?? this.titleElement ?? undefined;
  }

  // ---------------------------------------------------------------------------
  // Row projection from child blocks
  // ---------------------------------------------------------------------------

  private syncRowsFromBlocks(): void {
    if (this.source?.documentId !== undefined) return;
    this.pullLinkedSchema();
    const children = this.sourceMissing() ? [] : this.api.blocks.getChildren(this.dataId);
    const titlePropId = this.titlePropertyId();
    const templateIds = new Set<string>();
    const all: DatabaseRow[] = children
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

        const meta: DatabaseRowMeta = rowData?.anonymous === true ? anonymousRowMeta(rowMetaOf(child)) : rowMetaOf(child);
        const reactions = rowReactions(rowData);

        if (isTemplateData(rowData)) {
          templateIds.add(child.id);
        }

        return {
          id: child.id,
          position: rowData?.position ?? '',
          properties,
          ...(typeof rowData?.pageId === 'string' && rowData.pageId.length > 0 ? { pageId: rowData.pageId } : {}),
          ...(typeof rowData?.icon === 'string' && rowData.icon !== '' ? { icon: rowData.icon } : {}),
          ...(typeof rowData?.cover === 'string' && rowData.cover !== '' ? { cover: rowData.cover } : {}),
          ...(typeof rowData?.fullWidth === 'boolean' ? { fullWidth: rowData.fullWidth } : {}),
          ...(rowData?.reminders !== undefined ? { reminders: rowData.reminders } : {}),
          ...(Object.keys(reactions).length > 0 ? { reactions } : {}),
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        };
      });
    // A template is a row block so it keeps its body, but no view, query,
    // calculation or ID number may ever see it.
    const rows = all.filter((row) => !templateIds.has(row.id));

    this.templates = all.filter((row) => templateIds.has(row.id)).sort((a, b) => comparePositions(a.position, b.position));
    const numbered = this.model.getSchema()
      .filter((property) => property.type === 'uniqueId')
      .reduce((acc, property) => assignUniqueIds(acc, property.id), rows);

    this.model.setRows(this.computedValues.apply(this.model.getSchema(), numbered, {
      databaseId: this.dataId,
      now: new Date(),
      resolveDatabase: (databaseId) => this.readDatabaseSource(databaseId),
      ...(this.people === undefined ? {} : { people: this.people }),
    }));
    // The source stores its own derived IDs; a linked view writing them too would double every write.
    if (!this.readOnly && !this.linked) {
      this.storeUniqueIds(rows, numbered, children);
    }
    this.refreshRowPrompts();
    // A peer's layout write can settle which of two tabs blocks wins.
    if (this.madeTabsBlocks.size > 0) this.queueLayoutTabsSync();
    // Every reminder and repeat write lands here, so the next wake follows it.
    this.scheduleDue();
    // A repeat written here, by a peer or by undo keeps the open template's banner true.
    const openId = this.cardDrawer?.openRowId;

    if (openId !== undefined && openId !== null && templateIds.has(openId)) this.showTemplateBanner(openId);
    this.recreateDeletedRows();
    this.createCopiedRows();
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
      .flatMap((child): DatabaseRow[] => {
        const live: DatabaseRowData[] = [];

        child.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });
        const data = live[0] ?? child.preservedData as Partial<DatabaseRowData> | undefined;

        return isTemplateData(data) ? [] : [{ id: child.id, position: data?.position ?? '', properties: { ...(data?.properties ?? {}) } }];
      });

    const schema = Array.isArray(saved?.schema) ? saved.schema : [];
    // Not built yet: work its formulas out here, or a rollup of one reads nothing.
    const engine = new ComputedProperties(databaseId);

    return { schema, rows: engine.apply(schema, rows, { databaseId, now: new Date() }), valueProperty: (property) => engine.valueProperty(property) };
  }

  /** The name this database's person cells show for a user id, once its directory has loaded. */
  readPersonName(param: { id: string; receive: (name: string) => void }): void {
    const name = this.people?.find((person) => person.id === param.id)?.name;

    if (typeof name === 'string') param.receive(name);
  }

  /** Read by another database of this document: this database's schema and computed rows. */
  readRelationSource(param: { receive: (source: DatabaseSource) => void }): void {
    param.receive({
      schema: this.model.getSchema(),
      rows: this.model.getOrderedRows(),
      valueProperty: (property) => this.computedValues.valueProperty(property),
    });
  }

  /**
   * Opens one of this database's rows: a relation chip in another database
   * asks for it, and so does a row block when find-in-page reveals a match in it.
   */
  /**
   * `mode` is the opening view's "Open pages in": a linked view's own, not this database's.
   * `explicit` marks a row menu "Open in" pick, which also beats an open peek's mode.
   */
  openRow(param: { rowId: string; mode?: OpenPagesIn; explicit?: boolean }): void {
    if (this.model.getRow(param.rowId) !== undefined) {
      const mode = param.mode === 'side' || param.mode === 'center' || param.mode === 'full' ? param.mode : undefined;

      if (param.explicit === true) {
        this.handleRowClick(param.rowId, mode);
      } else {
        this.handleRowClick(param.rowId, undefined, mode);
      }
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
   * An undo or redo of this database closes every cell editor open over it,
   * without its draft, so no editor shows or writes back a value the undo
   * changed (a multi-select's delete prompt would bring an undone option back).
   * Undo moves no focus, so focus-out cannot do it.
   */
  private closeEditorsOnHistory(capture: BlockReplayCapture): void {
    if (
      this.destroyed || (capture.origin !== 'undo' && capture.origin !== 'redo') ||
      (capture.blockId !== this.block.id && capture.blockId !== this.dataId && this.model.getRow(capture.blockId) === undefined)
    ) return;
    const open = [...this.openCellEditors];

    this.openCellEditors.clear();
    open.forEach((editor) => editor.cancel());
  }

  private readonly handleBlockReplayed = (capture: BlockReplayCapture): void => {
    const native = capture.native;

    this.closeEditorsOnHistory(capture);

    if (
      this.destroyed || this.readOnly || this.source !== undefined ||
      (capture.origin !== 'undo' && capture.origin !== 'redo') ||
      native?.type !== 'database-row'
    ) return;

    const relocation = capture.relocation;

    // Only the new owner acts, and only while the backends hold the row where
    // the receipt says. A skipped undo or a never-synced move would otherwise
    // make the next receipt create the row twice or delete its last copy.
    if (relocation !== undefined) {
      const from = relocation.before.parent.present ? this.api.blocks.getById(relocation.before.parent.value) : null;
      const params = this.sync.relocationCreateParams(capture, this.model.getSchema());

      if (
        !relocation.after.parent.present || relocation.after.parent.value !== this.block.id ||
        from?.name !== 'database' || params === undefined || this.sync.holdsRow(capture.blockId)
      ) return;
      const released: boolean[] = [];

      from.call('releaseRelocatedRow', { rowId: capture.blockId, receive: (done: boolean) => released.push(done) });
      if (released.includes(true)) this.sync.createRelocatedRow(params);

      return;
    }
    if (!native.parent.present || native.parent.value !== this.block.id) return;
    // recreateDeletedRows sends it once the row is back in the model.
    if (capture.type === 'add' && this.sync.deletedRow(capture.blockId)) return;

    // A redone row add replays before this block's own setData, so a create
    // reads the schema a microtask later: an option the same step brings back
    // must be in it, or the filter drops the row's value.
    if (capture.type === 'add') {
      queueMicrotask(() => this.sync.syncReplayRow(capture, this.model.getSchema()));

      return;
    }
    this.sync.syncReplayRow(capture, this.model.getSchema());
  };

  /**
   * Redraw the board when a row changed under it: undo/redo, a peer, or a row
   * added or removed by either. A microtask keeps the redraw inside the
   * reconcile window; after it closes, this block's write-back would be a new
   * undo step. The tool's own row writes re-sync the model before this runs,
   * so they compare equal and redraw nothing.
   */
  private readonly handleBlockChanged = (payload: unknown): void => {
    const target = changedBlock(payload);

    if (this.isLayoutTabsChange(target)) this.queueLayoutTabsSync();
    const own = this.isOwnRowChange(target);

    if (this.reprojectQueued || !(own || this.isRelatedChange(target))) {
      return;
    }

    this.reprojectQueued = true;
    const run = (): void => {
      this.reprojectQueued = false;
      if (this.view instanceof DatabaseDashboardView) this.redrawWhenIdle();
      else this.reprojectRows();
    };

    // A related database re-reads its own rows in a microtask queued by the
    // same event; wait one more tick so this one reads them after that.
    queueMicrotask(own ? run : () => queueMicrotask(run));
  };

  /**
   * A row of this database, or one it showed until now (moved out or removed).
   * An unreadable parent counts as ours: the compare after it drops no-ops.
   */
  /**
   * Puts every row holder in the hidden pool, except the row whose page is
   * open: the peek holds that one. `hidden` on a holder is what keeps core's
   * caret and navigation out of a closed row's body.
   */
  private mountRows(): void {
    // A linked view never moves the source's row holders: the source mounts them.
    if (this.rowPool === null || this.linked) {
      return;
    }
    const openRowId = this.cardDrawer?.bodyRowId ?? null;
    const children = this.api.blocks.getChildren(this.dataId);
    const rows = children.filter((child) => child.name === 'database-row');
    // A second data source (a child database, research/23 §10) lives hidden in the pool too.
    const pooled = children.filter((child) => (child.name === 'database-row' && child.id !== openRowId) || child.name === 'database');

    mountChildBlocks(this.rowPool, pooled);
    rows.forEach((row) => row.holder.classList.toggle('hidden', row.id !== openRowId));
    pooled.filter((child) => child.name === 'database').forEach((source) => source.holder.classList.add('hidden'));
    this.mountLayoutTabs(children);
  }

  /**
   * Core mounts any new child into the first slot, the row pool: a layout tabs
   * block moves out of it. Not mountChildBlocks: it leaves a holder that sits
   * in another slot where it is. In document order, which core checks.
   */
  private mountLayoutTabs(children: BlockAPI[]): void {
    const pool = this.layoutPool;
    const lent = this.layoutTabsLent ? this.layoutTabsBlock()?.id : undefined;
    const pooled = children.filter((child) => child.name === 'tabs' && child.id !== lent);

    // Lent to a row page, the holder carries every tab: find must not reach another session's draft.
    children.filter((child) => child.name === 'tabs').forEach((tabs) => tabs.call('hideTabs', {
      ids: this.api.blocks.getChildren(tabs.id).filter((tab) => this.isForeignDraft(tab)).map((tab) => tab.id),
    }));
    if (pool === null || pooled.every((tabs, i) => pool.children[i] === tabs.holder)) return;
    pooled.forEach((tabs) => moveElementToEnd(pool, tabs.holder));
  }

  // ─── Row page view tabs (plan 11 §2.1) ───

  /** The `tabs` child named by `pageLayoutTabsId`, else the first one: a duplicate's id still names the original's. */
  private layoutTabsBlock(): BlockAPI | undefined {
    const blocks = this.api.blocks.getChildren(this.dataId).filter((child) => child.name === 'tabs' && !this.isForeignDraft(child));
    const named = this.model.getPageLayout().tabsId;

    return blocks.find((block) => block.id === named) ?? blocks[0];
  }

  private layoutTabsList(): LayoutTab[] {
    const block = this.layoutTabsBlock();

    if (block === undefined) return [];

    return this.api.blocks.getChildren(block.id).filter((child) => child.name === 'tab' && !this.isForeignDraft(child)).map((child) => {
      const title = (this.layoutDataOf(child) as { title?: unknown }).title;

      return { id: child.id, title: typeof title === 'string' ? title : '', view: this.isViewTab(child.id) };
    });
  }

  /** A view tab holds a database; Content holds none. Read from the blocks, not the order, which a peer's undo can change. */
  private isViewTab(tabId: string): boolean {
    return this.api.blocks.getChildren(tabId).some((child) => child.name === 'database');
  }

  private hasContentTab(tabsId: string): boolean {
    return this.api.blocks.getChildren(tabsId).some((child) => child.name === 'tab' && !this.isForeignDraft(child) && !this.isViewTab(child.id));
  }

  /** Live data of a tab or tabs block: `preservedData` lags until the async save. */
  private layoutDataOf(block: BlockAPI): unknown {
    const live: unknown[] = [];

    block.call('readData', { receive: (data: unknown) => live.push(data) });

    return live[0] ?? block.preservedData;
  }

  /** Drafts and presence of this editor. Keyed by the editor: a replay can rebuild this tool mid-draft. */
  private get layoutDrafts(): LayoutDraftSession {
    return layoutDraftSession((this.api.ui as Partial<API['ui']> | undefined)?.nodes?.wrapper ?? this.api);
  }

  /**
   * A tab or tabs block another editor drafted in Customize layout: hidden
   * here until it is applied. A tabs block holding an applied tab is never
   * one, whatever its mark says: an undone Apply puts the mark back on a block
   * a peer has added to since.
   */
  private isForeignDraft(block: BlockAPI): boolean {
    // The applied layout block is never one, even if a racing write left a mark on it.
    if (block.id === this.model.getPageLayout().tabsId) return false;
    if (this.layoutDrafts.made.has(block.id) || layoutDraftOf(this.layoutDataOf(block)) === undefined) return false;

    return block.name !== 'tabs' || this.api.blocks.getChildren(block.id).every((tab) => this.isForeignDraft(tab));
  }

  /** Data for a block made in Customize layout: marked as this editor's draft until Apply. */
  private draftData<T extends Record<string, unknown>>(data: T): T & { draft: ReturnType<LayoutDraftSession['newDraft']> } {
    return { ...data, draft: this.layoutDrafts.newDraft(Date.now()) };
  }

  private readonly handleCollaborationStatus = (payload: unknown): void => {
    this.layoutDrafts.notePresence(payload as Parameters<LayoutDraftSession['notePresence']>[0], Date.now());
    this.queueDraftCleanup();
    if (!this.layoutDrafts.connected || this.draftGraceTimer !== null) return;
    // A quiet room sends no status: check again once a maker could have been away the whole window.
    this.draftGraceTimer = setTimeout(() => {
      this.draftGraceTimer = null;
      this.queueDraftCleanup();
    }, LAYOUT_MAKER_ABSENCE_MS);
  };

  private draftGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private draftCleanupQueued = false;

  /** Deletes drafts nobody can apply or discard any more. Waits out the sync window, like the merge. */
  private queueDraftCleanup(): void {
    if (this.draftCleanupQueued || this.readOnly || this.linked) return;
    this.draftCleanupQueued = true;
    const run = (): void => {
      if (this.destroyed) return;
      if (this.api.blocks.isSyncingFromYjs) {
        requestAnimationFrame(run);

        return;
      }
      this.draftCleanupQueued = false;
      this.deleteAbandonedDrafts();
    };

    queueMicrotask(run);
  }

  /**
   * A peer deleted this editor's draft layout block while its Apply (or the
   * redo of one) was still on the way: the merged document names a missing
   * block, and the tabs put back in it sit at the root. The block comes back
   * with the same id and its tabs go into it, Content first. Only the maker
   * can do it: no record says which root tabs were whose.
   */
  private repairLayoutBlock(): void {
    const named = this.model.getPageLayout().tabsId;

    if (named === undefined || !this.layoutDrafts.made.has(named) || this.api.blocks.getById(named) !== null) return;
    const strays = [...this.layoutDrafts.made]
      .map((id) => this.api.blocks.getById(id))
      .filter((block): block is BlockAPI => block !== null && block.name === 'tab' && (block.parentId === null || this.api.blocks.getById(block.parentId) === null))
      .sort((a, b) => Number(this.isViewTab(a.id)) - Number(this.isViewTab(b.id)));

    if (strays.length === 0) return;
    // Taken out and put back with the same ids, as Apply does: moveTo refuses a tabs block, which owns its tabs.
    const subtrees = strays.map((tab) => this.subtreeOf(tab.id).map((block) => (block.id === tab.id ? { ...block, parentId: named } : block)));

    this.api.blocks.transactWithoutCapture?.(() => {
      this.api.blocks.insertAt('tabs', { noSeed: true }, { parentId: this.dataId, position: 'end', id: named });
      strays.forEach((tab) => this.removeBlock(tab.id));
    });
    const putBack = (): void => {
      if (this.destroyed) return;
      if (this.api.blocks.isSyncingFromYjs) {
        requestAnimationFrame(putBack);

        return;
      }
      this.api.blocks.transactWithoutCapture?.(() => this.putBackTabs(subtrees));
      this.mountRows();
    };

    putBack();
  }

  private deleteAbandonedDrafts(): void {
    if (!this.canEditLayoutTabs()) return;
    this.repairLayoutBlock();
    const now = Date.now();
    const abandoned = (block: BlockAPI): boolean => {
      const draft = layoutDraftOf(this.layoutDataOf(block));

      return draft !== undefined && this.isForeignDraft(block) && this.layoutDrafts.isAbandoned(block.id, draft, now);
    };
    // A tabs block goes whole only when every tab in it goes too.
    const doomed = this.api.blocks.getChildren(this.dataId).filter((child) => child.name === 'tabs').flatMap((tabs) => {
      const gone = this.api.blocks.getChildren(tabs.id).filter(abandoned).map((tab) => tab.id);

      return abandoned(tabs) && gone.length === this.api.blocks.getChildren(tabs.id).length ? [tabs.id] : gone;
    });

    if (doomed.length === 0) return;
    this.api.blocks.transactWithoutCapture?.(() => doomed.forEach((id) => this.removeBlock(id)));
    this.mountRows();
  }

  /** A change to the layout tabs block or a tab in it: remount and redraw the open row page once. */
  private isLayoutTabsChange(target: ChangedBlock | undefined): boolean {
    if (target?.name !== 'tabs' && target?.name !== 'tab') return false;
    const parentId = typeof target.parentId === 'string' ? target.parentId : null;

    return parentId === this.dataId || (parentId !== null && this.api.blocks.getById(parentId)?.parentId === this.dataId);
  }

  private layoutTabsQueued = false;
  /** Tabs blocks this editor made. Only their maker merges them, so two peers never move the same tab. */
  private readonly madeTabsBlocks = new Set<string>();

  /**
   * Two peers each made the first view tab: two tabs blocks. Every peer reads
   * the same winner (`pageLayoutTabsId`, one key). The maker of a loser moves
   * its view tabs into the winner and deletes it, with no undo step.
   */
  private mergeQueued = false;

  /** A merge waits out the sync window it was noticed in: a write inside it would read as its echo. */
  private queueMergeLayoutTabs(): void {
    if (this.mergeQueued || this.madeTabsBlocks.size === 0) return;
    this.mergeQueued = true;
    const run = (): void => {
      if (this.destroyed) return;
      if (this.api.blocks.isSyncingFromYjs) {
        requestAnimationFrame(run);

        return;
      }
      this.mergeQueued = false;
      this.mergeLayoutTabs();
    };

    run();
  }

  private mergeLayoutTabs(): void {
    const winner = this.layoutTabsBlock();
    const losers = this.api.blocks.getChildren(this.dataId)
      .filter((child) => child.name === 'tabs' && child.id !== winner?.id && this.madeTabsBlocks.has(child.id)
        // An open draft still owns it: Discard must find its tabs where it made them.
        && !(this.cardDrawer?.draftTabBlocks.includes(child.id) ?? false)
        // A draft tab in it, anyone's, waits for its Apply or Discard: then the merge runs again.
        && !this.api.blocks.getChildren(child.id).some((tab) => layoutDraftOf(this.layoutDataOf(tab)) !== undefined));

    if (winner === undefined || losers.length === 0 || this.readOnly || this.model.getPageLayout().tabsId !== winner.id) return;
    // Copies, not moves: the tabs sit in this editor's Apply step, and undoing
    // a step whose blocks moved under another parent leaves their ids behind
    // in that parent on this peer only.
    // Only view tabs come: the winner has its own Content.
    // A draft tab stays with its maker's Discard or Apply.
    const copies = losers.flatMap((loser) => this.api.blocks.getChildren(loser.id)
      .filter((tab) => this.isViewTab(tab.id) && layoutDraftOf(this.layoutDataOf(tab)) === undefined)
      .map((tab) => this.subtreeOf(tab.id)));

    this.api.blocks.transactWithoutCapture?.(() => {
      for (const loser of losers) {
        this.madeTabsBlocks.delete(loser.id);
        this.removeBlock(loser.id);
      }
      for (const subtree of copies) {
        const ids = new Map(subtree.map((block) => [block.id, nanoid()]));

        for (const block of subtree) {
          const parentId = block.parentId === null ? null : ids.get(block.parentId) ?? winner.id;

          this.api.blocks.insertAt(block.name, block.data, { parentId, position: 'end', id: ids.get(block.id) });
        }
      }
    });
  }
  /** The tab list the open row page last drew. Moving a view's holder fires block changes too, which must not redraw again. */
  private layoutTabsSeen = '';

  private queueLayoutTabsSync(): void {
    if (this.layoutTabsQueued) return;
    this.layoutTabsQueued = true;
    queueMicrotask(() => {
      this.layoutTabsQueued = false;
      if (this.destroyed) return;
      this.queueMergeLayoutTabs();
      this.mountRows();
      const seen = JSON.stringify([this.layoutTabsBlock()?.id, this.layoutTabsList()]);

      this.queueDraftCleanup();
      if (seen === this.layoutTabsSeen) return;
      this.layoutTabsSeen = seen;
      this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    });
  }

  private canEditLayoutTabs(): boolean {
    const names = new Set(this.api.tools.getBlockTools().map((tool) => tool.name));

    return !this.readOnly && !this.linked && !this.structureLocked() && names.has('tabs') && names.has('tab') && this.api.blocks.transactWithoutCapture !== undefined;
  }

  /** A linked view's data: its one view copies the source's first table view (Notion, R:2021-12-23). */
  private linkedViewData(databaseId: string, name: string, filters?: FilterConfig[], overrides: Partial<DatabaseViewConfig> = {}): DatabaseData {
    const view = { ...this.linkedFirstView(databaseId), ...(filters !== undefined ? { filters } : {}), ...overrides };
    const title = this.model.getSchema().find((p) => p.type === 'title');

    return {
      title: '',
      schema: title === undefined ? [] : [structuredClone(title)],
      views: [{ ...view, name }],
      activeViewId: view.id,
      source: { databaseId },
    };
  }

  private removeBlock(id: string): void {
    const index = this.api.blocks.getBlockIndex(id);

    if (index !== undefined) void this.api.blocks.delete(index, false);
  }

  /** A block and its descendants as saved, parents first. */
  private subtreeOf(id: string): Array<{ id: string; name: string; parentId: string | null; data: BlockToolData }> {
    const block = this.api.blocks.getById(id);

    if (block === null) return [];

    return [
      { id, name: block.name, parentId: block.parentId, data: structuredClone(block.preservedData) },
      ...this.api.blocks.getChildren(id).flatMap((child) => this.subtreeOf(child.id)),
    ];
  }

  /** Makes a view tab of `sourceId` at once, with no undo step. `made` is what Discard deletes. */
  private makeViewTab(sourceId: string, title: string, filters?: FilterConfig[], overrides?: Partial<DatabaseViewConfig>): { tabId: string; made: string; contentId: string | null } | null {
    if (!this.canEditLayoutTabs()) return null;
    const made: { tabId: string; made: string; contentId: string | null } = { tabId: '', made: '', contentId: null };

    this.api.blocks.transactWithoutCapture?.(() => {
      const existing = this.layoutTabsBlock();
      const tabs = existing ?? this.api.blocks.insertAt('tabs', this.draftData({ noSeed: true }), { parentId: this.dataId, position: 'end' });

      // An undone Apply, or a peer's, can leave the block without Content: it comes first again.
      // Unmarked in a block that exists: neither Apply nor Discard takes it, and peers draw Content anyway.
      if (existing === undefined || !this.hasContentTab(tabs.id)) {
        made.contentId = this.api.blocks.insertAt('tab', existing === undefined ? this.draftData({ title: '' }) : { title: '' }, { parentId: tabs.id, position: 'start' }).id;
        this.layoutDrafts.made.add(made.contentId);
      }
      const tab = this.api.blocks.insertAt('tab', this.draftData({ title }), { parentId: tabs.id, position: 'end' });

      this.layoutDrafts.made.add(tab.id);
      if (existing === undefined) this.layoutDrafts.made.add(tabs.id);
      this.api.blocks.insertAt('database', this.linkedViewData(sourceId, title, filters, overrides), { parentId: tab.id, position: 'end' });
      made.tabId = tab.id;
      made.made = existing === undefined ? tabs.id : tab.id;
      if (existing === undefined) this.madeTabsBlocks.add(tabs.id);
    });
    this.mountRows();

    return made.tabId === '' ? null : made;
  }

  private relatedTabSources(): ReturnType<typeof relatedTabSources> {
    const titles = new Map(this.documentDatabases().map((database) => [database.id, database.title]));

    return relatedTabSources(this.model.getSchema(), this.dataId, (property) => this.syncedMirror(property), (id) => titles.get(id));
  }

  /** The row page a linked view is shown on: its "This page" filters read it. */
  private thisPage: string | null = null;

  /** "Add new relation" relations of this session, by id: their mirror, for Discard. */
  private readonly madeTabRelations = new Map<string, { databaseId: string; propertyId: string }>();

  /** Another writable, unlocked database of this document: "Add new relation" can point to it. */
  private canRelateTab(sourceId: string): boolean {
    const owner = sourceId === this.dataId || this.isLinkedBlock(sourceId) ? undefined : this.dashboardOwner(sourceId);

    // A locked source keeps its properties as they are, so it takes no mirror.
    return owner !== undefined && !owner.readOnly && !owner.structureLocked();
  }

  /**
   * research/13 §2 "Add view & relation": a two-way relation to `sourceId`,
   * its mirror there named `relatedName`, in one undo step like a builder-made
   * property; then a view tab of the source filtered by the mirror. The schema
   * is written before the tab: an insert opens a sync window, and a database
   * change inside it is saved outside the step.
   */
  private addRelationTab(sourceId: string, name: string, relatedName: string): ReturnType<LayoutTabsHost['addWithRelation']> {
    if (!this.canEditLayoutTabs() || !this.canRelateTab(sourceId)) return null;
    const made = { forward: '', back: null as string | null };
    const write = (): void => {
      // In the model only until the source takes the mirror, which needs this id:
      // a refusal then leaves no row list, no undo step and no backend call.
      made.forward = this.model.addProperty(name, 'relation', undefined, {}, { relation: { targetDatabaseId: sourceId } }).id;
      made.back = this.addForeignRelation(sourceId, relatedName, { targetDatabaseId: this.dataId, twoWay: true, syncedPropertyId: made.forward });
      if (made.back === null) {
        this.model.deleteProperty(made.forward);

        return;
      }
      const relation = { targetDatabaseId: sourceId, twoWay: true, syncedPropertyId: made.back };

      this.model.updateProperty(made.forward, { relation });
      this.writeEmptyLists(made.forward);
      const prop = this.model.getProperty(made.forward);

      if (prop !== undefined) void this.sync.syncCreateProperty({ id: prop.id, name: prop.name, type: prop.type, position: prop.position, relation });
      this.writeSchema();
    };

    if (this.api.blocks.transact !== undefined) this.api.blocks.transact(write);
    else write();
    if (made.back === null) return null;
    this.madeTabRelations.set(made.forward, { databaseId: sourceId, propertyId: made.back });
    this.syncRowsFromBlocks();
    this.commitSchema();
    const tab = this.makeViewTab(sourceId, name, [thisPageFilter(made.back)]);

    return tab === null ? null : { ...tab, propertyId: made.forward };
  }

  /**
   * research/13 §3c: a copy of a view tab at the end of the bar, made at once
   * with no undo step, like Add view. Views are read live (the saved data lags
   * until the async save) and get new ids: personal view state is keyed by them.
   */
  private duplicateViewTab(tabId: string, title: string): ReturnType<LayoutTabsHost['duplicate']> {
    const tabs = this.layoutTabsBlock();
    const view = this.api.blocks.getChildren(tabId).find((child) => child.name === 'database');

    if (!this.canEditLayoutTabs() || tabs === undefined || view === undefined || this.api.blocks.getById(tabId)?.parentId !== tabs.id) return null;
    const live: DatabaseViewConfig[][] = [];

    view.call('readViews', { receive: (views: DatabaseViewConfig[]) => live.push(views) });
    const saved = structuredClone(view.preservedData) as DatabaseData;
    const ids = new Map((live[0] ?? saved.views ?? []).map((each) => [each.id, nanoid()]));
    const views = (live[0] ?? saved.views ?? []).map((each) => ({ ...structuredClone(each), id: ids.get(each.id) ?? nanoid() }));
    const made = { tabId: '' };

    this.api.blocks.transactWithoutCapture?.(() => {
      const tab = this.api.blocks.insertAt('tab', this.draftData({ title }), { parentId: tabs.id, position: 'end' });

      this.layoutDrafts.made.add(tab.id);
      this.api.blocks.insertAt('database', { ...saved, views, activeViewId: ids.get(saved.activeViewId ?? '') ?? views[0]?.id }, { parentId: tab.id, position: 'end' });
      made.tabId = tab.id;
    });
    this.mountRows();

    return made.tabId === '' ? null : { tabId: made.tabId, made: made.tabId, contentId: null };
  }

  /** Called by a database discarding a relation that "Add new relation" made: its mirror here goes too. */
  deleteMirrorProperty(param: { propertyId: string }): void {
    this.deleteProperty(param.propertyId);
  }

  /** Discard of "Add new relation": the relation and its mirror go, in one undo step. */
  private removeTabRelation(propertyId: string): void {
    // Recorded at creation: the relation may be gone already (the user or a peer deleted it).
    const mirror = this.madeTabRelations.get(propertyId);

    this.madeTabRelations.delete(propertyId);
    if (this.readOnly) return;
    const write = (): void => {
      this.deleteProperty(propertyId);
      if (mirror !== undefined) this.api.blocks.getById(mirror.databaseId)?.call('deleteMirrorProperty', { propertyId: mirror.propertyId });
    };

    if (this.api.blocks.transact !== undefined) this.api.blocks.transact(write);
    else write();
    this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
  }

  /** Called by the database whose row page shows this linked view. */
  showOnRowPage(param: { rowId: string | null }): void {
    if (this.destroyed || param.rowId === this.thisPage) return;
    this.thisPage = param.rowId;
    this.rerenderView();
  }

  private readonly layoutTabsHost: LayoutTabsHost = {
    canEdit: () => this.canEditLayoutTabs(),
    list: () => this.layoutTabsList(),
    sources: () => this.documentDatabases().filter((database) => database.id === this.dataId || !this.isLinkedBlock(database.id)),
    add: (sourceId, title) => this.makeViewTab(sourceId, title),
    related: () => this.relatedTabSources().map(({ propertyId, title }) => ({ propertyId, title })),
    addRelated: (propertyId) => {
      const source = this.relatedTabSources().find((each) => each.propertyId === propertyId);

      if (source === undefined) return null;
      // research/36 §12: every column, the title first, then by name, a later property too. Measured on a self-relation only.
      const columns: Partial<DatabaseViewConfig> | undefined = source.sourceId === this.dataId
        ? { properties: [], visibleProperties: [], propertyOrder: 'alphabetical' }
        : undefined;

      return this.makeViewTab(source.sourceId, source.title, [thisPageFilter(source.backPropertyId)], columns);
    },
    canRelate: (sourceId) => this.canRelateTab(sourceId),
    propertyNames: (sourceId) => (sourceId === this.dataId ? this.model.getSchema() : this.readDatabaseSource(sourceId)?.schema ?? []).map((property) => property.name),
    addWithRelation: (sourceId, name, relatedName) => this.addRelationTab(sourceId, name, relatedName),
    removeRelation: (propertyId) => this.removeTabRelation(propertyId),
    duplicate: (tabId, title) => this.duplicateViewTab(tabId, title),
    ensure: () => {
      if (!this.canEditLayoutTabs()) return null;
      const existing = this.layoutTabsBlock();

      if (existing !== undefined && this.hasContentTab(existing.id)) return null;
      const made = { contentId: '', made: '' };

      this.api.blocks.transactWithoutCapture?.(() => {
        const tabs = existing ?? this.api.blocks.insertAt('tabs', this.draftData({ noSeed: true }), { parentId: this.dataId, position: 'end' });

        made.contentId = this.api.blocks.insertAt('tab', this.draftData({ title: '' }), { parentId: tabs.id, position: 'start' }).id;
        this.layoutDrafts.made.add(made.contentId);
        made.made = existing === undefined ? tabs.id : made.contentId;
        if (existing === undefined) this.madeTabsBlocks.add(tabs.id);
        if (existing === undefined) this.layoutDrafts.made.add(tabs.id);
      });
      this.mountRows();

      return made.made === '' ? null : made;
    },
    renameMade: (tabId, title) => {
      const tab = this.api.blocks.getById(tabId);

      if (tab === null || !this.canEditLayoutTabs()) return;
      this.api.blocks.transactWithoutCapture?.(() => {
        tab.call('setData', { title });
        tab.dispatchChange({ derived: true });
      });
    },
    discard: (made) => {
      // A copy this discard cannot reach (a room reset tears the builder down) then hides here as a peer's.
      made.forEach((id) => this.layoutDrafts.made.delete(id));
      const live = made.filter((id) => this.api.blocks.getById(id) !== null);

      if (live.length === 0 || this.readOnly) return;
      this.api.blocks.transactWithoutCapture?.(() => live.forEach((id) => this.removeBlock(id)));
    },
    attach: (tabId, host, rowId) => this.attachLayoutTab(tabId, host, rowId),
    detach: () => this.detachLayoutTab(),
    notify: (message) => this.api.notifier.show({ message }),
  };

  /** Whether the layout tabs holder is lent to a row page's tab panel. */
  private layoutTabsLent = false;

  /**
   * Lends the layout tabs block to a row page's view tab panel, opened on
   * `tabId`. The whole tabs holder moves, not the tab's database: a database
   * child is placed by the database, so the saver's home-slot check passes,
   * while a tab's child outside its tab would fail it. Refused when `host`
   * sits inside the tabs block: a row page opened from the view itself.
   */
  private attachLayoutTab(tabId: string, host: HTMLElement, rowId: string): boolean {
    const tabs = this.layoutTabsBlock();
    const tab = this.api.blocks.getById(tabId);

    if (tabs === undefined || tab === null || tab.parentId !== tabs.id || tabs.holder.contains(host)) return false;
    // Not cleared on detach: the view is hidden then, and clearing would redraw it twice per refresh.
    this.api.blocks.getChildren(tab.id).forEach((view) => view.call('showOnRowPage', { rowId }));
    moveElementToEnd(host, tabs.holder);
    this.layoutTabsLent = true;
    // The tab's own lever, as find-in-page uses it: open this tab in its tabs block.
    tab.call('expand');

    return true;
  }

  private detachLayoutTab(): void {
    if (!this.layoutTabsLent) return;
    this.layoutTabsLent = false;
    this.mountRows();
  }

  /**
   * Apply: tabs made while customizing were saved without an undo step. They
   * are taken out (still without one) and put back with the same ids inside
   * the Apply step, so one undo removes them with the rest of the layout.
   */
  private takeMadeTabs(made: string[]): Array<Array<{ id: string; name: string; parentId: string | null; data: BlockToolData }>> {
    const live = made.filter((id) => this.api.blocks.getById(id) !== null);
    // A tabs block made now stays out of the step: once a peer's tab sits in
    // it, undoing the step that inserted it spares the block and leaves stale
    // content ids on the undoer. Its tabs go and come back instead.
    const roots = live.flatMap((id) => {
      const block = this.api.blocks.getById(id);

      return block?.name === 'tabs' ? this.api.blocks.getChildren(id).map((child) => child.id) : [id];
    }).filter((id, i, all) => all.indexOf(id) === i && !all.includes(this.api.blocks.getById(id)?.parentId ?? ''));
    const subtrees = roots.map((id) => this.subtreeOf(id));

    if (subtrees.length > 0) this.api.blocks.transactWithoutCapture?.(() => roots.forEach((id) => this.removeBlock(id)));

    return subtrees;
  }

  private putBackTabs(subtrees: Array<Array<{ id: string; name: string; parentId: string | null; data: BlockToolData }>>): void {
    // Parents come first in each subtree, so every parent exists by its children's turn.
    for (const block of subtrees.flat()) {
      if (block.parentId === null || this.api.blocks.getById(block.parentId) !== null) {
        // A tabs block must not seed tabs of its own: its tabs follow. Applied now: no draft mark.
        const { draft: _draft, ...applied } = block.data as BlockToolData & { draft?: unknown };
        const data = block.name === 'tabs' ? { ...applied, noSeed: true } : applied;

        this.api.blocks.insertAt(block.name, data, { parentId: block.parentId, position: 'end', id: block.id });
      }
    }
  }

  private applyPageLayout(edit: PageLayoutOp | null, visibility: ReadonlyMap<string, PageVisibility> | undefined, tabs: LayoutTabsDraft | undefined): void {
    const taken = tabs === undefined ? [] : this.takeMadeTabs(tabs.made);
    // Reset discards the tabs made now (research/11 §1), outside its step, so Undo cannot bring them back.
    const subtrees = tabs?.reset === true ? [] : taken;

    if (taken.length === 0) {
      this.writePageLayout(edit, visibility, tabs, subtrees);

      return;
    }
    // The removal above replays through the document first. A write made
    // while it does reads as its echo and is saved outside every undo step.
    const run = (): void => {
      if (this.destroyed) return;
      if (this.api.blocks.isSyncingFromYjs) {
        requestAnimationFrame(run);

        return;
      }
      this.writePageLayout(edit, visibility, tabs, subtrees);
    };

    run();
  }

  private writePageLayout(
    edit: PageLayoutOp | null,
    visibility: ReadonlyMap<string, PageVisibility> | undefined,
    tabs: LayoutTabsDraft | undefined,
    subtrees: Array<Array<{ id: string; name: string; parentId: string | null; data: BlockToolData }>>
  ): void {
    const block = this.layoutTabsBlock();
    const tabsId = tabs?.reset === true ? undefined : block?.id;
    const named = tabsId !== undefined && tabsId !== this.model.getPageLayout().tabsId;

    // One undo step. The schema is written first: an insert below opens a sync
    // window, and a database change made inside it reads as an echo and is
    // saved outside the step.
    this.inOneStep(() => {
      for (const [propertyId, pageVisibility] of visibility ?? []) this.updatePropertySettings(propertyId, { pageVisibility });
      if (edit !== null || named) {
        this.setPageLayout((layout) => {
          const next = edit === null ? layout : edit(layout);

          return named ? setTabsId(tabsId)(next) : next;
        });
      }
      // In the step: undo puts the mark back, so an undone first Apply leaves a draft, not a stray block.
      if (tabs?.reset !== true && block !== undefined && layoutDraftOf(this.layoutDataOf(block)) !== undefined) {
        block.call('setData', {});
        block.dispatchChange();
      }
      this.putBackTabs(subtrees);
      for (const id of tabs?.removed ?? []) this.removeBlock(id);
      // After putBackTabs: tabs made now come back at the end.
      if (tabs?.order !== undefined && block !== undefined) this.reorderLayoutTabs(block, tabs.order);
      for (const [id, title] of tabs?.titles ?? []) {
        const tab = this.api.blocks.getById(id);

        tab?.call('setData', { title });
        tab?.dispatchChange();
      }
      if (tabs?.reset === true && block !== undefined) this.removeBlock(block.id);
    });
    this.mountRows();
    // A peer's tabs block may have won while this draft was open.
    this.queueMergeLayoutTabs();
  }

  /**
   * Puts the view tabs in `order` with the tabs block's own move. Read from
   * the live children: a peer's tab, or one this draft never saw, keeps its slot.
   */
  private reorderLayoutTabs(block: BlockAPI, order: string[]): void {
    const children = (): string[] => this.api.blocks.getChildren(block.id).map((child) => child.id);
    const target = inTabOrder(children(), order);

    // From the end: each tab lands before the one already placed after it.
    target.map((id, i) => ({ id, next: target[i + 1] })).reverse().forEach(({ id, next }) => {
      const live = children();

      if (live[live.indexOf(id) + 1] !== next) block.call('moveTab', next === undefined ? { id } : { id, before: next });
    });
  }

  /**
   * Shows the row's child blocks in `host`. A legacy body blob is turned into
   * child blocks first. A read-only viewer cannot write, so for an unconverted
   * blob it gets false and the drawer shows the blob read-only.
   */
  private attachRowBody(rowId: string, host: HTMLElement, writable: () => boolean): boolean {
    const block = this.api.blocks.getById(rowId) ?? undefined;
    const row = this.rowOrTemplate(rowId);

    if (block === undefined || row === undefined) {
      return false;
    }
    const live: DatabaseRowData[] = [];

    block.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });
    const descriptionId = this.model.getSchema().find((property) => property.type === 'richText')?.id;
    const legacy = live[0]?.bodyBlocks === true ? undefined : rowDescription(row, this.model.getSchema(), descriptionId);
    const unconverted = legacy !== undefined && legacy.blocks.length > 0;

    if (unconverted && (this.readOnly || !writable())) {
      return false;
    }
    if (unconverted) {
      this.convertLegacyBody(block, legacy);
    }
    this.mountRows();
    moveElementToEnd(host, block.holder);

    return true;
  }

  /**
   * One derived step, never an undo step: undo would bring the blob back as
   * the only body. The blob stays in `properties` because older clients still
   * read the body from it; a later version removes it. Edits those clients make
   * to it after this are not carried over.
   */
  private convertLegacyBody(block: BlockAPI, legacy: OutputData): void {
    const inserts = legacyBodyInserts(block.id, legacy);
    const run = (): void => {
      const state = { complete: true };

      for (const insert of inserts) {
        if (this.api.blocks.getById(insert.id) !== null) continue;
        try {
          this.api.blocks.insertAt(insert.type, insert.data, { parentId: insert.parentId ?? block.id, position: 'end', id: insert.id });
        } catch {
          state.complete = false;
        }
      }
      if (state.complete) {
        block.call('markBodyBlocks');
        block.dispatchChange({ derived: true });
      }
    };

    if (this.api.blocks.transactWithoutCapture !== undefined) {
      this.api.blocks.transactWithoutCapture(run);
    } else {
      run();
    }
  }

  private isOwnRowChange(target: ChangedBlock | undefined): boolean {
    if (target?.name !== 'database-row') {
      return false;
    }

    if (typeof target.parentId !== 'string' || target.parentId === this.dataId) {
      return true;
    }

    return typeof target.id === 'string' && this.model.getRow(target.id) !== undefined;
  }

  /** Another database of this editor rendered: re-read it if this one relates to it. */
  private readonly handleDatabaseRendered = (payload: unknown): void => {
    const databaseId = (payload as { databaseId?: unknown } | undefined)?.databaseId;

    if (this.destroyed || typeof databaseId !== 'string' || !this.isRelatedChange({ id: databaseId, name: 'database' })) return;
    if (this.view instanceof DatabaseDashboardView) {
      if (databaseId !== this.block.id) this.redrawWhenIdle();

      return;
    }
    if (this.source?.databaseId === databaseId) {
      // A source back from undo makes the view writable again.
      this.rebuildTabBar();
      this.rerenderView({ keepDrawer: true });

      return;
    }
    this.reprojectRows();
  };

  /**
   * A row or the schema of a database this one relates to: its titles and
   * values feed this database's relation chips and rollups.
   */
  private isRelatedChange(target: ChangedBlock | undefined): boolean {
    const related = this.model.getSchema()
      .flatMap((property) => (property.type === 'relation' && property.relation?.targetDocumentId === undefined ? [property.relation?.targetDatabaseId] : []))
      .filter((id): id is string => id !== undefined && id !== this.dataId)
      .concat(this.source !== undefined ? [this.source.databaseId] : [])
      .concat(this.view instanceof DatabaseDashboardView ? [...this.dashboardSources].filter((id) => id !== this.block.id) : []);

    if (related.length === 0 || target === undefined) return false;
    if (target.name === 'database') return typeof target.id === 'string' && related.includes(target.id);

    return target.name === 'database-row' && typeof target.parentId === 'string' && related.includes(target.parentId);
  }

  private reprojectRows(): void {
    if (this.boardContainer === null) {
      return;
    }
    // The source may have been renamed.
    this.paintLinkedTitle();

    this.mountRows();

    const before = this.model.getOrderedRows();

    this.syncRowsFromBlocks();

    const after = this.model.getOrderedRows();

    this.resolveMovedRows(before, after);
    const retitled = this.retitledRows(before, after);
    const openRowId = this.cardDrawer?.openRowId ?? null;

    if (openRowId !== null) {
      const openBefore = before.find((row) => row.id === openRowId);
      const openAfter = this.rowOrTemplate(openRowId);

      if (JSON.stringify(openBefore) !== JSON.stringify(openAfter)) {
        this.cardDrawer?.syncOpenRow(openAfter);
      }
    }

    // A self-relation chip or a formula can show a row's title: a rename redraws them.
    const titleShownElsewhere = this.model.getSchema().some((property) => property.type === 'formula'
      || (property.type === 'relation' && property.relation?.targetDatabaseId === this.dataId));

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
    const saved = this.shownView();
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

    if (focused instanceof HTMLInputElement && this.viewRoot()?.contains(focused) === true) {
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
    const dashboard = this.view instanceof DatabaseDashboardView ? this.view : undefined;
    const container = this.boardContainer;
    const source = dashboard === undefined || container === null ? undefined
      : [...this.dashboardSources].map((sourceId) => this.dashboardOwner(sourceId)).find((candidate) => {
        const held = candidate?.titleIconMenu;

        return candidate !== undefined && held !== undefined && held !== null
          && candidate.propertyMenu === held.menu && held.menu.isOpen && held.context.writable()
          && container.contains(held.context.root);
      });
    const held = source?.titleIconMenu;

    if (dashboard !== undefined && source !== undefined && held !== undefined && held !== null) {
      const showPageIcon = showsPageIcon(held.context.view);

      held.menu.syncPageIcon(showPageIcon);
      if (held.showPageIcon === showPageIcon) return;
      held.showPageIcon = showPageIcon;
      const titlePropertyId = source.titlePropertyId();

      for (const row of source.model.getOrderedRows()) {
        const title = row.properties[titlePropertyId];

        dashboard.updateRowTitle(held.context.root, row.id, typeof title === 'string' ? title : '');
      }

      return;
    }
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
    const children = this.api.blocks.getChildren(this.dataId);
    const rowBlock = children.find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updateTitle', { title, titlePropertyId: titlePropId });
      rowBlock.dispatchChange();
    }

    this.syncRowsFromBlocks();
  }

  /** An automation or autofill value: saved, but not an undo step of the person's. */
  private writeHostValues(rowId: string, changes: Record<string, PropertyValue>): boolean {
    const rowBlock = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

    if (this.readOnly || this.destroyed || rowBlock === undefined) return false;
    const titlePropId = this.titlePropertyId();
    const stored = Object.fromEntries(Object.entries(changes).filter(([propertyId]) => {
      const type = this.model.getProperty(propertyId)?.type;

      return type !== undefined && !isReadOnlyType(type);
    }).map(([propertyId, value]) => {
      const type = this.model.getProperty(propertyId)?.type;

      return [propertyId, value === null && type !== undefined && isListValueType(type) ? [] : value];
    }));

    if (Object.keys(stored).length === 0) return false;
    const { [titlePropId]: title, ...rest } = stored;

    if (title !== undefined) {
      rowBlock.call('updateTitle', { title: typeof title === 'string' ? title : '', titlePropertyId: titlePropId });
    }
    if (Object.keys(rest).length > 0) {
      rowBlock.call('updateProperties', rest);
    }
    rowBlock.dispatchChange({ derived: true });
    this.syncRowsFromBlocks();
    // Host answers land at any time: a redraw now would close an editor mid-typing.
    this.redrawWhenIdle();
    this.sync.syncUpdateRow({ rowId, properties: stored });

    return true;
  }

  /** An automation's "Add page to": a new row at the end. */
  private addHostRow(properties: Record<string, PropertyValue>): boolean {
    return this.insertRow(properties, { rerender: true }) !== undefined;
  }

  /** A new row at the end with these values. Undefined when writes are refused. */
  /** `anonymous`: an anonymous form answer, stored with no author (research/23 §6). */
  private insertRow(properties: Record<string, PropertyValue>, options: { rerender: boolean; anonymous?: boolean }): string | undefined {
    if (this.readOnly || this.destroyed) return undefined;
    const titlePropId = this.titlePropertyId();
    const anonymous = options.anonymous === true;
    const rowData = this.model.createRowData(properties, { anonymous });
    const title = rowData.properties[titlePropId];

    this.api.blocks.insertAt(
      'database-row',
      { properties: rowData.properties, position: rowData.position, title: typeof title === 'string' ? title : '', ...(anonymous ? { anonymous: true } : {}) },
      { parentId: this.dataId, position: 'end', id: rowData.id, ...(anonymous ? { anonymous: true } : {}) },
    );
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    if (options.rerender) {
      this.redrawWhenIdle();
    } else {
      this.syncRowsFromBlocks();
    }

    return rowData.id;
  }

  private deleteRowBlock(rowId: string): void {
    this.pendingDescriptions.delete(rowId);
    const pair = this.model.subItemPair();
    // Deleting a parent deletes its sub-items (research/05 §11.1).
    const subItems = pair === undefined ? [] : descendantsOf(rowId, this.model.getOrderedRows(), pair.forward);
    const remove = (): void => {
      [...subItems].reverse().forEach((id) => this.removeRowBlock(id));
      this.removeRowBlock(rowId);
    };
    const linked = this.model.getSchema().some((property) => property.type === 'relation');

    subItems.forEach((id) => void this.sync.syncDeleteRow({ rowId: id }));
    if (linked && this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(remove);
    } else {
      remove();
    }

    this.syncRowsFromBlocks();
  }

  private removeRowBlock(rowId: string): void {
    this.unlinkDeletedRow(rowId);
    const blockIndex = this.api.blocks.getBlockIndex(rowId);

    if (blockIndex !== undefined) {
      void this.api.blocks.delete(blockIndex);
    }
  }

  private updateRowBlock(rowId: string, propertyChanges: Record<string, PropertyValue>): void {
    const children = this.api.blocks.getChildren(this.dataId);
    const rowBlock = children.find((child) => child.id === rowId);
    // Formula and rollup values are computed: a write to one (a drop into a
    // formula group, a paste) would shadow the result with stale data.
    // A null list would replace the container peers' adds merge into.
    const stored = Object.fromEntries(Object.entries(propertyChanges).filter(([propertyId]) => {
      const type = this.model.getProperty(propertyId)?.type;

      return type !== 'formula' && type !== 'rollup' && type !== 'button';
    }).map(([propertyId, value]) => {
      const type = this.model.getProperty(propertyId)?.type;

      return [propertyId, value === null && type !== undefined && isListValueType(type) ? [] : value];
    }));

    // A cleared date takes its reminder along in the same write, so one undo restores both.
    const reminders = this.rowOrTemplate(rowId)?.reminders ?? {};
    const dropped = Object.keys(stored).filter((propertyId) => stored[propertyId] === null && reminders[propertyId] !== undefined);

    if (rowBlock !== undefined && Object.keys(stored).length > 0) {
      if (dropped.length > 0) rowBlock.call('updateReminders', Object.fromEntries(dropped.map((propertyId) => [propertyId, null])));
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

      if (!isOutputData(beforeCopy) || !equalsOutputData(beforeCopy, body)) return;

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
        || !isOutputData(current)
        || !equalsOutputData(current, body)) {
        throw new Error('Copy receipt did not match the current row body');
      }

      const rowBlock = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

      if (rowBlock === undefined) return;
      rowBlock.call('updatePageId', { pageId: receipt.pageId });
      // The host committed it: undo must not strip it.
      rowBlock.dispatchChange({ derived: true });
      this.syncRowsFromBlocks();
      if (this.cardDrawer?.openRowId === rowId) {
        this.cardDrawer.syncOpenRow(this.rowOrTemplate(rowId));
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
    const children = this.api.blocks.getChildren(this.dataId);
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
    this.sync = new DatabaseBackendSync(
      this.config.adapter, (error) => this.showBackendError(error), this.hostLevers, this.backendRows,
      deletedBackendRowsOf(this.config.adapter, this.block.id),
    );
  }

  private switchView(viewId: string): void {
    if (viewId === this.activeViewId || this.boardContainer === null) {
      return;
    }
    this.rowSelection.clear();

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

    this.wireView(newBoardWrapper);

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
    const bar = this.ownTabBarElement();
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
    if (this.structureLocked()) return;
    const statusProp = this.model.getSchema().find((p) => p.type === 'select');
    const defaultNames: Partial<Record<ViewType, string>> = {
      list: DATABASE_DEFAULT_TEXT.viewTypeList,
      table: DATABASE_DEFAULT_TEXT.viewTypeTable,
      gallery: DATABASE_DEFAULT_TEXT.viewTypeGallery,
      calendar: DATABASE_DEFAULT_TEXT.viewTypeCalendar,
      timeline: DATABASE_DEFAULT_TEXT.viewTypeTimeline,
      chart: DATABASE_DEFAULT_TEXT.viewTypeChart,
      feed: DATABASE_DEFAULT_TEXT.viewTypeFeed,
      form: DATABASE_DEFAULT_TEXT.viewTypeForm,
      map: DATABASE_DEFAULT_TEXT.viewTypeMap,
    };
    if (type === 'map') this.ensurePlaceProperty();
    const newView = this.model.addView(defaultNames[type] ?? DATABASE_DEFAULT_TEXT.viewTypeBoard, type, {
      groupBy: type === 'board' || type === 'chart' ? statusProp?.id : undefined,
    });
    void this.sync.syncCreateView(structuredClone(newView));
    this.switchView(newView.id);
    if (type === 'form') this.askFormAutoCreate(newView.id);
    else if (this.linked && type !== 'dashboard') this.openLinkedAddView(newView.id, type);
  }

  /**
   * Add view's click: the view, then its settings (feel/findings-toolbar V05).
   * Form asks its own question, and a linked view opens its source picker.
   */
  private addViewWithSettings(type: ViewType): void {
    const before = this.activeViewId;

    this.addView(type);
    if (this.activeViewId === before || type === 'form' || this.linked) return;
    const tab = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(this.activeViewId)}"]`);
    const anchor = tab?.isConnected === true && tab.offsetParent !== null ? tab : this.titleRowElement ?? this.element;

    if (anchor !== null) this.controls.openSettings(anchor, 'layout');
  }

  /**
   * "New data source" (research/23 §10): a child database block with only a
   * title property, and a Table view of this block bound to it, selected.
   * One undo step removes both.
   */
  private addDataSource(): { sourceId: string; viewId: string } | undefined {
    if (this.readOnly || this.linked || this.structureLocked()) return undefined;
    const sourceId = nanoid();
    const sourceView: DatabaseViewConfig = {
      id: nanoid(), name: DATABASE_DEFAULT_TEXT.viewTypeTable, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [],
    };
    const data: DatabaseData = {
      title: '',
      schema: [{ id: nanoid(), name: DATABASE_DEFAULT_TEXT.sourceTitleProperty, type: 'title', position: 'a0' }],
      views: [sourceView],
      activeViewId: sourceView.id,
    };
    const view = this.model.addView(DATABASE_DEFAULT_TEXT.viewTypeTable, 'table');

    this.model.updateView(view.id, { dataSourceId: sourceId });
    this.inOneStep(() => {
      // Before the insert: a change dispatched inside its sync window is dropped as an echo.
      this.block.dispatchChange();
      this.api.blocks.insertAt('database', data, { parentId: this.block.id, position: 'end', id: sourceId });
    });
    void this.sync.syncCreateView(structuredClone({ ...view, dataSourceId: sourceId }));
    this.mountRows();
    this.switchView(view.id);

    return { sourceId, viewId: view.id };
  }

  /**
   * The menu's "New data source": the source and tab come at once, then the
   * panel on the new tab (research/23 §10). Only a click opens it, so undo,
   * redo and peers never do. Closing it keeps the empty source (research/26 §2).
   */
  private newDataSourceWithPanel(): void {
    const made = this.addDataSource();

    if (made === undefined) return;
    const anchor = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(made.viewId)}"]`)
      ?? this.titleRowElement ?? this.element;

    if (anchor === null) return;
    this.sourcePicker?.close();
    const panel = openNewSourcePanel({
      anchor,
      t: (key, vars) => this.api.i18n.t(key, vars),
      sources: () => this.linkableSources(),
      suggested: () => this.dataSourceChoices().filter((choice) => choice.id !== made.sourceId && choice.fits),
      importCsv: () => this.openCsvImport((file, targets, settings) => this.importCsvIntoSource(made.sourceId, file.text, targets, settings)),
      nameSource: (title) => this.nameNewSource(made.sourceId, title),
      linkExisting: (id) => this.linkNewSourceView(made, id),
      onClose: () => {
        if (this.sourcePicker === panel) this.sourcePicker = null;
      },
    });

    this.sourcePicker = panel;
  }

  /** Other databases of the document a view here may show: never this block, its own sources or a linked view. */
  private linkableSources(): LinkedPickerSource[] {
    const own = new Set(this.api.blocks.getChildren(this.block.id).map((child) => child.id));

    return this.pickerSources().filter((source) => !own.has(source.id) && this.dashboardOwner(source.id) !== undefined);
  }

  /** "Existing data sources" in View settings "Source". */
  private existingSources(): DataSourceChoice[] {
    const type = this.model.getView(this.activeViewId)?.type;
    const fits = type !== undefined && RENDERED_LAYOUTS.includes(type);

    return this.linkableSources().map((source) => ({ id: source.id, title: source.title, parent: source.parent, fits }));
  }

  /** "Import CSV" from the panel: the new source takes the file's columns and rows. One undo empties it again. */
  private importCsvIntoSource(sourceId: string, text: string, targets?: CsvColumnTarget[], settings?: CsvImportSettings): void {
    const source = this.dashboardOwner(sourceId);

    if (this.readOnly || source === undefined || source === this || source.readOnly) return;
    const table = parseCsv(text);

    if (table.length === 0) {
      this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvEmpty') });

      return;
    }
    const built = this.csvBlocks(table, targets, settings);

    // The source keeps its title property: its backend already has it.
    const oldTitle = source.model.getSchema().find((p) => p.type === 'title');
    const newTitle = built.data.schema.find((p) => p.type === 'title');
    const titleId = oldTitle?.id ?? newTitle?.id;
    const remap = (id: string): string => (newTitle !== undefined && id === newTitle.id && titleId !== undefined ? titleId : id);
    const schema = built.data.schema.map((p) => ({ ...p, id: remap(p.id) }));
    const views = built.data.views.map((view) => ({ ...view, visibleProperties: view.visibleProperties.map(remap) }));
    const rows = built.rows.map((row) => ({
      ...row,
      data: { ...row.data, properties: Object.fromEntries(Object.entries(row.data.properties).map(([id, value]) => [remap(id), value])) },
    }));

    this.inOneStep(() => {
      source.model.replaceDefinition({ schema, views });
      source.activeViewId = built.data.activeViewId;
      // Before the rows: a change dispatched inside a row insert's sync window is dropped as an echo.
      source.block.dispatchChange();
      for (const row of rows) {
        this.api.blocks.insertAt('database-row', row.data, { parentId: sourceId, position: 'end', id: row.id });
      }
    });
    const renamed = schema.find((p) => p.id === oldTitle?.id && p.name !== oldTitle.name);

    if (renamed !== undefined) void source.sync.syncUpdateProperty({ propertyId: renamed.id, changes: { name: renamed.name } });
    for (const p of schema.filter((candidate) => candidate.id !== oldTitle?.id)) {
      void source.sync.syncCreateProperty({ id: p.id, name: p.name, type: p.type, position: p.position, ...(p.config !== undefined ? { config: p.config } : {}) });
    }
    for (const row of rows) void source.sync.syncCreateRow({ id: row.id, properties: row.data.properties, position: row.data.position });
    this.paintLinkedTitle();
    this.rerenderView();
    this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvImported', { count: built.rows.length }) });
  }

  /** `New “<query>” data source` (research/26 §2): the new source takes the typed title. */
  private nameNewSource(sourceId: string, title: string): void {
    const source = this.dashboardOwner(sourceId);

    if (this.readOnly || source === undefined || source === this) return;
    source.renameAsSource(title);
    this.paintLinkedTitle();
  }

  /**
   * "Link to existing data source": the new view shows that database (or this
   * block's own data, or another of its sources), and the empty source it got goes.
   */
  private linkNewSourceView(made: { sourceId: string; viewId: string }, databaseId: string): void {
    if (this.readOnly || this.structureLocked() || this.model.getView(made.viewId) === undefined) return;
    const target = databaseId === this.dataId ? undefined : databaseId;

    if (target === made.sourceId || (target !== undefined && this.dashboardOwner(target) === undefined)) return;
    const index = this.api.blocks.getBlockIndex(made.sourceId);

    this.inOneStep(() => {
      this.model.updateView(made.viewId, { dataSourceId: target });
      this.block.dispatchChange();
      if (index !== undefined) void this.api.blocks.delete(index, false);
    });
    void this.sync.syncUpdateView({ viewId: made.viewId, changes: { dataSourceId: target } });
    this.mountRows();
    this.switchView(made.viewId);
    this.paintLinkedTitle();
    this.controls.refresh();
  }

  /** research 20 §2b: after the new tab shows, pick the source, then a fresh view or one to copy into it. */
  private openLinkedAddView(viewId: string, type: Exclude<ViewType, 'form' | 'dashboard'>): void {
    const source = this.source;

    if (source === undefined || this.readOnly || this.sourceMissing()) return;
    const anchor = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(viewId)}"]`)
      ?? this.titleRowElement ?? this.element;

    if (anchor === null) return;
    this.sourcePicker?.close();
    const copyable = (view: DatabaseViewConfig): boolean => view.type !== 'form' && view.type !== 'dashboard';
    const panel = openLinkedAddView({
      anchor,
      t: (key, vars) => this.api.i18n.t(key, vars),
      source: {
        id: source.databaseId,
        title: this.lastSourceTitle,
        parent: this.pickerSources().find((candidate) => candidate.id === source.databaseId)?.parent ?? '',
      },
      newViewLabel: this.api.i18n.t(LINKED_NEW_VIEW_KEYS[type]),
      views: () => [
        ...this.sourceViews(source.databaseId).filter(copyable),
        ...this.model.getViews().filter((view) => view.id !== viewId && copyable(view)),
      ],
      copyView: (view) => this.copyIntoView(viewId, view),
      onClose: () => {
        if (this.sourcePicker === panel) this.sourcePicker = null;
      },
    });

    this.sourcePicker = panel;
  }

  /** The new tab takes the picked view's settings; it keeps its own id and place. */
  private copyIntoView(viewId: string, view: DatabaseViewConfig): void {
    if (this.readOnly || this.structureLocked() || this.model.getView(viewId) === undefined) return;
    const { id: _id, position: _position, ...settings } = structuredClone(view);

    this.model.updateView(viewId, settings);
    this.block.dispatchChange();
    void this.sync.syncUpdateView({ viewId, changes: structuredClone(settings) });
    this.rebuildTabBar();
    this.rerenderView();
  }

  /** A map needs a place: Notion adds one named "Place" when there is none (research/20 §1a). */
  private ensurePlaceProperty(): void {
    if (this.model.getSchema().some((p) => p.type === 'place')) return;
    this.addProperty({ name: '', type: 'place' });
  }

  /**
   * Notion asks this on every new form view (research/19 §3a). The view starts
   * with every supported property as a question, so Escape keeps that.
   */
  private askFormAutoCreate(viewId: string): void {
    const count = this.model.getSchema().filter(isAutoQuestion).length;

    if (count === 0 || this.readOnly) return;
    const t = (key: string, vars?: Record<string, string | number>): string => this.api.i18n.t(`tools.database.${key}`, vars);

    this.formPromptAbort?.abort();
    const abort = new AbortController();

    this.formPromptAbort = abort;
    void openDatabaseConfirm({
      title: t('formAutoCreateTitle'),
      description: t('formAutoCreateDescription'),
      confirmLabel: count === 1 ? t('formAutoCreateOne') : t('formAutoCreateMany', { count }),
      cancelLabel: t('formAutoCreateScratch'),
      role: 'dialog',
      primary: true,
      dismissAs: true,
      art: [IconTable, IconChevronRight, IconListChecklist],
      directionSource: this.element,
      signal: abort.signal,
    }).then((create) => {
      if (this.formPromptAbort === abort) this.formPromptAbort = null;
      if (create || abort.signal.aborted || this.destroyed || this.readOnly || this.structureLocked()) return;
      const view = this.model.getView(viewId);

      if (view?.type !== 'form') return;
      const properties = this.model.getSchema().map((property) => ({ id: property.id, visible: property.type === 'title' }));

      this.model.updateView(viewId, { properties });
      this.block.dispatchChange();
      void this.sync.syncUpdateView({ viewId, changes: { properties: structuredClone(properties) } });
      if (this.activeViewId === viewId) this.rerenderView({ keepDrawer: true });
    });
  }

  renameView(viewId: string, name: string): void {
    if (this.structureLocked()) return;
    this.model.updateView(viewId, { name });
    void this.sync.syncUpdateView({ viewId, changes: { name } });
  }

  duplicateView(viewId: string): void {
    if (this.structureLocked()) return;
    const sourceView = this.model.getView(viewId);

    if (sourceView === undefined) {
      return;
    }

    const { id: _id, name, type, position: _position, ...settings } = sourceView;
    const newView = this.model.addView(name, type, settings);

    void this.sync.syncCreateView(structuredClone(newView));
    this.switchView(newView.id);
  }

  /**
   * Delete from the tab menu or View settings. It always asks first; the last
   * view of a second source also offers to delete the source (research/26 §5a).
   * Only a click gets here: agents, undo and peers call deleteView. The promise
   * says whether the view went (the tab menu stays open until then).
   */
  private requestDeleteView(viewId: string): Promise<boolean> | undefined {
    const view = this.model.getView(viewId);
    const sourceId = view === undefined ? undefined : this.otherSourceId(view);
    const ownSource = sourceId !== undefined && this.api.blocks.getChildren(this.dataId).some((child) => child.id === sourceId && child.name === 'database');
    const last = ownSource && !this.model.getViews().some((other) => other.id !== viewId && other.dataSourceId === sourceId);

    if (this.model.getViews().length <= 1 || this.structureLocked()) return undefined;
    const t = (key: string): string => this.api.i18n.t(key);

    // feel/findings-toolbar V24: Notion asks before every delete.
    if (!last || sourceId === undefined) {
      return openDatabaseConfirm({
        title: t('tools.database.layoutDeleteViewTitle'),
        confirmLabel: t('tools.database.layoutDeleteView'),
        cancelLabel: t('tools.database.layoutCancel'),
        destructive: true,
        directionSource: this.element,
      }).then((ok) => {
        if (!ok || this.destroyed || this.model.getView(viewId) === undefined) return false;
        this.deleteView(viewId);

        return true;
      });
    }

    return openDatabaseChoice({
      title: t('tools.database.deleteLastViewTitle'),
      confirmLabel: t('tools.database.layoutDeleteView'),
      cancelLabel: t('tools.database.layoutCancel'),
      destructive: true,
      filled: true,
      art: [IconTrash],
      closeLabel: t('tools.database.close'),
      largeTitle: true,
      directionSource: this.element,
      choices: [
        { label: t('tools.database.deleteLastViewOnly'), description: t('tools.database.deleteLastViewOnlyDescription') },
        { label: t('tools.database.deleteLastViewAndSource'), description: t('tools.database.deleteLastViewAndSourceDescription') },
      ],
    }).then((choice) => {
      if (choice === null || this.destroyed || this.model.getView(viewId) === undefined) return false;
      if (choice === 0) {
        this.deleteView(viewId);

        return true;
      }
      this.inOneStep(() => {
        this.deleteView(viewId);
        this.block.dispatchChange();
        // Rows first, then the source. Each delete tells the backend once.
        const doomed = [...this.api.blocks.getChildren(sourceId).map((child) => child.id).reverse(), sourceId];

        for (const id of doomed) {
          const index = this.api.blocks.getBlockIndex(id);

          if (index !== undefined) void this.api.blocks.delete(index, false);
        }
      });

      return true;
    });
  }

  deleteView(viewId: string): void {
    const views = this.model.getViews();

    if (views.length <= 1 || this.structureLocked()) {
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
    if (this.structureLocked()) return;
    this.model.updateView(viewId, { position: newPosition });
    void this.sync.syncUpdateView({ viewId, changes: { position: newPosition } });
    this.rebuildTabBar();
  }

  private rebuildTabBar(): void {
    if (this.element === null || this.tabBar === null) {
      return;
    }

    const oldBarEl = this.ownTabBarElement();

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

  /** This block's bar only: a nested database or a second source sits earlier in the row pool. */
  private ownTabBarElement(): HTMLElement | null {
    return this.element?.querySelector<HTMLElement>(':scope > [data-blok-database-view-bar] > [data-blok-database-tab-bar]') ?? null;
  }

  private syncTitleRowAddBtn(): void {
    if (this.element === null || this.titleRowElement === null || this.tabBar === null) {
      return;
    }

    const tabBarEl = this.ownTabBarElement();
    const views = this.model.getViews();
    const addBtn = this.tabBar.getAddBtnEl();
    const single = views.length === 1;
    // Not `controls`: while bound that is the holder's toolbar, and moving it here
    // files its writes under this block, so the two blocks redraw each other forever.
    const toolbar = this.ownControls.toolbar;

    // One view: the toolbar shares the title row (feel/findings-toolbar V01, research/35:221).
    this.titleRowElement.toggleAttribute('data-single-view', single);
    tabBarEl?.parentElement?.toggleAttribute('data-single-view', single);
    if (single) {
      this.titleRowElement.appendChild(toolbar);
    } else if (tabBarEl !== null && tabBarEl.nextElementSibling !== toolbar) {
      tabBarEl.after(toolbar);
    }

    this.titleRowElement.querySelector(':scope > [data-blok-database-title-more]')?.remove();
    // A rebuild makes a new button; the old one stays in the title row unless it goes here.
    this.titleRowElement.querySelectorAll('[data-blok-database-add-view]').forEach((el) => {
      el.remove();
    });
    if (single && !this.readOnly && !this.structureLocked() && addBtn !== null) {
      this.titleRowElement.insertBefore(addBtn, toolbar);
      this.titleRowElement.insertBefore(this.tabBar.createTitleMoreButton(), toolbar);
      if (tabBarEl instanceof HTMLElement) {
        tabBarEl.style.display = 'none';
      }
    } else {
      if (!this.readOnly && !this.structureLocked() && addBtn !== null && tabBarEl !== null && !tabBarEl.contains(addBtn)) {
        tabBarEl.appendChild(addBtn);
      }
      if (tabBarEl instanceof HTMLElement) {
        tabBarEl.style.display = views.length >= 2 ? '' : 'none';
      }
    }
  }

  /** "Edit title": the caret at the end of the title. */
  private focusTitle(): void {
    const title = this.titleElement;

    if (title === null || !this.titleEditable()) return;
    title.focus();
    const range = document.createRange();

    range.selectNodeContents(title);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }

  private toggleDataSourceTitles(): void {
    if (this.readOnly || this.structureLocked()) return;
    this.dataSourceTitlesHidden = !this.dataSourceTitlesHidden;
    this.block.dispatchChange();
    this.paintLinkedTitle();
    this.rebuildTabBar();
  }

  private createTabBar(): DatabaseTabBar {
    return new DatabaseTabBar({
      views: localizeDatabaseViews(this.model.getViews(), this.api.i18n),
      activeViewId: this.activeViewId,
      onTabClick: (viewId) => this.switchView(viewId),
      onAddView: (type) => this.addViewWithSettings(type),
      onRename: (viewId, name) => this.renameView(viewId, name),
      onDuplicate: (viewId) => this.duplicateView(viewId),
      onDelete: (viewId) => this.requestDeleteView(viewId),
      onReorder: (viewId, newPosition) => this.reorderView(viewId, newPosition),
      onEditView: (viewId, anchor) => this.editView(viewId, anchor),
      onRenameView: (viewId, anchor) => this.editView(viewId, anchor, 'rename'),
      onCopyLink: (viewId) => this.copyViewLink(viewId),
      onEditTitle: () => this.focusTitle(),
      display: this.tabDisplay.get(),
      onDisplayChange: (display) => {
        this.tabDisplay.set(display);
        this.rebuildTabBar();
      },
      dataSourceTitlesHidden: this.dataSourceTitlesHidden,
      ...(this.readOnly || this.structureLocked() ? {} : { onDataSourceTitlesToggle: () => this.toggleDataSourceTitles() }),
      // The bar hides it while read-only or locked; it flips in place (setReadOnly), so this is not gated here.
      ...(this.linked ? {} : { onNewDataSource: () => this.newDataSourceWithPanel() }),
      api: this.api,
      // A locked database keeps its views: no add, rename, delete or reorder.
      readOnly: this.readOnly || this.structureLocked(),
      // A linked view has no form (research 20 §2b).
      ...(this.linked ? { hiddenViewTypes: ['form'] as ViewType[] } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Board rendering helpers
  // ---------------------------------------------------------------------------

  private renderActiveView(): HTMLDivElement {
    this.paintLinkedTitle();
    this.element?.toggleAttribute('data-blok-database-unlinked', this.linkPicker);
    if (this.linkPicker) {
      return this.renderSourcePicker();
    }
    if (this.sourceMissing()) {
      // Blok has no Trash: the source's rows went with it, so only the banner shows (research 20 §2e).
      const missing = document.createElement('div');
      const icon = document.createElement('span');
      const text = document.createElement('span');

      missing.setAttribute('data-blok-database-source-missing', '');
      missing.setAttribute('role', 'status');
      icon.setAttribute('data-blok-database-source-missing-icon', '');
      icon.innerHTML = IconTrash;
      text.textContent = this.api.i18n.t('tools.database.linkedSourceMissing');
      missing.append(icon, text);

      return missing;
    }
    const saved = this.shownView();

    if (saved !== undefined && this.otherSourceId(saved) !== undefined) {
      return this.renderSourceView(saved.id);
    }
    const viewConfig = saved === undefined ? undefined : this.controls.effective(saved);

    return this.renderLayout(viewConfig);
  }

  /** Draws one view of this block's rows and schema in its layout. */
  private renderLayout(viewConfig: DatabaseViewConfig | undefined): HTMLDivElement {
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
      if (viewConfig?.type === 'chart') {
        return this.renderChartView(titlePropId, viewConfig);
      }
      if (viewConfig?.type === 'feed') {
        return this.renderFeedView(titlePropId, viewConfig);
      }
      const tier3 = viewConfig === undefined ? undefined : this.renderTier3View(titlePropId, viewConfig);

      if (tier3 !== undefined) {
        return tier3;
      }

      // Unknown types (a newer client's layout) fall back to a board.
      return this.renderBoardView(titlePropId, groupByPropId, viewConfig);
    })();

    if (viewConfig !== undefined) {
      this.paintRowColors(viewEl, viewConfig);
    }

    return viewEl;
  }

  /** The block whose views are on show: this one, or the holder while bound. */
  private viewOwner(): DatabaseTool {
    return this.binding?.owner ?? this;
  }

  private viewOf(viewId: string): DatabaseViewConfig | undefined {
    return this.viewOwner().model.getView(viewId);
  }

  /** Writes a view setting where the view lives: this block, or the holder while bound. */
  private writeView(viewId: string, changes: ViewChanges): void {
    const owner = this.viewOwner();

    owner.model.updateView(viewId, changes);
    owner.block.dispatchChange();
    void owner.sync.syncUpdateView({ viewId, changes: structuredClone(changes) });
  }

  private shows(viewId: string): boolean {
    return (this.binding?.viewId ?? this.activeViewId) === viewId;
  }

  /** The saved view on show: this block's active one, or the holder's view while bound. */
  private shownView(): DatabaseViewConfig | undefined {
    const binding = this.binding;

    return binding === null ? this.model.getView(this.activeViewId) : binding.owner.model.getView(binding.viewId);
  }

  /** The tool whose rows and schema the active view shows: this one, or a second source. */
  private activeSource(): DatabaseTool {
    const saved = this.shownView();
    const id = saved === undefined ? undefined : this.otherSourceId(saved);

    return (id === undefined ? undefined : this.dashboardOwner(id)) ?? this;
  }

  /** This block's own data, then its second sources: the child database blocks, whether a view shows them or not. */
  private dataSourceChoices(): DataSourceChoice[] {
    const type = this.model.getView(this.activeViewId)?.type;
    const fits = type !== undefined && RENDERED_LAYOUTS.includes(type);
    const titleOf = (tool: DatabaseTool): string => tool.titleElement?.textContent ?? tool.title;
    const sources = this.api.blocks.getChildren(this.dataId).flatMap((child): DataSourceChoice[] => {
      const tool = child.name === 'database' ? this.dashboardOwner(child.id) : undefined;

      return tool === undefined ? [] : [{ id: child.id, title: titleOf(tool), fits }];
    });

    return [{ id: this.dataId, title: titleOf(this), fits: true }, ...sources];
  }

  /**
   * View settings "Source": the view shows another source of this block.
   * Every filter goes, and every sort but one on the title, which moves to
   * the new source's title (research/26 §5b, 27 §5). Nothing comes back.
   */
  private pickDataSource(id: string): void {
    const view = this.model.getView(this.activeViewId);
    const choice = [...this.dataSourceChoices(), ...this.existingSources()].find((option) => option.id === id);
    const from = this.activeSource();

    if (view === undefined || choice === undefined || !choice.fits || id === from.dataId) return;
    const titleOf = (tool: DatabaseTool | undefined): string | undefined => tool?.model.getSchema().find((p) => p.type === 'title')?.id;
    const oldTitle = titleOf(from);
    const newTitle = titleOf(id === this.dataId ? this : this.dashboardOwner(id));
    const sorts = newTitle === undefined ? [] : view.sorts.filter((sort) => sort.propertyId === oldTitle).map((sort) => ({ ...sort, propertyId: newTitle }));

    this.updateActiveView({
      dataSourceId: id === this.dataId ? undefined : id,
      sorts,
      filters: [],
      ...(view.filterTree === undefined ? {} : { filterTree: { ...view.filterTree, filterRules: [] } }),
    });
    this.paintLinkedTitle();
    this.controls.refresh();
  }

  /** A second data source of this block that the view shows (research/23 §10), else undefined. */
  private otherSourceId(view: DatabaseViewConfig): string | undefined {
    const id = view.dataSourceId;

    return id === undefined || id === this.dataId ? undefined : id;
  }

  /**
   * A view bound to a second source: drawn by the dashboard's native path,
   * with the source's rows and schema and this block's view and toolbar.
   */
  private renderSourceView(viewId: string): HTMLDivElement {
    this.dashboardSources.clear();
    this.view = new DatabaseDashboardView({
      rows: [{ id: viewId, widgets: [{ id: viewId, viewId, width: 12 }] }],
      single: true,
      mount: (widget) => this.mountDashboardWidget(viewId, widget, {
        controls: this.controls,
        placed: () => this.model.getView(viewId)?.dataSourceId !== undefined,
      }),
    });

    return this.view.createView();
  }

  /** Form, map and dashboard (D6): the host levers do the work. */
  private renderTier3View(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement | undefined {
    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);

    if (viewConfig.type === 'form') {
      const viewId = viewConfig.id;
      const editQuestion = <T>(edit: () => T, fallback: T): T => {
        if (this.destroyed || !this.shows(viewId) || this.readOnly || this.structureLocked() || this.viewOf(viewId)?.type !== 'form') return fallback;
        const previous = this.formQuestionEdit;

        this.formQuestionEdit = true;
        try {
          return edit();
        } finally {
          this.formQuestionEdit = previous;
        }
      };
      const setQuestionSetting = (propertyId: string, changes: ViewPropertyPatch): void => editQuestion(() => {
        const current = this.viewOf(viewId);

        if (current === undefined) return;
        const properties = withPropertySetting(current, this.model.getSchema(), propertyId, changes);
        const setting = properties.find((entry) => entry.id === propertyId);

        if (setting !== undefined) {
          if ('questionName' in changes && changes.questionName === undefined) delete setting.questionName;
          if ('maxSelections' in changes && changes.maxSelections === undefined) delete setting.maxSelections;
        }
        this.updateActiveView({ properties });
      }, undefined);

      this.view = new DatabaseFormView({
        i18n: this.api.i18n,
        view: viewConfig,
        schema,
        readOnly: this.readOnly,
        source: this.source,
        // A form answer is no row value: an undo must not drop its draft.
        cellContext: { ...this.cellContext(), openEditors: undefined, relationScope: (property: PropertyDefinition) => this.relatedDatabaseName(property) },
        hasPeople: this.hasPeople,
        onInteractionEnd: () => {
          if (this.redrawWhenIdleRetry !== null) this.redrawWhenIdle();
        },
        submitted: this.submittedForms.has(viewId),
        onSubmittedChange: (submitted) => {
          if (!submitted) this.submittedForms.delete(viewId);
          else if (!this.submittedForms.has(viewId)) this.submittedForms.set(viewId, null);
        },
        respondent: () => this.respondent(),
        responseActions: () => this.formResponseActions(this.submittedForms.get(viewId)),
        onSubmit: (values) => this.submitForm(viewId, values),
        ...(this.readOnly || this.structureLocked() ? {} : {
          share: {
            ...(this.config.forms === undefined ? {} : {
              host: {
                ...(this.config.forms.workspaceName === undefined ? {} : { workspaceName: this.config.forms.workspaceName }),
                ...this.formLink(viewId),
              },
            }),
            settings: () => this.viewOf(viewId)?.form ?? {},
            update: (patch: Partial<FormSettings>) => editQuestion(() => {
              const merged: FormSettings = { ...this.viewOf(viewId)?.form, ...patch };
              const form: FormSettings = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));

              this.updateActiveView({ form });
            }, undefined),
            copyLink: (link: string) => {
              void navigator.clipboard?.writeText(link).then(
                () => this.api.notifier.show({ message: this.api.i18n.t('tools.database.tableLinkCopied') }),
                () => undefined
              );
            },
          },
        }),
        ...(this.structureLocked()
          ? {}
          : {
            setRequired: (propertyId: string, required: boolean) => setQuestionSetting(propertyId, { required }),
            setQuestionSetting,
            addQuestion: (type: PropertyType) => editQuestion(() => this.addProperty({ name: '', type }), null),
            showQuestion: (propertyId: string) => editQuestion(() => {
              const current = this.viewOf(viewId);

              if (current === undefined) return;
              const shown = { ...current, properties: withPropertySetting(current, this.model.getSchema(), propertyId, { visible: true }) };

              this.updateActiveView({ properties: withPropertyOrder(shown, this.model.getSchema(), propertyId, null) });
            }, undefined),
            renameProperty: (propertyId: string, name: string) => editQuestion(() => this.renameProperty(propertyId, name), undefined),
            isNameTaken: (propertyId: string, name: string) => this.isPropertyNameTaken(propertyId, name),
            changePropertyType: (propertyId: string, type: PropertyType) => editQuestion(() => this.changePropertyType(propertyId, type), undefined),
            duplicateProperty: (propertyId: string) => editQuestion(() => this.duplicateProperty(propertyId), null),
            deleteProperty: (propertyId: string) => editQuestion(() => this.deleteProperty(propertyId), undefined),
          }),
      });
    } else if (viewConfig.type === 'map') {
      const rows = this.model.queryRows({ view: viewConfig }).rows;
      const colors = new Map([...resolveRowColors(rows, viewConfig, this.model.getValueSchema(), new Date(), this.config.people?.me?.() ?? null)]
        .flatMap(([rowId, color]) => (color.row === undefined ? [] : [[rowId, color.row] as const])));

      this.view = new DatabaseMapView({
        i18n: this.api.i18n,
        view: viewConfig,
        schema,
        rows,
        colors,
        titlePropertyId: titlePropId,
        ...(this.config.map?.render !== undefined ? { render: this.config.map.render.bind(this.config.map) } : {}),
        ...(this.config.map?.styleUrl !== undefined ? { style: this.config.map.styleUrl } : {}),
        breadcrumb: this.linked ? this.title : this.titleElement?.textContent ?? this.title,
        open: (rowId) => this.handleRowClick(rowId),
        writable: !this.readOnly,
        addPin: (lngLat) => this.addMapPin(viewConfig.id, lngLat),
      });
    } else if (viewConfig.type === 'dashboard') {
      this.dashboardSources.clear();
      this.view = new DatabaseDashboardView({
        rows: viewConfig.dashboard?.rows ?? [],
        mount: (widget) => this.mountDashboardWidget(viewConfig.id, widget),
      });
    } else {
      return undefined;
    }

    return this.view.createView();
  }

  /**
   * Add-pin mode: a row at the clicked point, titled by the host's reverse
   * geocoder, then opened (research/20 §1e). A failing geocoder keeps the point only.
   */
  private addMapPin(viewId: string, lngLat: DatabaseMapLngLat): void {
    const map = this.config.map;
    const lookup = async (): Promise<PlaceValue | null | undefined> => map?.reverseGeocode?.(lngLat);

    void lookup().catch(() => undefined).then((found) => {
      const view = this.viewOf(viewId);
      const placeBy = view === undefined ? undefined : resolveMapBy(view, this.model.getSchema());

      if (this.destroyed || this.readOnly || placeBy === undefined) return;
      const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
      const name = isPlaceValue(found ?? undefined) ? text(found?.name) : undefined;
      const address = isPlaceValue(found ?? undefined) ? text(found?.address) : undefined;
      const place: PlaceValue = { ...(name !== undefined ? { name } : {}), ...(address !== undefined ? { address } : {}), lat: lngLat.lat, lon: lngLat.lng };
      const title = name ?? address;
      const rowId = this.insertRow({ [placeBy.id]: place, ...(title !== undefined ? { [this.titlePropertyId()]: title } : {}) }, { rerender: false });

      if (rowId === undefined) return;
      if (this.shows(viewId)) this.rerenderView({ keepDrawer: true });
      this.handleRowClick(rowId);
    });
  }

  /** The host's link for a form, for the Share panel. A throwing host gives none. */
  private formLink(viewId: string): { link?: string } {
    try {
      const link = this.config.forms?.link?.({ databaseId: this.viewOwner().block.id, viewId });

      return typeof link === 'string' && link !== '' ? { link } : {};
    } catch {
      return {};
    }
  }

  /** A form answer becomes a row (Notion: responses land in the database). Read-only only tells the host. */
  private submitForm(viewId: string, values: Record<string, PropertyValue>, record = true): DatabaseFormSubmission | undefined {
    const view = this.viewOf(viewId);

    if (this.destroyed || !this.shows(viewId) || view?.type !== 'form' || view.form?.closed === true) return undefined;
    const rowId = this.readOnly ? undefined : this.insertRow(values, { rerender: false, anonymous: view.form?.anonymous === true });
    const submission: DatabaseFormSubmission = {
      databaseId: this.viewOwner().block.id,
      viewId,
      values,
      ...(rowId !== undefined ? { rowId } : {}),
      sharing: {
        public: view.form?.public === true,
        anonymous: view.form?.anonymous === true,
        submissionAccess: view.form?.submissionAccess ?? 'none',
      },
    };
    const forms = this.config.forms;

    if (record) this.submittedForms.set(viewId, submission);
    if (forms === undefined) return submission;
    try {
      void Promise.resolve(forms.onSubmit(submission)).catch(() => undefined);
    } catch {
      // The row is already saved; a failing host must not undo it.
    }

    return submission;
  }

  /**
   * A host hook an agent's command asked for, run once its writes landed
   * (ToolActionContext.hostEffect). The same hooks the person's Submit calls.
   */
  runAgentHostEffect(param: { effect: Record<string, unknown> }): void {
    const { effect } = param;

    if (this.destroyed) return;
    const { rowId, propertyId, action } = effect;

    // As pressButton's callback and notify: the host runs these, Blok sends nothing.
    if (effect.kind === 'buttonCallback' && typeof rowId === 'string' && typeof propertyId === 'string' && isButtonAction(action, 'callback')) {
      void Promise.resolve(this.config.buttons?.onAction?.({ databaseId: this.dataId, rowId, propertyId, action: callbackStep(action) })).catch((error: unknown) => this.showBackendError(error));

      return;
    }
    if (effect.kind === 'buttonNotify' && typeof rowId === 'string' && typeof propertyId === 'string' && isButtonAction(action, 'sendNotification')
      && Array.isArray(effect.to) && effect.to.every((id) => typeof id === 'string') && typeof effect.message === 'string') {
      void Promise.resolve(this.config.buttons?.onNotify?.({ databaseId: this.dataId, rowId, propertyId, action: notifyStep(action), to: effect.to, message: effect.message })).catch((error: unknown) => this.showBackendError(error));

      return;
    }
    if (effect.kind === 'formSubmitted' && isFormSubmission(effect.submission)) {
      const forms = this.config.forms;
      const submission = effect.submission;

      if (forms === undefined) return;
      try {
        void Promise.resolve(forms.onSubmit(submission)).catch(() => undefined);
      } catch {
        // The row is already saved; a failing host must not undo it.
      }
    }
  }

  /**
   * Who the answer's Created by will name: the editor's `user.id`, as core
   * stamps new blocks (YjsManager.withCreationStamp), with no `people.me()`
   * fallback. Shown once the host's directory knows that id.
   */
  private respondent(): DatabasePerson | undefined {
    const id = this.api.config.user?.id;

    return typeof id !== 'string' || id === '' ? undefined : this.people?.find((person) => person.id === id);
  }

  private formPreview: ModalDialogHandle | null = null;

  /**
   * research/36 §13: "Preview" shows the form as a respondent sees it, in a
   * centred dialog. Its answer is a real row; the builder's own form keeps
   * its state.
   */
  private openFormPreview(viewId: string): void {
    const view = this.viewOf(viewId);

    if (this.destroyed || this.readOnly || view?.type !== 'form' || this.formPreview !== null) return;
    const backdrop = document.createElement('div');
    const surface = document.createElement('div');
    const state: { submission?: DatabaseFormSubmission } = {};
    const form = new DatabaseFormView({
      i18n: this.api.i18n,
      view,
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      readOnly: false,
      source: this.source,
      cellContext: { ...this.cellContext(), openEditors: undefined, relationScope: (property: PropertyDefinition) => this.relatedDatabaseName(property) },
      hasPeople: this.hasPeople,
      respondent: () => this.respondent(),
      onSubmittedChange: (submitted) => {
        if (!submitted) delete state.submission;
      },
      responseActions: () => this.formResponseActions(state.submission, () => handle.close()),
      onSubmit: (values) => {
        state.submission = this.submitForm(viewId, values, false);
      },
    });

    // Mounted on body: the popover scope brings the editor font and preflight.
    backdrop.setAttribute('data-blok-popover', '');
    backdrop.setAttribute('data-blok-database-form-preview-backdrop', '');
    surface.setAttribute('data-blok-database-form-preview', '');
    surface.setAttribute('data-blok-testid', 'database-form-preview');
    surface.appendChild(form.createView());
    backdrop.appendChild(surface);
    const handle = openModalDialog({
      content: backdrop,
      surface,
      role: 'dialog',
      label: this.api.i18n.t('tools.file.preview'),
      directionSource: this.element,
      onDismiss: () => handle.close(),
      onClose: () => {
        form.destroy();
        this.formPreview = null;
      },
    });

    this.formPreview = handle;
  }

  /**
   * The thank-you screen's buttons (research/23 §6): "View my response" while
   * the row the answer became is there, "Email me a copy" when the host sends it.
   */
  private formResponseActions(submission: DatabaseFormSubmission | null | undefined, beforeOpen?: () => void): { view?: () => void; email?: () => void } {
    const rowId = submission?.rowId;
    const emailCopy = this.config.forms?.emailCopy;

    if (submission === undefined || submission === null) return {};

    return {
      // research/36 §13: Notion opens the response as a full page.
      ...(rowId !== undefined && this.model.getRow(rowId) !== undefined ? {
        view: () => {
          beforeOpen?.();
          this.handleRowClick(rowId, 'full');
        },
      } : {}),
      ...(emailCopy === undefined ? {} : {
        email: () => {
          try {
            void Promise.resolve(emailCopy.call(this.config.forms, submission)).catch(() => undefined);
          } catch {
            // A failing host leaves the thank-you screen as it is.
          }
        },
      }),
    };
  }

  /** Conditional color: a data attribute on each matching row, card or (table) cell. */
  private paintRowColors(viewEl: HTMLElement, view: DatabaseViewConfig): void {
    const colors = resolveRowColors(this.model.getOrderedRows(), view, this.model.getValueSchema(), new Date(), this.config.people?.me?.() ?? null);
    const rowSelector = ':is([data-blok-database-table-row], [data-blok-database-card], [data-blok-database-list-row], [data-blok-database-feed-card], '
      + '[data-blok-database-calendar-event], [data-blok-database-calendar-no-date-item], [data-blok-database-timeline-bar])';
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
      locale: editorLocale(this.api.i18n),
      cellContext: this.cellContext(),
      ...this.commentBadgeLever(),
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
        ...(this.readOnly ? {} : {
          selectRows: (rowIds: string[]) => this.selectRows(rowIds),
          pickRow: (rowId: string, range: boolean, order: string[]) => this.pickRow(rowId, range, order),
          renameRow: (rowId: string, title: string) => {
            this.updateRowTitleBlock(rowId, titlePropId, title);
            this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: title } });
          },
        }),
      },
    });

    return this.view.createView();
  }

  /** One group's rows cut to what "Load more" has revealed, and the group's total. */
  private pagedQuery(viewConfig: DatabaseViewConfig, shown: Map<string, number>, limit: number, search = this.controls.search) {
    return (key: string, group?: string): Pick<GalleryGroup, 'rows' | 'total'> => {
      const result = this.model.queryRows({ view: viewConfig, ...(group !== undefined ? { group } : {}), search, limit: shown.get(key) ?? limit });

      return { rows: result.rows, total: result.total ?? result.rows.length };
    };
  }

  /** A row page's body: its child blocks, else the legacy body column. A host `rowPages` body is not readable here. */
  private rowBodyBlocks(rowId: string, descriptionId: string | undefined): Array<{ type: string; data: unknown }> {
    const children = this.api.blocks.getChildren(rowId).filter((child) => child.name !== 'database-row' && !isAnnotationBlock(child));

    if (children.length > 0) {
      return children.map((child) => ({ type: child.name, data: child.preservedData }));
    }

    const row = this.model.getRow(rowId);

    return row === undefined ? [] : pageContentSourceBlocks(row, this.model.getSchema(), descriptionId);
  }

  /**
   * What a chart axis may use, as values read: a formula by its result type.
   * Never a rollup, files, a unique id or a list formula (H-charts).
   */
  private chartSchema(): PropertyDefinition[] {
    const saved = this.model.getSchema();
    const isList = (property: PropertyDefinition): boolean => {
      const compiled = this.computedValues.compile(property, saved);

      return compiled.ok && compiled.resultType.kind === 'list';
    };
    const excluded = new Set(saved
      .filter((p) => p.type === 'rollup' || p.type === 'files' || p.type === 'uniqueId' || (p.type === 'formula' && isList(p)))
      .map((p) => p.id));

    return this.model.getValueSchema().filter((p) => !excluded.has(p.id));
  }

  /** The X axis: the view's grouping, else the first select-like property, else the first it can group by. */
  private chartAxis(view: DatabaseViewConfig, schema: PropertyDefinition[]): PropertyDefinition | undefined {
    const stored = schema.find((p) => p.id === view.groupBy);

    if (stored !== undefined && GROUPABLE_TYPES.includes(stored.type)) return stored;

    return schema.find((p) => OPTION_GROUP_TYPES.includes(p.type)) ?? schema.find((p) => GROUPABLE_TYPES.includes(p.type));
  }

  /** Each group's rows from the view query. X groups drop the view's hidden groups; series keep all. */
  private chartGroups(view: DatabaseViewConfig, propertyId: string, series: boolean): ChartGroupInput[] {
    const grouped: DatabaseViewConfig = series
      ? { ...view, groupBy: propertyId, groupSettings: view.subGroupSettings }
      : { ...view, groupBy: propertyId };
    const optionGroup = this.isOptionGroup(propertyId);
    const options = series ? this.groupOptions(propertyId, grouped) : this.shownGroupOptions(propertyId, grouped);
    // Date and number keys do not collate in value order ("range:out", "rel:today"): rank them the way the model sorts them.
    const rank = optionGroup
      ? undefined
      : new Map(this.groupOptions(propertyId, { ...grouped, groupSettings: { ...grouped.groupSettings, sort: 'ascending', hideEmptyGroups: false } })
        .map((option, index) => [option.id, String(index).padStart(6, '0')]));

    return options.map((option) => ({
      key: option.id,
      label: option.label,
      sortKey: rank === undefined ? option.label : rank.get(option.id) ?? option.id,
      ...(option.color !== undefined ? { color: option.color } : {}),
      rows: this.model.queryRows({ view: grouped, group: option.id, search: this.controls.search }).rows,
    }));
  }

  private renderChartView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const schema = this.chartSchema();
    const localized = localizeDatabaseSchema(schema, this.api.i18n);
    const settings = resolveChartSettings(viewConfig, schema);
    const axis = this.chartAxis(viewConfig, schema);
    const hidden = this.chartHidden.get(viewConfig.id) ?? new Set<string>();
    const groups: ChartGroupInput[] = axis === undefined || settings.type === 'number'
      ? [{ key: '', label: viewConfig.name, sortKey: '', rows: this.model.queryRows({ view: viewConfig, search: this.controls.search }).rows }]
      : this.chartGroups(viewConfig, axis.id, false);
    const subId = viewConfig.subGroupBy;
    const hasSeries = subId !== undefined && subId !== axis?.id && schema.some((p) => p.id === subId && GROUPABLE_TYPES.includes(p.type))
      && (settings.type === 'column' || settings.type === 'bar' || settings.type === 'line');
    const series: ChartSeriesInput[] = hasSeries
      ? this.chartGroups(viewConfig, subId, true).map((group) => ({ key: group.key, label: group.label, rowIds: new Set(group.rows.map((row) => row.id)) }))
      : [];
    const data = foldChartData(
      buildChartData({ groups, series, measure: settings.measure, schema, sort: settings.sort, omitZero: settings.omitZero, cumulative: settings.cumulative, hidden }),
      { max: 8, otherLabel: this.api.i18n.t('tools.database.chartOther'), slices: settings.type === 'donut' }
    );

    this.view = new DatabaseChartView({
      settings,
      data,
      xName: localized.find((p) => p.id === axis?.id)?.name ?? '',
      yName: chartMeasureLabel(settings.measure, localized, this.api.i18n),
      i18n: this.api.i18n,
      formatValue: (value) => this.formatChartValue(settings.measure, value, schema),
      handlers: {
        drilldown: (point) => this.openChartDrilldown(viewConfig, point, titlePropId),
        toggle: (key) => {
          const next = new Set(hidden);

          if (!next.delete(key)) next.add(key);
          this.chartHidden.set(viewConfig.id, next);
          this.rerenderView({ keepDrawer: true });
        },
      },
    });

    return this.view.createView();
  }

  private formatChartValue(measure: ReturnType<typeof resolveChartSettings>['measure'], value: number, schema: PropertyDefinition[]): string {
    const locale = editorLocale(this.api.i18n);

    if (measure.kind === 'property' && measure.fn.startsWith('percent_')) {
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
    }
    const property = measure.kind === 'property' ? schema.find((p) => p.id === measure.propertyId) : undefined;

    if (property?.type === 'number' && property.number !== undefined && measure.kind === 'property'
      && ['sum', 'average', 'median', 'min', 'max', 'range'].includes(measure.fn)) {
      return formatNumberValue(value, property.number, locale);
    }

    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }

  /** Title first, then the view's visible properties, localized. */
  private csvColumns(view: DatabaseViewConfig): PropertyDefinition[] {
    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);

    return [this.titlePropertyId(), ...visibleRowPropertyIds(view, schema)]
      .map((id) => schema.find((p) => p.id === id))
      .filter((p): p is PropertyDefinition => p !== undefined);
  }

  private csvText(property: PropertyDefinition, row: DatabaseRow): string {
    const shown = localizeDatabaseSchema([this.computedValues.valueProperty(property)], this.api.i18n)[0];

    return csvCellText(shown, readPropertyValue(row, property), {
      locale: editorLocale(this.api.i18n),
      personName: (id) => this.people?.find((person) => person.id === id)?.name,
      rowTitle: (id) => this.csvRowTitle(shown, id),
    });
  }

  private openChartDrilldown(view: DatabaseViewConfig, point: ChartPoint, titlePropId: string): void {
    openChartDrilldown({
      title: point.label,
      rows: point.rowIds.map((id) => this.model.getRow(id)).filter((row): row is DatabaseRow => row !== undefined),
      columns: this.csvColumns(view),
      titlePropertyId: titlePropId,
      cellText: (property, row) => this.csvText(property, row),
      i18n: this.api.i18n,
      openRow: (rowId) => this.handleRowClick(rowId),
      directionSource: this.element,
    });
  }

  private renderFeedView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const step = resolveLoadLimit(viewConfig);
    const limit = this.feedShown.get(viewConfig.id) ?? step;
    const result = this.model.queryRows({ view: viewConfig, search: this.controls.search, limit });
    const descriptionId = this.model.getSchema().find((p) => p.type === 'richText')?.id;

    this.view = new DatabaseFeedView({
      view: viewConfig,
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      rows: result.rows,
      total: result.total ?? result.rows.length,
      titlePropertyId: titlePropId,
      i18n: this.api.i18n,
      locale: editorLocale(this.api.i18n),
      bodyOf: (rowId) => this.rowBodyBlocks(rowId, descriptionId),
      personName: (id) => this.people?.find((person) => person.id === id)?.name,
      handlers: {
        openRow: (rowId) => this.handleRowClick(rowId),
        loadMore: () => {
          this.feedShown.set(viewConfig.id, limit + step);
          this.rerenderView({ keepDrawer: true });
        },
        ...(this.readOnly ? {} : { addRow: () => this.addTableRow(null) }),
      },
      ...(this.config.feedFooter !== undefined ? { footer: this.config.feedFooter } : {}),
      reactions: this.feedReactions(),
      comments: (rowId) => (this.config.comments === undefined && this.builtInComments.enabled() ? this.builtInComments.feedBox(rowId) : null),
      actions: (rowId, anchor, card) => this.openFeedActions(rowId, anchor, card),
    });

    return this.view.createView();
  }

  /**
   * Feed reactions (research/19 §2c). Reacting needs a user id that is one
   * person's: a display name is not unique, so without `people.me` nobody reacts.
   */
  private feedReactions(): FeedReactions {
    const me = this.config.people?.me?.();
    const user = typeof me === 'string' && me !== '' ? me : undefined;

    if (user === undefined || this.readOnly || !this.permits('comment')) return user === undefined ? {} : { me: user };

    return {
      me: user,
      toggle: (rowId, emoji) => this.writeReaction(rowId, user, emoji, this.model.getRow(rowId)?.reactions?.[user]?.[emoji] === undefined),
      pick: (rowId, anchor) => this.openReactionPicker(rowId, user, anchor),
    };
  }

  /** Not an undo step: reacting is not editing the page, as comments are not (18-comments-design §4). */
  private writeReaction(rowId: string, userId: string, emoji: string, add: boolean): void {
    const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);
    const had = this.model.getRow(rowId)?.reactions?.[userId]?.[emoji] !== undefined;

    if (this.readOnly || this.destroyed || block === undefined || had === add) return;
    block.call('updateReaction', { userId, emoji, at: add ? Date.now() : null });
    block.dispatchChange({ derived: true });
    this.syncRowsFromBlocks();
    this.rerenderView({ keepDrawer: true });
  }

  /** The full picker, with no quick set (research/19 §2c). Picking an emoji you already used keeps it. */
  private openReactionPicker(rowId: string, userId: string, anchor: HTMLElement): void {
    const handlers = {
      onSelect: (native: string): void => this.writeReaction(rowId, userId, native, true),
      onRemove: (): void => undefined,
    };

    if (this.reactionPicker === null) {
      const locale = this.api.i18n.getLocale?.() ?? 'en';

      prefetchEmojiPickerData(locale);
      this.reactionPicker = new EmojiPicker({ ...handlers, i18n: this.api.i18n, locale, curated: false, pickOnly: true, label: this.api.i18n.t('tools.database.feedAddReaction') });
    }
    const element = this.reactionPicker.getElement();

    if (!element.isConnected) document.body.appendChild(element);
    void this.reactionPicker.open(anchor, undefined, handlers);
  }

  /** The card's More actions (research/19 §2e): the shared row menu, without the view settings rows. */
  private openFeedActions(rowId: string, anchor: HTMLElement, card: HTMLElement): void {
    this.openRowMenu(rowId, anchor, card, { viewSettings: false });
  }

  /** The active view as CSV, the way this person sees it: filters, sorts, search and visible properties. */
  exportCsv(): string {
    const saved = this.shownView();

    if (saved === undefined) return serializeCsv([]);
    const view = this.controls.effective(saved);
    const columns = this.csvColumns(view);
    const rows = this.model.queryRows({ view, search: this.controls.search }).rows;

    return serializeCsv([columns.map((p) => p.name), ...rows.map((row) => columns.map((p) => this.csvText(p, row)))]);
  }

  /**
   * A CSV as a new database block right after this one, in one undo step.
   * `targets` gives each column's type; without it the first column is the
   * title and the rest are detected. The title stays the placeholder (research/27 §2).
   */
  importCsv(text: string, _fileName?: string, targets?: CsvColumnTarget[], settings?: CsvImportSettings): void {
    if (this.readOnly) return;
    const table = parseCsv(text);

    if (table.length === 0) {
      this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvEmpty') });

      return;
    }
    const built = this.csvBlocks(table, targets, settings);
    const insert = (): void => {
      this.api.blocks.insertAt('database', built.data, { position: { after: this.block.id }, id: built.id });
      for (const row of built.rows) {
        this.api.blocks.insertAt('database-row', row.data, { parentId: built.id, position: 'end', id: row.id });
      }
    };

    this.inOneStep(insert);
    this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvImported', { count: built.rows.length }) });
  }

  /**
   * Merge with CSV: every CSV row becomes a new row (research/05 §9.3, research/30 §9f).
   * `targets` is the dialog's mapping; without it a header goes to the property
   * it names, and any other column becomes a new property at the end.
   */
  mergeCsv(text: string, targets?: CsvMergeTarget[], settings?: CsvImportSettings): void {
    // Person cells match names in the directory: wait for it, or every name is dropped.
    if (this.people === undefined && this.peopleLoad !== null && this.mergeFillsPerson(text, targets, settings)) {
      void this.peopleLoad.then(() => {
        if (!this.destroyed) this.applyCsvMerge(text, targets, settings);
      });

      return;
    }
    this.applyCsvMerge(text, targets, settings);
  }

  private mergeFillsPerson(text: string, targets?: CsvMergeTarget[], settings?: CsvImportSettings): boolean {
    const schema = this.model.getSchema();
    const chosen = targets ?? csvMergeTargets(parseCsv(text), schema, {
      localized: localizeDatabaseSchema(schema, this.api.i18n),
      ...(settings === undefined ? {} : { headers: settings.headers }),
    });

    return chosen.some((target) => typeof target !== 'string' && schema.find((p) => p.id === target.property)?.type === 'person');
  }

  private applyCsvMerge(text: string, targets?: CsvMergeTarget[], settings?: CsvImportSettings): void {
    if (this.readOnly || this.structureLocked()) return;
    const table = parseCsv(text);

    if (table.length < (settings?.headers === false ? 1 : 2)) {
      this.api.notifier.show({ message: this.api.i18n.t('tools.database.csvEmpty') });

      return;
    }
    const plan = planCsvMerge(table, this.model.getSchema(), {
      newId: () => nanoid(),
      localized: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      untitled: this.api.i18n.t('tools.database.csvUntitledColumn'),
      ...(targets === undefined ? {} : { targets }),
      ...settings,
      ...(this.people === undefined ? {} : { people: this.people }),
    });
    const titleId = this.titlePropertyId();
    const write = (): void => {
      for (const [propertyId, added] of Object.entries(plan.newOptions)) {
        const existing = [...(this.model.getProperty(propertyId)?.config?.options ?? [])].sort((a, b) => (a.position < b.position ? -1 : 1));
        const options = added.reduce<SelectOption[]>((list, option) =>
          [...list, { ...option, position: DatabaseModel.positionBetween(list.at(-1)?.position ?? null, null) }], existing);

        this.model.updateProperty(propertyId, { config: { options } });
        void this.sync.syncUpdateProperty({ propertyId, changes: { config: { options } } });
      }
      const ids = new Map(plan.newProperties.map((planned) => [planned.id, this.addMergedProperty(planned).id]));
      // Before the rows: each row insert keeps a sync window open to the next
      // frame, and a change dispatched inside it is dropped as an echo.
      if (Object.keys(plan.newOptions).length > 0 || ids.size > 0) this.writeSchema();
      plan.rows.reduce<string | null>((previous, csvRow) => {
        const csvProperties = Object.fromEntries(Object.entries(csvRow).map(([id, value]) => [ids.get(id) ?? id, value]));
        const properties = withEmptyLists(this.model.getSchema(), csvProperties);
        const position = DatabaseModel.positionBetween(previous, null);
        const id = nanoid();
        const title = properties[titleId];

        this.api.blocks.insertAt(
          'database-row',
          { properties, position, title: typeof title === 'string' ? title : '' },
          { parentId: this.dataId, position: 'end', id },
        );
        void this.sync.syncCreateRow({ id, properties, position });

        return position;
      }, this.model.lastRowKey());
    };

    this.inOneStep(write);
    this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.rerenderView({ keepDrawer: true });
    // From the dialog a skipped column is the person's own "Don't import", not a missing match.
    const skipped = targets === undefined && plan.skippedColumns.length > 0
      ? ` ${this.api.i18n.t('tools.database.csvSkipped', { columns: plan.skippedColumns.join(', ') })}`
      : '';

    this.api.notifier.show({ message: `${this.api.i18n.t('tools.database.csvMerged', { count: plan.rows.length })}${skipped}` });
  }

  /** A merge's new property, at the end and shown in the active view, as Add property does. */
  private addMergedProperty(planned: PropertyDefinition): PropertyDefinition {
    const { id: _id, name, type, position: _position, config, ...settings } = planned;
    const prop = this.model.addProperty(name, type, config, {}, settings);

    this.showInActiveView(prop);
    this.writeEmptyLists(prop.id);
    void this.sync.syncCreateProperty({
      id: prop.id,
      name: prop.name,
      type: prop.type,
      position: prop.position,
      ...(prop.config !== undefined ? { config: prop.config } : {}),
      ...(prop.status !== undefined ? { status: prop.status } : {}),
    });

    return prop;
  }

  private inOneStep(fn: () => void): void {
    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(fn);
    } else {
      fn();
    }
  }

  private fileBase(): string {
    const name = this.title.trim() !== '' ? this.title.trim() : this.shownView()?.name ?? '';

    return name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'database';
  }

  private downloadCsv(): void {
    downloadBlob(new Blob([this.exportCsv()], { type: 'text/csv;charset=utf-8' }), `${this.fileBase()}.csv`);
  }

  private async saveChart(format: 'png' | 'svg', background: boolean): Promise<void> {
    const view = this.view;

    if (!(view instanceof DatabaseChartView)) return;
    const svg = view.toSvgString({ background });
    const blob = format === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await view.toPngBlob({ background });

    if (svg !== '' && blob !== null) downloadBlob(blob, `${this.fileBase()}.${format}`);
  }

  /**
   * Hands the clipboard a promise of the PNG instead of awaiting it first:
   * Safari drops the click's user activation across an await and refuses the write.
   */
  private copyChart(background: boolean): void {
    const view = this.view;
    const t = (key: string): string => this.api.i18n.t(`tools.database.${key}`);
    const fail = (): void => this.api.notifier.show({ message: t('chartCopyFailed'), style: 'error' });

    if (!(view instanceof DatabaseChartView)) return;
    if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
      fail();

      return;
    }
    const png = view.toPngBlob({ background }).then((blob) => {
      if (blob === null) throw new Error('chart image failed');

      return blob;
    });

    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => this.api.notifier.show({ message: t('chartCopied') }),
      fail
    );
  }

  private csvBlocks(table: string[][], targets: CsvColumnTarget[] | undefined, settings?: CsvImportSettings): ReturnType<typeof csvDatabaseBlocks> {
    return csvDatabaseBlocks(table, {
      newId: () => nanoid(),
      untitled: this.api.i18n.t('tools.database.csvUntitledColumn'),
      viewName: DATABASE_DEFAULT_TEXT.viewTypeTable,
      title: '',
      // research/30 §9a, §9c: Notion's import names the title "Name", as a new data source does.
      titleName: DATABASE_DEFAULT_TEXT.sourceTitleProperty,
      ...(targets === undefined ? {} : { targets }),
      ...settings,
    });
  }

  /** Notion's import dialog: the file, then a type per column (research/27 §2). */
  private openCsvImport(then: (file: { name: string; text: string }, targets: CsvColumnTarget[], settings: CsvImportSettings) => void): void {
    openCsvImportDialog({
      t: (key, vars) => this.api.i18n.t(key, vars),
      locale: editorLocale(this.api.i18n),
      hasPeople: this.hasPeople,
      directionSource: this.element,
      onImport: then,
      ...(this.config.helpLinks?.imports !== undefined ? { helpUrl: this.config.helpLinks.imports } : {}),
    });
  }

  /** "Merge with CSV": the import dialog with "Import Location" and this database's properties (research/30 §9f). */
  private openCsvMerge(): void {
    const name = (this.source === undefined ? this.title : this.databaseTitleOf(this.source.databaseId) ?? '').trim();

    openCsvImportDialog({
      t: (key, vars) => this.api.i18n.t(key, vars),
      locale: editorLocale(this.api.i18n),
      hasPeople: this.hasPeople,
      directionSource: this.element,
      merge: {
        location: name === '' ? this.api.i18n.t('tools.database.titlePlaceholder') : name,
        schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
        stored: this.model.getSchema(),
        onMerge: (file, targets, settings) => this.mergeCsv(file.text, targets, settings),
      },
      ...(this.config.helpLinks?.imports !== undefined ? { helpUrl: this.config.helpLinks.imports } : {}),
    });
  }

  /**
   * "Customize page layout", last in More settings. It opens the first row page and starts customizing.
   * With no rows it opens on a "New page" placeholder (research/09 §1).
   */
  private customizeLayoutAction(): ViewSettingsAction | undefined {
    if (this.readOnly || this.structureLocked() || this.linked) return undefined;

    return {
      testId: 'database-settings-customize-layout',
      label: this.api.i18n.t('tools.database.layoutCustomizePage'),
      icon: IconPageLayout,
      onClick: () => {
        const first = this.viewRowOrder()[0];

        if (first === undefined) {
          this.ensureCardDrawer();
          this.cardDrawer?.customizeNewPage();

          return;
        }
        this.handleRowClick(first.id);
        this.cardDrawer?.startCustomizing();
      },
    };
  }

  /** "…" panel actions: save the chart, export the view, import or merge a CSV. */
  private csvActions(): ViewSettingsAction[] {
    const t = (key: string): string => this.api.i18n.t(`tools.database.${key}`);
    const view = this.shownView();
    const actions: ViewSettingsAction[] = [];

    if (view?.type === 'chart' && resolveChartSettings(view, this.chartSchema()).type !== 'number') {
      actions.push({
        testId: 'database-settings-chart-save',
        label: t('chartSaveAs'),
        icon: IconImage,
        page: () => chartExportPage({
          t,
          copy: (background) => this.copyChart(background),
          download: (format, background) => void this.saveChart(format, background),
        }),
      });
    }
    actions.push({ testId: 'database-settings-csv-export', label: t('csvExport'), icon: IconDownload, moreSettings: true, onClick: () => this.downloadCsv() });
    if (!this.readOnly) {
      actions.push(
        // A new database goes beside the block on the page, never inside a holder as a stray source.
        { testId: 'database-settings-csv-import', label: t('csvImport'), icon: IconUpload, moreSettings: true, onClick: () => this.openCsvImport((file, targets, settings) => this.viewOwner().importCsv(file.text, file.name, targets, settings)) },
        {
          testId: 'database-settings-csv-merge',
          label: t('csvMerge'),
          icon: IconMergeCells,
          moreSettings: true,
          disabled: this.structureLocked(),
          onClick: () => this.openCsvMerge(),
        }
      );
    }

    return actions;
  }

  /** The active view's own layout rows (board, gallery, timeline, calendar, chart), for the view settings panel. */
  layoutItems(): PopoverItemParams[] {
    const view = this.shownView();
    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);
    const update = (changes: ViewChanges): void => this.updateActiveView(changes);

    if (view?.type === 'gallery') {
      return galleryLayoutItems(view, schema, this.api.i18n, update);
    }
    if (view?.type === 'chart') {
      return chartLayoutItems(view, localizeDatabaseSchema(this.chartSchema(), this.api.i18n), this.api.i18n, update);
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
    const locale = editorLocale(this.api.i18n);
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
      ...this.commentBadgeLever(),
      ...this.calendarLever(this.dataId, viewConfig.id),
      ...(focusDay !== undefined ? { focusDay } : {}),
      handlers: {
        openRow: (rowId) => this.handleRowClick(rowId),
        ...(this.readOnly || dateId === undefined ? {} : {
          pickRow: (rowId: string) => this.pickCalendarEvent(rowId, dateId),
          lassoRows: (rowIds: string[]) => this.selectRows(rowIds),
        }),
        addRow: (day, open) => {
          if (dateId === undefined) return;
          const rowId = this.addCalendarRow(dateId, day);

          if (open === true && rowId !== undefined) this.handleRowClick(rowId);
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

  /** The person's last centre day, else the view's shared one, else today. */
  private timelineCenter(viewId: string, today: string): string {
    try {
      const stored = window.localStorage.getItem(this.timelineStorageKey(viewId));

      if (stored !== null && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
        return stored;
      }
    } catch {
      // Blocked storage: fall back to this session's value.
    }

    return this.timelineCenters.get(viewId) ?? this.viewOf(viewId)?.timelineCenter ?? today;
  }

  /**
   * Pans only redraw near the canvas ends, so the shared write is rare. It is
   * derived: a pan is not an undo step.
   */
  private setTimelineCenter(viewId: string, day: string): void {
    this.timelineCenters.set(viewId, day);
    const owner = this.viewOwner();

    if (!this.readOnly && owner.model.getView(viewId)?.timelineCenter !== day) {
      owner.model.updateView(viewId, { timelineCenter: day });
      owner.block.dispatchChange({ derived: true });
      void owner.sync.syncUpdateView({ viewId, changes: { timelineCenter: day } });
    }
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
    const nesting = this.subItemNesting(viewConfig, true);
    const nestedGroups = nesting === undefined ? groups : groups.map((group) => ({ ...group, rows: nesting.nest(group.rows) }));
    const arrowsBy = resolveArrowsBy(viewConfig, schema) ?? this.dependencyPair()?.forward;
    const arrowsProperty = arrowsBy === undefined ? undefined : this.model.getProperty(arrowsBy);
    const shownIds = new Set(nestedGroups.flatMap((group) => group.rows.map((row) => row.id)));
    const arrows = arrowsProperty?.type !== 'relation' || arrowsProperty.relation?.targetDatabaseId !== this.dataId
      ? []
      : dependencyArrows(this.model.getOrderedRows(), arrowsProperty.id).filter((a) => shownIds.has(a.from) && shownIds.has(a.to));

    this.view = new DatabaseTimelineView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      view: viewConfig,
      schema: localizeDatabaseSchema(schema, this.api.i18n),
      groups: nestedGroups,
      grouped,
      arrows,
      ...(nesting !== undefined ? { depthOf: (rowId: string) => nesting.table.info(rowId)?.depth ?? 0 } : {}),
      titlePropertyId: titlePropId,
      startPropertyId: startId,
      endPropertyId: endId,
      center: this.timelineCenter(viewConfig.id, today),
      today,
      locale: editorLocale(this.api.i18n),
      cellContext: this.cellContext(),
      ...this.commentBadgeLever(),
      ...this.calendarLever(this.dataId, viewConfig.id),
      handlers: {
        openRow: (rowId) => this.handleRowClick(rowId),
        ...(this.readOnly ? {} : {
          pickRow: (rowId: string, range: boolean) => this.pickRow(rowId, range),
          lassoRows: (rowIds: string[]) => this.selectRows(rowIds),
        }),
        addRow: (groupKey, write) => {
          const rowId = this.addTimelineRow(groupKey, write, startId, endId);

          if (rowId !== undefined && this.view instanceof DatabaseTimelineView) this.view.editTitle(rowId);
        },
        renameRow: (rowId, title) => this.updateRowTitleBlock(rowId, titlePropId, title),
        writeDates: (rowId, write) => this.writeTimelineDates(rowId, write, startId, endId),
        moveRow: (result) => this.handleTableRowDrop(result),
        setZoom: (zoom) => this.updateActiveView({ timelineZoom: zoom }),
        openZoomMenu: (anchor) => this.openTimelineZoomMenu(anchor, viewConfig),
        navigate: (day) => {
          this.setTimelineCenter(viewConfig.id, day);
          this.rerenderView({ keepDrawer: true });
        },
        toggleTable: () => this.updateActiveView({ showTimelineTable: !resolveShowTimelineTable(viewConfig) }),
        ...(this.readOnly ? {} : { openCalculationMenu: (anchor: HTMLElement, propertyId: string) => this.openTimelineCalculationMenu(anchor, viewConfig, propertyId) }),
        loadMore: (groupKey) => {
          shown.set(groupKey, (shown.get(groupKey) ?? limit) + limit);
          this.galleryShown.set(viewConfig.id, shown);
          this.rerenderView({ keepDrawer: true });
        },
        ...this.timelineLink(arrowsProperty),
      },
    });

    return this.view.createView();
  }

  private openTimelineCalculationMenu(anchor: HTMLElement, viewConfig: DatabaseViewConfig, propertyId: string): void {
    const property = this.model.getProperty(propertyId);

    if (property === undefined) return;
    const shown = (p: PropertyDefinition): PropertyDefinition => this.computedValues.valueProperty(p);
    const current = resolveCalculations(viewConfig, this.model.getSchema().map(shown)).get(propertyId);

    openMenu(anchor, calculationItems(shown(property), current, this.api.i18n, (fn) => {
      this.updateActiveView({ calculations: withCalculation(viewConfig, propertyId, fn) });
    }, {
      capCounts: resolveCountCaps(viewConfig).has(propertyId),
      onCapCounts: (cap) => this.updateActiveView({ calculations: withCalculationCap(viewConfig, propertyId, cap) }),
    }));
  }

  /** "+ New": a row with the new bar's dates, plus what the view's filters and group ask for. */
  private addTimelineRow(groupKey: string | null, write: BarWrite, startId: string | undefined, endId: string | undefined): string | undefined {
    if (this.readOnly) return undefined;
    const titlePropId = this.titlePropertyId();
    const groupBy = groupKey === null ? undefined : this.shownView()?.groupBy;
    const properties = this.newRowProperties(titlePropId, groupBy, groupKey ?? NO_VALUE_GROUP_KEY);
    const dates = {
      ...(startId !== undefined && write.start !== undefined ? { [startId]: write.start } : {}),
      ...(endId !== undefined && write.end !== undefined ? { [endId]: write.end } : {}),
    };
    const rowData = this.model.createRowData({ ...properties, ...dates });

    this.insertNewRow(rowData);
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    this.rerenderView({ keepDrawer: true });

    return rowData.id;
  }

  /** A moved bar may change both of its properties: one row write, one sync, one undo step. */
  private writeTimelineDates(rowId: string, write: BarWrite, startId: string | undefined, endId: string | undefined): void {
    if (this.readOnly || this.destroyed || startId === undefined) return;
    const changesOf = (w: BarWrite): Record<string, PropertyValue> => ({
      ...(w.start !== undefined ? { [startId]: w.start } : {}),
      ...(w.end !== undefined && endId !== undefined ? { [endId]: w.end } : {}),
    });
    const changes = changesOf(write);

    if (Object.keys(changes).length === 0) return;
    const pair = this.dependencyPair();
    const settings = pair === undefined ? undefined : this.model.getProperty(pair.forward)?.dependency;
    // Read before the write: the shift compares the old dates with the new.
    const shifts = pair === undefined || settings === undefined
      ? []
      : shiftDependents({ rows: this.model.getOrderedRows(), blockedBy: pair.forward, startId, endId, changedRowId: rowId, newValues: write, settings });

    // A shift and the change that caused it are one undo step.
    this.inOneStep(() => {
      this.updateRowBlock(rowId, changes);
      shifts.forEach((shift) => this.updateRowBlock(shift.rowId, changesOf(shift.write)));
    });
    this.sync.syncUpdateRow({ rowId, properties: changes });
    shifts.forEach((shift) => this.sync.syncUpdateRow({ rowId: shift.rowId, properties: changesOf(shift.write) }));
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.rowOrTemplate(rowId));
    }
    this.rerenderView({ keepDrawer: true });
  }

  private openTimelineZoomMenu(anchor: HTMLElement, viewConfig: DatabaseViewConfig): void {
    const current = resolveTimelineZoom(viewConfig);

    // findings C22: Notion's zoom menu is 180 wide.
    this.showGroupPopover(anchor, TIMELINE_ZOOMS.map((zoom) => ({
      type: PopoverItemType.Default,
      name: `database-timeline-zoom-${zoom}`,
      title: this.api.i18n.t(timelineZoomLabelKey(zoom)),
      isActive: zoom === current,
      onActivate: () => this.updateActiveView({ timelineZoom: zoom }),
    })), undefined, { minWidth: '180px' });
  }

  /** "+" on a day: a new row dated that day, plus what the view's filters ask for. */
  private addCalendarRow(dateId: string, day: string): string | undefined {
    if (this.readOnly) return undefined;
    const titlePropId = this.titlePropertyId();
    const rowData = this.model.createRowData({ ...this.newRowProperties(titlePropId, undefined, NO_VALUE_GROUP_KEY), [dateId]: day });

    this.insertNewRow(rowData);
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    this.rerenderView({ keepDrawer: true });

    return rowData.id;
  }

  /**
   * The view's groups in display order. Select-like groups are the options
   * (or status groups) in board order, with the no-value group at the view's
   * stored place, or last; a group sort or "Hide empty groups" reorders or
   * drops them. Other types list the groups their rows fall in (group-keys.ts).
   */
  private groupOptions(groupByPropId: string, view: DatabaseViewConfig | undefined, search = this.controls.search): SelectOption[] {
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

      return this.model.listGroups({ ...view, groupBy: groupByPropId }, { search }).map((group, index) => ({
        id: group.key,
        label: label(group.key),
        position: String(index),
      }));
    }
    const statusBy = view?.groupByStatus;
    const listed = statusBy === 'group' && property?.type === 'status'
      ? statusGroupsOf(property).map((g) => ({ id: g.id, label: g.name, color: g.color, position: g.position }))
      : localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId, { statusBy }), this.api.i18n);
    const sort = view?.groupSettings?.sort ?? (property === undefined ? 'manual' : defaultGroupSort(property.type));
    // A status's Ascending is its workflow order, the order `listed` is in.
    const inOrder = sort === 'manual' || (property?.type === 'status' && sort === 'ascending');
    const reorder = (): SelectOption[] => property?.type === 'status'
      ? [...listed].reverse()
      : [...listed].sort((x, y) => x.label.localeCompare(y.label) * (sort === 'descending' ? -1 : 1));
    // research/31 §8: a view's own manual order. Status keeps its workflow order.
    const order = sort === 'manual' && property?.type !== 'status' ? view?.groupOrder : undefined;
    const keyOf = (option: SelectOption): string => order?.[option.id] ?? option.position;
    const manual = order === undefined ? listed : [...listed].sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : 1));
    const options = inOrder ? manual : reorder();
    const stored = view?.noValueGroupPosition;
    const index = stored === undefined || !inOrder ? -1 : options.findIndex((option) => keyOf(option) > stored);
    const all = index === -1
      ? [...options, noValue]
      : [...options.slice(0, index), noValue, ...options.slice(index)];

    const counts = (shown: DatabaseViewConfig): Map<string, number> => new Map(this.model.queryGroups({ ...shown, groupBy: groupByPropId }, { search }).map((g) => [g.key, g.count]));

    if (view?.groupSettings?.hideEmptyGroups === true) {
      const counted = counts(view);

      return all.filter((option) => (counted.get(option.id) ?? 0) > 0);
    }

    // findings-board B03: a status grouping shows "No Status" only while a row has no status.
    if (property?.type === 'status' && view !== undefined && (counts(view).get(NO_VALUE_GROUP_KEY) ?? 0) === 0) {
      return all.filter((option) => option.id !== NO_VALUE_GROUP_KEY);
    }

    return all;
  }

  /** Groups the view shows: hidden ones dropped. */
  private shownGroupOptions(groupByPropId: string, view: DatabaseViewConfig | undefined, search = this.controls.search): SelectOption[] {
    return this.groupOptions(groupByPropId, view, search).filter((option) => !hasGroup(view?.hiddenGroups, option.id));
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
    this.writeView(view.id, { noValueGroupPosition: position });
  }

  /** Each group's rows, queried once per render. */
  private queryGroupRows(viewConfig: DatabaseViewConfig, optionIds: string[], search = this.controls.search): Map<string, DatabaseRow[]> {
    return new Map(optionIds.map((id) => [id, this.model.queryRows({ view: viewConfig, group: id, search }).rows]));
  }

  /** Group keys the active view draws; empty when it is not grouped. */
  private activeGroupKeys(): string[] {
    const saved = this.shownView();

    if (saved?.groupBy === undefined) return [];

    return this.shownGroupOptions(saved.groupBy, this.controls.effective(saved)).map((o) => o.id);
  }

  /** Cmd/Ctrl+Alt+T: collapse or open every group of the active view, and keep it in the view. */
  private setAllGroupsCollapsed(collapsed: boolean): void {
    const view = this.shownView();

    if (view === undefined || this.readOnly || this.structureLocked()) return;
    const keys = this.activeGroupKeys();
    const others = (view.collapsedGroups ?? []).filter((group) => !keys.includes(group.id));
    const collapsedGroups = collapsed ? [...others, ...keys.map((id) => ({ id }))] : others;

    this.writeView(view.id, { collapsedGroups });
    this.rerenderView({ keepDrawer: true });
  }

  /** This browser's personal state for the block. */
  private viewStateFallback(): ViewStateFallback {
    return {
      get: (key) => this.api.viewState.get(this.block.id, key),
      set: (key, value) => this.api.viewState.set(this.block.id, key, value),
    };
  }

  /** What the toolbar, filter bar and settings panel ask of the tool. */
  private controlsHost(context?: NativeWidgetContext): ViewControlsHost {
    const owner = context?.owner ?? this;
    // The main toolbar follows the active view's data source; a widget's host is already its source.
    const data = (): DatabaseTool => (context === undefined ? this.activeSource() : this);

    return {
      i18n: this.api.i18n,
      ...(context === undefined && this.config.viewState !== undefined ? { store: this.config.viewState } : {}),
      ...(context !== undefined && context.store !== undefined ? { store: context.store } : {}),
      fallback: context?.fallback ?? this.viewStateFallback(),
      savedView: () => owner.model.getView(context?.viewId ?? this.activeViewId),
      // Filters and sorts read a formula or rollup as its result type.
      schema: () => localizeDatabaseSchema(data().model.getValueSchema(), this.api.i18n),
      rowCount: () => data().model.getOrderedRows().length,
      locked: () => owner.structureLocked(),
      readOnly: () => context === undefined ? this.readOnly : !context.authority.writable(),
      viewCount: () => owner.model.getViews().length,
      layouts: RENDERED_LAYOUTS,
      me: () => this.config.people?.me?.() ?? null,
      people: () => this.people ?? [],
      relatedRows: (property) => data().relationCandidates(property),
      thisPageDatabase: () => (this.thisPage === null ? null : this.api.blocks.getById(this.thisPage)?.parentId ?? null),
      updateView: (changes) => this.updateActiveView(changes, context),
      setLayout: (type) => this.setActiveLayout(type),
      setLocked: (locked) => this.setDatabaseLocked(locked),
      linked: () => owner.linked,
      noDate: () => (context === undefined && (this.view instanceof DatabaseCalendarView || this.view instanceof DatabaseTimelineView) ? this.view.noDateControl() : undefined),
      duplicateView: () => this.duplicateView(this.activeViewId),
      deleteView: () => {
        void this.requestDeleteView(this.activeViewId);
      },
      copyViewLink: () => this.copyViewLink(),
      ...this.calendarLever(owner.dataId, context?.viewId ?? this.activeViewId),
      ...(context === undefined ? {
        shareForm: (anchor: HTMLElement) => {
          if (this.view instanceof DatabaseFormView) this.view.openShare(anchor);
        },
        previewForm: () => this.openFormPreview(this.activeViewId),
      } : {}),
      groups: (sub) => this.groupEntries(sub),
      rerender: () => context === undefined ? this.rerenderView({ keepDrawer: true }) : context.redraw(),
      // The source draws the view, so it holds the layout rows, the export and the row page layout.
      layoutItems: () => data().layoutItems(),
      actions: () => data().csvActions(),
      ...(context === undefined ? { customizeLayout: () => data().customizeLayoutAction() } : {}),
      ...(context === undefined && !this.linked ? { starterRow: () => this.starterRow() } : {}),
      automations: {
        read: () => owner.savedAutomations,
        schema: () => owner.model.getSchema(),
        views: () => owner.model.getViews(),
        writable: () => !owner.destroyed && !owner.readOnly && !owner.structureLocked()
          && owner.source?.documentId === undefined && (context === undefined || context.authority.writable()),
        write: (next, before) => {
          if (owner.destroyed || owner.readOnly || owner.structureLocked() || owner.source?.documentId !== undefined
            || (context !== undefined && !context.authority.writable()) || owner.savedAutomations !== before) return false;
          owner.savedAutomations = structuredClone(next);
          owner.block.dispatchChange();
          return true;
        },
      },
      ...(this.config.ai?.autofill === undefined ? {} : {
        autofill: {
          properties: () => localizeDatabaseSchema(data().model.getSchema(), this.api.i18n),
          writable: () => !data().destroyed && !data().readOnly && !data().structureLocked() && (context === undefined || context.writable()),
          open: (propertyId: string) => {
            const property = data().model.getProperty(propertyId);

            if (property !== undefined && this.element !== null) {
              data().openAutofillSetup(propertyId, localizeDatabaseSchema([property], this.api.i18n)[0]?.name ?? property.name, this.element, context);
            }
          },
        },
      }),
      ...(context === undefined && !this.linked ? {
        dataSources: {
          list: () => this.dataSourceChoices(),
          current: () => data().dataId,
          pick: (id: string) => this.pickDataSource(id),
          existing: () => this.existingSources(),
        },
      } : {}),
      newRow: () => {
        data().newRow();
      },
      openNewMenu: (anchor) => data().openTemplateMenu(anchor),
      structure: {
        subItems: () => data().model.subItemPair() !== undefined,
        setSubItems: (on) => data().setSubItemsEnabled(on),
        dependencies: () => {
          const pair = data().dependencyPair();

          return pair === undefined ? undefined : (data().model.getProperty(pair.forward)?.dependency ?? {});
        },
        setDependencies: (on) => data().setDependenciesEnabled(on),
        updateDependency: (patch) => {
          const pair = data().dependencyPair();

          if (pair === undefined) return;
          data().updatePropertySettings(pair.forward, { dependency: { ...(data().model.getProperty(pair.forward)?.dependency ?? {}), ...patch } });
        },
      },
    };
  }

  private templateTitles(): Array<{ id: string; title: string }> {
    const titleId = this.titlePropertyId();

    return this.templates.map((t) => ({ id: t.id, title: typeof t.properties[titleId] === 'string' ? String(t.properties[titleId]) : '' }));
  }

  private openTemplateMenu(anchor: HTMLElement): void {
    this.showGroupPopover(anchor, templateMenuItems({
      i18n: this.api.i18n,
      databaseName: () => (this.title.trim() === '' ? this.api.i18n.t('tools.database.titlePlaceholder') : this.title.trim()),
      templates: () => this.templateTitles(),
      defaultTemplateId: () => this.model.getDefaultTemplateId(),
      repeatOf: (id) => this.templateRepeat(this.api.blocks.getChildren(this.dataId).find((child) => child.id === id)),
      newEmpty: () => this.newEmptyRow(),
      newFromTemplate: (id) => this.newFromTemplate(id),
      addTemplate: () => this.addTemplate(),
      editTemplate: (id) => this.openTemplate(id),
      setDefault: (id) => this.setDefaultTemplate(id),
      duplicate: (id) => this.duplicateTemplate(id),
      remove: (id) => this.deleteTemplate(id),
    }), anchor, {
      // Notion's panel is 360 wide and ends at the chevron: bounding it by the view bar flips it to end-align.
      minWidth: '360px',
      scopeElement: anchor.closest<HTMLElement>('[data-blok-database-view-bar]') ?? undefined,
    });
    // research/35 §14, research/36 §3.1: in a template's "…" submenu only Escape closes it, one level.
    if (this.groupMenuPopover !== null) {
      this.groupMenuPopover.escapeClosesSubmenuFirst = true;
      this.groupMenuPopover.arrowLeftClosesSubmenu = false;
      this.groupMenuPopover.getElement().setAttribute('data-blok-database-template-menu', '');
    }
  }

  private groupEntries(sub: boolean): ViewGroupEntry[] {
    const saved = this.shownView();

    if (saved === undefined) return [];
    const view = this.controls.effective(saved);
    const groupBy = sub ? view.subGroupBy : view.groupBy;
    const data = this.activeSource();

    if (groupBy === undefined) return [];
    const grouped = sub ? { ...view, groupBy, groupSettings: view.subGroupSettings } : view;
    const counts = new Map(data.model.queryGroups(grouped, { search: this.controls.search }).map((g) => [g.key, g.count]));

    return data.groupOptions(groupBy, grouped, this.controls.search).map((option) => ({ key: option.id, label: option.label, count: counts.get(option.id) ?? 0 }));
  }

  /** A board needs a grouping: the first select-like property, else the first property it can group by. */
  private setActiveLayout(type: ViewType): void {
    const view = this.shownView();

    if (view === undefined || view.type === type) return;
    // The grouping and the place property come from the rows the view shows.
    const data = this.activeSource();
    const change = layoutChange(view, type, data.model.getSchema());

    if (change === undefined) return;
    if (change.needsPlace) data.ensurePlaceProperty();
    this.updateActiveView(change.changes);
    this.rebuildTabBar();
  }

  /** "Edit view" or "Rename" on a tab: show that view, then its settings. */
  private editView(viewId: string, anchor: HTMLElement, start: 'root' | 'rename' = 'root'): void {
    this.switchView(viewId);
    const tab = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(viewId)}"]`);

    this.controls.openSettings(tab?.isConnected === true ? tab : anchor, start);
  }

  private setDatabaseLocked(locked: boolean): void {
    if (this.linked) {
      this.setViewsLocked(locked);

      return;
    }
    if (this.readOnly || this.structureDenied || this.model.isDatabaseLocked() === locked) return;
    this.model.setDatabaseLocked(locked);
    this.writeSchema();
    this.rebuildTabBar();
    this.rerenderView({ keepDrawer: true });
  }

  /** "Lock views" on a linked view (research 20 §2b): the source stays unlocked. */
  private setViewsLocked(locked: boolean): void {
    if (this.readOnly || this.structureDenied || this.viewsLocked() === locked) return;
    const title: PropertyDefinition = this.stubSchema.find((property) => property.type === 'title')
      ?? { id: nanoid(), name: DATABASE_DEFAULT_TEXT.titleProperty, type: 'title', position: 'a0' };

    if (!this.stubSchema.includes(title)) this.stubSchema.unshift(title);
    if (locked) {
      title.databaseLocked = true;
    } else {
      delete title.databaseLocked;
    }
    this.block.dispatchChange();
    this.rebuildTabBar();
    this.rerenderView({ keepDrawer: true });
  }

  private setPageLayout(edit: PageLayoutOp): void {
    if (this.readOnly || this.structureLocked()) return;
    this.model.setPageLayout(edit(this.model.getPageLayout()));
    this.block.dispatchChange();
    this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.refreshRowPrompts();
  }

  /** Views have no addressable URL yet: the page URL with the view id as its fragment. Read by `consumeViewLink`. */
  private copyViewLink(viewId: string = this.activeViewId): void {
    const url = `${window.location.href.split('#')[0]}#view-${encodeURIComponent(viewId)}`;

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
    // Lanes draw every row: a per-column cut would split unevenly across lanes.
    const paged = viewConfig !== undefined && lanes === null;
    const limit = viewConfig === undefined ? 0 : resolveLoadLimit(viewConfig);
    const shownRows = viewConfig === undefined ? new Map<string, number>() : this.galleryShown.get(viewConfig.id) ?? new Map<string, number>();
    const localSchema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);
    const shownOf = (property: PropertyDefinition): PropertyDefinition => this.computedValues.valueProperty(property);
    const calculation = viewConfig === undefined ? undefined : resolveGroupCalculation(viewConfig, localSchema.map(shownOf));
    // The first draw reads the rows already queried; a later card add or removal queries again.
    const drawn = { done: false };
    // Lanes leave out the rows of hidden sub-groups.
    const inShownLane = (row: DatabaseRow): boolean => lanes === null || lanes.keysOf(row).some((key) => lanes.lanes.some((lane) => lane.key === key));
    const aggregate = viewConfig === undefined || calculation === undefined ? undefined : (optionId: string): string => {
      const rows = (drawn.done ? this.queryGroupRows(viewConfig, [optionId]).get(optionId) : groups.get(optionId)) ?? [];

      return groupCalculationText(calculation, rows.filter(inShownLane), localSchema, editorLocale(this.api.i18n), shownOf);
    };

    this.view = new DatabaseBoardView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      options,
      getRows: (optionId, subKey) => {
        const rows = groups.get(optionId) ?? [];

        if (paged) {
          return rows.slice(0, shownRows.get(optionId) ?? limit);
        }

        if (lanes === null) return rows;
        if (subKey !== undefined) return rows.filter((row) => lanes.keysOf(row).includes(subKey));

        return rows.filter(inShownLane);
      },
      getTotal: (optionId) => groups.get(optionId)?.length ?? 0,
      onLoadMore: (optionId) => {
        if (viewConfig === undefined) return;
        shownRows.set(optionId, (shownRows.get(optionId) ?? limit) + limit);
        this.galleryShown.set(viewConfig.id, shownRows);
        this.rerenderView({ keepDrawer: true });
      },
      titlePropertyId: titlePropId,
      hideCounts: viewConfig?.hideGroupAggregation === true,
      ...(aggregate !== undefined && calculation !== undefined
        ? { aggregate, aggregateHint: groupCalculationHint(calculation, localSchema, this.api.i18n) }
        : {}),
      hiddenGroupCount: allOptions.length - shown.length,
      ...(viewConfig !== undefined ? { view: viewConfig } : {}),
      schema: localSchema,
      bodyOf: (rowId) => this.rowBodyBlocks(rowId, descriptionId),
      locale: editorLocale(this.api.i18n),
      cellContext: this.cellContext(),
      onPropertyEdit: (rowId, propertyId, anchor) => this.editCardProperty(rowId, propertyId, anchor),
      ...(this.readOnly ? {} : { lassoRows: (rowIds: string[]) => this.selectRows(rowIds) }),
      ...(lanes !== null ? { subGroups: lanes.lanes } : {}),
      ...(viewConfig !== undefined ? { onLaneToggle: (key: string, collapsed: boolean) => this.saveGroupCollapse(viewConfig.id, `sub:${key}`, collapsed) } : {}),
      ...this.commentBadgeLever(),
      ...this.addCardLabel(titlePropId),
      onTitleEdit: (rowId, newTitle) => {
        const titlePropId = this.titlePropertyId();
        this.updateRowTitleBlock(rowId, titlePropId, newTitle);
        this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: newTitle } });
      },
    });

    const boardEl = this.view.createView();

    drawn.done = true;
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
  private boardLanes(view: DatabaseViewConfig): { lanes: Array<{ key: string; label: string; option?: SelectOption; collapsed: boolean }>; keysOf: (row: DatabaseRow) => string[] } | null {
    const subGroupBy = view.subGroupBy;

    if (subGroupBy === undefined || subGroupBy === view.groupBy || this.model.getProperty(subGroupBy) === undefined) {
      return null;
    }

    const subView = { ...view, groupBy: subGroupBy, groupSettings: view.subGroupSettings };
    const optionGroup = this.isOptionGroup(subGroupBy);

    return {
      lanes: this.groupOptions(subGroupBy, subView).filter((option) => !hasGroup(view.hiddenGroups, `sub:${option.id}`)).map((option) => ({
        key: option.id,
        label: option.label,
        collapsed: hasGroup(view.collapsedGroups, `sub:${option.id}`),
        ...(optionGroup && option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
      })),
      keysOf: this.model.groupKeysOf(subGroupBy, { settings: view.subGroupSettings ?? {} }),
    };
  }

  /** Inline edit of a board card property (Notion 2022-08-25): the cell editor, no page. */
  private editCardProperty(rowId: string, propertyId: string, anchor: HTMLElement, afterClose?: () => void, context?: NativeWidgetContext): void {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId);
    const row = this.model.getRow(rowId);

    if (this.readOnly || (context !== undefined && !context.writable()) || property === undefined || row === undefined) return;
    if (context === undefined) this.cardCellEditor?.close();
    else context.state.cellEditor?.close();

    const reminder = row.reminders?.[propertyId]?.remind;
    const changeDisplay = property.type === 'date' ? this.dateDisplayChanger(propertyId, context) : undefined;
    const handle = openCellEditor(property, readPropertyValue(row, property), anchor, {
      ...this.cellContext(),
      i18n: this.api.i18n,
      readOnly: false,
      options: this.model.getProperty(propertyId)?.config?.options ?? [],
      ...(reminder !== undefined ? { reminder } : {}),
      ...(property.type === 'date'
        ? { onReminderChange: (next: DateReminderOffset | null) => { if (context === undefined || context.writable()) this.commitReminder(rowId, propertyId, next); } }
        : {}),
      ...(changeDisplay !== undefined ? { onDateDisplayChange: changeDisplay } : {}),
      onOptionsChange: (options) => { if (context === undefined || context.writable()) this.handleTableOptionsChange(propertyId, options); },
      onCommit: (value) => { if (context === undefined || context.writable()) this.commitTableCell(rowId, propertyId, value); },
      onClose: () => {
        if (context === undefined) {
          this.cardCellEditor = null;
          this.rerenderView({ keepDrawer: true });
        } else {
          const state = context.state;

          state.cellEditor = null;
          if (context.current()) context.redraw();
        }
        afterClose?.();
      },
    });

    if (context === undefined) this.cardCellEditor = handle.isOpen ? handle : null;
    else {
      const state = context.state;

      state.cellEditor = handle.isOpen ? handle : null;
      context.onDispose(() => {
        if (context.state.cellEditor === handle) handle.cancel();
      });
    }
  }

  /** The redraw after an edit replaced the slot: focus its new copy, so Tab keeps walking the row. */
  private focusListProperty(rowId: string, propertyId: string, context?: NativeWidgetContext): void {
    (context?.root ?? this.boardContainer)?.querySelector<HTMLElement>(
      `[data-blok-database-list-row][data-row-id="${CSS.escape(rowId)}"] [data-blok-database-list-row-property][data-property-id="${CSS.escape(propertyId)}"]`
    )?.focus();
  }

  /** Shift+Enter in a list (research/03 §5). In a sorted view the sort decides where it shows. */
  private addListRowBelow(rowId: string, groupKey: string | null, context?: NativeWidgetContext): void {
    const newId = this.addTableRow(groupKey, rowId, context);

    if (context !== undefined && newId !== null) {
      const state = context.state;

      state.pendingTitle = newId;

      return;
    }

    if (newId !== null && this.view instanceof DatabaseListView) {
      this.view.editTitle(newId);
    }
  }

  /**
   * `bound`: a view bound to a second source. It is placed by its own
   * `dataSourceId`, not a dashboard row, and uses this block's toolbar.
   */
  private mountDashboardWidget(
    dashboardId: string, widget: DashboardWidget,
    bound?: { controls: DatabaseViewControls; placed: () => boolean }
  ): DashboardMount | { error: string } {
    const ownerId = widget.databaseId ?? this.block.id;

    this.dashboardSources.add(ownerId);
    const owner = this.dashboardOwner(ownerId);
    const saved = owner?.model.getView(widget.viewId);

    if (owner === undefined) return { error: 'missing-database' };
    if (saved === undefined) return { error: 'missing-view' };
    if (saved.type === 'dashboard') return { error: 'dashboard-view' };
    const layouts = bound === undefined ? WIDGET_LAYOUTS : RENDERED_LAYOUTS;

    if (!layouts.includes(saved.type)) return { error: 'unsupported-view' };
    const sourceId = saved.dataSourceId ?? owner.dataId;

    this.dashboardSources.add(sourceId);
    const source = this.dashboardOwner(sourceId);

    if (source === undefined || source.source?.documentId !== undefined) return { error: 'missing-source' };
    source.syncRowsFromBlocks();
    const key = JSON.stringify([this.block.id, dashboardId, widget.id, ownerId, saved.id, sourceId]);
    const eligible = (): boolean => {
      const selected = owner.model.getView(saved.id);

      return !this.destroyed && !owner.destroyed && !source.destroyed
        && this.activeViewId === dashboardId && selected !== undefined && layouts.includes(selected.type)
        && (selected.dataSourceId ?? owner.dataId) === sourceId
        && (bound !== undefined ? bound.placed() : this.model.getView(dashboardId)?.dashboard?.rows.some((row) => row.widgets.some((entry) =>
          entry.id === widget.id && entry.viewId === saved.id && (entry.databaseId ?? this.block.id) === ownerId)) === true);
    };
    const storedState = this.dashboardStates.get(key);
    const state: DashboardWidgetState = storedState ?? {
      table: createTableState(),
      shown: new Map(),
      expanded: new Set(),
      authority: { writable: () => eligible() && !this.readOnly && !owner.readOnly && !source.readOnly },
      cellEditor: null,
      pendingTitle: null,
    };

    if (storedState === undefined) this.dashboardStates.set(key, state);
    const lifetime = { disposed: false };
    const cancellations = new Set<() => void>();
    const current = (): boolean => !lifetime.disposed && eligible()
      && owner.model.getView(saved.id)?.type === saved.type;
    const store = this.config.viewState;
    const context: NativeWidgetContext = {
      owner,
      viewId: saved.id,
      get view() { return controls.effective(owner.model.getView(saved.id) ?? saved); },
      get controls() { return controls; },
      get root() { return native.root; },
      authority: state.authority,
      fallback: {
        get: (entry) => this.api.viewState.get(this.block.id, `dashboard:${key}:${entry}`),
        set: (entry, value) => this.api.viewState.set(this.block.id, `dashboard:${key}:${entry}`, value),
      },
      ...(store === undefined ? {} : { store: {
        get: (viewId: string) => store.get(`dashboard:${key}:${viewId}`),
        set: (viewId: string, patch: Partial<DatabaseViewConfig>) => store.set(`dashboard:${key}:${viewId}`, patch),
      } }),
      state,
      current,
      writable: () => current() && state.authority.writable(),
      redraw: (allowed) => {
        queueMicrotask(() => {
          if (eligible() && (allowed === undefined || allowed())) this.redrawWhenIdle();
        });
      },
      onDispose: (cancel) => { cancellations.add(cancel); },
      openRow: (rowId, mode) => {
        if (!current()) return;
        source.handleRowClick(rowId, mode, resolveOpenPagesIn(context.view), state.authority);
      },
    };
    const controls = bound?.controls ?? state.controls ?? new DatabaseViewControls(source.controlsHost(context));

    if (bound === undefined && state.controls === undefined) {
      state.controls = controls;
      controls.load([saved.id]);
    }
    controls.refresh();
    // A bound source reads the holder's view for its own new rows, exports and menus.
    if (bound !== undefined) source.binding = context;
    if (bound !== undefined && !WIDGET_LAYOUTS.includes(saved.type)) {
      return source.mountBound(context, {
        revoke: () => { lifetime.disposed = true; },
        dispose: () => {
          lifetime.disposed = true;
          cancellations.forEach((cancel) => cancel());
          source.revokeCardDrawer(state.authority);
        },
      });
    }
    const native = saved.type === 'table'
      ? source.createNativeTableView(source.titlePropertyId(), context.view, context)
      : source.createNativeListView(source.titlePropertyId(), context.view.groupBy, context.view, context);
    const renderer: DatabaseViewRenderer = native.renderer;
    const keyboard = source.createKeyboard(native.root);
    const click = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;

      if (target === null) return;
      const add = target.closest('[data-blok-database-add-row]');

      if (add !== null && context.writable()) {
        if (renderer instanceof DatabaseListView) {
          source.handleAddListRow(add.getAttribute('data-option-id'), native.root, renderer, context);
        } else {
          source.addTableRow(add.getAttribute('data-option-id'), undefined, context);
        }
        context.redraw();
        event.stopPropagation();

        return;
      }
      const remove = target.closest('[data-blok-database-delete-row]');
      const removeId = remove?.getAttribute('data-row-id');

      if (typeof removeId === 'string' && context.writable()) {
        source.deleteTableRows([removeId]);
        context.redraw();
        event.stopPropagation();

        return;
      }
      if (target.closest(ROW_CONTROL_SELECTOR) !== null) return;
      const rowId = target.closest('[data-blok-database-list-row]')?.getAttribute('data-row-id');

      if (typeof rowId === 'string') {
        if ((event.metaKey || event.ctrlKey || event.shiftKey) && context.writable()) {
          source.pickRow(rowId, event.shiftKey);
        } else {
          context.openRow(rowId);
        }
        event.stopPropagation();
      }
    };
    const buttonClick = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('[data-blok-database-button]');

      if (button === null || button === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      const rowId = button.closest('[data-row-id]')?.getAttribute('data-row-id');
      const propertyId = button.getAttribute('data-property-id');

      if (context.writable() && typeof rowId === 'string' && propertyId !== null) source.pressButton(rowId, propertyId);
    };

    // A bound view's filter bar is this block's own, already under the tabs.
    if (bound === undefined) native.root.prepend(controls.filterBar);
    if (renderer instanceof DatabaseListView && state.pendingTitle !== null) {
      const rowId = state.pendingTitle;

      queueMicrotask(() => {
        if (!current() || state.pendingTitle !== rowId) return;
        state.pendingTitle = null;
        renderer.editTitle(rowId);
      });
    }
    native.root.addEventListener('click', click);
    native.root.addEventListener('click', buttonClick, true);

    return {
      renderer,
      root: native.root,
      get interacting() {
        return state.cellEditor?.isOpen === true || renderer.interacting === true
          || (document.activeElement instanceof HTMLInputElement && native.root.contains(document.activeElement))
          || (source.titleIconMenu?.menu === source.propertyMenu && source.titleIconMenu?.context === context
            && source.propertyMenu.isOpen && context.writable())
          // A redraw remounts this view, and its dispose destroys the header menu. Its onClose redraws.
          || (source.propertyMenuContext === context && source.propertyMenu !== null
            && (source.propertyMenu.isOpen || source.propertyMenu.isIconPickerOpen) && context.writable());
      },
      revoke: () => { lifetime.disposed = true; },
      destroy: () => {
        lifetime.disposed = true;
        cancellations.forEach((cancel) => cancel());
        if (bound === undefined && !state.authority.writable()) controls.destroy();
        source.revokeCardDrawer(state.authority);
        keyboard.destroy();
        native.root.removeEventListener('click', click);
        native.root.removeEventListener('click', buttonClick, true);
        renderer.destroy?.();
        if (source.binding === context) source.binding = null;
      },
    };
  }

  /**
   * A layout other than table and list on a second source: this block draws
   * and wires it as its own view, with the holder's view, toolbar and redraws.
   */
  private mountBound(context: NativeWidgetContext, end: { revoke: () => void; dispose: () => void }): DashboardMount {
    const root = this.renderLayout(context.view);
    const renderer = this.view;
    const drags = (): Array<{ active: boolean } | null> => [this.cardDrag, this.columnDrag, this.listRowDrag];
    const cardEditor = (): boolean => this.cardCellEditor?.isOpen === true;

    this.boundRoot = root;

    this.wireView(root);

    return {
      renderer,
      root,
      // A drag, a card editor or a focused field in it holds the holder's redraw too.
      get interacting() {
        const focused = document.activeElement;

        return renderer.interacting === true || (focused instanceof HTMLInputElement && root.contains(focused)) || cardEditor()
          || drags().some((drag) => drag?.active === true);
      },
      revoke: end.revoke,
      destroy: () => {
        end.dispose();
        this.unwireView();
        // Its teardown may still commit through the holder's view.
        renderer.destroy?.();
        if (this.binding === context) this.binding = null;
        if (this.boundRoot === root) this.boundRoot = null;
      },
    };
  }

  /** Drops what {@link wireView} attached. */
  private unwireView(): void {
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
  }

  private renderTableView(titlePropId: string, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const native = this.createNativeTableView(titlePropId, viewConfig);

    this.view = native.renderer;

    return native.root;
  }

  private createNativeTableView(titlePropId: string, viewConfig: DatabaseViewConfig, context?: NativeWidgetContext): { renderer: DatabaseTableView; root: HTMLDivElement } {
    const groupBy = viewConfig.groupBy;
    const groups = groupBy !== undefined && this.model.getProperty(groupBy) !== undefined
      ? this.tableGroups(groupBy, viewConfig, (context?.controls ?? this.controls).search)
      : undefined;
    const state = context?.state.table ?? this.tableState(viewConfig.id);

    // Collapse is saved in the view, so peers and reloads see it.
    state.collapsed.clear();
    for (const group of groups ?? []) {
      if (hasGroup(viewConfig.collapsedGroups, group.key)) state.collapsed.add(group.key);
    }

    const nesting = this.subItemNesting(viewConfig, false, context);
    const rows = groups === undefined ? this.model.queryRows({ view: viewConfig, search: (context?.controls ?? this.controls).search }).rows : [];

    const readOnly = context === undefined ? this.readOnly : !context.writable();
    const renderer: DatabaseTableView = new DatabaseTableView({
      readOnly,
      i18n: this.api.i18n,
      locale: editorLocale(this.api.i18n),
      get view() { return context?.view ?? viewConfig; },
      schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
      rows: nesting === undefined ? rows : nesting.nest(rows),
      ...(groups !== undefined ? { groups: nesting === undefined ? groups : groups.map((group) => ({ ...group, rows: nesting.nest(group.rows) })) } : {}),
      ...(nesting !== undefined ? { nesting: nesting.table } : {}),
      titlePropertyId: titlePropId,
      state,
      cellContext: this.cellContext(),
      selectionBarSlot: () => context === undefined ? this.selectionBarSlot() : null,
      ...(readOnly ? { openRow: (rowId: string) => (context === undefined ? this.handleRowClick(rowId) : context.openRow(rowId)) } : {
        handlers: this.tableHandlers(context, () => renderer),
      }),
      ...this.commentLever(),
      ...(this.config.favorites !== undefined ? { favorite: (rowId: string) => this.favoriteFor(rowId) } : {}),
      ...this.autofillLever(readOnly, context),
      notify: (message) => this.api.notifier.show({ message }),
      ...(readOnly ? {} : { buttonError: (property: PropertyDefinition) => this.buttonHasError(property.id) }),
    });

    return { renderer, root: renderer.createView() };
  }

  /**
   * Sub-items "Nested in toggle" for a table, list or timeline: orders shown
   * rows under their open parents and answers the table's per-row questions.
   */
  private subItemNesting(view: DatabaseViewConfig, expandAll = false, context?: NativeWidgetContext): { nest: (rows: DatabaseRow[]) => DatabaseRow[]; table: TableNesting } | undefined {
    const pair = this.model.subItemPair();

    if (pair === undefined || resolveSubItemsDisplay(view) !== 'nested') return undefined;
    const all = this.model.getOrderedRows();
    const parents = parentMap(all, pair.forward);
    const info = new Map<string, { depth: number; hasChildren: boolean; expanded: boolean }>();
    // The timeline and list have no toggle yet: they show the whole tree.
    const expanded = expandAll ? new Set(all.map((row) => row.id)) : context?.state.expanded ?? this.expandedSubItems;

    return {
      nest: (rows) => nestRows(rows, all, parents, view, expanded).map((nested) => {
        info.set(nested.row.id, { depth: nested.depth, hasChildren: nested.hasChildren, expanded: (context?.state.expanded ?? this.expandedSubItems).has(nested.row.id) });

        return nested.row;
      }),
      table: {
        info: (rowId) => info.get(rowId),
        toggle: (rowId) => this.toggleSubItems(rowId, context),
        ...(this.readOnly ? {} : { addSubItem: (parentId: string) => this.addSubItem(parentId, context) }),
      },
    };
  }

  private toggleSubItems(rowId: string, context?: NativeWidgetContext): void {
    if (context !== undefined && !context.current()) return;
    const expanded = context?.state.expanded ?? this.expandedSubItems;
    if (expanded.has(rowId)) {
      expanded.delete(rowId);
    } else {
      expanded.add(rowId);
    }
    if (context === undefined) this.rerenderView({ keepDrawer: true });
    else context.redraw();
  }

  private dependencyPair(): { forward: string; backward: string } | undefined {
    return relationPair(this.model.getSchema(), this.dataId, 'blockedBy', 'blocking');
  }

  /** Database settings → Dependencies: the "Blocked by" / "Blocking" pair. */
  setDependenciesEnabled(on: boolean): void {
    this.setRelationPairEnabled(on, 'blockedBy', 'blocking', 'tools.database.dependenciesBlockedByName', 'tools.database.dependenciesBlockingName', false);
  }

  /** The bars' link handle: onto the view's relation, else (findings C16) onto a new dependency pair. */
  private timelineLink(arrowsProperty: PropertyDefinition | undefined): { link?: (from: string, to: string) => void } {
    if (arrowsProperty?.type === 'relation') {
      return { link: (from, to) => this.linkDependency(arrowsProperty.id, from, to) };
    }

    return this.readOnly ? {} : { link: (from, to) => this.linkNewDependency(from, to) };
  }

  /** findings C16: a link drawn before dependencies exist turns them on, then links. */
  private linkNewDependency(from: string, to: string): void {
    if (this.dependencyPair() === undefined) this.setDependenciesEnabled(true);
    const pair = this.dependencyPair();

    if (pair !== undefined) this.linkDependency(pair.forward, from, to);
  }

  /** A link drawn on the timeline: `from` blocks `to`. Both sides in one undo step. */
  private linkDependency(blockedById: string, from: string, to: string): void {
    const row = this.model.getRow(to);

    if (this.readOnly || row === undefined || from === to || relationIdsOf(row.properties[blockedById]).includes(from)) return;
    this.commitRelation(to, blockedById, [...relationIdsOf(row.properties[blockedById]).map((id) => ({ id })), { id: from }]);
    this.rerenderView({ keepDrawer: true });
  }

  /** A new row under `parentId`: its "Parent item" and the parent's "Sub-items", in one undo step. */
  addSubItem(parentId: string, context?: NativeWidgetContext): string | null {
    const pair = this.model.subItemPair();

    if (this.readOnly || (context !== undefined && !context.writable()) || pair === undefined || this.model.getRow(parentId) === undefined) return null;
    const rowData = this.model.createRowData(this.newRowProperties(this.titlePropertyId(), undefined, NO_VALUE_GROUP_KEY, undefined, context?.view));

    this.inOneStep(() => {
      this.insertNewRow(rowData);
      this.syncRowsFromBlocks();
      this.commitRelation(rowData.id, pair.forward, [{ id: parentId }]);
    });
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    (context?.state.expanded ?? this.expandedSubItems).add(parentId);
    this.syncRowsFromBlocks();
    if (context === undefined) this.rerenderView({ keepDrawer: true });
    else context.redraw();

    return rowData.id;
  }

  /**
   * Database settings → Sub-items. On adds the "Parent item" / "Sub-items"
   * self-relation pair; off drops their roles and keeps both relations, so
   * no value is lost.
   */
  setSubItemsEnabled(on: boolean): void {
    this.setRelationPairEnabled(on, 'parentItem', 'subItems', 'tools.database.subItemsParentName', 'tools.database.subItemsChildrenName', true);
  }

  private setRelationPairEnabled(on: boolean, forwardRole: RelationRole, backwardRole: RelationRole, forwardName: string, backwardName: string, forwardLimitOne: boolean): void {
    if (this.readOnly || this.model.isDatabaseLocked()) return;
    const pair = relationPair(this.model.getSchema(), this.dataId, forwardRole, backwardRole);

    if (on === (pair !== undefined)) return;
    if (pair !== undefined) {
      [pair.forward, pair.backward].forEach((id) => {
        const relation = this.model.getProperty(id)?.relation;

        if (relation === undefined) return;
        const { role: _role, ...rest } = relation;

        this.model.updateProperty(id, { relation: rest });
        void this.sync.syncUpdateProperty({ propertyId: id, changes: { relation: rest } });
      });
      this.commitSchema();

      return;
    }
    const forward = this.model.addProperty(this.api.i18n.t(forwardName), 'relation', undefined, {}, {
      relation: { targetDatabaseId: this.dataId, ...(forwardLimitOne ? { limit: 1 as const } : {}), twoWay: true, role: forwardRole },
    });
    const backward = this.model.addProperty(this.api.i18n.t(backwardName), 'relation', undefined, {}, {
      relation: { targetDatabaseId: this.dataId, twoWay: true, syncedPropertyId: forward.id, role: backwardRole },
    });

    this.model.updateProperty(forward.id, { relation: { ...(forward.relation ?? { targetDatabaseId: this.dataId }), syncedPropertyId: backward.id } });
    [forward.id, backward.id].forEach((id) => {
      this.writeEmptyLists(id);
      const prop = this.model.getProperty(id);

      if (prop !== undefined) {
        void this.sync.syncCreateProperty({ id: prop.id, name: prop.name, type: prop.type, position: prop.position, ...(prop.relation !== undefined ? { relation: prop.relation } : {}) });
      }
    });
    this.commitSchema();
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
  private tableGroups(groupBy: string, viewConfig: DatabaseViewConfig, search = this.controls.search): TableGroup[] {
    const ordered = this.shownGroupOptions(groupBy, viewConfig, search);
    const rows = this.queryGroupRows(viewConfig, ordered.map((o) => o.id), search);
    const optionGroup = this.isOptionGroup(groupBy);

    return ordered.map((option) => ({
      key: option.id,
      label: option.label,
      ...(optionGroup && option.id !== NO_VALUE_GROUP_KEY ? { option } : {}),
      rows: rows.get(option.id) ?? [],
    }));
  }

  /** What the table view asks of the tool. Each write goes through the row block or the view, then the backend. */
  private tableHandlers(context?: NativeWidgetContext, table?: () => DatabaseTableView): TableHandlers {
    const writable = (): boolean => context === undefined ? !this.readOnly && !this.destroyed : context.writable();

    return {
      commitCell: (rowId, propertyId, value) => { if (writable()) this.commitTableCell(rowId, propertyId, value); },
      commitReminder: (rowId, propertyId, reminder) => { if (writable()) this.commitReminder(rowId, propertyId, reminder); },
      commitBulkReminder: (rowIds, propertyId, reminder, picked) => writable() ? this.commitBulkReminder(rowIds, propertyId, reminder, picked) : [],
      dateDisplayChanger: (propertyId) => this.dateDisplayChanger(propertyId, context),
      editEnded: () => context === undefined ? this.redrawWhenIdle() : context.redraw(),
      addRow: (groupKey, afterRowId) => this.addTableRow(groupKey, afterRowId, context),
      deleteRows: (rowIds, byKey) => {
        if (!writable()) return;
        if (byKey === true) this.trashWithToast(() => this.deleteTableRows(rowIds), rowIds.length);
        else this.deleteTableRows(rowIds);
      },
      duplicateRow: (rowId) => { if (writable()) this.duplicateTableRow(rowId); },
      openRow: (rowId, mode) => context === undefined ? this.handleRowClick(rowId, mode) : context.openRow(rowId, mode),
      copyRowLink: (rowId) => this.copyRowLink(rowId),
      moveTargets: () => this.moveTargets(),
      // After the click that closed the editor, which would count as outside the
      // new menu; the table may have redrawn by then, so find the header late.
      editProperty: (propertyId) => setTimeout(() => {
        const header = this.liveColumnHeader(propertyId, context);

        if (header !== null && writable()) this.openPropertyMenu(propertyId, header, table?.(), context);
      }, 0),
      moveRowTo: (rowId, databaseId) => { if (writable()) this.moveRowTo({ rowId, databaseId }); },
      editRowIcon: (rowId) => { if (writable()) this.editRowIcon(rowId, context); },
      updateView: (changes) => { if (writable()) this.updateActiveView(changes, context); },
      openPropertyMenu: (propertyId, anchor) => { if (writable()) this.openPropertyMenu(propertyId, anchor, table?.(), context); },
      addProperty: (anchor, placement) => { if (writable()) this.openAddProperty(anchor, placement, undefined, context); },
      viewAction: (action, propertyId, anchor) => { if (writable()) this.onTableViewAction(action, propertyId, anchor, context); },
      moveRow: (result) => this.handleTableRowDrop(result, context),
      sortedRowDrop: (result) => this.onSortedRowDrop(result, context),
      bulkEdit: () => undefined,
      commitCells: (changes, newRows, whenIdle) => this.commitTableCells(changes, newRows, context, whenIdle),
      editFilters: (anchor) => { if (writable()) (context?.controls ?? this.controls).openSettings(anchor, 'filter'); },
      searching: () => (context?.controls ?? this.controls).search !== '',
      clearSearch: () => (context?.controls ?? this.controls).clearSearch(),
      groupToggled: (key, collapsed) => { if (writable()) (context?.owner ?? this).saveGroupCollapse(context?.viewId ?? this.activeViewId, key, collapsed); },
      rerender: () => context === undefined ? this.rerenderView({ keepDrawer: true }) : context.redraw(),
      // Locked: no option edits, so the select editor offers no "Create" (research/05 §12).
      ...(this.structureLocked() ? {} : { optionsChange: (propertyId: string, options: SelectOption[]) => { if (writable()) this.handleTableOptionsChange(propertyId, options); } }),
    };
  }

  /** Filter, Sort and Group from a column header. Filter and sort are personal edits (D4). */
  protected onTableViewAction(action: 'filter' | 'sort' | 'group', propertyId: string, anchor: HTMLElement, context?: NativeWidgetContext): void {
    if (context !== undefined && !context.writable()) return;
    const controls = context?.controls ?? this.controls;
    if (action === 'filter') {
      controls.filterBy(propertyId, anchor);
    } else if (action === 'sort') {
      controls.sortBy(propertyId, anchor);
    } else if (!(context?.owner ?? this).structureLocked()) {
      controls.groupBy(propertyId, anchor);
    }
  }

  /**
   * A row dropped in a sorted table. Same rule as the board: a move to another
   * group writes the group value only; a reorder asks to remove sorting (D7).
   */
  protected onSortedRowDrop(result: TableRowDropResult, context?: NativeWidgetContext): void {
    const { rowId, beforeRowId, afterRowId, groupKey, fromGroupKey } = result;
    const view = context?.view ?? this.shownView();
    const groupBy = view?.groupBy;

    if (this.readOnly || (context !== undefined && !context.writable())) return;
    if (groupBy !== undefined && groupKey !== fromGroupKey) {
      this.cardDragFromOptionId = fromGroupKey;
      this.writeRowValues(rowId, this.changedValues(rowId, { [groupBy]: this.droppedGroupValue(groupBy, rowId, groupKey, view) }), context);

      return;
    }
    this.askToRemoveSorting(rowId, beforeRowId, afterRowId, {}, context);
  }

  /**
   * While locked, option edits are refused, so drop any option id the schema
   * does not hold: the drawer's editor was built before the lock and may
   * still create one.
   */
  private knownOptionsOnly(propertyId: string, value: PropertyValue): PropertyValue {
    const property = this.model.getProperty(propertyId);

    if (!this.structureLocked() || property === undefined || !this.isOptionGroup(propertyId)) return value;
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
      this.cardDrawer.syncOpenRow(this.rowOrTemplate(rowId));
    }
  }

  /**
   * A date's Remind choice. Stored on the row block only: the backend adapter has no reminders.
   * `fromPage`: the open row page made it and already shows it; a resync would redraw under its picker.
   */
  private commitReminder(rowId: string, propertyId: string, reminder: DateReminderOffset | null, fromPage = false): void {
    const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

    if (this.readOnly || this.destroyed || block === undefined) return;
    if ((this.rowOrTemplate(rowId)?.reminders?.[propertyId]?.remind ?? null) === reminder) return;
    // The setter's zone: a date with no property zone is then due at one time on every client.
    block.call('updateReminders', { [propertyId]: reminder === null ? null : { remind: reminder, timeZone: viewerTimeZone() } });
    block.dispatchChange();
    this.syncRowsFromBlocks();
    if (!fromPage && this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.rowOrTemplate(rowId));
    }
  }

  /**
   * A bulk date picker's Remind (research/21 §6). A pick goes on every
   * selected row. The property default goes on the rows with no reminder of
   * their own, dated or not, as Notion did; a default that stopped fitting the
   * time changes nothing.
   */
  private commitBulkReminder(rowIds: string[], propertyId: string, reminder: DateReminderOffset | null, picked: boolean): string[] {
    const targets = rowIds.filter((rowId) => picked || (reminder !== null && this.rowOrTemplate(rowId)?.reminders?.[propertyId] === undefined));

    targets.forEach((rowId) => this.commitReminder(rowId, propertyId, reminder));

    return targets;
  }

  /**
   * A paste, fill or bulk edit: every write in one undo step. New rows go at
   * the end, with the values the view's filters give a new row under the
   * pasted ones.
   */
  /** `whenIdle`: an open bulk picker made it; the redraw waits for it to close. */
  private commitTableCells(changes: CellChange[], newRows: Array<Record<string, PropertyValue>>, context?: NativeWidgetContext, whenIdle = false): void {
    if (this.readOnly || this.destroyed || (context !== undefined && !context.writable()) || (changes.length === 0 && newRows.length === 0)) return;
    const run = (): void => {
      changes.forEach(({ rowId, propertyId, value }) => this.commitTableCell(rowId, propertyId, value));
      newRows.forEach((values) => {
        const titlePropId = this.titlePropertyId();
        const rowData = this.model.createRowData({ ...this.newRowProperties(titlePropId, undefined, NO_VALUE_GROUP_KEY, undefined, context?.view), ...values });
        const title = rowData.properties[titlePropId];

        this.api.blocks.insertAt(
          'database-row',
          { properties: rowData.properties, position: rowData.position, title: typeof title === 'string' ? title : '' },
          { parentId: this.dataId, position: 'end', id: rowData.id },
        );
        this.syncRowsFromBlocks();
        void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
      });
    };

    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(run);
    } else {
      run();
    }
    if (context !== undefined) context.redraw();
    else if (whenIdle) this.redrawWhenIdle();
    else this.rerenderView({ keepDrawer: true });
  }

  /** Inserts a row block at the end, or right after `afterRowId`. */
  private addTableRow(groupKey: string | null, afterRowId?: string, context?: NativeWidgetContext): string | null {
    if (this.readOnly || (context !== undefined && !context.writable())) return null;
    const titlePropId = this.titlePropertyId();
    const groupBy = groupKey === null ? undefined : (context?.view ?? this.shownView())?.groupBy;
    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupBy, groupKey ?? NO_VALUE_GROUP_KEY, undefined, context?.view));
    const ordered = this.model.getOrderedRows();
    const afterIndex = afterRowId === undefined ? -1 : ordered.findIndex((row) => row.id === afterRowId);
    const position = afterIndex === -1
      ? rowData.position
      : DatabaseModel.positionBetween(ordered[afterIndex].position, ordered[afterIndex + 1]?.position ?? null);
    const owner = context?.owner ?? this;
    const view = context?.view ?? this.shownView();
    const ownOrder = afterRowId === undefined || owner.structureDenied || view === undefined ? undefined : owner.model.rowOrderOf(view);

    if (view !== undefined && ownOrder !== undefined) {
      // The shared key above places the row after `afterRowId` in the shared order only.
      const manual = this.model.getRowsInManualOrder(view);
      const at = manual.findIndex((row) => row.id === afterRowId);
      const next = at === -1 ? undefined : manual[at + 1];
      const rowOrder = at === -1 ? ownOrder : {
        ...ownOrder,
        [rowData.id]: DatabaseModel.positionBetween(rowOrderKey(manual[at], ownOrder), next === undefined ? null : rowOrderKey(next, ownOrder)),
      };

      // The view write goes first: an insert opens a sync window that would read it as an echo.
      this.inOneStep(() => {
        owner.model.updateView(view.id, { rowOrder });
        owner.block.dispatchChange();
        this.insertNewRow(rowData, position);
      });
      void owner.sync.syncUpdateView({ viewId: view.id, changes: { rowOrder: structuredClone(rowOrder) } });
    } else {
      this.insertNewRow(rowData, position);
    }
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position });
    if (context === undefined) this.rerenderView({ keepDrawer: true });
    else context.redraw();

    this.markFresh(rowData.id);

    // The page opens instead of the inline title edit.
    return this.openIfFiltered(rowData.id, context) ? null : rowData.id;
  }

  /**
   * Escape deletes an accidental empty new row (Notion, R:2022-04-14): one
   * "+ New" just made that still has no title, no body and only the values it
   * was born with.
   */
  private dropFreshRow(rowId: string): boolean {
    const fresh = this.freshRow;
    const row = this.model.getRow(rowId);

    this.freshRow = null;
    if (this.readOnly || fresh?.id !== rowId || row === undefined) {
      return false;
    }
    const title = row.properties[this.titlePropertyId()];
    const untouched = JSON.stringify(row.properties) === fresh.properties;

    if ((typeof title === 'string' && title !== '') || !untouched || this.api.blocks.getChildren(rowId).some((child) => !isAnnotationBlock(child))) {
      return false;
    }
    this.deleteRowBlock(rowId);
    void this.sync.syncDeleteRow({ rowId });
    this.rerenderView({ keepDrawer: true });

    return true;
  }

  private markFresh(rowId: string): void {
    const row = this.model.getRow(rowId);

    this.freshRow = row === undefined ? null : { id: rowId, properties: JSON.stringify(row.properties) };
  }

  /**
   * Notion opens a row made in a filtered view in its peek: the filter may
   * hide the row, and the page is where the rest gets filled in (research/08).
   */
  private openIfFiltered(rowId: string, context?: NativeWidgetContext): boolean {
    const saved = this.shownView();
    const view = context?.view ?? (saved === undefined ? undefined : this.controls.effective(saved));

    if (view === undefined || (view.filters.length === 0 && countFilterRules(view.filterTree) === 0)) {
      return false;
    }
    if (context === undefined) this.handleRowClick(rowId);
    else context.openRow(rowId);

    return true;
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

  /**
   * Duplicates a row with its page body. A parent's sub-items are
   * duplicated too, under the copy (research/05 §11.1). One undo step.
   */
  private duplicateTableRow(rowId: string): void {
    const row = this.model.getRow(rowId);

    if (row === undefined || this.readOnly) return;
    const ordered = this.model.getOrderedRows();
    const pair = this.model.subItemPair();
    const subItems = pair === undefined ? [] : descendantsOf(rowId, ordered, pair.forward);
    const copies = new Map([rowId, ...subItems].map((id) => [id, nanoid()]));
    const titlePropId = this.titlePropertyId();
    const remap = (value: PropertyValue | undefined): PropertyValue =>
      relationIdsOf(value).filter((id) => copies.has(id)).map((id) => ({ id: copies.get(id) ?? id }));
    const created: Array<{ id: string; properties: Record<string, PropertyValue>; position: string }> = [];
    const nextKey = ordered[ordered.findIndex((r) => r.id === rowId) + 1]?.position ?? null;
    const positions = positionsBetween(row.position, nextKey, subItems.length + 1);

    const write = (): void => [rowId, ...subItems].forEach((sourceId, index) => {
      const source = this.model.getRow(sourceId);
      const id = copies.get(sourceId);

      if (source === undefined || id === undefined) return;
      const properties = withEmptyLists(this.model.getSchema(), structuredClone(source.properties));

      if (pair !== undefined) {
        properties[pair.backward] = remap(source.properties[pair.backward]);
        if (sourceId !== rowId) properties[pair.forward] = remap(source.properties[pair.forward]);
      }
      const position = positions[index];
      const title = properties[titlePropId];

      const reminders = copiedReminders(source.reminders, properties);

      this.api.blocks.insertAt(
        'database-row',
        {
          properties,
          position,
          title: typeof title === 'string' ? title : '',
          ...(source.icon !== undefined ? { icon: source.icon } : {}),
          ...(source.cover !== undefined ? { cover: source.cover } : {}),
          ...(source.fullWidth !== undefined ? { fullWidth: source.fullWidth } : {}),
          ...(reminders !== undefined ? { reminders } : {}),
        },
        { parentId: this.dataId, position: 'end', id },
      );
      this.copyChildBlocks(sourceId, id);
      created.push({ id, properties, position });
    });

    const grandparent = pair === undefined ? undefined : relationIdsOf(row.properties[pair.forward]).pop();
    const view = this.shownView();
    const viewOrder = this.structureDenied || view === undefined ? undefined : this.model.rowOrderOf(view);
    // In a view with its own order the shared keys above place the copies by the original in the shared order only.
    const placed = ((): Record<string, string> | undefined => {
      if (view === undefined || viewOrder === undefined) return undefined;
      const manual = this.model.getRowsInManualOrder(view);
      const at = manual.findIndex((r) => r.id === rowId);
      const next = manual[at + 1];
      const keys: Record<string, string> = { ...viewOrder };
      const viewKeys = positionsBetween(rowOrderKey(row, viewOrder), next === undefined ? null : rowOrderKey(next, viewOrder), subItems.length + 1);

      [rowId, ...subItems].forEach((sourceId, index) => {
        keys[copies.get(sourceId) ?? sourceId] = viewKeys[index];
      });

      return keys;
    })();

    this.inOneStep(() => {
      // The view write goes first: an insert opens a sync window that would read it as an echo.
      if (view !== undefined && placed !== undefined) {
        this.viewOwner().model.updateView(view.id, { rowOrder: placed });
        this.viewOwner().block.dispatchChange();
      }
      write();
      const copy = copies.get(rowId);

      // The copy sits beside the original: its parent lists it too.
      if (pair !== undefined && grandparent !== undefined && copy !== undefined && this.model.getRow(grandparent) !== undefined) {
        this.updateRowBlock(grandparent, { [pair.backward]: addRelatedIds(this.model.getRow(grandparent)?.properties[pair.backward], copy, null) });
      }
    });
    created.forEach((copy) => void this.sync.syncCreateRow({ ...copy, properties: adapterRowValues(copy.properties, this.model.getSchema()).properties }));
    if (view !== undefined && placed !== undefined) void this.viewOwner().sync.syncUpdateView({ viewId: view.id, changes: { rowOrder: structuredClone(placed) } });
    this.syncRowsFromBlocks();
    this.rerenderView({ keepDrawer: true });
  }

  /** A button cell's click: its actions in order, the writes as one undo step. */
  pressButton(rowId: string, propertyId: string): void {
    const property = this.model.getProperty(propertyId);

    if (this.readOnly || property?.type !== 'button' || this.model.getRow(rowId) === undefined) return;
    const isHere = (databaseId: string | undefined): boolean => databaseId === undefined || databaseId === this.dataId;
    const t = (key: string): string => this.api.i18n.t(key);
    const actions = property.button?.buttonActions ?? [];
    const run = (kept: typeof actions): void => runButtonActions(kept, rowId, {
      oneStep: (fn) => this.inOneStep(fn),
      writeValues: (id, changes, databaseId) => {
        if (isHere(databaseId)) {
          Object.entries(changes).forEach(([key, value]) => this.commitTableCell(id, key, value));
        } else {
          this.api.blocks.getById(databaseId ?? '')?.call('writeButtonValues', { rowId: id, changes });
        }
      },
      insertBlocks: (id, blocks) => blocks.forEach((block) => {
        this.api.blocks.insertAt(block.type, structuredClone(block.data), { parentId: id, position: 'end' });
      }),
      openRow: (id, databaseId) => {
        if (isHere(databaseId)) this.handleRowClick(id);
        else this.api.blocks.getById(databaseId ?? '')?.call('openRow', { rowId: id });
      },
      openUrl: (url) => {
        const href = safeHref(url);

        if (href !== null) window.open(href, '_blank', 'noopener');
      },
      callback: (action) => {
        void Promise.resolve(this.config.buttons?.onAction?.({ databaseId: this.dataId, rowId, propertyId, action })).catch((error: unknown) => this.showBackendError(error));
      },
      me: () => this.config.people?.me?.() ?? null,
      now: () => new Date(),
      addPage: (databaseId, name, properties) => {
        if (isHere(databaseId)) return this.addButtonRow(name, properties);
        const received: Array<string | null> = [];

        this.api.blocks.getById(databaseId ?? '')?.call('addButtonPage', { name, properties, receive: (id: string | null) => received.push(id) });

        return received[0] ?? null;
      },
      source: (databaseId) => (isHere(databaseId)
        ? { schema: this.model.getSchema(), rows: this.model.getOrderedRows() }
        : this.readDatabaseSource(databaseId)),
      rowValues: (id) => this.model.getRow(id)?.properties,
      notify: (action, to, message) => {
        void Promise.resolve(this.config.buttons?.onNotify?.({ databaseId: this.dataId, rowId, propertyId, action, to, message })).catch((error: unknown) => this.showBackendError(error));
      },
      askAgent: (message) => this.askAgentFromButton(message, rowId),
    });

    const toAgent = agentMessageOf(actions);

    if (toAgent === null && !needsConfirmation(actions)) {
      run(actions);
      this.rerenderView({ keepDrawer: true });

      return;
    }
    // The question below is open: a second press or a key repeat adds nothing.
    if (toAgent !== null && this.agentPressOpen) return;
    // A press the agent cannot answer runs nothing: one press, one decision.
    if (toAgent !== null && !this.agentCanRun()) return;
    this.agentPressOpen = toAgent !== null;
    void askConfirmations(actions, (action) => openDatabaseConfirm({
      title: action.message ?? t('tools.database.buttonConfirmDefault'),
      confirmLabel: action.confirmLabel ?? t('tools.database.buttonConfirmContinue'),
      cancelLabel: action.cancelLabel ?? t('tools.database.optionDeleteCancel'),
      directionSource: this.element,
    })).then(async (kept) => {
      const message = agentMessageOf(kept);
      // Anyone who can edit the button wrote this text, and the agent acts with
      // the presser's rights. So the presser reads it first, before any write.
      // Cancel stays focused first, so a held Enter cannot confirm.
      const sends = message === null || await openDatabaseConfirm({
        title: t('tools.database.buttonAgentConfirm'),
        description: message,
        confirmLabel: t('tools.database.buttonConfirmContinue'),
        cancelLabel: t('tools.database.optionDeleteCancel'),
        directionSource: this.element,
      });

      // The dialog took time: the row, the block, write access or the agent may be gone.
      if (!sends || this.readOnly || this.destroyed || this.model.getRow(rowId) === undefined) return;
      if (message !== null && !this.agentCanRun()) return;
      run(kept);
      this.rerenderView({ keepDrawer: true });
    }).finally(() => {
      this.agentPressOpen = false;
    });
  }

  /** The agent can take a button's message now. If not, says why in a toast. */
  private agentCanRun(): boolean {
    const agent = this.api.agent;
    const notice = (key: string): false => {
      this.api.notifier.show({ message: this.api.i18n.t(key), style: 'error' });

      return false;
    };

    if (agent === undefined) return notice('tools.database.buttonAgentFailed');
    if (agent.state.status === 'working') return notice('tools.database.buttonAgentBusy');

    return true;
  }

  /**
   * A button's "Send message to agent". Runs after the click's writes, so the
   * agent's turn keeps its own undo steps. The run is ended once it answers:
   * an open run holds the editor's only agent turn.
   */
  private askAgentFromButton(message: string, rowId: string): void {
    const agent = this.api.agent;
    // The notifier renders HTML, so it only gets translated text, never the model's error.
    const notice = (key: string): void => this.api.notifier.show({ message: this.api.i18n.t(key), style: 'error' });

    if (agent === undefined || !this.agentCanRun()) return;
    // Model-facing, in the style of AgentAPI's own editor context line. JSON keeps
    // the author's text inside its quotes, whatever quotes it holds itself.
    const prompt = [
      `(Editor context: the user pressed a button in database row block ${rowId} of database block ${this.dataId}. "This page" in the request means that row.)`,
      `The button's author wrote this request; the user saw it and confirmed sending it. Request: ${JSON.stringify(message)}`,
    ].join('\n');
    const run = ((): AgentRun | null => {
      try {
        return agent.ask(prompt, { context: false });
      } catch {
        return null;
      }
    })();

    if (run === null) {
      notice('tools.database.buttonAgentFailed');

      return;
    }
    void run.result.then((result) => {
      run.end();
      if (result.status === 'failed') notice('tools.database.buttonAgentFailed');
    });
  }

  /** A button of this database has an action that cannot run. */
  private buttonHasError(propertyId: string): boolean {
    const property = this.model.getProperty(propertyId);

    return property?.type === 'button' && buttonHasError(property.button ?? {}, {
      schema: () => this.model.getSchema(),
      databaseId: this.dataId,
      dataSources: () => [{ id: this.dataId, title: this.title }, ...this.moveTargets()],
      targetSchema: (databaseId) => (databaseId === this.dataId ? this.model.getSchema() : this.readDatabaseSource(databaseId)?.schema ?? []),
    });
  }

  /** "Add page to" this database: `name` as the title. Null when writes are refused. */
  private addButtonRow(name: string, properties: Record<string, PropertyValue>): string | null {
    const title = name === '' ? {} : { [this.titlePropertyId()]: name };

    return this.insertRow({ ...properties, ...title }, { rerender: true }) ?? null;
  }

  /** Another database's button adds a page here. A linked view passes it to its source. */
  addButtonPage(param: { name: string; properties: Record<string, PropertyValue>; receive: (rowId: string | null) => void }): void {
    if (this.source !== undefined) {
      this.api.blocks.getById(this.source.databaseId)?.call('addButtonPage', param);

      return;
    }
    param.receive(this.addButtonRow(param.name, param.properties));
  }

  /** Another database's button edits a page here, as a cell edit does. */
  writeButtonValues(param: { rowId: string; changes: Record<string, PropertyValue> }): void {
    if (this.source !== undefined) {
      this.api.blocks.getById(this.source.databaseId)?.call('writeButtonValues', param);

      return;
    }
    if (this.readOnly || this.destroyed || this.model.getRow(param.rowId) === undefined) return;
    Object.entries(param.changes).forEach(([key, value]) => this.commitTableCell(param.rowId, key, value));
    this.redrawWhenIdle();
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  /** This database's page templates, by position. */
  templateList(): DatabaseRow[] {
    return [...this.templates];
  }

  private rowOrTemplate(rowId: string): DatabaseRow | undefined {
    return this.model.getRow(rowId) ?? this.templates.find((template) => template.id === rowId);
  }

  /** research/27 shot 04: a board's add button reads the default template's name ("+ New task"). */
  private addCardLabel(titlePropId: string): { addCardLabel?: string } {
    const title = this.defaultTemplate()?.properties[titlePropId];

    return typeof title === 'string' && title.trim() !== '' ? { addCardLabel: title } : {};
  }

  private defaultTemplate(): DatabaseRow | undefined {
    const id = this.model.getDefaultTemplateId();

    return id === undefined ? undefined : this.templates.find((template) => template.id === id);
  }

  /**
   * Copies `fromId`'s child blocks, and theirs, under `toId`. Reads
   * `preservedData`, the last save: an edit to the body not saved yet is not
   * copied.
   */
  private copyChildBlocks(fromId: string, toId: string): void {
    // Comment threads stay with the page they were written on.
    for (const child of this.api.blocks.getChildren(fromId).filter((block) => !isAnnotationBlock(block))) {
      const copy = this.api.blocks.insertAt(child.name, structuredClone(child.preservedData), { parentId: toId, position: 'end' });

      this.copyChildBlocks(child.id, copy.id);
    }
  }

  /**
   * Inserts a new row block, started from `pick`: the default template when
   * not given, none when null. Values the caller passes (a group, a filter, a day) win over
   * the template's, except an empty title. Writes the final values back into
   * `rowData`, so the backend hears them too.
   */
  private insertNewRow(rowData: DatabaseRow, position = rowData.position, pick?: DatabaseRow | null): void {
    if (this.thisPage === null) {
      this.writeNewRow(rowData, position, pick);

      return;
    }
    // On a row page: the row and the page's link to it are one undo step. The
    // link goes first: an insert opens a sync window, and a database write
    // inside it reads as an echo and is saved outside the step.
    this.inOneStep(() => {
      this.linkPageBack(rowData);
      this.writeNewRow(rowData, position, pick);
    });
  }

  private writeNewRow(rowData: DatabaseRow, position: string, pick?: DatabaseRow | null): void {
    const titlePropId = this.titlePropertyId();
    const template = pick === undefined ? this.defaultTemplate() : pick ?? undefined;

    if (template !== undefined) {
      // An empty title, and the empty list a new row is born with, are not values the caller chose.
      const given = Object.fromEntries(Object.entries(rowData.properties).filter(([id, value]) =>
        !(id === titlePropId && (value === '' || value === null)) && !(Array.isArray(value) && value.length === 0)));

      Object.assign(rowData.properties, resolveDynamicProperties(structuredClone(template.properties), { me: this.config.people?.me?.() ?? null, now: new Date() }), given);
    }
    // After the template: its own status wins over the property's default.
    Object.assign(rowData.properties, this.model.withStatusDefaults(rowData.properties));
    const title = rowData.properties[titlePropId];
    const reminders = copiedReminders(template?.reminders, rowData.properties);

    this.api.blocks.insertAt(
      'database-row',
      {
        properties: rowData.properties,
        position,
        title: typeof title === 'string' ? title : '',
        ...(template?.icon !== undefined ? { icon: template.icon } : {}),
        ...(template?.cover !== undefined ? { cover: template.cover } : {}),
        ...(template?.fullWidth !== undefined ? { fullWidth: template.fullWidth } : {}),
        ...(reminders !== undefined ? { reminders } : {}),
      },
      { parentId: this.dataId, position: 'end', id: rowData.id },
    );
    if (template !== undefined) {
      this.copyChildBlocks(template.id, rowData.id);
    }
  }

  /**
   * A relation tab's new row holds this page in its back relation (newRowValues).
   * Two-way relations are stored on both sides, so the page row lists the new row
   * too, as a relation cell edit writes it (commitRelation).
   */
  private linkPageBack(rowData: DatabaseRow): void {
    const page = this.thisPage;

    if (page === null) return;
    for (const property of this.model.getSchema()) {
      const synced = property.type === 'relation' ? this.syncedMirror(property) : undefined;
      const target = property.relation?.targetDatabaseId;

      if (synced === undefined || target === undefined || !relationIdsOf(rowData.properties[property.id]).includes(page)) continue;
      this.writeForeignRow(target, page, { [synced]: addRelatedIds(this.storedRelationOf(target, page, synced), rowData.id, null) });
    }
  }

  /** A new row from one template, as one undo step. Returns its id. */
  newFromTemplate(templateId: string): string | null {
    const template = this.templates.find((t) => t.id === templateId);

    if (this.readOnly || template === undefined) return null;
    const rowData = this.model.createRowData({});

    this.inOneStep(() => this.insertNewRow(rowData, rowData.position, template));
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    this.syncRowsFromBlocks();
    this.rerenderView({ keepDrawer: true });
    this.handleRowClick(rowData.id);

    return rowData.id;
  }

  /** The toolbar's "New": a row from the default template, opened. */
  newRow(): string | null {
    return this.makeOpenedRow(undefined);
  }

  /** "Empty page" in the "New" dropdown: a row that skips the default template. */
  private newEmptyRow(): void {
    this.makeOpenedRow(null);
  }

  private makeOpenedRow(template: DatabaseRow | null | undefined): string | null {
    if (this.readOnly) return null;
    const rowData = this.model.createRowData(this.newRowProperties(this.titlePropertyId(), undefined, NO_VALUE_GROUP_KEY));

    this.inOneStep(() => this.insertNewRow(rowData, rowData.position, template));
    void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
    this.syncRowsFromBlocks();
    this.rerenderView({ keepDrawer: true });
    this.handleRowClick(rowData.id);

    return rowData.id;
  }

  /** An empty row page asks what to offer: the "Database templates" switch and the templates (research/10 §6). */
  rowPagePrompt(param: { receive: (prompt: { templates: boolean; list: Array<{ id: string; title: string }> }) => void }): void {
    param.receive({ templates: this.model.getPageLayout().templates, list: this.templateTitles() });
  }

  /**
   * Redraws every row's empty-page prompt when what it shows changed. The key
   * keeps a title keystroke or a cell edit from redrawing every row.
   */
  private refreshRowPrompts(): void {
    const key = JSON.stringify([this.model.getPageLayout().templates, this.templateTitles()]);

    if (key === this.rowPromptKey) return;
    this.rowPromptKey = key;
    for (const child of this.api.blocks.getChildren(this.dataId)) {
      if (child.name === 'database-row') child.call('refreshPlaceholder');
    }
  }

  /**
   * A template picked on an empty row page: its values fill the row's empty
   * ones, its icon and cover fill missing ones, and its body is copied. One undo step.
   */
  applyTemplate(param: { rowId: string; templateId: string }): void {
    const template = this.templates.find((t) => t.id === param.templateId);
    const row = this.model.getRow(param.rowId);
    const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === param.rowId);

    if (this.readOnly || this.destroyed || template === undefined || row === undefined || block === undefined
      || this.api.blocks.getChildren(param.rowId).some((child) => !isAnnotationBlock(child))) return;
    const titlePropId = this.titlePropertyId();
    const blank = (value: PropertyValue | undefined): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    const filled = resolveDynamicProperties(structuredClone(template.properties), { me: this.config.people?.me?.() ?? null, now: new Date() });
    const changes = Object.fromEntries(Object.entries(filled).filter(([id, value]) => !blank(value) && blank(row.properties[id])));
    const { [titlePropId]: title, ...values } = changes;
    // Only beside a date the template fills, and never over the row's own reminder.
    const reminders = Object.fromEntries(Object.entries(copiedReminders(template.reminders, changes) ?? {})
      .filter(([propertyId]) => row.reminders?.[propertyId] === undefined));

    this.inOneStep(() => {
      if (typeof title === 'string') this.updateRowTitleBlock(param.rowId, titlePropId, title);
      this.updateRowBlock(param.rowId, values);
      if (row.icon === undefined && template.icon !== undefined) block.call('updateIcon', { icon: template.icon });
      if (row.cover === undefined && template.cover !== undefined) block.call('updateCover', { cover: template.cover });
      if (row.fullWidth === undefined && template.fullWidth !== undefined) block.call('updateFullWidth', { fullWidth: template.fullWidth });
      if (Object.keys(reminders).length > 0) block.call('updateReminders', reminders);
      block.dispatchChange();
      this.copyChildBlocks(template.id, param.rowId);
    });
    block.call('mountBody');
    if (Object.keys(changes).length > 0) this.sync.syncUpdateRow({ rowId: param.rowId, properties: changes });
    this.syncRowsFromBlocks();
    this.cardDrawer?.syncOpenRow(this.rowOrTemplate(param.rowId));
    this.rerenderView({ keepDrawer: true });
  }

  /** "+ New template": an empty template, opened for editing. */
  addTemplate(): string | null {
    if (this.readOnly) return null;
    const id = nanoid();
    const last = this.templates[this.templates.length - 1];
    const position = DatabaseModel.positionBetween(last?.position ?? null, null);
    const properties = { [this.titlePropertyId()]: '' };

    this.api.blocks.insertAt('database-row', { properties, position, title: '', template: true }, { parentId: this.dataId, position: 'end', id });
    void this.sync.syncCreateRow({ id, properties, position, template: true });
    this.syncRowsFromBlocks();
    this.openTemplate(id);

    return id;
  }

  /** Opens a template as a row page with the "editing a template" banner. */
  openTemplate(templateId: string): void {
    if (this.source !== undefined) {
      // The template's body mounts in the source, which owns its holder.
      this.api.blocks.getById(this.source.databaseId)?.call('openTemplate', templateId as never);

      return;
    }
    const template = this.templates.find((t) => t.id === templateId);

    if (template === undefined) return;
    this.cardDrawer?.open(template, this.cardDrawer.isOpen ? this.cardDrawer.openMode : 'center');
    this.showTemplateBanner(templateId);
  }

  /** The open template's banner, with its "Duplicate every…" button. Read-only shows the text alone. */
  private showTemplateBanner(templateId: string): void {
    const repeat = this.templateRepeat(this.api.blocks.getChildren(this.dataId).find((child) => child.id === templateId));

    this.cardDrawer?.setTemplateBanner({
      text: this.api.i18n.t('tools.database.templateBanner'),
      ...(this.readOnly ? {} : {
        repeat: {
          label: templateRepeatSummary(this.api.i18n, repeat),
          open: (anchor: HTMLElement) => {
            const host: TemplateRepeatHost = {
              i18n: this.api.i18n,
              repeat: () => this.templateRepeat(this.api.blocks.getChildren(this.dataId).find((child) => child.id === templateId)),
              setRepeat: (next) => this.setTemplateRepeat(templateId, next),
              // After the preset list has closed: it is still being activated now.
              editCadence: (draft) => queueMicrotask(() => this.showGroupPopover(anchor, templateRepeatItems(host, draft), anchor)),
              close: () => this.groupMenuPopover?.hide(),
            };

            this.showGroupPopover(anchor, templateRepeatItems(host), anchor);
          },
        },
      }),
    });
  }

  setDefaultTemplate(templateId: string | null): void {
    if (this.readOnly || (templateId !== null && !this.templates.some((t) => t.id === templateId))) return;
    this.model.setDefaultTemplateId(templateId);
    this.commitSchema();
  }

  duplicateTemplate(templateId: string): string | null {
    const template = this.templates.find((t) => t.id === templateId);

    if (this.readOnly || template === undefined) return null;
    const id = nanoid();
    const next = this.templates[this.templates.indexOf(template) + 1];
    const position = DatabaseModel.positionBetween(template.position, next?.position ?? null);
    const properties = structuredClone(template.properties);
    const title = properties[this.titlePropertyId()];
    const reminders = copiedReminders(template.reminders, properties);

    this.inOneStep(() => {
      this.api.blocks.insertAt('database-row', {
        properties,
        position,
        title: typeof title === 'string' ? title : '',
        template: true,
        ...(template.icon !== undefined ? { icon: template.icon } : {}),
        ...(template.cover !== undefined ? { cover: template.cover } : {}),
        ...(template.fullWidth !== undefined ? { fullWidth: template.fullWidth } : {}),
        ...(reminders !== undefined ? { reminders } : {}),
      }, { parentId: this.dataId, position: 'end', id });
      this.copyChildBlocks(templateId, id);
    });
    void this.sync.syncCreateRow({ id, properties: adapterRowValues(properties, this.model.getSchema()).properties, position, template: true });
    this.syncRowsFromBlocks();

    return id;
  }

  deleteTemplate(templateId: string): void {
    if (this.readOnly || !this.templates.some((t) => t.id === templateId)) return;
    if (this.cardDrawer?.openRowId === templateId) {
      this.cardDrawer.close();
    }
    this.inOneStep(() => {
      if (this.model.getDefaultTemplateId() === templateId) {
        this.model.setDefaultTemplateId(null);
        this.writeSchema();
      }
      const index = this.api.blocks.getBlockIndex(templateId);

      if (index !== undefined) {
        void this.api.blocks.delete(index);
      }
    });
    void this.sync.syncDeleteRow({ rowId: templateId });
    this.syncRowsFromBlocks();
    this.rerenderView({ keepDrawer: true });
  }

  /** Sets or clears a template's repeat schedule. Blok stores it; the host runs it. */
  setTemplateRepeat(templateId: string, repeat: TemplateRepeat | null): void {
    const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === templateId);

    if (this.readOnly || block === undefined || !this.templates.some((t) => t.id === templateId)) return;
    block.call('updateRepeat', { repeat });
    block.dispatchChange();
    this.syncRowsFromBlocks();
  }

  /**
   * Hands every due repeating template to the host. Each client that renders
   * the database asks; the host decides which one makes the row.
   */
  private offerDueTemplates(): void {
    const onRepeatDue = this.config.templates?.onRepeatDue;

    // The source offers its own templates; a linked view would offer each run again.
    if (onRepeatDue === undefined || this.readOnly || this.linked) return;
    for (const template of this.templates) {
      const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === template.id);
      const repeat = this.templateRepeat(block);
      const dueAt = dueRun(repeat, new Date());
      const key = `template:${template.id}:${dueAt ?? ''}`;

      if (dueAt === null || repeat === undefined || block === undefined || this.offeredDue.has(key)) continue;
      this.offeredDue.add(key);
      onRepeatDue({
        databaseId: this.dataId,
        templateId: template.id,
        dueAt,
        createRow: () => {
          if (this.destroyed || !this.templates.some((t) => t.id === template.id)) return null;
          const rowData = this.model.createRowData({});

          this.inOneStep(() => {
            this.insertNewRow(rowData, rowData.position, template);
            block.call('updateRepeat', { repeat: { ...repeat, lastRunAt: dueAt } });
            block.dispatchChange();
          });
          // The sync observer runs before its promise returns.
          this.hostLevers.withoutPageAdded(rowData.id, () => {
            void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
          });
          this.syncRowsFromBlocks();
          this.rerenderView({ keepDrawer: true });

          return rowData.id;
        },
      });
    }
  }

  private offerDue(): void {
    this.offerDueTemplates();
    this.offerDueReminders();
    this.scheduleDue();
  }

  /** Back closes a full row page; Forward (or a typed `#rowId?full`) opens it again. */
  private readonly followRowPageHistory = (): void => {
    if (this.source !== undefined || this.destroyed) return;
    const link = readRowPageHash();
    const drawer = this.cardDrawer;
    const shownFull = drawer?.isOpen === true && drawer.openMode === 'full' ? drawer.openRowId : null;
    const wanted = link?.full === true && this.model.getRow(link.rowId) !== undefined ? link.rowId : null;

    if (shownFull === wanted) return;
    if (wanted === null) {
      drawer?.close();

      return;
    }
    this.handleRowClick(wanted, 'full');
  };

  private readonly handleDueVisibility = (): void => {
    // A sleeping laptop holds timers back; waking up checks at once.
    if (document.visibilityState === 'visible' && this.dueWatching) this.offerDue();
  };

  /** Sets one timer for the next reminder or template run still to come. */
  private scheduleDue(): void {
    if (this.dueTimer !== null) clearTimeout(this.dueTimer);
    this.dueTimer = null;
    const reminders = this.config.reminders?.onReminderDue !== undefined;
    const templates = this.config.templates?.onRepeatDue !== undefined;

    if (!this.dueWatching || this.destroyed || this.readOnly || this.linked || (!reminders && !templates)) return;
    const now = new Date();
    const dates = reminders ? this.model.getSchema().filter((property) => property.type === 'date') : [];
    const reminderTimes = this.model.getOrderedRows().flatMap((row) => dates.map((property) => {
      const reminder = row.reminders?.[property.id];

      return reminder === undefined ? null : storedReminderDueAt(row.properties[property.id], reminder, property.date?.timeZone);
    }));
    const runTimes = templates
      ? this.templates.map((template) => nextRun(this.templateRepeat(this.api.blocks.getChildren(this.dataId).find((child) => child.id === template.id)), now))
      : [];
    const next = [...reminderTimes, ...runTimes].filter((at): at is number => at !== null && at > now.getTime());

    if (next.length === 0) return;
    // setTimeout overflows past 2^31 - 1 ms (about 24.8 days) and fires at once; a long wait wakes early and reschedules.
    const delay = Math.min(Math.min(...next) - now.getTime(), 2 ** 31 - 1);

    this.dueTimer = setTimeout(() => {
      this.dueTimer = null;
      this.offerDue();
    }, delay);
  }

  /** Hands every due date reminder to the host, as `offerDueTemplates` does for templates. */
  private offerDueReminders(): void {
    const onReminderDue = this.config.reminders?.onReminderDue;

    if (onReminderDue === undefined || this.readOnly || this.linked) return;
    const now = new Date();
    const dates = this.model.getSchema().filter((property) => property.type === 'date');
    // Model rows leave templates out, so a template's date never reminds.
    const due = this.model.getOrderedRows().flatMap((row) => dates.map((property) => {
      const reminder = row.reminders?.[property.id];
      const dueAt = reminder === undefined ? null : dueReminder(row.properties[property.id], reminder, property.date?.timeZone, now);

      return reminder === undefined || dueAt === null ? null : { rowId: row.id, propertyId: property.id, remind: reminder.remind, dueAt };
    })).filter((entry) => entry !== null)
      .filter(({ rowId, propertyId, dueAt }) => {
        const key = `reminder:${rowId}:${propertyId}:${dueAt}`;
        const fresh = !this.offeredDue.has(key);

        this.offeredDue.add(key);

        return fresh;
      });

    due.forEach(({ rowId, propertyId, remind, dueAt }) => onReminderDue({
      databaseId: this.dataId,
      rowId,
      propertyId,
      remind,
      dueAt,
      markSent: () => {
        const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);
        const row = this.model.getRow(rowId);
        const current = row?.reminders?.[propertyId];
        const zone = this.model.getProperty(propertyId)?.date?.timeZone;

        // The host may call later: a reminder changed, removed or moved since the offer is not this one.
        if (this.destroyed || block === undefined || current === undefined
          || storedReminderDueAt(row?.properties[propertyId], current, zone) !== Date.parse(dueAt)) return;
        block.call('updateReminders', { [propertyId]: { ...current, sentFor: dueAt } });
        // Derived: a host stamp is not the user's edit, so undo must not take it back.
        block.dispatchChange({ derived: true });
        this.syncRowsFromBlocks();
      },
    }));
  }

  private templateRepeat(block: BlockAPI | undefined): TemplateRepeat | undefined {
    const live: DatabaseRowData[] = [];

    block?.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });

    return (live[0] ?? block?.preservedData as DatabaseRowData | undefined)?.repeat;
  }

  /**
   * A link from "Copy link" (`#rowId`) or "Copy link to view" (`#rowId?v=tabId`)
   * opens that row's page on load. Its source opens it, never a linked view.
   */
  private openLinkedRow(): void {
    const hash = window.location.hash.slice(1);

    // A later render (undo, a peer replace) must not reopen a page the user closed.
    if (hash === rowLink.closed) return;
    const link = readRowPageHash();
    const rowId = link?.rowId ?? '';
    const tabId = link?.tabId ?? null;

    if (this.source === undefined && rowId !== '' && this.model.getRow(rowId) !== undefined) {
      this.openedRowLink = hash;
      this.handleRowClick(rowId, link?.full === true ? 'full' : undefined);
      // A host's full page (rowPages.navigate) gets the row only: its drawer did not open.
      if (tabId !== null && tabId !== '' && this.cardDrawer?.openRowId === rowId) this.cardDrawer.showTab(tabId);
    }
  }

  private openedRowLink: string | null = null;

  /** Rows have no addressable URL yet: copies the page URL with the row id (and a view tab) as its fragment. */
  private copyRowLink(rowId: string, tabId?: string): void {
    const view = tabId === undefined ? '' : `?v=${encodeURIComponent(tabId)}`;
    const url = `${window.location.href.split('#')[0]}#${encodeURIComponent(rowId)}${view}`;

    void navigator.clipboard?.writeText(url).then(
      () => this.api.notifier.show({ message: this.api.i18n.t('tools.database.tableLinkCopied') }),
      () => undefined
    );
  }

  private updateActiveView(changes: ViewChanges, explicit?: NativeWidgetContext): void {
    const context = explicit ?? this.binding ?? undefined;
    const owner = context?.owner ?? this;
    const viewId = context?.viewId ?? this.activeViewId;

    if (owner.readOnly || owner.destroyed || owner.structureLocked() || (context !== undefined && !context.authority.writable())) return;
    owner.model.updateView(viewId, changes);
    owner.block.dispatchChange();
    void owner.sync.syncUpdateView({ viewId, changes: structuredClone(changes) });
    if (context === undefined) this.rerenderView({ keepDrawer: true });
    else context.redraw();
    // The view settings "View name" field renames through here; the tabs show the name.
    if (changes.name !== undefined) owner.rebuildTabBar();
  }

  private handleTableRowDrop(result: TableRowDropResult, context?: NativeWidgetContext): void {
    const { rowId, beforeRowId, afterRowId, groupKey, fromGroupKey } = result;
    const view = context?.view ?? this.shownView();
    const groupBy = view?.groupBy;

    if (this.readOnly || (context !== undefined && !context.writable())) return;
    if (groupBy !== undefined && groupKey !== fromGroupKey) {
      this.cardDragFromOptionId = fromGroupKey;
      const value = this.droppedGroupValue(groupBy, rowId, groupKey, view);

      this.updateRowBlock(rowId, { [groupBy]: value });
      this.sync.syncUpdateRow({ rowId, properties: { [groupBy]: value } });
    }
    this.placeRow(view, rowId, afterRowId, beforeRowId, context?.owner);
    if (context === undefined) this.rerenderView({ keepDrawer: true });
    else context.redraw();
  }

  /** Same as the drawer: a label the user kept goes back as the saved (unlocalized) one. */
  private handleTableOptionsChange(propertyId: string, options: SelectOption[]): void {
    if (this.readOnly || this.destroyed || this.structureLocked()) return;
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
    this.writeSchema();
    this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    void this.sync.syncUpdateProperty({ propertyId, changes: { config: { options: next } } });
  }

  private renderListView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const native = this.createNativeListView(titlePropId, groupByPropId, viewConfig);

    this.view = native.renderer;

    return native.root;
  }

  private createNativeListView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig, context?: NativeWidgetContext): { renderer: DatabaseListView; root: HTMLDivElement } {
    // The real types decide what is editable; cellContext.valueProperty draws a formula or rollup as its result.
    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n);
    const nesting = this.subItemNesting(viewConfig, true, context);
    const nest = (rows: DatabaseRow[]): DatabaseRow[] => (nesting === undefined ? rows : nesting.nest(rows));
    const limit = resolveLoadLimit(viewConfig);
    const shown = context?.state.shown ?? this.galleryShown.get(viewConfig.id) ?? new Map<string, number>();
    const query = this.pagedQuery(viewConfig, shown, limit, (context?.controls ?? this.controls).search);
    const common = {
      showPageIcon: showsPageIcon(viewConfig),
      readOnly: context === undefined ? this.readOnly : !context.writable(),
      i18n: this.api.i18n,
      titlePropertyId: titlePropId,
      schema,
      visiblePropertyIds: visibleRowPropertyIds(viewConfig, this.model.getSchema()),
      cellContext: this.cellContext(),
      ...this.commentBadgeLever(),
      locale: editorLocale(this.api.i18n),
      onPropertyEdit: (rowId: string, propertyId: string, anchor: HTMLElement) =>
        this.editCardProperty(rowId, propertyId, anchor, () => this.focusListProperty(rowId, propertyId, context), context),
      onNewBelow: (rowId: string, groupKey: string | null) => this.addListRowBelow(rowId, groupKey, context),
      onOpenRow: (rowId: string) => (context === undefined ? this.handleRowClick(rowId) : context.openRow(rowId)),
      ...(context === undefined && !this.readOnly ? { lassoRows: (rowIds: string[]) => this.selectRows(rowIds) } : {}),
      onTitleEdit: (rowId: string, title: string) => {
        if (context !== undefined && !context.writable()) return;
        this.updateRowTitleBlock(rowId, titlePropId, title);
        this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: title } });
        if (context !== undefined) context.redraw();
      },
      onLoadMore: (groupKey: string) => {
        shown.set(groupKey, (shown.get(groupKey) ?? limit) + limit);
        if (context === undefined) {
          this.galleryShown.set(viewConfig.id, shown);
          this.rerenderView({ keepDrawer: true });
        } else if (context.current()) context.redraw();
      },
    };

    const renderer = ((): DatabaseListView => {
      if (groupByPropId !== undefined) {
        const options = this.shownGroupOptions(groupByPropId, viewConfig, (context?.controls ?? this.controls).search);
        const groups = new Map(options.map((option) => [option.id, query(option.id, option.id)]));

        return new DatabaseListView({
          ...common,
          rows: [],
          options,
          getRows: (optionId) => nest(groups.get(optionId)?.rows ?? []),
          getTotal: (optionId) => groups.get(optionId)?.total ?? 0,
          collapsedGroupIds: new Set((viewConfig.collapsedGroups ?? []).map((group) => group.id)),
          onToggleCollapse: (optionId, collapsed) => {
            if (context === undefined) this.saveGroupCollapse(viewConfig.id, optionId, collapsed);
            else if (context.writable()) context.owner.saveGroupCollapse(viewConfig.id, optionId, collapsed);
          },
        });
      }
      const page = query('');

      return new DatabaseListView({ ...common, rows: nest(page.rows), total: page.total });
    })();
    const listEl = renderer.createView();

    // The list draws a sub-item one step in per level; it has no toggle yet.
    listEl.querySelectorAll<HTMLElement>('[data-blok-database-list-row][data-row-id]').forEach((rowEl) => {
      const depth = nesting?.table.info(rowEl.getAttribute('data-row-id') ?? '')?.depth ?? 0;

      if (depth > 0) {
        rowEl.setAttribute('data-subitem-depth', String(depth));
        rowEl.style.setProperty('--blok-database-subitem-depth', String(depth));
      }
    });

    return { renderer, root: listEl };
  }

  // ---------------------------------------------------------------------------
  // Event listeners & subsystems
  // ---------------------------------------------------------------------------

  /**
   * Attaches a single click listener on the board element for event delegation.
   */
  private attachViewListeners(boardEl: HTMLDivElement): void {
    // Capture: a button press must not also open the card or the cell editor under it.
    boardEl.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-blok-database-button]');
      const rowId = button?.closest('[data-row-id]')?.getAttribute('data-row-id');
      const propertyId = button?.getAttribute('data-property-id');

      if (button === null || button === undefined) return;
      event.stopPropagation();
      event.preventDefault();
      if (typeof rowId === 'string' && typeof propertyId === 'string') {
        this.pressButton(rowId, propertyId);
      }
    }, true);
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

      const calculationBtn = target.closest<HTMLElement>('button[data-blok-database-column-count]');

      if (calculationBtn !== null) {
        event.stopPropagation();
        this.openGroupCalculationMenu(calculationBtn);

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
        const cardEl = cardMenuBtn.closest('[data-blok-database-card], [data-blok-database-gallery-card]');

        if (rowId !== null && cardEl instanceof HTMLElement) {
          event.stopPropagation();
          this.openCardMenu(cardMenuBtn, cardEl, rowId);
        }

        return;
      }

      const listHandle = target.closest<HTMLElement>('[data-blok-database-list-row-handle]');
      const listRowEl = listHandle?.closest<HTMLElement>('[data-blok-database-list-row]');
      const listRowId = listRowEl?.getAttribute('data-row-id');

      if (listHandle !== null && listRowEl !== null && listRowEl !== undefined && listRowId !== null && listRowId !== undefined) {
        event.stopPropagation();
        this.openCardMenu(listHandle, listRowEl, listRowId);

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

    });
  }

  /**
   * Listeners every viewer gets, read-only included: opening a row page to
   * read it. Phase 0 made read-only paint no write listener at all, so these
   * live apart from {@link attachViewListeners}.
   */
  private wireView(boardEl: HTMLDivElement): void {
    if (this.view instanceof DatabaseDashboardView) return;
    this.paintRowSelection();
    this.attachReadListeners(boardEl);
    this.ensureCardDrawer();
    this.attachKeyboard(boardEl);

    if (!this.readOnly) {
      this.attachViewListeners(boardEl);
      this.initSubsystems(boardEl);
    }
  }

  private attachReadListeners(boardEl: HTMLDivElement): void {
    // Notion: a right-click on a card or list row opens its row menu.
    boardEl.addEventListener('contextmenu', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const rowEl = target?.closest<HTMLElement>('[data-blok-database-card], [data-blok-database-gallery-card], [data-blok-database-list-row], '
        + '[data-blok-database-timeline-bar], [data-blok-database-timeline-table-row], [data-blok-database-calendar-event]');
      const rowId = rowEl?.getAttribute('data-row-id');

      // A field being edited keeps the native menu, for copy and paste.
      if ((target?.closest('input, textarea, [contenteditable="true"]') ?? null) !== null) return;
      if (rowEl === null || rowEl === undefined || rowId === null || rowId === undefined) return;
      event.preventDefault();
      // Core opens its block menu on a right-click; this menu replaces it.
      event.stopPropagation();
      // findings-listgallery L16: a list row's menu opens at the pointer.
      const anchor = rowEl.matches('[data-blok-database-list-row]') ? pointerAnchor(rowEl, event) : rowEl;

      this.openCardMenu(anchor, rowEl, rowId);
      if (anchor !== rowEl) this.cardMenuPopover?.on(PopoverEvent.Closed, () => anchor.remove());
    });
    boardEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      // Controls inside a card or row act on their own; they never open the page.
      if (target.closest(ROW_CONTROL_SELECTOR) !== null) {
        return;
      }
      const rowEl = target.closest('[data-blok-database-list-row], [data-blok-database-card]');
      const rowId = rowEl?.getAttribute('data-row-id') ?? null;
      const picks = event.metaKey || event.ctrlKey || event.shiftKey;

      if (rowId !== null && picks && !this.readOnly && rowEl?.matches('[data-blok-database-list-row], [data-blok-database-board] [data-blok-database-card]') === true) {
        this.pickRow(rowId, event.shiftKey);

        return;
      }
      // A gallery opens the same row through its own handler first; the second open is a no-op.
      if (rowId !== null) {
        this.handleRowClick(rowId);
      }
    });
  }

  private attachKeyboard(boardEl: HTMLDivElement): void {
    this.keyboard = this.createKeyboard(boardEl);
  }

  private createKeyboard(boardEl: HTMLDivElement): DatabaseKeyboard {
    const keyboard = new DatabaseKeyboard({
      wrapper: boardEl,
      onEscape: () => {
        if (this.cardDrawer?.isOpen) {
          const rowId = this.cardDrawer.openRowId;

          this.cardDrawer.close();
          if (rowId !== null) {
            this.dropFreshRow(rowId);
          }

          return true;
        }

        return this.freshRow !== null && this.dropFreshRow(this.freshRow.id);
      },
    });
    keyboard.attach();

    return keyboard;
  }

  /**
   * Board and gallery carry Layout and Property visibility; a list row does not (research/12 §3).
   * A timeline bar has no Comment; its table panel row does (research/22 §11).
   */
  private openCardMenu(anchor: HTMLElement, cardEl: HTMLElement, rowId: string): void {
    const type = this.shownView()?.type;

    this.openRowMenu(rowId, anchor, cardEl, {
      viewSettings: type === 'board' || type === 'gallery',
      comment: !cardEl.hasAttribute('data-blok-database-timeline-bar'),
    });
  }

  /**
   * The row menu of a card, a list row or a feed card, built by the same
   * `rowMenuItems` as the table's ⋮⋮ so they cannot drift. `card` keeps its
   * hover buttons while the menu is up.
   */
  private openRowMenu(rowId: string, anchor: HTMLElement, card: HTMLElement, options: { viewSettings: boolean; comment?: boolean }): void {
    const comment = options.comment === false ? undefined : this.commentLever().comment;
    const writable = (): boolean => !this.readOnly && !this.destroyed;
    const listTargets = (): Array<{ id: string; title: string }> => this.moveTargets();
    const view = this.shownView();
    const visible = view === undefined ? [] : visibleRowPropertyIds(view, this.model.getSchema());
    const properties = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).filter((p) => p.type !== 'title' && visible.includes(p.id));
    const edits = !writable() ? {} : {
      onEditIcon: () => this.editRowIcon(rowId),
      onEditProperty: (propertyId: string) => this.editRowProperty(rowId, propertyId),
      ...(options.viewSettings
        ? {
          onLayout: () => this.controls.openSettingsPage('layout', card),
          onPropertyVisibility: () => this.controls.openSettingsPage('properties', card),
        }
        : {}),
      onDuplicate: () => { if (writable()) this.duplicateTableRow(rowId); },
      onDelete: () => { if (writable()) this.deleteTableRows([rowId]); },
      // A getter: the targets walk every block, so they are read only when the menu opens.
      get moveTargets() { return listTargets(); },
      onMoveTo: (databaseId: string) => { if (writable()) this.moveRowTo({ rowId, databaseId }); },
    };

    this.cardMenuPopover?.destroy();
    card.setAttribute('data-popover-open', '');
    const favorite = this.favoriteFor(rowId);
    const popover = openMenu(anchor, rowMenuItems({
      i18n: this.api.i18n,
      properties,
      ...(favorite !== undefined ? { favorite } : {}),
      ...edits,
      onOpenIn: (mode) => this.handleRowClick(rowId, mode),
      onCopyLink: () => this.copyRowLink(rowId),
      // The ••• button hides once the menu closes; the composer sits under the card, as in Notion.
      ...(comment !== undefined ? { onComment: () => comment(rowId, undefined, card) } : {}),
      ...rowMenuFooter({
        row: this.model.getRow(rowId),
        titlePropertyId: this.titlePropertyId(),
        locale: editorLocale(this.api.i18n),
        ...(this.people !== undefined ? { people: this.people } : {}),
        i18n: this.api.i18n,
      }),
    }), {
      searchable: true,
      kind: 'card',
      searchPlaceholder: this.api.i18n.t('tools.database.searchActions'),
      onClose: () => {
        card.removeAttribute('data-popover-open');
        if (this.cardMenuPopover === popover) this.cardMenuPopover = null;
      },
    });

    this.cardMenuPopover = popover;
  }

  /** The row menu's Edit icon: the row page opens, then its icon picker. */
  private editRowIcon(rowId: string, context?: NativeWidgetContext): void {
    if (context === undefined) this.handleRowClick(rowId);
    else context.openRow(rowId);
    this.cardDrawer?.editIcon();
  }

  /** A card's Edit property ›: the row page opens, then that value's editor. */
  private editRowProperty(rowId: string, propertyId: string): void {
    this.handleRowClick(rowId);
    this.cardDrawer?.editProperty(propertyId);
  }

  /** Every group of the active board, hidden ones included, in board order. */
  private boardGroups(): Array<{ id: string; label: string; hidden: boolean; color: OptionColor | undefined }> {
    const view = this.shownView();

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
  private showGroupPopover(anchor: HTMLElement, items: ReturnType<typeof groupMenuItems>, owner?: HTMLElement, layout: { minWidth?: string; scopeElement?: HTMLElement } = {}): void {
    this.groupMenuPopover?.destroy();

    const popover = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      animateClose: true,
      trigger: anchor,
      width: 'auto',
      minWidth: layout.minWidth ?? '220px',
      autoFocusFirstItem: false,
      items,
      ...(layout.scopeElement !== undefined ? { scopeElement: layout.scopeElement } : {}),
    });

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
    const view = this.shownView();
    const groups = this.boardGroups();
    const group = groups.find((g) => g.id === groupId);

    if (view === undefined || group === undefined) {
      return;
    }

    const property = view.groupBy === undefined ? undefined : this.model.getProperty(view.groupBy);

    this.showGroupPopover(anchor, groupMenuItems({
      i18n: this.api.i18n,
      isNoValue: groupId === NO_VALUE_GROUP_KEY,
      color: group.color,
      aggregationHidden: view.hideGroupAggregation === true,
      isStatus: property?.type === 'status',
      onEditGroups: () => this.controls.openSettingsPage('group', anchor),
      // Notion brings the numbers back as Count all, not the last calculation.
      onToggleAggregation: () => this.updateActiveView(view.hideGroupAggregation === true
        ? { hideGroupAggregation: false, groupCalculation: undefined }
        : { hideGroupAggregation: true }),
      onHide: () => this.toggleGroupHidden(groupId),
      onTrash: () => this.trashGroup(groupId),
      onRecolor: (color) => this.recolorGroup(groupId, color),
    }), anchor.closest<HTMLElement>('[data-blok-database-column-header]') ?? undefined);
  }

  /** The count's calculation menu. The pick is the view's, so every column shows it. */
  private openGroupCalculationMenu(anchor: HTMLElement): void {
    const view = this.shownView();

    if (view === undefined) {
      return;
    }

    const schema = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).map((property) => this.computedValues.valueProperty(property));
    const current = resolveGroupCalculation(view, schema);
    const titleId = this.titlePropertyId();

    this.showGroupPopover(anchor, groupCalculationItems({
      i18n: this.api.i18n,
      schema,
      groupBy: view.groupBy,
      current,
      // A leaf closes only its own list; the redraw drops the anchor, so close the whole menu.
      onPick: (fn, propertyId) => {
        this.groupMenuPopover?.hide();
        this.updateActiveView({ groupCalculation: groupCalculationFor(fn, propertyId, titleId) });
      },
      onCapCounts: (cap) => {
        this.groupMenuPopover?.hide();
        this.updateActiveView({ groupCalculation: groupCalculationCapped(current, cap, titleId) });
      },
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
    const current = this.viewOf(viewId)?.collapsedGroups ?? [];

    if (this.readOnly || this.destroyed || this.structureLocked() || current.some((group) => group.id === groupId) === collapsed) {
      return;
    }
    const collapsedGroups = collapsed ? [...current, { id: groupId }] : current.filter((group) => group.id !== groupId);

    this.writeView(viewId, { collapsedGroups });
  }

  private toggleGroupHidden(groupId: string): void {
    const current = this.shownView()?.hiddenGroups ?? [];
    const hiddenGroups = current.some((group) => group.id === groupId)
      ? current.filter((group) => group.id !== groupId)
      : [...current, { id: groupId }];

    this.updateActiveView({ hiddenGroups });
  }

  private recolorGroup(optionId: string, color: OptionColor): void {
    const groupBy = this.shownView()?.groupBy;
    const options = groupBy === undefined ? undefined : this.model.getProperty(groupBy)?.config?.options;

    if (this.readOnly || groupBy === undefined || options === undefined) {
      return;
    }
    const next = options.map((option) => (option.id === optionId ? { ...option, color } : option));

    this.model.updateProperty(groupBy, { config: { options: next } });
    this.writeSchema();
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

  private handleAddListRow(optionId: string | null, viewEl: HTMLDivElement, renderer: DatabaseViewRenderer = this.view, context?: NativeWidgetContext): void {
    if (context !== undefined && !context.writable()) return;
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const viewConfig = context?.view ?? this.shownView();
    const groupByPropId = viewConfig?.groupBy;

    const groupProp = optionId === null ? undefined : groupByPropId;
    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupProp, optionId ?? NO_VALUE_GROUP_KEY, undefined, context?.view));
    this.insertNewRow(rowData);
    this.syncRowsFromBlocks();

    // A grouped list keeps its "+ New" inside each group, so the row must go into that group's rows list.
    const groupRows = optionId === null
      ? null
      : viewEl.querySelector(`[data-blok-database-list-group][data-option-id="${optionId}"] [data-blok-database-list-rows]`);

    renderer.appendRow(groupRows instanceof HTMLElement ? groupRows : viewEl, rowData);

    void this.sync.syncCreateRow({
      id: rowData.id,
      properties: rowData.properties,
      position: rowData.position,
    });
    this.markFresh(rowData.id);
    if (this.openIfFiltered(rowData.id, context)) return;
    // findings-listgallery L05: the new row opens with its title being edited. A widget redraws first.
    if (context !== undefined) {
      const state = context.state;

      state.pendingTitle = rowData.id;
    } else if (renderer instanceof DatabaseListView) {
      renderer.editTitle(rowData.id);
    }
  }

  /** The clicked group's value wins over a filter on the same property. */
  private newRowProperties(titlePropId: string, groupByPropId: string | undefined, optionId: string, subGroupBy?: string, selected?: DatabaseViewConfig): Record<string, PropertyValue> {
    const saved = this.shownView();
    const effective = selected ?? (saved === undefined ? undefined : this.controls.effective(saved));
    const filters = prefillFilters(effective, [groupByPropId, subGroupBy]);
    const properties: Record<string, PropertyValue> = { ...newRowValues(filters, this.model.getSchema(), this.config.people?.me?.() ?? null, this.thisPage), [titlePropId]: '' };

    const value = groupByPropId === undefined || optionId === NO_VALUE_GROUP_KEY ? undefined : this.groupValueFor(groupByPropId, optionId, effective);

    // A row added under "No Status" stays there: the status default does not fill it.
    if (groupByPropId !== undefined && optionId === NO_VALUE_GROUP_KEY && this.model.getProperty(groupByPropId)?.status?.defaultOptionId !== undefined) {
      return { ...properties, [groupByPropId]: null };
    }

    return groupByPropId === undefined || value === undefined ? properties : { ...properties, [groupByPropId]: value };
  }

  /** The value a row takes in a group, or `undefined` when the group is a bucket (a date range, a number range). */
  private groupValueFor(groupByPropId: string, optionId: string, selected?: DatabaseViewConfig): PropertyValue | undefined {
    const property = this.model.getProperty(groupByPropId);
    const view = selected ?? this.shownView();

    if (property?.type === 'status' && view?.groupByStatus === 'group') {
      return this.model.statusValueForGroup(groupByPropId, optionId, undefined) ?? undefined;
    }

    return property === undefined ? optionId : groupValueForKey(property, optionId, view?.groupSettings ?? {}) ?? undefined;
  }

  /** `subKey` is the lane clicked in, on a sub-grouped board. */
  private handleAddRow(optionId: string, boardEl: HTMLDivElement, subKey?: string): void {
    const viewConfig = this.shownView();
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

    this.insertNewRow(rowData);
    this.syncRowsFromBlocks();

    // feel findings B09: the new card opens with its title being edited; Enter with a name makes the next one.
    const editNewCard = (): void => {
      if (this.view instanceof DatabaseBoardView) {
        this.view.editTitle(rowData.id, { onEnter: () => this.handleAddRow(optionId, this.boardContainer ?? boardEl, subKey) });
      }
    };

    // Lane columns have no header count: a redraw keeps the header and lane counts right.
    if (subKey !== undefined) {
      this.rerenderView({ keepDrawer: true });
      void this.sync.syncCreateRow({ id: rowData.id, properties: rowData.properties, position: rowData.position });
      editNewCard();

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
    this.markFresh(rowData.id);
    if (!this.openIfFiltered(rowData.id)) editNewCard();
  }

  private handleAddColumn(boardEl: HTMLDivElement): void {
    const viewConfig = this.shownView();
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined || this.structureLocked()) {
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
  /** The drawer hangs off the outer wrapper, so it stays across view switches. */
  private destroyCardDrawer(): void {
    const drawer = this.cardDrawer;

    this.cardDrawerSession = null;
    this.cardDrawer = null;
    drawer?.destroy();
  }

  private revokeCardDrawer(origin: DrawerAuthority): void {
    if (this.source !== undefined) {
      this.dashboardOwner(this.source.databaseId)?.revokeCardDrawer(origin);

      return;
    }
    if (this.cardDrawerSession?.origin === origin && !this.cardDrawerSession.readOnly && !origin.writable()) {
      this.destroyCardDrawer();
    }
  }

  private ensureCardDrawer(origin?: DrawerAuthority): void {
    if (this.element === null) {
      return;
    }
    const titlePropId = this.titlePropertyId();
    const descriptionPropId = this.model.getSchema().find((p) => p.type === 'richText')?.id;

    if (this.cardDrawer === null) {
      const session = {
        origin,
        readOnly: this.readOnly || this.destroyed || (origin !== undefined && !origin.writable()),
      };
      const writable = (): boolean => this.cardDrawerSession === session
        && !session.readOnly && !this.readOnly && !this.destroyed
        && (origin === undefined || origin.writable());

      const commentProperty = this.commentLever().comment;

      this.cardDrawerSession = session;
      this.cardDrawer = new DatabaseCardDrawer({
        // A second source's own wrapper is hidden: its pages open in its holder's.
        wrapper: (this.isHeldSource() ? this.dashboardOwner(this.block.parentId ?? '')?.element : undefined) ?? this.element,
        readOnly: session.readOnly,
        databaseId: this.block.id,
        backlinks: (rowId) => this.backlinksFor(rowId),
        comments: (rowId) => (this.config.comments === undefined && this.builtInComments.enabled() ? this.builtInComments.section(rowId) : null),
        ...(commentProperty !== undefined ? { onCommentProperty: commentProperty } : {}),
        notify: (message) => this.api.notifier.show({ message }),
        i18n: this.api.i18n,
        events: this.api.events,
        toolsConfig: this.api.tools.getToolsConfig(),
        rowPages: this.config.rowPages,
        titlePropertyId: titlePropId,
        descriptionPropertyId: descriptionPropId,
        schema: localizeDatabaseSchema(this.model.getSchema(), this.api.i18n),
        onTitleChange: (rowId, title) => {
          if (!writable()) return;
          this.updateRowTitleBlock(rowId, titlePropId, title);
          const currentView = this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-board]')
            ?? this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-list]')
            ?? this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-table]')
            ?? this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-gallery]')
            ?? this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-calendar]')
            ?? this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-timeline]');

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
            this.writeSchema();
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
        onClose: () => {
          rowLink.closed = this.openedRowLink ?? rowLink.closed;
          this.openedRowLink = null;
          // The next open asks the host again.
          this.hostBacklinks = null;
          this.view?.rowPageClosed?.();
        },
        onCopyViewLink: (rowId, tabId) => this.copyRowLink(rowId, tabId),
        onAddProperty: (type, name) => {
          if (this.addProperty({ name, type }) !== null) {
            this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
          }
        },
        onOpenPropertyMenu: (propertyId, anchor, onCustomizeLayout, extras) => this.openPropertyMenu(propertyId, anchor, undefined, undefined, onCustomizeLayout, extras ?? {}),
        onOpenAddProperty: (anchor, onAdded) => this.openAddProperty(anchor, undefined, (created, ownSetup) => {
          this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
          return onAdded?.(created.id, ownSetup);
        }),
        onDeleteProperty: (propertyId) => {
          this.deleteProperty(propertyId);
          this.cardDrawer?.refreshSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
        },
        hasPeople: this.hasPeople,
        cellContext: () => this.cellContext(),
        onPropertyValueChange: (rowId, propertyId, input) => {
          if (!writable()) return;
          if (this.model.getProperty(propertyId)?.type === 'relation') {
            this.commitRelation(rowId, propertyId, input);
            this.rerenderView({ keepDrawer: true });

            return;
          }
          const value = this.knownOptionsOnly(propertyId, input);

          // Deleting an option already emptied this row through clearRemovedOptions.
          // A template is no model row: read it too, or clearing its value is never saved.
          if (JSON.stringify(this.rowOrTemplate(rowId)?.properties[propertyId] ?? null) === JSON.stringify(value)) return;
          this.updateRowBlock(rowId, { [propertyId]: value });
          this.rerenderView({ keepDrawer: true });
          this.sync.syncUpdateRow({ rowId, properties: { [propertyId]: value } });
        },
        onReminderChange: (rowId, propertyId, reminder) => { if (writable()) this.commitReminder(rowId, propertyId, reminder, true); },
        dateDisplayChanger: (propertyId) => writable() ? this.dateDisplayChanger(propertyId) : undefined,
        onOptionsChange: (propertyId, options) => {
          if (this.readOnly || this.destroyed || this.structureLocked()) return;
          this.clearRemovedOptions(propertyId, options);
          this.model.updateProperty(propertyId, { config: { options } });
          this.writeSchema();
          this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
          this.rerenderView({ keepDrawer: true });
          void this.sync.syncUpdateProperty({ propertyId, changes: { config: { options } } });
        },
        savedOptionsOf: (propertyId) => this.model.getProperty(propertyId)?.config?.options,
        rowBody: {
          attach: (rowId, host) => {
            if (!writable()) host.setAttribute('inert', '');

            return this.attachRowBody(rowId, host, writable);
          },
          detach: () => this.mountRows(),
          start: (rowId) => this.api.blocks.getById(rowId)?.call('enter'),
          move: (rowId, step) => {
            const handled: boolean[] = [];

            this.api.blocks.getById(rowId)?.call('movePick', { step, receive: (h: boolean) => handled.push(h) });

            return handled.includes(true);
          },
        },
        adjacentRow: (rowId, direction) => this.adjacentRow(rowId, direction),
        viewRows: () => this.viewRowOrder(),
        onEscapeClose: (rowId) => this.dropFreshRow(rowId),
        onCoverChange: (rowId, cover) => {
          if (!writable()) return;
          const row = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

          row?.call('updateCover', { cover });
          row?.dispatchChange();
          this.syncRowsFromBlocks();
          this.cardDrawer?.syncOpenRow(this.rowOrTemplate(rowId));
          this.rerenderView({ keepDrawer: true });
        },
        uploadCover: this.coverUploader(),
        onIconChange: (rowId, icon) => {
          if (!writable()) return;
          const row = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

          row?.call('updateIcon', { icon });
          row?.dispatchChange();
          this.syncRowsFromBlocks();
          this.cardDrawer?.syncOpenRow(this.rowOrTemplate(rowId));
          this.rerenderView({ keepDrawer: true });
        },
        rowActions: (rowId) => {
          // A template's page: the row actions would miss it, as they read the rows only.
          if (this.model.getRow(rowId) === undefined) return undefined;
          const copyLink = { onCopyLink: () => this.copyRowLink(rowId) };
          const listTargets = (): Array<{ id: string; title: string }> => this.moveTargets();

          return !writable() ? copyLink : {
            ...copyLink,
            onDuplicate: () => { if (writable()) this.duplicateTableRow(rowId); },
            onDelete: () => { if (writable()) this.deleteTableRows([rowId]); },
            // A getter: the targets walk every block, so they are read only when the menu opens.
            get moveTargets() { return listTargets(); },
            onMoveTo: (databaseId: string) => { if (writable()) this.moveRowTo({ rowId, databaseId }); },
          };
        },
        // A template's page is not a row, so it has no star.
        favorite: (rowId) => (this.model.getRow(rowId) === undefined ? undefined : this.favoriteFor(rowId)),
        onFullWidthChange: (rowId, fullWidth) => {
          if (!writable()) return;
          const row = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

          row?.call('updateFullWidth', { fullWidth });
          row?.dispatchChange();
          this.syncRowsFromBlocks();
          this.cardDrawer?.syncOpenRow(this.rowOrTemplate(rowId));
        },
        onEditViewDefault: (anchor) => this.controls.openSettingsPage('layout', anchor),
        pageFooter: (rowId) => rowMenuFooter({
          row: this.model.getRow(rowId),
          titlePropertyId: this.titlePropertyId(),
          locale: editorLocale(this.api.i18n),
          ...(this.people !== undefined ? { people: this.people } : {}),
          i18n: this.api.i18n,
        }),
        onExpand: (rowId) => {
          const navigate = this.config.rowPages?.navigate;

          if (navigate === undefined) return false;
          this.cardDrawer?.close();
          navigate(rowId);

          return true;
        },
        peekHost: () => this.element?.closest<HTMLElement>(`[${DATA_ATTR.editor}]`) ?? null,
        onPageLayoutChange: (edit, visibility, tabs) => {
          if (this.readOnly || this.structureLocked()) return;
          this.applyPageLayout(edit, visibility, tabs);
        },
        layoutTabs: this.layoutTabsHost,
        onPageLayoutBirth: () => {
          // Derived: undoing the birth would also drop entries a peer pushed into the lists.
          if (!this.readOnly && this.model.bearPageLayout()) this.block.dispatchChange({ derived: true });
        },
        databaseLocked: () => this.structureLocked(),
        databaseTitle: () => (this.linked ? this.title : this.titleElement?.textContent ?? this.title),
      });
    }

  }

  private initSubsystems(boardEl: HTMLDivElement): void {
    if (this.element === null) {
      return;
    }

    const savedView = this.shownView();
    const viewConfig = savedView === undefined ? undefined : this.controls.effective(savedView);
    const isList = viewConfig?.type === 'list';
    // Table, gallery, calendar, timeline, chart and feed own their gestures. Unknown types render as a board.
    const ownsGestures = viewConfig?.type === 'table' || viewConfig?.type === 'gallery' || viewConfig?.type === 'calendar'
      || viewConfig?.type === 'timeline' || viewConfig?.type === 'chart' || viewConfig?.type === 'feed';
    const isBoard = !isList && !ownsGestures;

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
    if (isBoard && this.isOptionGroup(viewConfig?.groupBy) && !this.structureLocked()) {
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
          const viewConfig = this.shownView();
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

    boardEl.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;

      // Board: column header drag
      const columnHeader = target.closest('[data-blok-database-column-header]');

      if (columnHeader !== null) {
        // Do not start drag when the click originates from the pill (title element or its input)
        // or from a header button.
        // The count stays a drag handle: a press without a move is still a click that opens its menu.
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

      // List: row drag. An editable property and the title input keep the pointer for edit and focus.
      const listRowEl = target.closest('[data-blok-database-list-row]');

      if (listRowEl !== null && target.closest('[data-blok-database-list-row-property][data-editable], [data-blok-database-list-title-input]') === null) {
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

    if (this.sortsShown(this.shownView()).length > 0) {
      this.askToRemoveSorting(rowId, beforeRowId, afterRowId);

      return;
    }

    this.placeRow(this.shownView(), rowId, afterRowId, beforeRowId);
    this.rerenderView();
  }

  /**
   * Keeps `rowIds` where they are in `owner`'s other views before their
   * shared `position` changes (see pinRowsInOtherViews). A view of another
   * source never shows these rows, and a chart, dashboard or form shows no
   * row order.
   */
  private pinInOtherViews(owner: DatabaseTool, viewId: string, rowIds: string[]): string[] {
    const rows = rowIds.flatMap((id) => this.model.getRow(id) ?? []);

    return owner.model.pinRowsInOtherViews(viewId, rows,
      (view) => !UNORDERED_VIEW_TYPES.has(view.type) && (view.dataSourceId ?? owner.dataId) === this.dataId);
  }

  /**
   * Puts a dropped row between its neighbours in `view`'s manual order.
   * Manual order is per view (research/22 OU17). A view with its own
   * `rowOrder` changes only there. A view on the shared order moves the row's
   * `position`, after the other views pin it where they show it. `also.write` joins the same undo step;
   * `also.sync` runs before this move's backend calls, as it always did.
   */
  private placeRow(
    view: DatabaseViewConfig | undefined, rowId: string, afterRowId: string | null, beforeRowId: string | null,
    owner: DatabaseTool = this.viewOwner(), also: { write?: () => void; sync?: () => void } = {}
  ): void {
    const order = view === undefined ? undefined : owner.model.rowOrderOf(view);
    const keyOf = (id: string | null): string | null => {
      const row = id === null ? undefined : this.model.getRow(id);

      return row === undefined ? null : rowOrderKey(row, order);
    };
    const key = DatabaseModel.positionBetween(keyOf(afterRowId), keyOf(beforeRowId));
    // A view's own order is a database-block write; without editStructure the shared order is all this person can change.
    const writesView = view !== undefined && !owner.structureDenied;
    const frozen: string[] = [];
    const write = (): void => {
      also.write?.();
      if (order !== undefined) {
        if (!writesView) return;
        owner.model.updateView(view.id, { rowOrder: { ...order, [rowId]: key } });
        owner.block.dispatchChange();

        return;
      }
      if (writesView) frozen.push(...this.pinInOtherViews(owner, view.id, [rowId]));
      if (frozen.length > 0) owner.block.dispatchChange();
      this.moveRowBlock(rowId, key);
    };

    if (this.api.blocks.transact !== undefined) this.api.blocks.transact(write);
    else write();

    also.sync?.();
    if (order !== undefined) {
      if (writesView) void owner.sync.syncUpdateView({ viewId: view.id, changes: { rowOrder: { ...order, [rowId]: key } } });

      return;
    }
    frozen.forEach((viewId) => {
      void owner.sync.syncUpdateView({ viewId, changes: { rowOrder: structuredClone(owner.model.getView(viewId)?.rowOrder) } });
    });
    void this.sync.syncMoveRow({ rowId, position: key });
  }

  private handleRowDrop(result: CardDragResult): void {
    const { rowId, toOptionId, beforeRowId, afterRowId } = result;
    const viewConfig = this.shownView();
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const subGroupBy = viewConfig?.subGroupBy;
    const subChange: Record<string, PropertyValue> = subGroupBy !== undefined && subGroupBy !== groupByPropId && result.toSubGroup !== undefined
      ? { [subGroupBy]: this.droppedSubGroupValue(subGroupBy, rowId, result.toSubGroup) }
      : {};

    // Neighbours arrive in sort order, not key order, so a key between them
    // would mean nothing. A reorder inside the group asks first (D7). A move to another
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

    const value = this.droppedGroupValue(groupByPropId, rowId, toOptionId);
    const changes: Record<string, PropertyValue> = { [groupByPropId]: value, ...subChange };

    this.placeRow(viewConfig, rowId, afterRowId, beforeRowId, this, {
      write: () => this.updateRowBlock(rowId, changes),
      sync: () => this.sync.syncUpdateRow({ rowId, properties: changes }),
    });
    this.rerenderView();
  }

  /** The sorts this person sees: their own (D4) or the saved ones. */
  private sortsShown(view: DatabaseViewConfig | undefined, controls: DatabaseViewControls = this.controls): DatabaseViewConfig['sorts'] {
    return view === undefined ? [] : controls.effective(view).sorts;
  }

  /** Only the values that differ from the row's. */
  private changedValues(rowId: string, values: Record<string, PropertyValue>): Record<string, PropertyValue> {
    const current = this.model.getRow(rowId)?.properties ?? {};

    return Object.fromEntries(Object.entries(values).filter(([id, value]) => JSON.stringify(current[id] ?? null) !== JSON.stringify(value)));
  }

  private writeRowValues(rowId: string, changes: Record<string, PropertyValue>, context?: NativeWidgetContext): void {
    if ((context !== undefined && !context.writable()) || Object.keys(changes).length === 0 || this.model.getRow(rowId) === undefined) {
      return;
    }
    this.updateRowBlock(rowId, changes);
    if (context === undefined) this.rerenderView();
    else context.redraw();
    this.sync.syncUpdateRow({ rowId, properties: changes });
  }

  /**
   * Notion's D7 flow (research/08): "Remove" deletes the sorts, keeps the sorted
   * order as the manual order and lands the row where it was dropped.
   * "Don't remove" discards the drop.
   */
  /** `changes` is a cross-lane drop's sub-group value: it is kept whatever the answer. */
  private askToRemoveSorting(rowId: string, beforeRowId: string | null, afterRowId: string | null, changes: Record<string, PropertyValue> = {}, context?: NativeWidgetContext): void {
    const owner = context?.owner ?? this;
    const controls = context?.controls ?? this.controls;
    const viewId = context?.view.id ?? this.activeViewId;

    void openDatabaseConfirm({
      title: this.api.i18n.t('tools.database.removeSortingTitle'),
      confirmLabel: this.api.i18n.t('tools.database.removeSortingConfirm'),
      cancelLabel: this.api.i18n.t('tools.database.removeSortingCancel'),
      destructive: true,
      directionSource: this.element,
    }).then((remove) => {
      const view = owner.model.getView(viewId);

      if (this.destroyed || this.readOnly || (context !== undefined && !context.writable())) {
        return;
      }
      // A peer may have dropped the sort or the row while the dialog was open.
      if (!remove || view === undefined || this.sortsShown(view, controls).length === 0 || this.model.getRow(rowId) === undefined) {
        this.writeRowValues(rowId, changes, context);

        return;
      }
      this.removeSortingAndPlace(view, rowId, beforeRowId, afterRowId, changes, context);
    });
  }

  private removeSortingAndPlace(
    view: DatabaseViewConfig, rowId: string, beforeRowId: string | null, afterRowId: string | null, changes: Record<string, PropertyValue> = {}, context?: NativeWidgetContext
  ): void {
    if (context !== undefined && !context.writable()) return;
    const owner = context?.owner ?? this;
    const controls = context?.controls ?? this.controls;

    // Every row, filtered out or not, so hidden rows keep their sorted place too.
    const sorted = sortRows(this.model.getOrderedRows(), this.sortsShown(view, controls), this.model.getValueSchema(), owner.model.rowOrderOf(view));
    // A personal sort (D4) is this person's to drop; so is any sort while the database is locked.
    const personal = controls.hasPersonalSorts(view.id) || owner.structureLocked();
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
    const keys: Array<{ rowId: string; position: string }> = [];

    order.reduce<string | null>((previous, row) => {
      const position = DatabaseModel.positionBetween(previous, null);

      keys.push({ rowId: row.id, position });

      return position;
    }, null);

    // Manual order is per view (research/22 OU17): a view with its own order
    // bakes the sorted order there; one on the shared order first has the
    // other views pin every row it moves.
    const ownOrder = owner.model.rowOrderOf(view) !== undefined;
    const writesView = !owner.structureDenied;
    const rowOrder = ownOrder && writesView ? Object.fromEntries(keys.map((key) => [key.rowId, key.position])) : undefined;
    const moves = ownOrder ? [] : keys.filter((key) => this.model.getRow(key.rowId)?.position !== key.position);
    const viewChanges: ViewChanges = { ...(personal ? {} : { sorts: [] }), ...(rowOrder === undefined ? {} : { rowOrder }) };
    const frozen: string[] = [];
    const hasChanges = Object.keys(changes).length > 0;
    const write = (): void => {
      if (!ownOrder && writesView) frozen.push(...this.pinInOtherViews(owner, view.id, moves.map((move) => move.rowId)));
      if (Object.keys(viewChanges).length > 0) owner.model.updateView(view.id, viewChanges);
      if (Object.keys(viewChanges).length > 0 || frozen.length > 0) owner.block.dispatchChange();
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

    if (personal) {
      controls.dropPersonalSorts(view);
    }
    if (context === undefined) this.rerenderView();
    else context.redraw();
    if (Object.keys(viewChanges).length > 0) {
      void owner.sync.syncUpdateView({ viewId: view.id, changes: structuredClone(viewChanges) });
    }
    frozen.forEach((viewId) => {
      void owner.sync.syncUpdateView({ viewId, changes: { rowOrder: structuredClone(owner.model.getView(viewId)?.rowOrder) } });
    });
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
      return groupValueForKey(property, toKey, this.shownView()?.subGroupSettings ?? {}) ?? current ?? null;
    }
    if (property.type !== 'multiSelect') {
      return target;
    }

    const from = this.cardDragFromSubGroup;
    const kept = personIdsOf(current).filter((id) => id !== from && id !== target);

    return target === null ? kept : [...kept, target];
  }

  private droppedGroupValue(groupByPropId: string, rowId: string, toOptionId: string, selected?: DatabaseViewConfig): PropertyValue {
    const target = toOptionId === NO_VALUE_GROUP_KEY ? null : toOptionId;
    const property = this.model.getProperty(groupByPropId);
    const type = property?.type;
    const current = this.model.getRow(rowId)?.properties[groupByPropId];
    const view = selected ?? this.shownView();

    if (property !== undefined && !this.isOptionGroup(groupByPropId)) {
      // A bucket names no single value: the row keeps the one it has.
      const settings = view?.groupSettings ?? {};

      return groupValueForKey(property, toOptionId, settings) ?? current ?? null;
    }

    if (type === 'status' && target !== null && view?.groupByStatus === 'group') {
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
    const viewConfig = this.shownView();
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    // A view with its own group order moves the column there only; the options keep their positions.
    const order = viewConfig?.groupOrder !== undefined && prop.type !== 'status' ? viewConfig.groupOrder : undefined;
    // Keep the stored array in position order so every later reader (add-column,
    // neighbour lookup) sees the same order the board renders in.
    const options = prop.config.options
      .map((o) => (order?.[o.id] === undefined ? o : { ...o, position: order[o.id] }))
      .sort((a, b) => (a.position < b.position ? -1 : 1));
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

    if (order !== undefined && viewConfig !== undefined) {
      this.writeView(viewConfig.id, { groupOrder: { ...order, [optionId]: newPosition } });
      this.moveColumnInDom(optionId, beforeOptionId);

      return;
    }

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
    const boardEl = this.viewRoot()?.querySelector<HTMLElement>('[data-blok-database-board]');

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
    const viewConfig = this.shownView();
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined || this.structureLocked()) {
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
    const viewConfig = this.shownView();
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined || this.structureLocked()) {
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

  /**
   * @param explicit - the row menu's "Open in" choice; it beats the view's mode and the open peek's.
   * @param openIn - the opening view's mode when it is not this database's active view (a linked view).
   */
  private handleRowClick(rowId: string, explicit?: OpenPagesIn, openIn?: OpenPagesIn, origin?: DrawerAuthority): void {
    if (this.source !== undefined) {
      const linkedView = this.shownView();
      const viewMode = linkedView === undefined ? {} : { mode: resolveOpenPagesIn(linkedView) };

      if (origin !== undefined) {
        const originMode = openIn ?? (linkedView === undefined ? undefined : resolveOpenPagesIn(linkedView));

        this.dashboardOwner(this.source.databaseId)?.handleRowClick(rowId, explicit, originMode, origin);

        return;
      }

      // The row's page body mounts in the source, which owns its holder.
      this.api.blocks.getById(this.source.databaseId)?.call('openRow', {
        rowId,
        ...(explicit !== undefined ? { mode: explicit, explicit: true } : viewMode),
      });

      return;
    }
    const row = this.model.getRow(rowId);

    if (this.freshRow !== null && this.freshRow.id !== rowId) {
      this.freshRow = null;
    }

    if (row === undefined) {
      return;
    }
    const closedReadOnlyChanged = this.cardDrawer?.isOpen === false &&
      this.cardDrawerSession?.readOnly !== (this.readOnly || this.destroyed || (origin !== undefined && !origin.writable()));

    if (this.cardDrawerSession?.origin !== origin || closedReadOnlyChanged) {
      this.destroyCardDrawer();
    }
    this.ensureCardDrawer(origin);
    // Already shown: a fresh lookup would drop the open editor unsaved. open() only switches the mode.
    const navigates = explicit === 'full' && this.config.rowPages?.navigate !== undefined;

    if (this.cardDrawer?.openRowId === rowId && !navigates) {
      if (explicit !== undefined && explicit !== this.cardDrawer.openMode) {
        this.cardDrawer.open(row, explicit);
      }

      return;
    }

    const view = this.shownView();
    const viewMode = openIn ?? (view === undefined ? 'side' : resolveOpenPagesIn(view));
    const mode = explicit ?? (this.cardDrawer?.isOpen === true ? this.cardDrawer.openMode : viewMode);

    if (mode === 'full' && this.config.rowPages?.navigate !== undefined) {
      this.cardDrawer?.close();
      this.config.rowPages.navigate(rowId);

      return;
    }
    if (this.config.rowPages !== undefined && !this.readOnly && row.pageId === undefined) {
      this.cardDrawer?.setRowPageLookup(rowId, 'pending');
    }
    this.cardDrawer?.open(row, mode);
    this.cardDrawer?.setTemplateBanner(null);
    void this.resolveRowPage(rowId);
  }

  // ---------------------------------------------------------------------------
  // Board and list selection
  // ---------------------------------------------------------------------------

  /**
   * Cmd/Ctrl-click toggles a row; Shift-click adds every row from the last pick.
   * `order` is the rows as drawn; without it, the view order, which ignores "Load more" cuts.
   */
  private pickRow(rowId: string, range: boolean, order = this.viewRowOrder().map((row) => row.id)): void {
    const from = this.selectionAnchor === null ? -1 : order.indexOf(this.selectionAnchor);
    const to = order.indexOf(rowId);

    if (range && from !== -1 && to !== -1) {
      order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((id) => this.rowSelection.add(id));
    } else if (this.rowSelection.has(rowId)) {
      this.rowSelection.delete(rowId);
    } else {
      this.rowSelection.add(rowId);
    }
    this.selectionAnchor = rowId;
    this.paintRowSelection();
  }

  /**
   * Calendar Shift-click (research/22 §1): adds an event on the same start day
   * as the picked ones, replaces them when it starts on another day.
   */
  private pickCalendarEvent(rowId: string, dateId: string): void {
    const startOf = (id: string): string | undefined => eventSpan(this.model.getRow(id)?.properties[dateId])?.start;
    const day = startOf(rowId);

    if ([...this.rowSelection].some((id) => startOf(id) !== day)) {
      this.rowSelection.clear();
    }
    this.pickRow(rowId, false, []);
  }

  /** Gallery arrow keys and the board, list and calendar lassos: the selection becomes exactly these rows. */
  private selectRows(rowIds: string[]): void {
    this.rowSelection.clear();
    rowIds.forEach((id) => this.rowSelection.add(id));
    this.selectionAnchor = rowIds.at(-1) ?? null;
    this.paintRowSelection();
  }

  private clearRowSelection(): void {
    this.rowSelection.clear();
    this.selectionAnchor = null;
    this.paintRowSelection();
  }

  /** The view toolbar row: the selection bar takes its place (research/08). With one view that is the title row. */
  private selectionBarSlot(): HTMLElement | null {
    const owner = this.viewOwner();

    return owner.element?.querySelector<HTMLElement>(':scope > [data-blok-database-title-row][data-single-view], :scope > [data-blok-database-view-bar]') ?? null;
  }

  /** Where this block's shown view is drawn. */
  private viewRoot(): HTMLElement | null {
    return this.boundRoot ?? this.boardContainer;
  }

  /** Gray halo on each picked row (D3) and the selection bar above the view. */
  private paintRowSelection(): void {
    const container = this.viewRoot();

    if (container === null) {
      return;
    }
    const present = new Set(this.model.getOrderedRows().map((row) => row.id));

    [...this.rowSelection].filter((id) => !present.has(id)).forEach((id) => this.rowSelection.delete(id));
    container.querySelectorAll<HTMLElement>('[data-blok-database-list-row], [data-blok-database-card], [data-blok-database-gallery-card], [data-blok-database-timeline-row], [data-blok-database-timeline-table-row], [data-blok-database-calendar-event]').forEach((el) => {
      const selected = this.rowSelection.has(el.getAttribute('data-row-id') ?? '');

      el.toggleAttribute('data-blok-database-row-selected', selected);
      if (selected) {
        el.setAttribute('aria-selected', 'true');
      } else {
        el.removeAttribute('aria-selected');
      }
    });
    const slot = this.selectionBarSlot() ?? container;

    // Only this bar: a table view's own bar shares the slot and the attribute, and keeps its selection across a redraw.
    this.rowSelectionBar?.remove();
    this.rowSelectionBar = null;
    slot.toggleAttribute('data-blok-database-selecting', slot.querySelector(':scope > [data-blok-database-table-selection-bar]') !== null);
    document.removeEventListener('keydown', this.handleSelectionKeys, true);
    if (this.rowSelection.size === 0) {
      return;
    }
    document.addEventListener('keydown', this.handleSelectionKeys, true);
    const view = this.shownView();

    // research/22 §1: Notion shows no bulk bar for picked calendar events.
    if (view?.type === 'calendar') {
      return;
    }
    const visible = view === undefined ? [] : visibleRowPropertyIds(view, this.model.getSchema());
    const properties = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).filter((p) => visible.includes(p.id));

    slot.setAttribute('data-blok-database-selecting', '');
    this.rowSelectionBar = createSelectionBar({
      count: this.rowSelection.size,
      properties,
      i18n: this.api.i18n,
      onEdit: (propertyId, anchor) => this.openBulkEditor(propertyId, anchor),
      onDelete: () => this.trashSelection(),
      onMore: (anchor) => {
        openMenu(anchor, [
          { name: 'database-selection-duplicate', title: this.api.i18n.t('tools.database.tableDuplicate'), icon: IconCopy, closeOnActivate: true, onActivate: () => this.duplicateSelection() },
          { name: 'database-selection-delete', title: this.api.i18n.t('tools.database.tableMoveToTrash'), icon: IconTrash, closeOnActivate: true, onActivate: () => this.trashSelection() },
        ]);
      },
    });
    slot.prepend(this.rowSelectionBar);
  }

  private openBulkEditor(propertyId: string, anchor: HTMLElement): void {
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId);
    const rowIds = this.inViewOrder([...this.rowSelection]);

    if (property === undefined || rowIds.length === 0 || this.readOnly) {
      return;
    }
    this.bulkEditor?.close();
    const changeDisplay = property.type === 'date' ? this.dateDisplayChanger(propertyId) : undefined;
    const displayChanged = { any: false };
    const written = { any: false };
    const closeKey = watchBulkCloseKey();
    // research/35:234-235: the picked cards and rows show each key; the write waits for the close.
    const showDraft = (text?: string): void => {
      if (!(this.view instanceof DatabaseBoardView || this.view instanceof DatabaseListView)) return;
      this.view.showDraft(rowIds.flatMap((rowId) => {
        const row = this.model.getRow(rowId);

        return row === undefined ? [] : [text === undefined ? row : { ...row, properties: { ...row.properties, [propertyId]: text } }];
      }));
    };

    this.bulkEditor = openCellEditor(property, bulkStartValue(property, rowIds.map((rowId) => this.model.getRow(rowId))), anchor, {
      ...this.cellContext(),
      i18n: this.api.i18n,
      readOnly: false,
      ...(property.type === 'date'
        ? { bulk: true, onReminderChange: (next: DateReminderOffset | null, picked: boolean) => { this.commitBulkReminder(rowIds, propertyId, next, picked); } }
        : {}),
      ...(changeDisplay !== undefined
        ? { onDateDisplayChange: (change: DateDisplayChange) => {
          displayChanged.any = true;
          changeDisplay(change);
        } }
        : {}),
      options: this.model.getProperty(propertyId)?.config?.options ?? [],
      onOptionsChange: (options) => this.handleTableOptionsChange(propertyId, options),
      ...(property.type === 'text' ? { onDraft: showDraft } : {}),
      onCommit: (value) => {
        written.any = true;
        this.commitTableCells(rowIds.map((rowId) => ({ rowId, propertyId, value })), []);
      },
      onClose: () => {
        closeKey.stop();
        this.bulkEditor = null;
        if (property.type === 'text' && !written.any) showDraft();
        if (bulkCloseClearsSelection(property.type, closeKey.key(), written.any)) this.clearRowSelection();
        if (displayChanged.any) this.rerenderView({ keepDrawer: true });
      },
    });
    if (!this.bulkEditor.isOpen) closeKey.stop();
  }

  /** ⌘⇧M and ⌘⇧P on one picked card, list row or calendar event: its Comment and its Move to, as the row menu shows. */
  private rowShortcut(rowId: string, command: 'comment' | 'moveTo', act: (run: () => void) => void): void {
    const id = CSS.escape(rowId);
    const rowEl = this.viewRoot()?.querySelector<HTMLElement>(`:is([data-blok-database-card], [data-blok-database-list-row], [data-blok-database-calendar-event])[data-row-id="${id}"]`);
    const { comment } = this.commentLever();

    if (rowEl === null || rowEl === undefined) return;
    if (command === 'comment') {
      if (comment !== undefined) act(() => comment(rowId, undefined, rowEl));

      return;
    }
    const targets = this.moveTargets();

    if (targets.length > 0) {
      act(() => openMenu(rowEl, moveTargetItems(this.api.i18n, targets, (databaseId) => this.moveRowTo({ rowId, databaseId })), { searchable: true }));
    }
  }

  private duplicateSelection(): void {
    [...this.rowSelection].forEach((rowId) => this.duplicateTableRow(rowId));
    this.paintRowSelection();
  }

  private trashSelection(): void {
    const rowIds = [...this.rowSelection];

    this.rowSelection.clear();
    this.deleteTableRows(rowIds);
    this.rerenderView({ keepDrawer: true });
  }

  /** Gallery cards and list rows trashed by key get the "Moved to Trash" toast (findings K05). */
  private trashSelectionFromKeys(): void {
    const type = this.shownView()?.type;

    this.trashWithToast(() => this.trashSelection(), this.rowSelection.size, type === 'gallery' || type === 'list');
  }

  /**
   * Runs a delete as one undo step, then shows one "Moved to Trash" toast whose
   * Restore undoes that step (research/22 §2, research/23 §2b for several rows).
   */
  private trashWithToast(remove: () => void, count: number, toast = true): void {
    const before = this.api.history.latestStep();

    // One undo step, so Restore brings every row back.
    if (this.api.blocks.transact !== undefined) this.api.blocks.transact(remove);
    else remove();
    if (!toast) {
      return;
    }
    const after = this.api.history.latestStep();
    // Only the delete's own step: the toast stays open, so a later edit may sit on top by then.
    const step = after !== before ? after : undefined;

    this.api.notifier.show({
      message: this.api.i18n.t('tools.database.movedToTrash'),
      announce: this.api.i18n.t('tools.database.blocksDeleted', { count }),
      actions: [{
        label: this.api.i18n.t('tools.database.restore'),
        onClick: () => {
          if (step !== undefined) {
            this.api.history.undoStep(step);
          }
        },
      }],
    });
  }

  /**
   * While board or list rows are picked: Escape clears, Cmd/Ctrl+D
   * duplicates, Delete or Backspace trashes, Cmd/Ctrl+/ edits them all.
   * A key typed into a field keeps its own meaning.
   */
  private readonly handleSelectionKeys = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;

    if (this.rowSelection.size === 0 || (target !== null && (target.isContentEditable || target.matches('input, textarea, select')))) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const act = (run: () => void): void => {
      event.preventDefault();
      event.stopPropagation();
      run();
    };

    if (key === 'escape') {
      act(() => this.clearRowSelection());
    } else if (mod && event.shiftKey && (key === 'm' || key === 'p') && this.rowSelection.size === 1) {
      this.rowShortcut([...this.rowSelection][0], key === 'm' ? 'comment' : 'moveTo', act);
    } else if (mod && key === 'd') {
      act(() => this.duplicateSelection());
    } else if (!mod && (key === 'backspace' || key === 'delete')) {
      act(() => this.trashSelectionFromKeys());
    } else if (mod && key === '/') {
      // A calendar pick has no bar; the key keeps its own meaning then.
      const bar = (this.selectionBarSlot() ?? this.viewRoot())?.querySelector<HTMLElement>(':scope > [data-blok-database-table-selection-bar]');

      if (bar === null || bar === undefined) {
        return;
      }
      act(() => {
        const view = this.shownView();
        const visible = view === undefined ? [] : visibleRowPropertyIds(view, this.model.getSchema());
        const properties = bulkEditableProperties(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).filter((p) => visible.includes(p.id)));

        openMenu(bar, properties.map((property) => ({
          name: `database-bulk-edit-${property.id}`,
          title: property.name,
          closeOnActivate: true,
          onActivate: () => {
            const button = bar.querySelector<HTMLElement>(`[data-property-id="${property.id}"]`);

            this.openBulkEditor(property.id, button ?? bar);
          },
        })), { searchable: true });
      });
    }
  };

  /** The active view's rows in the order it shows them, groups in board order. */
  private viewRowOrder(): DatabaseRow[] {
    const view = this.shownView();

    if (view === undefined) {
      return [];
    }
    if (view.groupBy !== undefined && this.model.getProperty(view.groupBy) !== undefined) {
      const options = this.groupOptions(view.groupBy, view);
      const groups = this.queryGroupRows(view, options.map((option) => option.id));

      return options.flatMap((option) => groups.get(option.id) ?? []);
    }

    return this.model.queryRows({ view }).rows;
  }

  /** `rowIds` top to bottom as the view draws them; a row the view lacks goes last. */
  private inViewOrder(rowIds: string[]): string[] {
    const order = new Map(this.viewRowOrder().map((row, index) => [row.id, index]));
    const rank = (id: string): number => order.get(id) ?? order.size;

    return [...rowIds].sort((a, b) => rank(a) - rank(b));
  }

  private adjacentRow(rowId: string, direction: 1 | -1): DatabaseRow | undefined {
    const order = this.viewRowOrder();
    const index = order.findIndex((row) => row.id === rowId);

    return index === -1 ? undefined : order[index + direction];
  }

  /** A mode picked in the peek header is saved on the view, as Notion's "Open pages in" is. */
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

      if (property.type === 'richText' && isOutputData(value)) {
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

    const rowBlock = this.api.blocks.getChildren(this.dataId).find((child) => child.id === rowId);

    if (rowBlock === undefined || this.model.getRow(rowId)?.pageId === page.pageId) return;
    rowBlock.call('updatePageId', { pageId: page.pageId });
    // Host-derived, not a user step: undo must not strip it again.
    rowBlock.dispatchChange({ derived: true });
    this.syncRowsFromBlocks();
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.rowOrTemplate(rowId));
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

    return databaseId === this.dataId
      ? { schema: this.model.getSchema(), rows: this.model.getOrderedRows() }
      : this.readDatabaseSource(databaseId);
  }

  private static titleOf(source: DatabaseSource, row: DatabaseRow): string {
    const titleId = source.schema.find((p) => p.type === 'title')?.id;
    const title = titleId === undefined ? undefined : row.properties[titleId];

    return typeof title === 'string' ? title : '';
  }

  /** A page ref's title in an export: a rollup's refs belong to the relation it reads through. */
  private csvRowTitle(property: PropertyDefinition, rowId: string): string | undefined {
    const relation = property.type === 'rollup' ? this.model.getProperty(property.rollup?.relationPropertyId ?? '') : property;

    if (relation?.type === 'relation') return this.relatedTitle(relation, rowId);
    const row = this.model.getRow(rowId);

    return row === undefined ? undefined : DatabaseTool.titleOf({ schema: this.model.getSchema(), rows: [] }, row);
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

  /** The related database's title, for a form's page picker. */
  private relatedDatabaseName(property: PropertyDefinition): string {
    const databaseId = property.relation?.targetDatabaseId;
    const title = databaseId === undefined || databaseId === this.dataId ? this.title : this.api.blocks.getById(databaseId)?.preservedData.title;

    return typeof title === 'string' && title.trim() !== '' ? title : this.api.i18n.t('tools.database.relationUntitledDatabase');
  }

  private relationCandidates(property: PropertyDefinition): Array<{ id: string; title: string }> {
    const source = this.relatedSource(property);

    return (source?.rows ?? []).map((row) => ({ id: row.id, title: source === undefined ? '' : DatabaseTool.titleOf(source, row) }));
  }

  private openRelated(property: PropertyDefinition, rowId: string): void {
    const databaseId = property.relation?.targetDatabaseId;

    if (databaseId === undefined || property.relation?.targetDocumentId !== undefined) return;
    if (databaseId === this.dataId) {
      this.handleRowClick(rowId);

      return;
    }
    this.api.blocks.getById(databaseId)?.call('openRow', { rowId });
  }

  private writeForeignRow(databaseId: string, rowId: string, changes: Record<string, PropertyValue>): void {
    if (databaseId === this.dataId) {
      this.writeRelatedRow({ rowId, changes });

      return;
    }
    this.api.blocks.getById(databaseId)?.call('writeRelatedRow', { rowId, changes, done: () => undefined });
  }

  /** The old owner's half of a relocation replay: delete only a row this backend still holds. */
  releaseRelocatedRow(param: { rowId: string; receive: (released: boolean) => void }): void {
    if (this.readOnly || this.destroyed || this.source !== undefined || !this.sync.holdsRow(param.rowId)) {
      param.receive(false);

      return;
    }
    void this.sync.syncDeleteRow({ rowId: param.rowId }, true);
    param.receive(true);
  }

  readRowWritePermission(param: { receive: (allowed: boolean) => void }): void {
    if (this.checkingRowPermission) {
      param.receive(false);

      return;
    }
    const allowed: boolean[] = [];

    this.checkingRowPermission = true;
    try {
      allowed.push(!this.readOnly && !this.destroyed);
    } finally {
      this.checkingRowPermission = false;
    }
    param.receive(Boolean(allowed[0]));
  }

  /** The other side of a relation edit, from this database or another one. */
  writeRelatedRow(param: { rowId: string; changes: Record<string, PropertyValue>; done?: () => void }): void {
    if (this.readOnly || this.destroyed || this.model.getRow(param.rowId) === undefined) return;
    if (this.source !== undefined) {
      this.api.blocks.getById(this.source.databaseId)?.call('writeRelatedRow', param);

      return;
    }
    this.updateRowBlock(param.rowId, param.changes);
    this.sync.syncUpdateRow({ rowId: param.rowId, properties: param.changes });
    if (param.done !== undefined) {
      // Written from another database: the model already holds it, so no change event redraws this one.
      param.done();
      this.rerenderView({ keepDrawer: true });
    }
  }

  private storedRelationOf(databaseId: string, rowId: string, propertyId: string): PropertyValue | undefined {
    const source = databaseId === this.dataId
      ? { rows: this.model.getOrderedRows() }
      : this.readDatabaseSource(databaseId);

    return source?.rows.find((r) => r.id === rowId)?.properties[propertyId];
  }

  /**
   * The mirroring property of a two-way relation, only while it still is
   * one: a relation on the target database that points back here. A mirror
   * deleted or changed to another type must never get relation writes.
   */
  private syncedMirror(property: PropertyDefinition): string | undefined {
    const settings = property.relation;
    const id = settings?.twoWay === true ? settings.syncedPropertyId : undefined;

    if (settings === undefined || id === undefined) return undefined;
    const schema = settings.targetDatabaseId === this.dataId ? this.model.getSchema() : this.readDatabaseSource(settings.targetDatabaseId)?.schema;
    const mirror = schema?.find((p) => p.id === id);

    return mirror?.type === 'relation' && mirror.relation?.targetDatabaseId === this.dataId && mirror.relation.syncedPropertyId === property.id
      ? id
      : undefined;
  }

  /**
   * A relation cell's new list. Writes the row's stored ids and, in one undo
   * step, the other side: the synced property of a two-way relation, or the
   * row that points here on a one-way self-relation.
   */
  private commitRelation(rowId: string, propertyId: string, input: PropertyValue): void {
    if (this.readOnly || this.destroyed) return;
    const property = this.model.getProperty(propertyId);
    const row = this.model.getRow(rowId);
    const settings = property?.relation;

    if (property === undefined || row === undefined || settings === undefined) return;
    const edit = relationEdit(
      relationIdsOf(row.properties[propertyId]), relationIdsOf(row.computed?.[propertyId] ?? row.properties[propertyId]), input, settings.limit,
    );

    if (edit === null) return;
    const { link, unlink, removed } = edit;
    const own = edit.own.map((id) => ({ id }));
    const target = settings.targetDatabaseId;
    const synced = this.syncedMirror(property);

    if (synced !== undefined && target !== this.dataId) {
      const allowed: unknown[] = [];

      this.api.blocks.getById(target)?.call('readRowWritePermission', {
        receive: (value: unknown): void => { allowed.push(value); },
      });
      if (allowed[0] !== true) return;
    }
    const write = (): void => {
      this.updateRowBlock(rowId, { [propertyId]: own });
      if (synced !== undefined) {
        link.forEach((id) => this.writeForeignRow(target, id, { [synced]: addRelatedIds(this.storedRelationOf(target, id, synced), rowId, null) }));
        unlink.forEach((id) => this.writeForeignRow(target, id, { [synced]: removeRelatedIds(this.storedRelationOf(target, id, synced), rowId) }));
      } else if (target === this.dataId) {
        // A one-way self-relation shows both ways: drop the pointer on the other row too.
        removed
          .filter((id) => relationIdsOf(this.model.getRow(id)?.properties[propertyId]).includes(rowId))
          .forEach((id) => this.writeRelatedRow({ rowId: id, changes: { [propertyId]: removeRelatedIds(this.model.getRow(id)?.properties[propertyId], rowId) } }));
      }
    };

    if (this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(write);
    } else {
      write();
    }
    this.sync.syncUpdateRow({ rowId, properties: { [propertyId]: own } });
    if (this.cardDrawer?.openRowId === rowId) {
      this.cardDrawer.syncOpenRow(this.rowOrTemplate(rowId));
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
      const synced = this.syncedMirror(property);

      if (synced !== undefined) {
        relationIdsOf(row.properties[property.id])
          .forEach((id) => this.writeForeignRow(settings.targetDatabaseId, id, {
            [synced]: removeRelatedIds(this.storedRelationOf(settings.targetDatabaseId, id, synced), rowId),
          }));
      }
      if (settings.targetDatabaseId === this.dataId) {
        this.model.getOrderedRows()
          .filter((other) => other.id !== rowId && relationIdsOf(other.properties[property.id]).includes(rowId))
          .forEach((other) => this.writeRelatedRow({ rowId: other.id, changes: { [property.id]: removeRelatedIds(other.properties[property.id], rowId) } }));
      }
    }
  }

  /** The Place cell's map levers: the host's, else Blok's own mini-map when the host gave a style. */
  private mapCellContext(): Pick<CellContext, 'renderPlace' | 'geocode' | 'currentLocation'> {
    const map = this.config.map;

    if (map === undefined) return {};
    const style = map.styleUrl;
    const ownMiniMap: CellContext['renderPlace'] = style === undefined
      ? undefined
      : (container, place) => drawMapLibrePlace(container, place, { style, i18n: this.api.i18n });
    const renderPlace = map.renderPlace?.bind(map) ?? ownMiniMap;

    return {
      ...(renderPlace !== undefined ? { renderPlace } : {}),
      ...(map.geocode !== undefined ? { geocode: map.geocode.bind(map) } : {}),
      ...(map.currentLocation !== undefined ? { currentLocation: map.currentLocation.bind(map) } : {}),
    };
  }

  /** What cells need from the host: people, the current user, file uploads. */
  private cellContext(): Partial<CellContext> {
    const uploader = this.api.uploader;
    const canUpload = !this.readOnly && uploader !== undefined && uploader.isConfigured('file', 'uploadByFile');
    const me = this.config.people?.me?.();

    return {
      openEditors: this.openCellEditors,
      valueProperty: (property) => this.computedValues.valueProperty(property),
      formulaProblem: (property, rowId) => this.computedValues.problem(rowId, property),
      relationTitle: (property, rowId) => this.relatedTitle(property, rowId),
      relationCandidates: (property) => this.relationCandidates(property),
      relationScope: (property) => this.relatedDatabaseName(property),
      openRelated: (property, rowId) => this.openRelated(property, rowId),
      ...this.mapCellContext(),
      ...(this.config.helpLinks !== undefined ? { helpLinks: this.config.helpLinks } : {}),
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

  /** Uploads a cover image through the host's image uploader, when it has one. */
  private coverUploader(): ((file: File) => Promise<string>) | undefined {
    const uploader = this.api.uploader;

    if (this.readOnly || uploader === undefined || !uploader.isConfigured('image', 'uploadByFile')) {
      return undefined;
    }

    return (file) => uploader.uploadByFile(file, { kind: 'image', tool: 'database' }).then((asset) => asset.url);
  }

  /** Whether the person property can be offered: the host gave a people directory. */
  private get hasPeople(): boolean {
    return this.config.people !== undefined;
  }

  /**
   * Saves a schema change. A linked view hands it to its source: its own
   * saved schema is only a stand-in, and the next read of the source would
   * overwrite the change.
   */
  private writeSchema(): void {
    if (this.source !== undefined) {
      this.api.blocks.getById(this.source.databaseId)?.call('adoptLinkedSchema', { schema: this.model.getSchema() });
    }
    this.block.dispatchChange();
  }

  /** Writes the schema and redraws. */
  private commitSchema(): void {
    this.writeSchema();
    this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    this.rerenderView({ keepDrawer: true });
  }

  /**
   * Adds a property, named after its type when `name` is empty. Status
   * starts with Notion's three options in its three groups. Returns null
   * when the type cannot be added (person without a people directory) or
   * the block is read-only.
   */
  addProperty(params: { name: string; type: PropertyType; afterId?: string; beforeId?: string }, context?: NativeWidgetContext): PropertyDefinition | null {
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
    // findings-listgallery L07: Notion's new status starts every new row at Not started, its first option.
    const notStarted = config?.options[0]?.id;
    // A relation starts as a self-relation; "Related to" then picks the database.
    const settings: PropertySettingsV2 = isStatus
      ? { status: { ...createDefaultStatusSettings(), ...(notStarted === undefined ? {} : { defaultOptionId: notStarted }) } }
      : {};

    if (params.type === 'relation') settings.relation = { targetDatabaseId: this.dataId };
    const prop = this.model.addProperty(name, params.type, config, { afterId: params.afterId, beforeId: params.beforeId }, settings);
    this.showInActiveView(prop, context, params.afterId, params.beforeId);
    this.writeEmptyLists(prop.id);
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

  /**
   * Places a property just added from the active view, or from a dashboard
   * widget's view, and makes sure it shows there. A legacy `visibleProperties`
   * view reads every unlisted property as hidden; a table or form shows it, as
   * it would in a view that never listed it. Other layouts keep hiding it.
   */
  private showInActiveView(prop: PropertyDefinition, context?: NativeWidgetContext, afterId?: string, beforeId?: string): void {
    // A widget's view lives on its owner; the schema is this database's.
    const owner = context?.owner ?? this;
    // The stored view, not context.view: that one carries personal overrides.
    const view = owner.model.getView(context?.viewId ?? this.activeViewId);

    if (view === undefined) return;
    const schema = this.model.getSchema();
    const placed = afterId !== undefined || beforeId !== undefined;
    const reveal = defaultVisible(view, prop) && resolveViewProperties(view, schema).find((p) => p.id === prop.id)?.visible !== true;

    if (!placed && !reveal) return;
    // The view's column order, not the schema's: a user may have dragged the columns.
    const order = resolveViewProperties(view, schema).map((p) => p.id).filter((id) => id !== prop.id);
    const before = beforeId ?? order[order.indexOf(afterId ?? '') + 1] ?? null;
    const ordered = placed ? withPropertyOrder(view, schema, prop.id, before) : view.properties;
    // Not placed means revealed, so `ordered` is only read when it was just written.
    const properties = reveal ? withPropertySetting({ ...view, properties: ordered }, schema, prop.id, { visible: true }) : ordered ?? [];

    owner.model.updateView(view.id, { properties });
    void owner.sync.syncUpdateView({ viewId: view.id, changes: { properties } });
    if (owner !== this) owner.block.dispatchChange();
  }

  /**
   * Writes `[]` for a list property (person, files, relation) on every row
   * with no value for it. Must run before the schema write: a peer that sees
   * the property first and adds to a row creates the key itself, and that
   * add races this birth last-writer-wins.
   */
  private writeEmptyLists(propertyId: string): void {
    const property = this.model.getProperty(propertyId);

    if (property === undefined || !isListValueType(property.type)) return;
    const missing = new Set(this.model.getOrderedRows()
      .filter((row) => row.properties[propertyId] === undefined || row.properties[propertyId] === null)
      .map((row) => row.id));

    for (const child of this.api.blocks.getChildren(this.dataId)) {
      if (!missing.has(child.id)) continue;
      child.call('updateProperties', { [propertyId]: [] });
      child.dispatchChange();
    }
    this.syncRowsFromBlocks();
  }

  renameProperty(propertyId: string, name: string): void {
    if (this.readOnly || this.destroyed || name.trim() === '' || this.model.getProperty(propertyId) === undefined) return;
    if (this.isPropertyNameTaken(propertyId, name.trim())) return;
    this.model.updateProperty(propertyId, { name: name.trim() });
    void this.sync.syncUpdateProperty({ propertyId, changes: { name: name.trim() } });
    this.commitSchema();
  }

  /** research/14 §3-§4: another property has exactly this name, as saved or as shown. */
  private isPropertyNameTaken(propertyId: string, name: string): boolean {
    const others = (schema: PropertyDefinition[]): boolean => schema.some((p) => p.id !== propertyId && p.name === name);

    return others(this.model.getSchema()) || others(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
  }

  /** Icon, description, page visibility, and the number, date, status and ID settings. */
  updatePropertySettings(propertyId: string, patch: Partial<PropertySettingsV2>): void {
    if (this.readOnly || this.destroyed || this.model.getProperty(propertyId) === undefined) return;
    this.model.updateProperty(propertyId, patch);
    void this.sync.syncUpdateProperty({ propertyId, changes: patch });
    this.commitSchema();
  }

  /**
   * The date picker's Date format, Time format and Time zone rows write the
   * property, as its property menu does. Undefined (no rows) wherever that
   * menu could not open: read-only, locked, a read-only widget. The view
   * redraws when the picker closes: a redraw now would take the picker's cell away.
   */
  private dateDisplayChanger(propertyId: string, context?: NativeWidgetContext): ((change: DateDisplayChange) => void) | undefined {
    const writable = (): boolean => !this.readOnly && !this.destroyed && !this.structureLocked() && (context === undefined || context.writable());

    if (!writable()) return undefined;

    return (change) => {
      const saved = this.model.getProperty(propertyId);

      if (!writable() || saved === undefined) return;
      const patch = { date: applyDateDisplayChange(saved.date ?? {}, change) };

      this.model.updateProperty(propertyId, patch);
      void this.sync.syncUpdateProperty({ propertyId, changes: patch });
      this.writeSchema();
      this.cardDrawer?.setSchema(localizeDatabaseSchema(this.model.getSchema(), this.api.i18n));
    };
  }

  /**
   * Changes a property's type and converts every row's value in the same
   * step (see planTypeChange). The title never changes type.
   */
  changePropertyType(propertyId: string, type: PropertyType): void {
    const property = this.model.getProperty(propertyId);

    if (this.readOnly || this.destroyed || property === undefined || (type === 'person' && !this.hasPeople)) return;
    const children = this.api.blocks.getChildren(this.dataId).filter((child) => child.name === 'database-row');
    const kept = new Map(children.map((child) => {
      const live: DatabaseRowData[] = [];

      child.call('readData', { receive: (data: DatabaseRowData) => live.push(data) });

      return [child.id, (live[0] ?? child.preservedData as DatabaseRowData | undefined)?.convertedValues] as const;
    }));
    const plan = planTypeChange(property, type, this.model.getOrderedRows().map((row) => ({ ...row, convertedValues: kept.get(row.id) })));

    if (plan === null) return;
    this.autofillDrafts.delete(propertyId);
    if (type === 'relation' && plan.property.relation === undefined) {
      plan.property.relation = { targetDatabaseId: this.dataId };
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
    // The adapter reads a key given as undefined as removed; an absent key means unchanged.
    const dropped = property.autofill !== undefined && plan.property.autofill === undefined ? { autofill: undefined } : {};

    void this.sync.syncUpdateProperty({ propertyId, changes: { ...changes, ...dropped } });
    this.commitSchema();
  }

  /** Copies a property and every row's value of it, right after the original. */
  duplicateProperty(propertyId: string, context?: NativeWidgetContext): PropertyDefinition | null {
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

    this.showInActiveView(copy, context);
    for (const row of this.model.getOrderedRows()) {
      const value = row.properties[propertyId];

      if (value !== undefined && value !== null) {
        this.updateRowBlock(row.id, { [copy.id]: structuredClone(value) });
        this.sync.syncUpdateRow({ rowId: row.id, properties: { [copy.id]: value } });
      }
    }
    this.writeEmptyLists(copy.id);
    void this.sync.syncCreateProperty({ ...settings, id: copy.id, name: copy.name, type, position: copy.position, ...(config !== undefined ? { config } : {}) });
    this.commitSchema();

    return copy;
  }

  /** Removes a property from the schema. Row values stay (D9). The title cannot be deleted. */
  deleteProperty(propertyId: string): void {
    const property = this.model.getProperty(propertyId);

    if (this.readOnly || this.destroyed || property === undefined || property.type === 'title') return;
    this.model.deleteProperty(propertyId);
    this.autofillDrafts.delete(propertyId);
    void this.sync.syncDeleteProperty({ propertyId });
    this.pruneAutofillWatch(propertyId);
    this.commitSchema();
  }

  /** "Only specific properties" forgets a deleted one; with none left the trigger is None, as in the setup. */
  private pruneAutofillWatch(propertyId: string): void {
    for (const other of this.model.getSchema()) {
      const watched = other.autofill?.onEditProperties;

      if (other.autofill === undefined || watched?.includes(propertyId) !== true) continue;
      const rest = watched.filter((id) => id !== propertyId);
      const { onEdit: _onEdit, onEditProperties: _watched, ...kept } = other.autofill;
      const autofill = rest.length > 0 ? { ...kept, onEdit: true, onEditProperties: rest } : kept;

      this.model.updateProperty(other.id, { autofill });
      void this.sync.syncUpdateProperty({ propertyId: other.id, changes: { autofill } });
    }
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
      .filter((block): block is BlockAPI => block !== undefined && block.name === 'database' && block.id !== this.dataId)
      .map((block) => {
        const title = (block.preservedData as Partial<DatabaseData> | undefined)?.title;

        return { id: block.id, title: typeof title === 'string' ? title : '' };
      });

    return [{ id: this.dataId, title: this.title }, ...others];
  }

  /** "Move to" targets: every other database of the document. A linked view shows another's rows, so it is none. */
  private moveTargets(): Array<{ id: string; title: string }> {
    return this.documentDatabases().filter((database) => database.id !== this.dataId && !this.isLinkedBlock(database.id));
  }

  /** Move row blocks whole so their page children stay attached. */
  moveRowTo(param: { rowId: string; databaseId: string }): void {
    const { rowId, databaseId } = param;

    if (this.readOnly || this.destroyed) return;
    if (this.source !== undefined) {
      this.api.blocks.getById(this.source.databaseId)?.call('moveRowTo', param);

      return;
    }
    const target = this.moveTargets().some((database) => database.id === databaseId) ? this.readDatabaseSource(databaseId) : undefined;

    if (this.model.getRow(rowId) === undefined || target === undefined) return;
    const schema = this.model.getSchema();
    const rows = this.model.getOrderedRows();
    const pair = this.model.subItemPair();
    const family = new Set([rowId, ...(pair === undefined ? [] : descendantsOf(rowId, rows, pair.forward))]);
    const targetPair = relationPair(target.schema, databaseId, 'parentItem', 'subItems');
    const children = this.api.blocks.getChildren(this.dataId);
    const positions = [target.rows.map((row) => row.position).sort(comparePositions).at(-1) ?? null];
    const moved = rows.filter((row) => family.has(row.id)).map((row) => {
      const properties = mapRowValues(row.properties, schema, target.schema);

      if (pair !== undefined && targetPair !== undefined) {
        properties[targetPair.forward] = relationIdsOf(row.properties[pair.forward]).filter((id) => family.has(id)).map((id) => ({ id }));
        properties[targetPair.backward] = relationIdsOf(row.properties[pair.backward]).filter((id) => family.has(id)).map((id) => ({ id }));
      }
      const position = DatabaseModel.positionBetween(positions.at(-1) ?? null, null);

      positions.push(position);
      return { row, block: children.find((child) => child.id === row.id), properties: withEmptyLists(target.schema, properties), position };
    });

    if (moved.some(({ block }) => block === undefined)) return;
    const inverseWrites: Array<{ databaseId: string; rowId: string; propertyId: string; movedId: string; add: boolean }> = [];

    moved.forEach(({ row, properties }) => {
      for (const property of schema) {
        const settings = property.relation;
        const mirror = this.syncedMirror(property);

        if (property.type !== 'relation' || settings === undefined || mirror === undefined || settings.targetDocumentId !== undefined || settings.targetDatabaseId === this.dataId) continue;
        relationIdsOf(row.properties[property.id]).forEach((id) => inverseWrites.push({
          databaseId: settings.targetDatabaseId, rowId: id, propertyId: mirror, movedId: row.id, add: false,
        }));
      }
      for (const property of target.schema) {
        const settings = property.relation;

        if (property.type !== 'relation' || settings?.twoWay !== true || settings.syncedPropertyId === undefined || settings.targetDocumentId !== undefined || settings.targetDatabaseId === databaseId) continue;
        const related = this.readDatabaseSource(settings.targetDatabaseId);
        const mirror = related?.schema.find((candidate) => candidate.id === settings.syncedPropertyId);

        if (mirror?.type !== 'relation' || mirror.relation?.targetDatabaseId !== databaseId || mirror.relation.syncedPropertyId !== property.id) continue;
        relationIdsOf(properties[property.id]).forEach((id) => inverseWrites.push({
          databaseId: settings.targetDatabaseId, rowId: id, propertyId: mirror.id, movedId: row.id, add: true,
        }));
      }
    });
    for (const owner of new Set([databaseId, ...inverseWrites.map((write) => write.databaseId)])) {
      const allowed: unknown[] = [];

      this.api.blocks.getById(owner)?.call('readRowWritePermission', {
        receive: (value: unknown): void => { allowed.push(value); },
      });
      if (allowed[0] !== true) return;
    }
    const move = (): void => {
      for (const write of inverseWrites) {
        const stored = this.storedRelationOf(write.databaseId, write.rowId, write.propertyId);
        const value = write.add ? addRelatedIds(stored, write.movedId, null) : removeRelatedIds(stored, write.movedId);

        this.writeForeignRow(write.databaseId, write.rowId, { [write.propertyId]: value });
      }
      for (const { row, block, properties, position } of moved) {
        if (block === undefined) continue;
        block.call('replaceProperties', { properties });
        block.call('updatePosition', { position });
        block.dispatchChange();
        this.api.blocks.moveTo(row.id, { parentId: databaseId, position: 'end' });
      }
    };
    const openRowId = this.cardDrawer?.openRowId;

    if (openRowId !== undefined && openRowId !== null && family.has(openRowId)) this.cardDrawer?.close();
    this.inOneStep(move);
    this.syncRowsFromBlocks();
    this.rerenderView({ keepDrawer: true });
    for (const { row } of moved) {
      void this.sync.syncDeleteRow({ rowId: row.id }, true);
      this.api.blocks.getById(databaseId)?.call('adoptMovedRow', { rowId: row.id });
    }
  }

  /**
   * A row another database moved here: pool its holder (core's move leaves it
   * in the old database's pool) and tell this database's backend it exists.
   */
  adoptMovedRow(param: { rowId: string }): void {
    const block = this.api.blocks.getChildren(this.dataId).find((child) => child.id === param.rowId);
    const data: DatabaseRowData[] = [];

    // mountRows leaves a holder that sits in another container's pool alone.
    if (block !== undefined && this.rowPool !== null && !this.linked && !this.rowPool.contains(block.holder)) {
      moveElementToEnd(this.rowPool, block.holder);
    }
    this.mountRows();

    block?.call('readData', { receive: (d: DatabaseRowData) => data.push(d) });
    if (this.readOnly || data[0] === undefined) return;
    void this.sync.syncCreateRow({ id: param.rowId, properties: data[0].properties, position: data[0].position });
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
      .flatMap((p) => (p.type === 'relation' && p.relation !== undefined && p.relation.targetDatabaseId !== this.dataId
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
        const trial = new ComputedProperties(this.dataId);
        const trialSchema = schema.map((p) => (p.id === propertyId ? draft(source) : p));
        const rows = trial.apply(trialSchema, this.model.getOrderedRows(), {
          databaseId: this.dataId,
          now: new Date(),
          resolveDatabase: (databaseId) => this.readDatabaseSource(databaseId),
          ...(this.people === undefined ? {} : { people: this.people }),
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
  setRelationTwoWay(propertyId: string, twoWay: boolean, context?: NativeWidgetContext, name?: string): void {
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
      const targetNames = (target === this.dataId ? this.model.getSchema() : this.readDatabaseSource(target)?.schema ?? []).map((p) => p.name);
      const reverseName = freePropertyName(targetNames, name ?? this.defaultMirrorName(property));
      const reverseRelation = { targetDatabaseId: this.dataId, twoWay: true, syncedPropertyId: propertyId };
      const reverseId = target === this.dataId
        ? this.addOwnRelation(reverseName, reverseRelation, context)
        : this.addForeignRelation(target, reverseName, reverseRelation);

      if (reverseId === null) return;
      this.model.updateProperty(propertyId, { relation: { ...settings, twoWay: true, syncedPropertyId: reverseId } });
      this.writeSchema();
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

  private defaultMirrorName(property: PropertyDefinition): string {
    return this.api.i18n.t('tools.database.relationReverseName', { name: this.title === '' ? property.name : this.title });
  }

  /** The two-way mirror's name, or the name a new mirror would get. */
  relationMirrorName(propertyId: string): string {
    const property = this.model.getProperty(propertyId);

    if (property === undefined) return '';
    const mirrorId = this.syncedMirror(property);
    const target = property.relation?.targetDatabaseId;
    const schema = target === this.dataId ? this.model.getSchema() : this.readDatabaseSource(target ?? '')?.schema;
    const mirror = mirrorId === undefined ? undefined : schema?.find((p) => p.id === mirrorId);

    return mirror?.name ?? this.defaultMirrorName(property);
  }

  /** Renames a two-way relation's mirror, here or in the related database. */
  renameRelationMirror(propertyId: string, name: string): void {
    const property = this.model.getProperty(propertyId);
    const mirrorId = property === undefined ? undefined : this.syncedMirror(property);
    const target = property?.relation?.targetDatabaseId;

    if (this.readOnly || mirrorId === undefined || target === undefined) return;
    if (target === this.dataId) {
      this.renameProperty(mirrorId, name);

      return;
    }
    this.api.blocks.getById(target)?.call('renameMirrorProperty', { propertyId: mirrorId, name });
  }

  /** Called by a database renaming its two-way relation's mirror, which lives here. */
  renameMirrorProperty(param: { propertyId: string; name: string }): void {
    this.renameProperty(param.propertyId, param.name);
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
    const closed = { done: false };

    // destroy() hides, and a hide emits Closed again: without the flag this re-queues itself forever.
    popover.on(PopoverEvent.Closed, () => {
      if (closed.done) return;
      closed.done = true;
      queueMicrotask(() => popover.destroy());
    });
    popover.show();
  }

  private addOwnRelation(name: string, relation: RelationSettings, context?: NativeWidgetContext): string {
    const prop = this.model.addProperty(name, 'relation', undefined, {}, { relation });

    this.showInActiveView(prop, context);
    this.writeEmptyLists(prop.id);
    void this.sync.syncCreateProperty({ id: prop.id, name: prop.name, type: prop.type, position: prop.position, relation });

    return prop.id;
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
    const schema = this.model.getSchema();

    // No view here is where the user acted: a legacy table shows it as a modern one would.
    for (const view of this.model.getViews()) {
      const revealed = revealedInLegacyView(view, schema, prop);

      if (revealed === view) continue;
      const changes = { properties: revealed.properties ?? [] };

      this.model.updateView(view.id, changes);
      void this.sync.syncUpdateView({ viewId: view.id, changes });
    }
    this.writeEmptyLists(prop.id);
    void this.sync.syncCreateProperty({ id: prop.id, name: prop.name, type: prop.type, position: prop.position, relation: param.relation });
    this.commitSchema();
    param.receive(prop.id);
  }

  private liveColumnHeader(propertyId: string, context?: NativeWidgetContext): HTMLElement | null {
    return (context?.root ?? this.boardContainer)?.querySelector<HTMLElement>(`[data-blok-database-table-column-header][data-property-id="${CSS.escape(propertyId)}"]`) ?? null;
  }

  /** `rowPage`: opened from a row page label, so the menu is the row page's own (no view rows). */
  openPropertyMenu(propertyId: string, anchor: HTMLElement, table?: DatabaseTableView, context?: NativeWidgetContext, onCustomizeLayout?: () => void, rowPage?: { onComment?: () => void; edit?: boolean }): void {
    const hostTable = table ?? (this.view instanceof DatabaseTableView ? this.view : undefined);
    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === propertyId);
    const saved = this.model.getProperty(propertyId);

    if (this.destroyed || this.readOnly || (context !== undefined && !context.writable()) || property === undefined || saved === undefined) return;
    // Locked: properties stay as they are, so only the view rows (filter, sort, ...) show.
    if (this.structureLocked()) {
      if (rowPage === undefined) hostTable?.openHeaderMenu(propertyId, anchor);

      return;
    }
    const previous = this.propertyMenu;

    this.propertyMenu = null;
    previous?.destroy();
    const writable = (): boolean => this.propertyMenu === menu
      && !this.destroyed && !this.readOnly && !this.structureLocked()
      && (context === undefined || context.writable());
    const parentWritable = (): boolean => writable() && menu.isOpen;
    const iconWritable = (): boolean => writable() && menu.isIconPickerOpen;
    const menu = new DatabasePropertyMenu({
      i18n: this.api.i18n,
      hasPeople: this.hasPeople,
      ...(onCustomizeLayout === undefined ? {} : { onCustomizeLayout }),
      ...(rowPage === undefined ? { liveAnchor: () => this.liveColumnHeader(propertyId, context) } : {}),
      onClose: () => {
        if (this.titleIconMenu?.menu === menu) this.titleIconMenu = null;
        if (this.propertyMenu !== menu || menu.isIconPickerOpen) return;
        this.propertyMenu = null;
        queueMicrotask(() => {
          if (this.propertyMenu === null && context?.current() === true) {
            context.redraw(() => this.propertyMenu === null && context.current());
          }
        });
      },
      onRename: (id, name) => { if (parentWritable()) this.renameProperty(id, name); },
      isNameTaken: (id, name) => this.isPropertyNameTaken(id, name),
      onUpdate: (id, patch) => { if (parentWritable()) this.updatePropertySettings(id, patch); },
      onIconUpdate: (id, patch) => { if (iconWritable()) this.updatePropertySettings(id, patch); },
      onChangeType: (id, type) => { if (parentWritable()) this.changePropertyType(id, type); },
      onDuplicate: (id) => { if (parentWritable()) this.duplicateProperty(id, context); },
      onDelete: (id) => { if (parentWritable()) this.deleteProperty(id); },
      onOptionsChange: (id, options) => {
        if (!parentWritable()) return;
        this.handleTableOptionsChange(id, options);
        this.rerenderView({ keepDrawer: true });
      },
      computed: {
        schema: () => this.model.getSchema(),
        databases: () => this.documentDatabases(),
        targetSchema: (databaseId) => (databaseId === this.dataId ? this.model.getSchema() : this.readDatabaseSource(databaseId)?.schema ?? []),
        onEditFormula: (id) => { if (parentWritable()) this.openFormulaEditor(id, anchor); },
        valueProperty: (p) => this.computedValues.valueProperty(p),
        targetValueProperty: (databaseId, p) => (databaseId === this.dataId ? this.computedValues.valueProperty(p) : this.readDatabaseSource(databaseId)?.valueProperty?.(p) ?? p),
        onSetTwoWay: (id, twoWay, name) => { if (parentWritable()) this.setRelationTwoWay(id, twoWay, context, name); },
        twoWayName: (id) => this.relationMirrorName(id),
        // writable, not parentWritable: a name typed before the menu closed is saved as it closes.
        onRenameMirror: (id, name) => { if (writable()) this.renameRelationMirror(id, name); },
        hasHostActions: this.config.buttons?.onAction !== undefined,
        hasNotify: this.config.buttons?.onNotify !== undefined,
        hasAgent: typeof this.api.config?.agent?.assistant?.model === 'function',
        databaseId: this.dataId,
        dataSources: () => [{ id: this.dataId, title: this.title }, ...this.moveTargets()],
        ...(this.config.people === undefined ? {} : { people: () => this.people ?? [] }),
        onEditButtonFilter: (id, actionId) => { if (parentWritable()) this.openButtonFilter(id, actionId, anchor); },
      },
      ...(this.config.ai?.autofill === undefined ? {} : {
        autofill: {
          hasDraft: (id: string) => this.autofillDrafts.has(id),
          open: (id: string) => { if (parentWritable()) this.openAutofillSetup(id, property.name, anchor, context); },
        },
      }),
    });

    this.propertyMenu = menu;
    this.propertyMenuAnchor = anchor;
    this.propertyMenuContext = rowPage === undefined ? context ?? null : null;
    context?.onDispose(() => {
      if (this.titleIconMenu?.menu === menu) this.titleIconMenu = null;
      if (this.propertyMenu === menu) this.propertyMenu = null;
      menu.destroy();
    });
    // The saved property, shown with its localized name: a settings patch the
    // menu builds from it must never carry a translated label into the data.
    if (rowPage !== undefined) {
      menu.openRowPage({ ...saved, name: property.name }, anchor, rowPage);

      return;
    }
    const viewItems = (hostTable?.headerItems(propertyId, anchor) ?? []).map((item): PopoverItemParams => {
      if (context === undefined || item.type !== PopoverItemType.Default || item.name !== 'database-show-page-icon'
        || 'children' in item || 'confirmation' in item) return item;

      return {
        ...item,
        isActive: () => showsPageIcon(context.view),
        onActivate: () => {
          if (!parentWritable()) return;
          const showPageIcon = showsPageIcon(context.view);

          this.titleIconMenu = { menu, context, showPageIcon };
          this.updateActiveView({ showPageIcon: !showPageIcon }, context);
        },
      };
    });

    menu.open({ ...saved, name: property.name }, anchor, viewItems, property);
  }

  private buttonFilter: DatabasePanel | null = null;

  /**
   * An "Edit pages in" step's filter, in the view's filter editor. Each edit
   * writes the button property. It is not tied to the menu: the menu closes as it opens.
   */
  private openButtonFilter(propertyId: string, actionId: string, anchor: HTMLElement): void {
    const current = () => {
      const actions = this.model.getProperty(propertyId)?.button?.buttonActions ?? [];
      const action = actions.find((a) => a.id === actionId);

      return action?.type === 'editPages' && action.target?.type === 'database' ? { actions, target: action.target } : undefined;
    };
    const found = current();

    if (found === undefined || this.destroyed || this.readOnly || this.structureLocked()) return;
    const databaseId = found.target.databaseId;
    const view = (): DatabaseViewConfig => {
      const target = current()?.target;

      return {
        id: `button-${actionId}`, name: '', type: 'table', position: 'a0', sorts: [], visibleProperties: [],
        filters: target?.filters ?? [],
        ...(target?.filterTree === undefined ? {} : { filterTree: target.filterTree }),
      };
    };
    const write: ViewSettingsContext['updatePersonal'] = (patch) => {
      const now = current();
      const button = this.model.getProperty(propertyId)?.button;

      if (now === undefined || button === undefined || this.destroyed || this.readOnly || this.structureLocked()) return;
      const { filters: _filters, filterTree: _tree, ...rest } = now.target;
      const filters = patch.filters ?? now.target.filters ?? [];
      const filterTree = 'filterTree' in patch ? patch.filterTree : now.target.filterTree;
      const target = { ...rest, ...(filters.length > 0 ? { filters } : {}), ...(filterTree === undefined ? {} : { filterTree }) };

      this.updatePropertySettings(propertyId, {
        button: { ...button, buttonActions: now.actions.map((a) => (a.id === actionId && a.type === 'editPages' ? { ...a, target } : a)) },
      });
    };
    const ctx: ViewSettingsContext = {
      i18n: this.api.i18n,
      view,
      schema: () => localizeDatabaseSchema(databaseId === this.dataId ? this.model.getValueSchema() : this.readDatabaseSource(databaseId)?.schema ?? [], this.api.i18n),
      locked: () => false,
      layouts: [],
      canDeleteView: () => false,
      updateView: () => undefined,
      updatePersonal: write,
      setLayout: () => undefined,
      setLocked: () => undefined,
      duplicateView: () => undefined,
      deleteView: () => undefined,
      copyViewLink: () => undefined,
      groups: () => [],
      people: () => this.people ?? [],
    };

    this.buttonFilter?.close();
    this.buttonFilter = openFilterList(anchor, ctx, 'database-button-filter');
  }

  /** The AI Autofill setup. It is not tied to the menu: the menu closes as it opens. */
  private openAutofillSetup(propertyId: string, name: string, anchor: HTMLElement, context?: NativeWidgetContext): void {
    const writable = (): boolean => !this.destroyed && !this.readOnly && !this.structureLocked()
      && (context === undefined || context.writable());

    if (!writable() || this.model.getProperty(propertyId) === undefined) return;
    this.autofillSetup?.close();
    const setup = openAutofillSetup({
      i18n: this.api.i18n,
      property: () => this.model.getProperty(propertyId),
      name,
      draft: this.autofillDrafts.get(propertyId),
      onDraft: (draft) => {
        if (draft === undefined) this.autofillDrafts.delete(propertyId);
        else this.autofillDrafts.set(propertyId, draft);
      },
      writable,
      hasRows: () => this.model.getOrderedRows().length > 0,
      triggerProperties: () => localizeDatabaseSchema(this.model.getSchema(), this.api.i18n)
        .filter((other) => other.id !== propertyId)
        .map((other) => ({ id: other.id, name: other.name })),
      onSave: (settings) => this.updatePropertySettings(propertyId, { autofill: settings }),
      onDelete: () => this.updatePropertySettings(propertyId, { autofill: undefined }),
      onGenerate: (settings) => this.runAutofill(propertyId, settings),
      onRunNow: () => this.runAutofill(propertyId),
      onClose: () => {
        if (this.autofillSetup === setup) this.autofillSetup = null;
      },
      directionSource: anchor,
    });

    this.autofillSetup = setup;
  }

  /** The table's AI Autofill run actions: none when read-only, locked or without `config.ai.autofill`. */
  private autofillLever(readOnly: boolean, context?: NativeWidgetContext): { autofill?: TableAutofill } {
    if (this.config.ai?.autofill === undefined || readOnly || this.structureLocked()) return {};
    const writable = (): boolean => !this.destroyed && !this.readOnly && !this.structureLocked()
      && (context === undefined || context.writable());

    return {
      autofill: {
        filling: (rowId, propertyId) => this.hostLevers.isFilling(rowId, propertyId),
        run: (rowId, propertyId) => {
          const property = this.model.getProperty(propertyId);

          if (writable() && property !== undefined) this.hostLevers.autofillCell(rowId, property);
        },
        open: (propertyId, anchor) => {
          const property = this.model.getProperty(propertyId);

          if (property !== undefined) this.openAutofillSetup(propertyId, localizeDatabaseSchema([property], this.api.i18n)[0]?.name ?? property.name, anchor, context);
        },
      },
    };
  }

  /**
   * Shows or drops a cell's "Thinking…" without a redraw, which would close an open editor.
   * Carries the stored value: the view's rows are its own copy, which a host write does not touch.
   */
  private repaintAutofillCell(rowId: string, propertyId: string): void {
    const detail = { propertyId, value: this.model.getRow(rowId)?.properties[propertyId] };

    document.querySelectorAll(`[data-blok-database-table-row][data-row-id="${CSS.escape(rowId)}"] [data-blok-database-table-cell][data-property-id="${CSS.escape(propertyId)}"]`)
      .forEach((cell) => cell.dispatchEvent(new CustomEvent('blok-database-table-repaint', { bubbles: true, detail })));
  }

  private runAutofill(propertyId: string, settings?: AutofillSettings): void {
    const property = this.model.getProperty(propertyId);

    if (property === undefined) return;
    this.hostLevers.autofillRows(property, this.model.getOrderedRows().map((row) => row.id), settings ?? property.autofill);
  }

  /**
   * Notion's "+" flow: a name field over the type list. With a placement
   * (Insert left/right), the new column lands beside that one in the active
   * view's column order.
   */
  openAddProperty(anchor: HTMLElement, placement?: { propertyId: string; side: 'left' | 'right' }, onAdded?: (created: PropertyDefinition, ownSetup: boolean) => HTMLElement | undefined | void, context?: NativeWidgetContext): void {
    if (this.destroyed || this.readOnly || this.structureLocked() || (context !== undefined && !context.writable())) return;
    const previous = this.addPropertyPopover;

    this.addPropertyPopover = null;
    previous?.destroy();
    const writable = (): boolean => this.addPropertyPopover === popover && popover.isOpen
      && !this.destroyed && !this.readOnly && !this.structureLocked()
      && (context === undefined || context.writable());
    const popover = new DatabasePropertyTypePopover({
      i18n: this.api.i18n,
      hasPeople: this.hasPeople,
      withNameField: true,
      // research/08: the table's "+" and Insert left/right get Notion's header grid; the row page passes onAdded and keeps the list.
      ...(onAdded === undefined ? { layout: 'grid' as const } : {}),
      // notion-spec-2 §19.11: the "+" puts the name box in the header cell. Insert left/right's is unmeasured.
      ...(onAdded === undefined && placement === undefined ? { nameOverAnchor: true } : {}),
      onSelect: (type, name) => {
        if (!writable()) return;
        const side = placement?.side === 'left' ? 'beforeId' : 'afterId';
        const created = this.addProperty({ name, type, ...(placement === undefined ? {} : { [side]: placement.propertyId }) }, context);

        if (created === null) return;
        // A host that redraws `anchor` away hands back where the follow-up setup goes.
        const setupAnchor = onAdded?.(created, created.type === 'relation') ?? anchor;

        // research/08: Relation opens "Related to" right away.
        if (created.type === 'relation') this.openRelatedToPicker(created.id, setupAnchor);
      },
      // research/12 §2: a preset makes a Text property and opens its setup at once, as a draft.
      ...(this.config.ai?.autofill === undefined ? {} : {
        onAutofill: (mode: 'summary' | 'translate', name: string) => {
          if (!writable()) return;
          const created = this.addProperty({ name, type: 'text' }, context);

          if (created === null) return;
          onAdded?.(created, true);
          this.autofillDrafts.set(created.id, { ...draftOf(undefined), ...presetDraft(mode, this.api.i18n) });
          this.openAutofillSetup(created.id, created.name, anchor, context);
        },
      }),
    });

    this.addPropertyPopover = popover;
    context?.onDispose(() => {
      if (this.addPropertyPopover === popover) this.addPropertyPopover = null;
      popover.destroy();
    });
    popover.open(anchor);
  }


  private rerenderView(options: { keepDrawer?: boolean } = {}): void {
    if (this.binding !== null) {
      this.binding.redraw();

      return;
    }
    if (this.boardContainer === null) {
      return;
    }
    if (this.formQuestionEdit && this.view instanceof DatabaseFormView && this.view.interacting) {
      this.redrawWhenIdle();

      return;
    }

    this.stopWaitingForIdle();

    // The old board wrapper is the first/only direct child of boardContainer
    const oldBoardWrapper = this.boardContainer.querySelector<HTMLElement>(':scope > [data-blok-database-dashboard]')
      ?? this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]')
      ?.closest<HTMLElement>('[data-blok-tool]')
      ?? this.boardContainer.querySelector<HTMLElement>('[data-blok-database-list]')
      ?? this.boardContainer.firstElementChild as HTMLElement | null;

    // The board and the table each scroll sideways in their own element.
    const scrollSelector = '[data-blok-database-board], [data-blok-database-table-scroller]';
    const oldBoardArea = this.boardContainer.querySelector<HTMLElement>(scrollSelector);
    const savedScrollLeft = oldBoardArea?.scrollLeft ?? 0;
    const formDraft = this.view instanceof DatabaseFormView ? this.view.captureDraft() : undefined;
    const titleDraft = this.view instanceof DatabaseBoardView ? this.view.captureTitleDraft() : null;

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

    if (formDraft !== undefined && this.view instanceof DatabaseFormView) {
      this.view.restoreDraft(formDraft);
    }

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
    // After the swap: the edit focuses its input, which must be in the page.
    if (titleDraft !== null && this.view instanceof DatabaseBoardView) {
      this.view.restoreTitleDraft(titleDraft);
    }

    // Rows arriving after boot, undo/peer reprojection and setReadOnly all
    // rerender through here.
    this.wireView(newBoardWrapper);
    this.controls.refresh();
    this.propertyMenu?.followLiveHeader();
  }
}
