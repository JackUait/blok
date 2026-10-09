import type { BlockToolData, OutputData } from '../../../types';

// ─── Property types ───

export type PropertyType =
  | 'title' | 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url' | 'richText'
  | PropertyTypeV2
  | ComputedPropertyType;

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
  /**
   * Read on the title property only: the whole database is locked. Lives
   * here, not at the top level or in `config`, because v1.16.1 clients drop
   * those on save but keep unknown fields on property objects.
   */
  databaseLocked?: boolean;
}

export type PropertyValue = string | number | boolean | string[] | OutputData | PersonValue[] | FileValue[] | RelationValue[] | null;

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
  formula?: FormulaSettings;
  relation?: RelationSettings;
  rollup?: RollupSettings;
}

// ─── Computed properties (Phase 6) ───

/** Relation stores row ids; formula and rollup are computed and never stored in `properties`. */
export type ComputedPropertyType = 'relation' | 'rollup' | 'formula';

export interface FormulaSettings {
  /** The stored form: `prop("Name")` is saved as `{{property:<id>}}`, so a rename keeps working. */
  expression: string;
}

export interface RelationSettings {
  /** The related database block, in this document. The database's own id makes a self-relation. */
  targetDatabaseId: string;
  /**
   * A database in another document. Blok cannot read it; the host's
   * `config.relations.resolve` lever shows its rows.
   */
  targetDocumentId?: string;
  /** `1` keeps one related row. Absent or null means no limit. */
  limit?: 1 | null;
  /** Two-way: the target database has a property that mirrors this one. */
  twoWay?: boolean;
  /** Two-way: the id of the mirroring property on the target database. */
  syncedPropertyId?: string;
}

/** Notion API rollup function names (24). */
export type RollupFunction =
  | 'show_original' | 'show_unique'
  | 'count' | 'count_values' | 'unique' | 'empty' | 'not_empty' | 'percent_empty' | 'percent_not_empty'
  | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range'
  | 'earliest_date' | 'latest_date' | 'date_range'
  | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked'
  | 'count_per_group' | 'percent_per_group';

export interface RollupSettings {
  /** A relation property of this database. */
  relationPropertyId: string;
  /** A property of the related database. */
  targetPropertyId: string;
  function: RollupFunction;
}

/** One related row. An object, not a bare id, so two peers' adds merge. */
export interface RelationValue {
  id: string;
}

/** A row of a database in another document, as the host resolves it. */
export interface ResolvedRelationRow {
  id: string;
  title: string;
}

/** Host lever for relations to a database in another document. */
export interface DatabaseRelations {
  resolve(input: { documentId: string; databaseId: string; rowIds: string[] }): Promise<ResolvedRelationRow[]>;
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
  /**
   * Formula and rollup values, by property id, in the stored shape of their
   * result type. In memory only: never written to the row block.
   */
  computed?: Record<string, PropertyValue>;
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
  /** Optional on old documents. Every write adds one, so two peers' sorts pair by id. */
  id?: string;
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface FilterConfig {
  /** Optional on old documents. Every write adds one, so two peers' filters pair by id. */
  id?: string;
  propertyId: string;
  operator: string;
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

/**
 * An AND/OR group in the advanced filter tree. A node is a group when it has
 * `filterRules`. The key name is unique on purpose: the CRDT births every
 * `filterRules` list as an array, so two peers adding the first rule keep both.
 */
export interface FilterGroup {
  id: string;
  conjunction: FilterConjunction;
  filterRules: FilterNode[];
}

export type FilterNode = FilterRule | FilterGroup;

/** Group order. Notion's API names: manual, ascending, descending. */
export type GroupSort = 'manual' | 'ascending' | 'descending';

export type DateGroupBy = 'relative' | 'day' | 'week' | 'month' | 'year';

/** How a view groups its rows, per the grouped property's type. Every field is optional. */
export interface GroupSettings {
  sort?: GroupSort;
  /** Date grouping. Default `relative`. */
  dateBy?: DateGroupBy;
  /** 0 is Sunday, 1 is Monday. Default 0. */
  weekStart?: 0 | 1;
  /** Number grouping. Default `unique`. */
  numberBy?: 'unique' | 'range';
  rangeStart?: number;
  rangeEnd?: number;
  rangeSize?: number;
  /** Text grouping: the whole value, or its first letter. Default `exact`. */
  textBy?: 'exact' | 'alphabet';
  hideEmptyGroups?: boolean;
  /** Board only: tint each column with its option color. Default on. */
  colorColumns?: boolean;
}

/** A conditional color rule. The rule tints rows whose property matches it. */
export interface ColorRule {
  id: string;
  propertyId: string;
  operator: string;
  value: PropertyValue;
  /** An option color name, such as `green`. */
  color: string;
  /** Table only. Default `row`. */
  applyTo?: 'row' | 'property';
}

/** Notion API aggregator names. */
export type CalculationFn =
  | 'count' | 'count_values' | 'unique' | 'empty' | 'not_empty' | 'percent_empty' | 'percent_not_empty'
  | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range'
  | 'earliest_date' | 'latest_date' | 'date_range'
  | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked';

export type LoadLimit = 10 | 25 | 50 | 100;

export type OpenPagesIn = 'side' | 'center' | 'full';

export type CardSize = 'small' | 'medium' | 'large';

/**
 * What a gallery card shows above its title. One string, not an object, so
 * two peers picking at once settle on one pick: the CRDT merges objects key
 * by key.
 */
export type CardPreview = 'none' | 'cover' | 'content' | `property:${string}`;

export type CalendarRange = 'month' | 'week';

/** Notion API `zoom_level` names. */
export type TimelineZoom = 'hours' | 'day' | 'week' | 'bi_week' | 'month' | 'quarter' | 'year' | '5_years';

/**
 * One property's settings in one view. The array order is the column order.
 * `id` is the property id: the CRDT pairs entries by it, so a peer's width
 * change on another column merges instead of overwriting.
 */
export interface ViewPropertySetting {
  id: string;
  visible?: boolean;
  /** Pixels. */
  width?: number;
  wrap?: boolean;
}

/** A footer calculation. `id` is the property id. */
export interface ViewCalculation {
  id: string;
  fn: CalculationFn;
}

/**
 * Every field after `visibleProperties` is optional. Read them through
 * `view-settings.ts`, which holds the defaults and the legacy migration.
 */
export interface DatabaseViewConfig {
  id: string;
  name: string;
  type: ViewType;
  position: string;
  groupBy?: string;
  sorts: SortConfig[];
  filters: FilterConfig[];
  /**
   * Visible non-title property ids, in order. Still written beside
   * `properties` because v1.16.1 clients read only this.
   */
  visibleProperties: string[];
  properties?: ViewPropertySetting[];
  wrapCells?: boolean;
  /** How many columns, from the start, stay put on horizontal scroll. */
  frozenColumnCount?: number;
  showVerticalLines?: boolean;
  loadLimit?: LoadLimit;
  calculations?: ViewCalculation[];
  openPagesIn?: OpenPagesIn;
  /** Gallery or board. */
  cardSize?: CardSize;
  cardPreview?: CardPreview;
  /** Gallery or board: show the whole image instead of cropping it to the card. */
  fitImage?: boolean;
  /** Calendar: the date property that places each row. */
  calendarBy?: string;
  calendarRange?: CalendarRange;
  showWeekends?: boolean;
  /** Timeline: the date property that places each bar. */
  timelineBy?: string;
  /** Timeline: a second date property that ends each bar. Absent means `timelineBy` holds the range. */
  timelineEndBy?: string;
  timelineZoom?: TimelineZoom;
  /** Timeline: show the table panel beside the bars. */
  showTimelineTable?: boolean;
  /** Timeline: the table panel's own columns, apart from the bar properties. */
  tableProperties?: ViewPropertySetting[];
  /** Timeline: the self-relation that draws dependency arrows. Nothing draws them yet. */
  arrowsBy?: string;
  /** Where the no-value group sits among the option groups. Absent means last. */
  noValueGroupPosition?: string;
  /** Groups this view hides, by option id (the no-value group uses its own key). */
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
  /**
   * Board only: a second grouping inside each column. Its hidden and
   * collapsed groups go in `hiddenGroups` / `collapsedGroups` with a `sub:` key.
   */
  subGroupBy?: string;
  subGroupSettings?: GroupSettings;
  colorRules?: ColorRule[];
  /** Default on. */
  showPageIcon?: boolean;
}

/** An entry in a per-view group list. Objects with ids, so two peers' entries merge. */
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

// ─── View data (kanban board) ───

export interface KanbanColumnData {
  id: string;
  title: string;
  color?: string;
  position: string;
}

export interface KanbanCardData {
  id: string;
  title: string;
  columnId: string;
  position: string;
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
 * them in this browser, per document, through `api.viewState`. An empty patch
 * means the person has no edits.
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
  viewState?: DatabaseViewStateStore;
  /** First day of the calendar week, 0 = Sunday … 6 = Saturday. Defaults to the locale's. */
  weekStart?: number;
  /** Rows of related databases in other documents. Without it, those relations show ids only. */
  relations?: DatabaseRelations;
}
