import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { OutputData } from '../data-formats/output-data';
import { ToolboxConfig } from './tool-settings';

// ─── Property types ───

export type PropertyType =
  | 'title' | 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url' | 'richText'
  | PropertyTypeV2;

export interface SelectOption {
  id: string;
  label: string;
  color?: string;
  position: string;
  /** Status only: the id of the `StatusGroup` this option sits in. */
  groupId?: string;
}

export interface SelectPropertyConfig {
  options: SelectOption[];
}

export type PropertyConfig = SelectPropertyConfig;

export interface PropertyDefinition extends PropertySettingsV2 {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  config?: PropertyConfig;
  /** Read on the title property only: the whole database is locked. Data entry still works. */
  databaseLocked?: boolean;
}

export type PropertyValue = string | number | boolean | string[] | OutputData | PersonValue[] | FileValue[] | null;

// ─── Property system (Phase 2) ───
// Kept in one block so it merges cleanly beside view-level changes.

/**
 * Types added in Phase 2. The last five are read-only: their value is computed
 * from the row block, never stored in `properties`.
 */
export type PropertyTypeV2 =
  | 'status' | 'email' | 'phone' | 'person' | 'files'
  | 'createdTime' | 'lastEditedTime' | 'createdBy' | 'lastEditedBy' | 'uniqueId';

/** Number formats, named as in the Notion API (45). */
export type NumberFormat =
  | 'number' | 'number_with_commas' | 'percent'
  | 'dollar' | 'australian_dollar' | 'canadian_dollar' | 'singapore_dollar' | 'euro' | 'pound' | 'yen'
  | 'ruble' | 'rupee' | 'won' | 'yuan' | 'real' | 'lira' | 'rupiah' | 'franc' | 'hong_kong_dollar'
  | 'new_zealand_dollar' | 'krona' | 'norwegian_krone' | 'mexican_peso' | 'rand' | 'new_taiwan_dollar'
  | 'danish_krone' | 'zloty' | 'baht' | 'forint' | 'koruna' | 'shekel' | 'chilean_peso' | 'philippine_peso'
  | 'dirham' | 'colombian_peso' | 'riyal' | 'ringgit' | 'leu' | 'argentine_peso' | 'uruguayan_peso'
  | 'peruvian_sol' | 'vietnamese_dong' | 'pakistani_rupee' | 'nigerian_naira' | 'bitcoin';

export type NumberShowAs = 'number' | 'bar' | 'ring';

export interface NumberDisplay {
  format?: NumberFormat;
  /** Fraction digits, 0 to 10. Absent means the format's default. */
  decimals?: number;
  showAs?: NumberShowAs;
  /** Bar or ring color, an option color name. */
  color?: string;
  /** Bar or ring: the value that fills it. Default 100 (1 for percent). */
  divideBy?: number;
}

export type DateFormat = 'full' | 'short' | 'month_day_year' | 'day_month_year' | 'year_month_day' | 'relative';

export type TimeFormat = '12_hour' | '24_hour' | 'hidden';

export interface DateDisplay {
  dateFormat?: DateFormat;
  timeFormat?: TimeFormat;
  /** IANA zone used to show times. Absent means the viewer's zone. */
  timeZone?: string;
}

export type StatusGroupKind = 'todo' | 'inProgress' | 'complete';

/** A status group. The three defaults use their kind as the id, so peers agree on it. */
export interface StatusGroup {
  id: string;
  kind: StatusGroupKind;
  name: string;
  color?: string;
  position: string;
}

export interface StatusSettings {
  groups: StatusGroup[];
  showAs?: 'select' | 'checkbox';
}

export type PageVisibility = 'always' | 'hideWhenEmpty' | 'hidden';

/**
 * Settings beside `config` on a property. Never inside `config`: a v1.16.1
 * client replaces `config` whole when it edits an option.
 */
export interface PropertySettingsV2 {
  description?: string;
  /** An emoji, or an icon name from the icon picker. */
  icon?: string;
  /** How the row page shows this property. Default `always`. */
  pageVisibility?: PageVisibility;
  number?: NumberDisplay;
  /** Date, created time and last edited time. Per property, as Notion's property menu sets it. */
  date?: DateDisplay;
  status?: StatusSettings;
  uniqueId?: { prefix?: string };
}

/**
 * View fields this phase adds. Declared apart from the main interface so it
 * merges cleanly beside other view-level changes; TypeScript joins the two.
 */
export interface DatabaseViewConfig {
  /** Board grouped by a status property: one column per group or per option. Default `option`. */
  groupByStatus?: 'group' | 'option';
}

/** One person in a person value. An object, not a bare id, so two peers' adds merge. */
export interface PersonValue {
  id: string;
}

export interface FileValue {
  id: string;
  name: string;
  url: string;
}

/** A person a host lists for the person property. */
export interface DatabasePerson {
  id: string;
  name: string;
  avatarUrl?: string;
}

/** Host directory for the person property. Without it, Person is not offered. */
export interface DatabasePeople {
  list(): Promise<DatabasePerson[]>;
  /** The current user's id. */
  me?(): string;
}

/** Row block metadata the read-only properties show. */
export interface DatabaseRowMeta {
  createdAt?: number;
  createdBy?: string;
  lastEditedAt?: number;
  lastEditedBy?: string;
}

/**
 * A value a type change could not carry over, kept so the change can be undone
 * by hand. Keyed by property id on the row.
 */
export interface ConvertedValue {
  type: PropertyType;
  value: PropertyValue;
}

// ─── Rows ───

export interface DatabaseRow {
  id: string;
  position: string;
  properties: Record<string, PropertyValue>;
  pageId?: string;
  /** Row block metadata, for the read-only time and person properties. */
  meta?: DatabaseRowMeta;
}

export interface DatabaseRowData extends BlockToolData {
  properties: Record<string, PropertyValue>;
  position: string;
  /**
   * The row title, mirrored from `properties[<title property id>]`.
   *
   * Top-level, so concurrent typing merges per character instead of one peer's
   * whole burst winning. OPTIONAL and absent on rows written before it existed;
   * those keep reading the title out of `properties`, and are never rewritten
   * on load.
   */
  title?: string;
  pageId?: string;
  /** Values a type change could not carry over, by property id. */
  convertedValues?: Record<string, ConvertedValue>;
}

// ─── View config ───

export type ViewType = 'board' | 'table' | 'gallery' | 'list' | 'calendar' | 'timeline';

export interface SortConfig {
  /** Optional on old documents. Blok adds one on every write. */
  id?: string;
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface FilterConfig {
  /** Optional on old documents. Blok adds one on every write. */
  id?: string;
  propertyId: string;
  /**
   * Notion API operator names. Dates also take `past_week`, `past_month`,
   * `past_year`, `next_week`, `next_month`, `next_year`, `this_week` (no
   * value) and `relative_to_today` (value `past:3:day`, `next:2:week`, ...).
   */
  operator: string;
  /** A date filter also takes `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago` or `one_month_from_now`. */
  value: PropertyValue;
}

export type FilterConjunction = 'and' | 'or';

/** One condition in the advanced filter tree. */
export interface FilterRule {
  id: string;
  propertyId: string;
  operator: string;
  value: PropertyValue;
}

/** An AND/OR group in the advanced filter tree. A node is a group when it has `filterRules`. Up to three layers. */
export interface FilterGroup {
  id: string;
  conjunction: FilterConjunction;
  filterRules: FilterNode[];
}

export type FilterNode = FilterRule | FilterGroup;

export type GroupSort = 'manual' | 'ascending' | 'descending';

export type DateGroupBy = 'relative' | 'day' | 'week' | 'month' | 'year';

/** How a view groups its rows. Each field applies to the grouped property's type. */
export interface GroupSettings {
  sort?: GroupSort;
  dateBy?: DateGroupBy;
  /** 0 is Sunday, 1 is Monday. */
  weekStart?: 0 | 1;
  numberBy?: 'unique' | 'range';
  rangeStart?: number;
  rangeEnd?: number;
  rangeSize?: number;
  textBy?: 'exact' | 'alphabet';
  hideEmptyGroups?: boolean;
  /** Board only. Default true. */
  colorColumns?: boolean;
}

/** A conditional color rule: rows whose property matches it get the color. */
export interface ColorRule {
  id: string;
  propertyId: string;
  operator: string;
  value: PropertyValue;
  /** An option color name, such as `green`. */
  color: string;
  /** Table only. Default 'row'. */
  applyTo?: 'row' | 'property';
}

/** Footer calculation names, as in Notion's API. */
export type CalculationFn =
  | 'count' | 'count_values' | 'unique' | 'empty' | 'not_empty' | 'percent_empty' | 'percent_not_empty'
  | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range'
  | 'earliest_date' | 'latest_date' | 'date_range'
  | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked';

/** Rows an inline view shows before "Load more". */
export type LoadLimit = 10 | 25 | 50 | 100;

/** Where a row's page opens. */
export type OpenPagesIn = 'side' | 'center' | 'full';

/** Gallery or board card size. */
export type CardSize = 'small' | 'medium' | 'large';

/** What a gallery card shows above its title: nothing, the page cover, the page content, or a property (`property:<id>`). */
export type CardPreview = 'none' | 'cover' | 'content' | `property:${string}`;

/** How much time a calendar view shows at once. */
export type CalendarRange = 'month' | 'week';

/** How much time one screen of a timeline view shows. Notion API `zoom_level` names. */
export type TimelineZoom = 'hours' | 'day' | 'week' | 'bi_week' | 'month' | 'quarter' | 'year' | '5_years';

/** One property's settings in one view. The array order is the column order. */
export interface ViewPropertySetting {
  /** The property id. */
  id: string;
  visible?: boolean;
  /** Column width in pixels. */
  width?: number;
  wrap?: boolean;
}

/** A footer calculation on one column. */
export interface ViewCalculation {
  /** The property id. */
  id: string;
  fn: CalculationFn;
}

export interface DatabaseViewConfig {
  id: string;
  name: string;
  type: ViewType;
  position: string;
  groupBy?: string;
  sorts: SortConfig[];
  filters: FilterConfig[];
  /**
   * Visible non-title property ids, in order. Kept in step with `properties`
   * for readers that predate it.
   */
  visibleProperties: string[];
  /** Per-property visibility, order, width and wrap. Wins over `visibleProperties`. */
  properties?: ViewPropertySetting[];
  /** Wrap every cell. Default false. */
  wrapCells?: boolean;
  /** Columns, from the start, that stay put on horizontal scroll. Default 0. */
  frozenColumnCount?: number;
  /** Default true. */
  showVerticalLines?: boolean;
  loadLimit?: LoadLimit;
  calculations?: ViewCalculation[];
  /** Default 'side', or 'center' for a gallery or a calendar. */
  openPagesIn?: OpenPagesIn;
  /** Gallery or board. Default 'medium'. */
  cardSize?: CardSize;
  /** Gallery or board. Default 'content' on a gallery, 'none' on a board. */
  cardPreview?: CardPreview;
  /** Gallery or board: show the whole image instead of cropping it. Default false. */
  fitImage?: boolean;
  /** Calendar: the date property that places each row. Default the first date property. */
  calendarBy?: string;
  /** Calendar. Default 'month'. */
  calendarRange?: CalendarRange;
  /** Calendar. Default true. */
  showWeekends?: boolean;
  /** Timeline: the date property that places each bar. Default the first date property. */
  timelineBy?: string;
  /** Timeline: a second date property that ends each bar. Absent means `timelineBy` holds the range. */
  timelineEndBy?: string;
  /** Timeline. Default 'month'. */
  timelineZoom?: TimelineZoom;
  /** Timeline: show the table panel beside the bars. Default false. */
  showTimelineTable?: boolean;
  /** Timeline: the table panel's columns, apart from the bar properties. Array order is column order. */
  tableProperties?: ViewPropertySetting[];
  /** Timeline: the self-relation that draws dependency arrows. */
  arrowsBy?: string;
  /** Where the no-value group sits among the option groups. Absent means last. */
  noValueGroupPosition?: string;
  /** Groups this view hides, by option id. */
  hiddenGroups?: GroupRef[];
  /** Groups this view shows collapsed, by option id. */
  collapsedGroups?: GroupRef[];
  /** Hides the row count beside each group's name. */
  hideGroupAggregation?: boolean;
  /**
   * The advanced filter. Rows must match it AND every entry of `filters`.
   * Clients older than this field ignore it and show more rows.
   */
  filterTree?: FilterGroup;
  groupSettings?: GroupSettings;
  /** Board only: a second grouping inside each column. Its group keys in `hiddenGroups` / `collapsedGroups` start with `sub:`. */
  subGroupBy?: string;
  subGroupSettings?: GroupSettings;
  colorRules?: ColorRule[];
  /** Default true. */
  showPageIcon?: boolean;
}

/** An entry in a per-view group list. */
export interface GroupRef {
  id: string;
}

/** View fields a caller may set when creating or changing a view. */
export type DatabaseViewSettingKey =
  | 'properties' | 'wrapCells' | 'frozenColumnCount' | 'showVerticalLines' | 'loadLimit' | 'calculations' | 'openPagesIn'
  | 'noValueGroupPosition' | 'hiddenGroups' | 'collapsedGroups' | 'hideGroupAggregation'
  | 'filterTree' | 'groupSettings' | 'subGroupBy' | 'subGroupSettings' | 'colorRules' | 'showPageIcon' | 'groupByStatus'
  | 'cardSize' | 'cardPreview' | 'fitImage' | 'calendarBy' | 'calendarRange' | 'showWeekends'
  | 'timelineBy' | 'timelineEndBy' | 'timelineZoom' | 'showTimelineTable' | 'tableProperties' | 'arrowsBy';

// ─── Top-level saved data ───

/**
 * Data saved by the database block.
 * Schema and views only — rows are child blocks (database-row type).
 */
export interface DatabaseData extends BlockToolData {
  title?: string;
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
}

// ─── Adapter ───

export interface DatabaseAdapter {
  loadDatabase(): Promise<{
    schema: PropertyDefinition[];
    views: DatabaseViewConfig[];
  }>;

  createRow(params: {
    id: string;
    properties: Record<string, PropertyValue>;
    position: string;
  }): Promise<DatabaseRow>;

  updateRow(params: {
    rowId: string;
    properties: Record<string, PropertyValue>;
  }): Promise<DatabaseRow>;

  moveRow(params: {
    rowId: string;
    position: string;
  }): Promise<DatabaseRow>;

  deleteRow(params: {
    rowId: string;
  }): Promise<void>;

  createProperty(params: {
    id: string;
    name: string;
    type: PropertyType;
    position: string;
    config?: PropertyConfig;
  } & PropertySettingsV2): Promise<PropertyDefinition>;

  updateProperty(params: {
    propertyId: string;
    /** A settings key given as undefined was removed. `type` comes with a type change. */
    changes: Partial<Pick<PropertyDefinition, 'name' | 'config' | 'type'>> & Partial<PropertySettingsV2>;
  }): Promise<PropertyDefinition>;

  deleteProperty(params: {
    propertyId: string;
  }): Promise<void>;

  createView(params: {
    id: string;
    name: string;
    type: ViewType;
    position: string;
    groupBy?: string;
    sorts?: SortConfig[];
    filters?: FilterConfig[];
    visibleProperties?: string[];
  } & Partial<Pick<DatabaseViewConfig, DatabaseViewSettingKey>>): Promise<DatabaseViewConfig>;

  updateView(params: {
    viewId: string;
    changes: Partial<Pick<DatabaseViewConfig,
      'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties' | DatabaseViewSettingKey
    >>;
  }): Promise<DatabaseViewConfig>;

  deleteView(params: {
    viewId: string;
  }): Promise<void>;
}

export interface DatabaseRowPageReceipt {
  pageId: string;
  transactionId: string;
  acceptedBody: OutputData;
}

export interface DatabaseRowPages {
  /** The row's page, or null when the row was never moved. */
  lookup(input: { rowId: string }): Promise<{ pageId: string; acceptedBody: OutputData } | null>;
  copyFromLegacy(input: { rowId: string; operationId: string; body: OutputData }): Promise<DatabaseRowPageReceipt>;
  /** Merge a legacy body an old client changed after the copy into the page, keeping both. */
  reconcileLegacy(input: {
    rowId: string;
    pageId: string;
    operationId: string;
    body: OutputData;
    acceptedBody: OutputData;
  }): Promise<DatabaseRowPageReceipt>;
  mount(pageId: string, holder: HTMLElement): { destroy(): void };
}

/** View fields a person can change for themselves before "Save for everyone". */
export type PersonalViewPatch = Partial<Pick<DatabaseViewConfig, 'filters' | 'sorts' | 'filterTree'>>;

/**
 * Where a person's unsaved filter and sort edits live. Without it, Blok keeps
 * them in this browser, per document. An empty patch means no edits.
 */
export interface DatabaseViewStateStore {
  get(viewId: string): Promise<Partial<DatabaseViewConfig> | null>;
  set(viewId: string, patch: Partial<DatabaseViewConfig>): Promise<void>;
}

export interface DatabaseConfig {
  adapter?: DatabaseAdapter;
  rowPages?: DatabaseRowPages;
  /** Directory for the person property. */
  people?: DatabasePeople;
  /** Per-person unsaved filter and sort edits. Default: this browser, per document. */
  viewState?: DatabaseViewStateStore;
  /** First day of the calendar week, 0 = Sunday … 6 = Saturday. Defaults to the locale's. */
  weekStart?: number;
}

/**
 * Database Tool constructor options
 */
export type DatabaseConstructorOptions = BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;

/**
 * Database Tool for the Blok Editor
 * Notion-style database block: schema + views stored in its data, rows as
 * child `database-row` blocks.
 */
export declare class Database implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /**
   * Plain-text and URL fields, declared PLAINTEXT so load and save never parse them as HTML
   */
  static sanitize?: SanitizerConfig;

  constructor(options: DatabaseConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLDivElement;

  /**
   * Called after the block is added to the page
   */
  rendered(): void;

  /**
   * Extract Tool's data from the view
   */
  save(blockContent: HTMLElement): DatabaseData;

  /**
   * Validate Database block data
   */
  validate(savedData: DatabaseData): boolean;

  /**
   * Clean up subscriptions and view renderers
   */
  destroy(): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Apply data from the document (undo, redo or a collaborator) in place.
   * Returns false when the block must be rendered again instead.
   */
  setData(data: DatabaseData): boolean;

  /**
   * Add a new view of the given type
   */
  addView(type: ViewType): void;

  /**
   * Rename a view
   */
  renameView(viewId: string, name: string): void;

  /**
   * Duplicate a view
   */
  duplicateView(viewId: string): void;

  /**
   * Delete a view
   */
  deleteView(viewId: string): void;

  /**
   * Move a view to a new position
   */
  reorderView(viewId: string, newPosition: string): void;
}
