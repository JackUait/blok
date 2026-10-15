import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { OutputData } from '../data-formats/output-data';
import { ToolboxConfig } from './tool-settings';

// ─── Property types ───

export type PropertyType =
  | 'title' | 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url' | 'richText'
  | PropertyTypeV2
  | ComputedPropertyType
  | 'button'
  | Tier3PropertyType;

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

export interface PropertyDefinition extends PropertySettingsV2, PageLayoutFields {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  config?: PropertyConfig;
  /** Read on the title property only: the whole database is locked. Data entry still works. */
  databaseLocked?: boolean;
  /** Read on the title property only: the template new rows start from. */
  defaultTemplateId?: string;
}

// ─── Page layout ───

/**
 * Where a property sits on a row page. `page` and `panel` give it a module of its own.
 * `group` keeps it in the property group, ahead of the properties with no entry.
 */
export type PageLayoutPlace = 'heading' | 'page' | 'panel' | 'section' | 'group';

/** One property's place on the row page. `id` is the property id. */
export interface PageLayoutPlacement {
  id: string;
  place: PageLayoutPlace;
  /** With `place: 'section'`: the `PageLayoutSection` it sits in. */
  sectionId?: string;
}

/** A named section of the property group. */
export interface PageLayoutSection {
  id: string;
  name: string;
}

/**
 * Read on the title property only: the row page layout, shared by every row.
 */
export interface PageLayoutFields {
  /** `tabbed` puts a tab bar under the heading. Default `simple`. */
  pageLayoutStructure?: 'simple' | 'tabbed';
  /** Where the property group sits. Default `page`. */
  pageLayoutGroupIn?: 'page' | 'panel';
  /** `false` hides the icon beside each property label. Default shown. */
  pageLayoutPropertyIcons?: false;
  /** `false` hides the property labels in the heading. Default shown. */
  pageLayoutPropertyLabels?: false;
  /** `false` hides the database templates on an empty row page. Default shown. */
  pageLayoutTemplates?: false;
  /** `true` lays every row page out full width. Default off. */
  pageLayoutFullWidth?: true;
  /** The `tabs` child of this database that holds the row page's view tabs. Kept while `simple`. */
  pageLayoutTabsId?: string;
  /** A property with no entry sits in the property group. */
  pageLayoutPlacements?: PageLayoutPlacement[];
  pageLayoutSections?: PageLayoutSection[];
}

export type PropertyValue = string | number | boolean | string[] | OutputData | PersonValue[] | FileValue[] | RelationValue[] | PlaceValue | VerificationValue | null;

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
  /** Button property: its label and its actions. */
  button?: ButtonSettings;
  /** Read on the "Blocked by" relation only: how a date change moves the items it blocks. */
  dependency?: DependencySettings;
  person?: PersonSettings;
}

// ─── Structure (Phase 6): sub-items, dependencies, templates, buttons ───

/**
 * What a self-relation stands for. Sub-items and dependencies are each a
 * two-way self-relation pair; this marks which side is which.
 */
export type RelationRole = 'parentItem' | 'subItems' | 'blockedBy' | 'blocking';

/** Notion's date shifting options for dependencies. */
export type DependencyShift = 'overlap' | 'maintain' | 'none';

export interface DependencySettings {
  /** Default `none`. */
  shift?: DependencyShift;
  /** A shifted item never starts or ends on a Saturday or Sunday. */
  avoidWeekends?: boolean;
}

/** A row's value set by a button or a template. `@me` and `@today` are filled in when used. */
export type DynamicValue = '@me' | '@today' | '@now';

export interface ButtonEditPropertyAction {
  id: string;
  type: 'editProperty';
  propertyId: string;
  /** The new value. A person value `[{ id: '@me' }]` or a date `'@today'` is filled in on click. */
  value: PropertyValue;
}

/** One block a button inserts. Has an id so two peers' list edits merge. */
export interface ButtonBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface ButtonInsertBlocksAction {
  id: string;
  type: 'insertBlocks';
  /** Inserted at the end of the row's page body. */
  blocks: ButtonBlock[];
}

export interface ButtonOpenPageAction {
  id: string;
  type: 'openPage';
  /** A URL. Absent means the row's own page. */
  url?: string;
}

/** Runs the host's `config.buttons.onAction` (automations, webhooks). */
export interface ButtonCallbackAction {
  id: string;
  type: 'callback';
  /** What the host should do, named by the person who made the button. */
  name?: string;
}

export type ButtonAction = ButtonEditPropertyAction | ButtonInsertBlocksAction | ButtonOpenPageAction | ButtonCallbackAction;

export interface ButtonSettings {
  label?: string;
  /** Run in order on a click, as one undo step. The key name is unique so the CRDT births it as a list. */
  buttonActions?: ButtonAction[];
}

/** Host lever for a button's `callback` action. */
export interface DatabaseButtons {
  onAction?(input: { databaseId: string; rowId: string; propertyId: string; action: ButtonCallbackAction }): void | Promise<void>;
}

export type TemplateRepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** When a repeating template makes a row. Blok only stores it; the host schedules. */
export interface TemplateRepeat {
  frequency: TemplateRepeatFrequency;
  /** Every n days, weeks, months or years. Default 1. */
  interval?: number;
  /** ISO date-time of the first run. */
  start: string;
  /** IANA zone whose wall clock the runs keep across DST. Absent: runs are counted in UTC. */
  timeZone?: string;
  /** ISO date-time the host last made a row from it. */
  lastRunAt?: string;
}

/** Host lever for repeating templates. Blok has no scheduler. */
export interface DatabaseTemplates {
  /**
   * Called when a repeating template is due, on each client that renders the
   * database. `createRow` makes the row and stamps `lastRunAt`; the host
   * decides which client calls it.
   */
  onRepeatDue?(input: { databaseId: string; templateId: string; dueAt: string; createRow: () => string | null }): void;
}

/** A linked database shows another database's rows and schema. */
export interface DatabaseSourceRef {
  /** The source database block. */
  databaseId: string;
  /** A database in another document. Blok cannot read it; the host's `config.linkedSources` lever does. */
  documentId?: string;
}

/** Host lever for a linked database whose source is in another document. */
export interface DatabaseLinkedSources {
  resolve(input: { documentId: string; databaseId: string }): Promise<{ schema: PropertyDefinition[]; rows: DatabaseRow[] } | null>;
}

/** A page in another document that mentions a row. */
export interface DatabaseBacklink {
  /** The page holding the mention. */
  pageId: string;
  title?: string;
  /** Titles of the pages above it, top first. Shown in grey after the title. */
  path?: string[];
  /** The block holding the mention. */
  blockId?: string;
}

/**
 * Host lever for row backlinks. Blok finds mentions of a row in this document
 * itself; this adds the ones in other documents. Without it, backlinks count
 * this document only.
 */
export interface DatabaseBacklinks {
  /** Pages in other documents that mention the row. `pageId` is the row's page, when it has one. Asked when the row's page opens. */
  list(input: { databaseId: string; rowId: string; pageId?: string }): Promise<DatabaseBacklink[]>;
  /** Opens a page from the list at its mention. */
  open(backlink: DatabaseBacklink): void;
}

// ─── Computed properties (Phase 6) ───

/** Relation stores row ids; formula and rollup are computed and never stored in `properties`. */
export type ComputedPropertyType = 'relation' | 'rollup' | 'formula';

export interface FormulaSettings {
  /** The stored form: `prop("Name")` is saved as `{{property:<id>}}`, so a rename keeps working. */
  expression: string;
}

/**
 * Person property settings from Notion's "Edit property" panel. Absent keys
 * keep Notion's defaults: no limit, no default, "Users only".
 */
export interface PersonSettings {
  /** `1` keeps one person. Absent or null means no limit. */
  limit?: 1 | null;
  /** `createdBy`: a new row starts with the user who adds it, when the people lever knows one. */
  default?: 'createdBy';
  /** Who gets told when they are added. Blok sends nothing: it only stores this for the host. Absent means users only. */
  notifications?: 'usersAndGroups' | 'none';
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
  /** A self-relation that drives sub-items or dependencies. */
  role?: RelationRole;
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
  /** The page icon, an emoji. */
  icon?: string;
  /** The page cover, an image URL. */
  cover?: string;
  /** The page's own Full width. Absent: the database's page layout decides. Only a full page widens. */
  fullWidth?: boolean;
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
  /**
   * The page body is the row's child blocks. Set when a legacy body (an
   * OutputData blob in a richText property) was turned into child blocks.
   */
  bodyBlocks?: boolean;
  /**
   * The page icon, an emoji. A plain leaf, so two people picking at once
   * converge on one pick instead of a mix of both.
   */
  icon?: string;
  /** The page cover, an image URL. A plain leaf, like the icon. */
  cover?: string;
  /** The page's own Full width, overriding the layout's. Absent: the layout decides. */
  fullWidth?: boolean;
  /** A page template, not a row. Every view, query and export skips it. */
  template?: boolean;
  /** Templates only: the schedule of a repeating template. */
  repeat?: TemplateRepeat;
}

// ─── View config ───

export type ViewType = 'board' | 'table' | 'gallery' | 'list' | 'calendar' | 'timeline' | 'chart' | 'feed' | Tier3ViewType;

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

/** Chart type (Notion API `chart_type`). */
export type ChartType = 'column' | 'bar' | 'line' | 'donut' | 'number';

/** Chart color palette (Notion API `color_theme`). */
export type ChartColorTheme =
  | 'auto' | 'colorful' | 'gray' | 'blue' | 'yellow' | 'green' | 'purple' | 'teal' | 'orange' | 'pink' | 'red';

export type ChartHeight = 'small' | 'medium' | 'large' | 'extraLarge';

/** Bar order: the group order, or by the X label or the Y value. */
export type ChartSort = 'manual' | 'xAscending' | 'xDescending' | 'yAscending' | 'yDescending';

export type ChartGridLines = 'none' | 'horizontal' | 'vertical' | 'both';

/** Legend position (Notion API `legend_position`). */
export type ChartLegend = 'off' | 'bottom' | 'side';

/** The chart's Y axis: `count`, or `<calculation>:<property id>` such as `sum:p1`. */
export type ChartMeasure = 'count' | `${CalculationFn}:${string}`;

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
  /** "Show large counts as 99+": a count above 99 shows as "99+". */
  capCounts?: boolean;
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
  /** Timeline: the shared centre day, `YYYY-MM-DD` (Notion's `center_timestamp`). A person's own last centre wins over it. */
  timelineCenter?: string;
  /** Timeline: show the table panel beside the bars. Default false. */
  showTimelineTable?: boolean;
  /** Timeline: the table panel's columns, apart from the bar properties. Array order is column order. */
  tableProperties?: ViewPropertySetting[];
  /** Timeline: the self-relation that draws dependency arrows. */
  arrowsBy?: string;
  /** Chart. The X axis (donut: each slice) is `groupBy`; the series are `subGroupBy`. Default 'column'. */
  chartType?: ChartType;
  /** Chart Y axis. Default 'count'. */
  chartMeasure?: ChartMeasure;
  /** Chart. Default 'manual'. */
  chartSort?: ChartSort;
  /** Chart: drop groups whose value is zero. Default false. */
  chartOmitZero?: boolean;
  /** Chart: running total, only for Count or Sum with `chartSort` 'xAscending'. Default false. */
  chartCumulative?: boolean;
  /** Chart. Default 'auto'. */
  chartColor?: ChartColorTheme;
  /** Chart. Default 'medium'. */
  chartHeight?: ChartHeight;
  /** Chart. Default 'horizontal'. */
  chartGridLines?: ChartGridLines;
  /** Chart. Default false. */
  chartAxisNames?: boolean;
  /** Chart. Default false. */
  chartDataLabels?: boolean;
  /** Line chart. Default false. */
  chartSmooth?: boolean;
  /** Line chart: shade the area under the line. Default false. */
  chartGradient?: boolean;
  /** Donut chart: the total in the center. Default true. */
  chartCenterValue?: boolean;
  /** Chart. Default 'bottom'. */
  chartLegend?: ChartLegend;
  /** Where the no-value group sits among the option groups. Absent means last. */
  noValueGroupPosition?: string;
  /** Groups this view hides, by option id. */
  hiddenGroups?: GroupRef[];
  /** Groups this view shows collapsed, by option id. */
  collapsedGroups?: GroupRef[];
  /** Hides the row count beside each group's name. */
  hideGroupAggregation?: boolean;
  /**
   * Board: the calculation beside each group's name, the same on every column.
   * Absent means Count all with large counts shown as "99+". Count all is
   * saved only to keep the cap off; its `id` is then the title property.
   */
  groupCalculation?: ViewCalculation;
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
  /**
   * How sub-items show. Table, list and timeline: `nested` (in a toggle,
   * the default) or `flattened`. Board, calendar and gallery: `card` (the
   * default) or `flattened`.
   */
  subItemsDisplay?: SubItemsDisplay;
  /** Which rows the view shows when sub-items are on. Default `parents`. */
  subItemsFilter?: SubItemsFilter;
}

export type SubItemsDisplay = 'nested' | 'card' | 'flattened';

export type SubItemsFilter = 'parents' | 'parentsAndSubItems' | 'subItems';

/** An entry in a per-view group list. */
export interface GroupRef {
  id: string;
}

/** View fields a caller may set when creating or changing a view. */
export type DatabaseViewSettingKey =
  | 'properties' | 'wrapCells' | 'frozenColumnCount' | 'showVerticalLines' | 'loadLimit' | 'calculations' | 'openPagesIn'
  | 'noValueGroupPosition' | 'hiddenGroups' | 'collapsedGroups' | 'hideGroupAggregation' | 'groupCalculation'
  | 'filterTree' | 'groupSettings' | 'subGroupBy' | 'subGroupSettings' | 'colorRules' | 'showPageIcon' | 'groupByStatus'
  | 'cardSize' | 'cardPreview' | 'fitImage' | 'calendarBy' | 'calendarRange' | 'showWeekends'
  | 'timelineBy' | 'timelineEndBy' | 'timelineZoom' | 'timelineCenter' | 'showTimelineTable' | 'tableProperties' | 'arrowsBy'
  | 'chartType' | 'chartMeasure' | 'chartSort' | 'chartOmitZero' | 'chartCumulative' | 'chartColor' | 'chartHeight'
  | 'chartGridLines' | 'chartAxisNames' | 'chartDataLabels' | 'chartSmooth' | 'chartGradient' | 'chartCenterValue' | 'chartLegend'
  | 'subItemsDisplay' | 'subItemsFilter'
  | Tier3ViewSettingKey;

// ─── Top-level saved data ───

/**
 * Data saved by the database block.
 * Rows are child blocks (database-row type).
 */
export interface DatabaseData extends BlockToolData {
  title?: string;
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
  automations?: DatabaseSavedAutomations;
  /** A linked database: it shows this database's rows and schema and has no rows of its own. Its views stay its own. */
  source?: DatabaseSourceRef;
}

// ─── Tier 3 (D6): data slots and host levers ───
// Kept in one block so it merges cleanly beside other changes. Blok runs no
// service for any of these: it stores the shape and calls the host.

/** Place and verification. A client older than them shows no value for them. */
export type Tier3PropertyType = 'place' | 'verification';

/** Form, map and dashboard. A client older than them opens the view as a board. */
export type Tier3ViewType = 'form' | 'map' | 'dashboard';

/** A place. Blok never geocodes: the host fills `lat` and `lon`. */
export interface PlaceValue {
  name?: string;
  address?: string;
  lat?: number;
  lon?: number;
}

export interface VerificationValue {
  state: 'verified' | 'unverified';
  /** A person id. */
  verifiedBy?: string;
  /** ISO date. Past it, the value reads as expired. Absent means verified indefinitely. */
  expiresAt?: string;
}

export type AutofillMode = 'summary' | 'translate' | 'keyInfo' | 'custom';

/** AI autofill on one property. Blok has no AI: `config.ai.autofill` fills the value. */
export interface AutofillSettings {
  mode: AutofillMode;
  instruction?: string;
  /** Translate: the target language, a BCP 47 tag. */
  language?: string;
  /** Fill when a row is added. Default false. */
  onCreate?: boolean;
  /** Fill again when another value of the row changes. Default false. */
  onEdit?: boolean;
  /** With `onEdit`: only a change to one of these property ids fills again. Absent means any property. */
  onEditProperties?: string[];
  /** Fill again when the row's page body is edited here. Default false. */
  onEditContent?: boolean;
}

export interface PropertySettingsV2 {
  autofill?: AutofillSettings;
}

export interface ViewPropertySetting {
  /** Form: the question must be answered. */
  required?: boolean;
  /** Form: help text under the question. */
  description?: string;
  /** Form: absent follows the property name. */
  questionName?: string;
  /** Form: a multi-line answer box. Absent means a one-line answer. */
  longAnswer?: boolean;
  /** Form: a positive integer; absent leaves selections unlimited. */
  maxSelections?: number;
  /**
   * Form: how a choice question lists its options. Absent: `'list'` for
   * multi-select, `'dropdown'` for select and status.
   */
  showOptionsAs?: 'list' | 'dropdown';
}

export interface FormSettings {
  /** The form takes no answers. Default false. */
  closed?: boolean;
  /** Answers carry no respondent. Default false. */
  anonymous?: boolean;
  submitLabel?: string;
  /** Text shown after a submit. */
  confirmation?: string;
}

export interface DashboardWidget {
  id: string;
  /** The view the widget shows. */
  viewId: string;
  /** The database holding the view. Omit for this database. */
  databaseId?: string;
  /** Columns of a 12-column grid, 1 to 12. */
  width: number;
}

export interface DashboardRow {
  id: string;
  /** Row height in pixels. */
  height?: number;
  /** Up to four. */
  widgets: DashboardWidget[];
}

export interface CalendarSyncSettings {
  enabled?: boolean;
  calendarId?: string;
}

export interface DatabaseViewConfig {
  /** Form view settings. */
  form?: FormSettings;
  /** Map: the place property. Default the first place property. */
  mapBy?: string;
  /** Dashboard slot. Blok draws no dashboard yet. */
  dashboard?: { rows: DashboardRow[] };
  /** Calendar sync slot, for the host. */
  calendarSync?: CalendarSyncSettings;
  /** Multi-source slot: the database block whose rows this view shows. Absent means this database. */
  dataSourceId?: string;
}

export type Tier3ViewSettingKey = 'form' | 'mapBy' | 'dashboard' | 'calendarSync' | 'dataSourceId';

export type DatabaseSavedAutomationTrigger =
  | { id: string; type: 'pageAdded' }
  | { id: string; type: 'propertyEdited'; propertyId: string };

export interface DatabaseSavedAutomationAction {
  id: string;
  type: 'editProperty';
  target: 'triggerRow';
  propertyId: string;
  value: PropertyValue;
}

export interface DatabaseSavedAutomation {
  id: string;
  name: string;
  status: 'active' | 'paused';
  scope: { type: 'database' } | { type: 'view'; viewId: string };
  triggerMode: 'any' | 'all';
  triggers: DatabaseSavedAutomationTrigger[];
  actions: DatabaseSavedAutomationAction[];
}

export interface DatabaseSavedAutomations {
  version: 1;
  definitions: DatabaseSavedAutomation[];
}

/** What Blok can see happen. A schedule trigger is the host's. */
export type DatabaseAutomationTrigger =
  | { type: 'pageAdded'; rowId: string; properties: Record<string, PropertyValue> }
  | { type: 'propertyEdited'; rowId: string; propertyId: string; value: PropertyValue };

/**
 * Notion's automation actions. `ctx.run` runs the first three in this
 * database; the rest are the host's to send.
 */
export type DatabaseAutomationAction =
  | { type: 'editProperty'; rowId: string; propertyId: string; value: PropertyValue }
  | { type: 'addPage'; properties: Record<string, PropertyValue> }
  | { type: 'editPages'; rowIds: string[]; propertyId: string; value: PropertyValue }
  | { type: 'sendNotification'; to: string[]; message?: string }
  | { type: 'sendMail'; to: string[]; subject?: string; body?: string }
  | { type: 'sendWebhook'; url: string }
  | { type: 'sendSlack'; channel: string; message?: string };

export interface DatabaseAutomationContext {
  databaseId: string;
  /** True when the row passes the view's filters now. */
  matchesView(rowId: string, viewId: string): boolean;
  /**
   * Runs an edit or add action in this database. Its writes fire no trigger.
   * Returns false for an action only the host can run.
   */
  run(action: DatabaseAutomationAction): boolean;
}

/** Fired after each local write. Peers, undo and redo fire nothing. */
export interface DatabaseAutomations {
  onTrigger(trigger: DatabaseAutomationTrigger, ctx: DatabaseAutomationContext): void | Promise<void>;
}

export interface DatabaseFormSubmission {
  databaseId: string;
  viewId: string;
  /** Answers by property id. */
  values: Record<string, PropertyValue>;
  /** The row Blok added. Absent in read-only, where only the host can store the answer. */
  rowId?: string;
}

export interface DatabaseForms {
  onSubmit(submission: DatabaseFormSubmission): void | Promise<void>;
}

export interface DatabaseMapItem {
  rowId: string;
  title: string;
  place: PlaceValue;
}

export interface DatabaseMap {
  /** Draws the map into `container`. Called again on every redraw, after `destroy`. */
  render(container: HTMLElement, items: DatabaseMapItem[], ctx: { open(rowId: string): void }): { destroy(): void } | void;
}

export interface DatabaseAutofillRequest {
  databaseId: string;
  rowId: string;
  propertyId: string;
  settings: AutofillSettings;
  /** The row's stored values, by property id. */
  values: Record<string, PropertyValue>;
}

export interface DatabaseAI {
  /** The new value, or null or undefined to keep the old one. */
  autofill(request: DatabaseAutofillRequest): Promise<PropertyValue | null | undefined>;
}

/**
 * `editContent` covers rows and their values; `editStructure` covers
 * properties, options, views and the title, as a locked database does.
 */
export type DatabasePermissionAction = 'editContent' | 'editStructure' | 'comment';

export interface DatabasePermissions {
  /** Read on every redraw. Call `setReadOnly` or redraw the block after a change. */
  can(action: DatabasePermissionAction, ctx: { databaseId: string }): boolean;
}

export interface DatabaseCommentTarget {
  databaseId: string;
  rowId: string;
  /** Set for a comment on one cell. */
  propertyId?: string;
}

export interface DatabaseComments {
  open(target: DatabaseCommentTarget, anchor: HTMLElement): void;
  /**
   * The row's comment count. Above zero, the row shows an "Open comments"
   * badge. Read on every redraw and on each `subscribe` change; a throw counts as zero.
   */
  count?(target: DatabaseCommentTarget): number;
  /**
   * Hears about comment changes. Call `onChange` and Blok reads `count` again,
   * keeping the badges in place. Return a function that stops it when the block goes away.
   */
  subscribe?(databaseId: string, onChange: () => void): (() => void) | void;
}

export interface DatabaseConfig {
  automations?: DatabaseAutomations;
  forms?: DatabaseForms;
  map?: DatabaseMap;
  ai?: DatabaseAI;
  permissions?: DatabasePermissions;
  comments?: DatabaseComments;
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
    /** The row is a page template, not a row. */
    template?: boolean;
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
  /**
   * Show the row's page as a full page in the host's own page area. Without
   * it, a full page takes the database's place in the editor.
   */
  navigate?(rowId: string): void;
}

/** View fields a person can change for themselves before "Save for everyone". */
export type PersonalViewPatch = Partial<Pick<DatabaseViewConfig, 'filters' | 'sorts' | 'filterTree'>>;

/**
 * Where a person's unsaved filter and sort edits live. Without it, Blok keeps
 * them in this browser, per document. An empty patch means no edits.
 */
/** How view tabs show: icon and name, name only, or icon only. */
export type DatabaseTabDisplay = 'both' | 'text' | 'icon';

export interface DatabaseViewStateStore {
  get(viewId: string): Promise<Partial<DatabaseViewConfig> | null>;
  set(viewId: string, patch: Partial<DatabaseViewConfig>): Promise<void>;
  /** This person's "Display as" for the database's tabs. Without both, Blok keeps it in this browser. */
  getTabDisplay?(): Promise<DatabaseTabDisplay | null>;
  setTabDisplay?(display: DatabaseTabDisplay): Promise<void>;
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
  /** Rows of related databases in other documents. Without it, those relations show ids only. */
  relations?: DatabaseRelations;
  /**
   * Feed view: a footer under each card, for comments and reactions. Blok
   * draws none. Return a cleanup; it runs when the view redraws.
   */
  feedFooter?: (context: { rowId: string; holder: HTMLElement }) => (() => void) | void;
  /** Button property callbacks. */
  buttons?: DatabaseButtons;
  /** Repeating templates. */
  templates?: DatabaseTemplates;
  /** Linked databases whose source is in another document. */
  linkedSources?: DatabaseLinkedSources;
  /** Mentions of a row in other documents, for its "N backlinks". */
  backlinks?: DatabaseBacklinks;
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

  exportCsv(): string;

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
