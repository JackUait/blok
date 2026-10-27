import { nanoid } from 'nanoid';
import type {
  DatabaseData,
  DatabaseRow,
  DatabaseViewConfig,
  GroupSettings,
  PageLayoutFields,
  PropertyConfig,
  PropertyDefinition,
  PropertySettingsV2,
  PropertyType,
  PropertyValue,
  SelectOption,
  ViewType,
} from './types';
import { pageLayoutFields, pageLayoutOf } from './page-layout';
import type { PageLayoutData } from './page-layout';
import { queryGroups, queryRows, rowOrderKey } from './database-query';
import { orderedStatusOptions, personIdsOf, readPropertyValue, statusGroupOf, statusGroupsOf, withEmptyLists } from './property-values';
import { shownStatusOption } from './cells/option-colors';
import type { GroupCount, QueryRowsRequest, QueryRowsResult, QuerySource } from './database-query';
import { NO_VALUE_GROUP_KEY, groupKeysFor, orderGroupKeys } from './group-keys';
import { parentMap, relationPair } from './sub-items';
import { comparePositions } from './positions';
import { createDefaultSchema, createDefaultView, freePropertyName, newView } from '../../shared/database/schema-ops';
import { positionBetween } from '../../shared/database/positions';
import { createSeedDefinition } from '../../shared/database/seed-layouts';
import type { ViewCreateConfig } from '../../shared/database/schema-ops';
import { applyViewChanges } from '../../shared/database/view-changes';
import { lastRowKey, pinnedRowOrders } from '../../shared/database/row-order';
import type { ViewChanges } from '../../shared/database/view-changes';

export type { ViewCreateConfig };

export type { ViewChanges };

export interface DatabaseModelOptions {
  /** Layout of the view a database without views starts with. */
  defaultViewType?: ViewType;
  /**
   * Makes the default schema and view ids derive from this string instead of
   * being random. Every client that fills in the same seeded block then
   * writes the same ids, so their saves merge into one schema, not two.
   */
  idSeed?: string;
  now?: () => Date;
  /** The current user's id, for a person filter's "Me" (the people lever). */
  me?: () => string | null;
  /** The row page this view is shown on, for a relation filter's "This page". */
  page?: () => string | null;
  /** The database block's id: a relation to it is a self-relation (sub-items). */
  databaseId?: string;
  /**
   * Each view keeps its own manual order (`rowOrder`). Default on. Off: every
   * view reads and writes the shared `position` order, and saved `rowOrder`
   * keys are ignored (an adapter that does not store them).
   */
  viewRowOrder?: boolean;
}

/** Sorts after every real fractional key: 'z' is the last digit of the base62 alphabet. */
const ORPHAN_GROUP_POSITION = 'zzzzzzzz';

export { NO_VALUE_GROUP_KEY };

/** What `updateProperty` may change. */
export type PropertyChanges = Partial<Pick<PropertyDefinition, 'name' | 'config'>> & Partial<PropertySettingsV2> & PageLayoutFields;

export interface GroupOptions {
  /** Status only: one group per status group instead of per option. */
  statusBy?: 'group' | 'option';
}

export class DatabaseModel {
  private schema: PropertyDefinition[];
  private rows: DatabaseRow[] = [];
  private views: DatabaseViewConfig[];
  private activeViewId: string;
  /** Ids minted here but not yet seen in a backend snapshot. */
  private readonly locallyAdded = new Set<string>();
  /** Today, for relative dates. Tests pin it. */
  private readonly now: () => Date;
  private readonly me: () => string | null;
  private readonly page: () => string | null;
  private readonly databaseId: string | undefined;
  private readonly viewRowOrder: boolean;
  /** Formula and rollup as their result type (ComputedProperties.valueProperty). */
  private valueOf: (property: PropertyDefinition) => PropertyDefinition = (property) => property;

  constructor(data?: Partial<DatabaseData>, options: DatabaseModelOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
    this.me = options.me ?? ((): null => null);
    this.page = options.page ?? ((): null => null);
    this.databaseId = options.databaseId;
    this.viewRowOrder = options.viewRowOrder ?? true;
    // A toolbox seed builds its entry's definition (research/28 §3); no seed keeps the old default.
    const seed = options.defaultViewType === undefined ? undefined : createSeedDefinition(options.defaultViewType, DatabaseModel.idMinter(options.idSeed));

    const savedSchema = data?.schema !== undefined && data.schema.length > 0 ? data.schema : undefined;

    if (savedSchema !== undefined) {
      this.schema = savedSchema.map((p) => ({ ...p }));
    } else {
      this.schema = seed?.schema ?? createDefaultSchema(DatabaseModel.idMinter(options.idSeed));
    }

    if (data?.views !== undefined && data.views.length > 0) {
      this.views = structuredClone(data.views);
    } else if (seed !== undefined && savedSchema === undefined) {
      this.views = seed.views;
    } else {
      // The seed's views name the seed's properties; a saved schema gets a plain view.
      this.views = [this.createDefaultView(options.defaultViewType ?? 'board', DatabaseModel.idMinter(options.idSeed))];
    }

    this.activeViewId = data?.activeViewId || (this.views.length > 0 ? this.views[0].id : '');
  }

  // ─── Schema ───

  getSchema(): PropertyDefinition[] {
    return [...this.schema];
  }

  getProperty(propertyId: string): PropertyDefinition | undefined {
    return this.schema.find((p) => p.id === propertyId);
  }

  setValueProperty(valueOf: (property: PropertyDefinition) => PropertyDefinition): void {
    this.valueOf = valueOf;
  }

  /**
   * The schema as values show: a formula or rollup as its result type. Filter,
   * sort, group and calculation read this one. Never save it.
   */
  getValueSchema(): PropertyDefinition[] {
    return this.schema.map((property) => this.valueOf(property));
  }

  /**
   * Adds a property at the end, or beside `at.afterId` / before `at.beforeId`.
   * Positions stay fractional keys, so two peers adding at once both land.
   * A taken name gets the lowest free " N" (freePropertyName). Loads and peer
   * merges do not come through here, so saved duplicates keep their names.
   */
  addProperty(
    name: string,
    type: PropertyType,
    config?: PropertyConfig,
    at: { afterId?: string; beforeId?: string } = {},
    settings: PropertySettingsV2 = {}
  ): PropertyDefinition {
    const ordered = [...this.schema].sort((a, b) => (a.position < b.position ? -1 : 1));
    const anchorIndex = ordered.findIndex((p) => p.id === (at.afterId ?? at.beforeId));
    const neighbours = (): [PropertyDefinition | null, PropertyDefinition | null] => {
      if (anchorIndex === -1) return [ordered[ordered.length - 1] ?? null, null];

      return at.afterId !== undefined
        ? [ordered[anchorIndex], ordered[anchorIndex + 1] ?? null]
        : [ordered[anchorIndex - 1] ?? null, ordered[anchorIndex]];
    };
    const [after, before] = neighbours();
    const prop: PropertyDefinition = {
      ...settings,
      id: nanoid(),
      name: freePropertyName(this.schema.map((p) => p.name), name),
      type,
      position: DatabaseModel.positionBetween(after?.position ?? null, before?.position ?? null),
      ...(config !== undefined ? { config } : {}),
    };
    this.schema.push(prop);
    this.schema.sort((a, b) => (a.position < b.position ? -1 : 1));
    this.locallyAdded.add(prop.id);
    return prop;
  }

  /**
   * Changes a property. A settings key given as `undefined` is removed.
   * `config` merges, not replaces: a newer client's key beside `options`
   * must outlive every option edit.
   */
  updateProperty(propertyId: string, changes: PropertyChanges): void {
    const prop = this.schema.find((p) => p.id === propertyId);
    if (prop === undefined) return;
    const { config, ...rest } = changes;

    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) {
        Reflect.deleteProperty(prop, key);
      } else {
        Reflect.set(prop, key, structuredClone(value));
      }
    }
    if (config !== undefined) prop.config = { ...prop.config, ...config };
  }

  /** Swaps a property for a new definition with the same id, as a type change does. */
  replaceProperty(next: PropertyDefinition): void {
    this.schema = this.schema.map((p) => (p.id === next.id ? structuredClone(next) : p));
  }

  deleteProperty(propertyId: string): void {
    this.schema = this.schema.filter((p) => p.id !== propertyId);
  }

  /** The lock lives on the title property; see `PropertyDefinition.databaseLocked`. */
  isDatabaseLocked(): boolean {
    return this.schema.find((p) => p.type === 'title')?.databaseLocked === true;
  }

  setDatabaseLocked(locked: boolean): void {
    const title = this.schema.find((p) => p.type === 'title');

    if (title === undefined) return;
    if (locked) {
      title.databaseLocked = true;
    } else {
      delete title.databaseLocked;
    }
  }

  /** The template new rows start from, read on the title property. */
  getDefaultTemplateId(): string | undefined {
    return this.schema.find((p) => p.type === 'title')?.defaultTemplateId;
  }

  setDefaultTemplateId(templateId: string | null): void {
    const title = this.schema.find((p) => p.type === 'title');

    if (title === undefined) return;
    if (templateId === null) {
      delete title.defaultTemplateId;
    } else {
      title.defaultTemplateId = templateId;
    }
  }

  getPageLayout(): PageLayoutData {
    return pageLayoutOf(this.schema.find((p) => p.type === 'title'));
  }

  setPageLayout(layout: PageLayoutData): void {
    const title = this.schema.find((p) => p.type === 'title');

    if (title !== undefined) this.updateProperty(title.id, pageLayoutFields(layout));
  }

  /**
   * Writes the empty layout lists, in a save of their own, before anyone adds
   * to them. A list born in the same write as its first entry is a whole-value
   * write, and a peer's concurrent first entry is lost. Returns whether it wrote.
   */
  bearPageLayout(): boolean {
    const title = this.schema.find((p) => p.type === 'title');

    if (title === undefined || (Array.isArray(title.pageLayoutPlacements) && Array.isArray(title.pageLayoutSections))) return false;
    title.pageLayoutPlacements ??= [];
    title.pageLayoutSections ??= [];

    return true;
  }

  // ─── Row projection ───

  setRows(rows: DatabaseRow[]): void {
    this.rows = rows;
  }

  getOrderedRows(): DatabaseRow[] {
    return [...this.rows].sort((a, b) => comparePositions(a.position, b.position));
  }

  getRow(rowId: string): DatabaseRow | undefined {
    return this.rows.find((r) => r.id === rowId);
  }

  /** Rows in a view's manual order (its own keys, else the shared order), sorts ignored. */
  getRowsInManualOrder(view: DatabaseViewConfig): DatabaseRow[] {
    const order = this.rowOrderOf(view);

    return [...this.rows].sort((a, b) => comparePositions(rowOrderKey(a, order), rowOrderKey(b, order)));
  }

  /** The view's own manual order, or undefined when it follows the shared one. */
  rowOrderOf(view: DatabaseViewConfig): Record<string, string> | undefined {
    return this.viewRowOrder ? view.rowOrder : undefined;
  }

  /** The view as the query reads it: without its own order when views share one. */
  private orderedView(view: DatabaseViewConfig): DatabaseViewConfig {
    if (this.viewRowOrder || view.rowOrder === undefined) return view;
    const { rowOrder: _ignored, ...shared } = view;

    return shared;
  }

  /**
   * Before `rows` move in the shared order: every view but `viewId` that
   * `shows` them keeps each one where it is, by taking its current
   * `position` as that view's own key. Rows that do not move keep their
   * `position`, so those views' order stays the same. Same key space as new
   * rows.
   * @returns the ids of the views it changed
   */
  pinRowsInOtherViews(viewId: string, rows: DatabaseRow[], shows: (view: DatabaseViewConfig) => boolean): string[] {
    if (!this.viewRowOrder) return [];

    return pinnedRowOrders(this.views, viewId, rows, shows).map(({ viewId: id, rowOrder }) => {
      this.updateView(id, { rowOrder });

      return id;
    });
  }

  /** The highest row key in any view, so a row placed after it goes last everywhere. */
  lastRowKey(): string | null {
    return lastRowKey(this.rows, this.views.map((view) => this.rowOrderOf(view)));
  }

  /** `anonymous`: an anonymous form answer, so no person property starts with the current user. */
  createRowData(properties?: Record<string, PropertyValue>, options: { anonymous?: boolean } = {}): DatabaseRow {
    const lastPosition = this.lastRowKey();
    const given = properties ?? {};

    return {
      id: nanoid(),
      position: DatabaseModel.positionBetween(lastPosition, null),
      properties: withEmptyLists(this.schema, options.anonymous === true ? { ...given } : this.withCreatedByDefaults(given)),
    };
  }

  /** A status with a default option fills a new row that has no key for it (research/04: "null resets to the default option"). */
  withStatusDefaults(properties: Record<string, PropertyValue>): Record<string, PropertyValue> {
    const result = { ...properties };

    for (const property of this.schema) {
      const id = property.type === 'status' ? property.status?.defaultOptionId : undefined;

      if (id !== undefined && !(property.id in result) && property.config?.options.some((option) => option.id === id) === true) {
        result[property.id] = id;
      }
    }

    return result;
  }

  /** A person property set to default "Created by" starts with the current user, unless the caller gave a value. */
  private withCreatedByDefaults(properties: Record<string, PropertyValue>): Record<string, PropertyValue> {
    const me = this.me();
    const result = { ...properties };

    if (me === null) return result;
    for (const property of this.schema) {
      if (property.type === 'person' && property.person?.default === 'createdBy' && personIdsOf(result[property.id]).length === 0) {
        result[property.id] = [{ id: me }];
      }
    }

    return result;
  }

  // ─── View-oriented queries ───

  getRowsGroupedBy(propertyId: string, options: GroupOptions = {}): Map<string, DatabaseRow[]> {
    const groups = new Map<string, DatabaseRow[]>();
    const ordered = this.getOrderedRows();
    const keysOf = this.groupKeysOf(propertyId, options);

    for (const row of ordered) {
      for (const key of keysOf(row)) {
        const group = groups.get(key) ?? [];

        group.push(row);
        groups.set(key, group);
      }
    }
    return groups;
  }

  /**
   * The groups a row belongs to under `propertyId`. The query engine groups
   * only through this. Options, status and people keep the keys boards have
   * always used; other types group by value, bucket or letter (group-keys.ts).
   */
  groupKeysOf(
    propertyId: string,
    options: GroupOptions & { settings?: GroupSettings; now?: Date } = {}
  ): (row: DatabaseRow) => string[] {
    const saved = this.getProperty(propertyId);
    const property = saved === undefined ? undefined : this.valueOf(saved);

    if (property === undefined) {
      return (row) => this.toGroupKeys(row.properties[propertyId]);
    }
    const settings = options.settings ?? {};
    const now = options.now ?? this.now();

    return (row) => {
      const value = readPropertyValue(row, property);

      if (property.type === 'person' || property.type === 'createdBy' || property.type === 'lastEditedBy') {
        const ids = personIdsOf(value);

        return ids.length > 0 ? ids : [NO_VALUE_GROUP_KEY];
      }
      if (property.type === 'status' && options.statusBy === 'group' && typeof value === 'string' && value !== '') {
        return [statusGroupOf(property, value)?.id ?? value];
      }
      if (property.type === 'select' || property.type === 'multiSelect' || property.type === 'status') {
        return this.toGroupKeys(value);
      }

      return groupKeysFor(property, value, settings, now);
    };
  }

  queryRows(request: QueryRowsRequest): QueryRowsResult {
    return queryRows(this.querySource(request.view), { ...request, view: this.orderedView(request.view) });
  }

  queryGroups(view: DatabaseViewConfig, options: { search?: string } = {}): GroupCount[] {
    return queryGroups(this.querySource(view), this.orderedView(view), options);
  }

  /**
   * The view's groups in display order, with counts after filters and search.
   * A select lists every option, empty ones too; other types list the groups
   * rows fall in. `hideEmptyGroups` drops groups with no row.
   */
  listGroups(view: DatabaseViewConfig, options: { search?: string } = {}): GroupCount[] {
    const saved = view.groupBy === undefined ? undefined : this.getProperty(view.groupBy);
    const property = saved === undefined ? undefined : this.valueOf(saved);

    if (property === undefined) return [];
    const settings = view.groupSettings ?? {};
    const counts = new Map(this.queryGroups(view, options).map((g) => [g.key, g.count]));
    const isOptionType = property.type === 'select' || property.type === 'multiSelect' || property.type === 'status';
    const groupOptions = isOptionType ? this.getSelectOptions(property.id, { statusBy: view.groupByStatus }) : [];
    const keys = isOptionType
      ? [...groupOptions.map((o) => o.id), NO_VALUE_GROUP_KEY]
      : [...new Set([...this.queryGroups({ ...view, filters: [], filterTree: undefined }).map((g) => g.key), ...counts.keys()])];
    const ordered = property.type === 'status' && view.groupByStatus === 'group'
      ? [
        ...(settings.sort === 'descending' ? [...groupOptions].reverse() : groupOptions).map((option) => option.id),
        NO_VALUE_GROUP_KEY,
      ]
      : orderGroupKeys(property, keys, settings, this.now(), isOptionType ? groupOptions : undefined);

    return ordered
      .map((key) => ({ key, count: counts.get(key) ?? 0 }))
      .filter((group) => settings.hideEmptyGroups !== true || group.count > 0);
  }

  /** The "Parent item" / "Sub-items" pair, when sub-items are on. */
  subItemPair(): { forward: string; backward: string } | undefined {
    return this.databaseId === undefined ? undefined : relationPair(this.schema, this.databaseId, 'parentItem', 'subItems');
  }

  private querySource(view: DatabaseViewConfig): QuerySource {
    const now = this.now();
    const subItems = this.subItemPair();

    return {
      schema: this.getValueSchema(),
      rows: this.rows,
      now,
      me: this.me(),
      page: this.page(),
      ...(subItems !== undefined ? { parents: parentMap(this.rows, subItems.forward) } : {}),
      ...(view.groupBy !== undefined
        ? { groupKeysOf: this.groupKeysOf(view.groupBy, { statusBy: view.groupByStatus, settings: view.groupSettings, now }) }
        : {}),
    };
  }

  getSelectOptions(propertyId: string, grouping: GroupOptions = {}): SelectOption[] {
    const prop = this.getProperty(propertyId);

    if (prop?.type === 'status') {
      return grouping.statusBy === 'group'
        ? statusGroupsOf(prop).map((g) => ({ id: g.id, label: g.name, color: g.color, position: g.position }))
        : orderedStatusOptions(prop).map(shownStatusOption);
    }
    if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) return [];
    const options = prop.config?.options ?? [];
    const sorted = [...options].sort((a, b) => (a.position < b.position ? -1 : 1));

    return [...sorted, ...this.orphanGroupOptions(propertyId, sorted)];
  }

  /** The option a card takes when dropped into a status group: its own if already there, else the group's first. */
  statusValueForGroup(propertyId: string, groupId: string, current: PropertyValue | undefined): string | null {
    const prop = this.getProperty(propertyId);

    if (prop === undefined) return null;
    if (typeof current === 'string' && statusGroupOf(prop, current)?.id === groupId) return current;

    return orderedStatusOptions(prop).find((o) => statusGroupOf(prop, o.id)?.id === groupId)?.id ?? null;
  }

  /**
   * Stand-in options for group values the rows still carry but the schema has
   * lost — a peer deleted the option while someone else moved a card into it.
   * A grouped view draws one group per option, so without these the card is in
   * the document but on no board. Labelless on purpose: the deleted option's
   * label is gone, and these are never written back to the schema.
   */
  private orphanGroupOptions(propertyId: string, known: SelectOption[]): SelectOption[] {
    const knownIds = new Set(known.map((o) => o.id));

    return [...this.getRowsGroupedBy(propertyId).keys()]
      .filter((key) => key !== NO_VALUE_GROUP_KEY && !knownIds.has(key))
      .map((key) => ({ id: key, label: '', position: ORPHAN_GROUP_POSITION }));
  }

  // ─── Views ───

  getViews(): DatabaseViewConfig[] {
    return [...this.views];
  }

  getView(viewId: string): DatabaseViewConfig | undefined {
    return this.views.find((v) => v.id === viewId);
  }

  addView(name: string, type: ViewType, config: ViewCreateConfig = {}): DatabaseViewConfig {
    const sorted = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const lastPosition = sorted.length > 0 ? sorted[sorted.length - 1].position : null;
    const view = this.newView({
      ...structuredClone(config),
      id: nanoid(),
      name,
      type,
      position: DatabaseModel.positionBetween(lastPosition, null),
    });
    this.views.push(view);
    this.locallyAdded.add(view.id);
    return view;
  }

  updateView(viewId: string, changes: ViewChanges): void {
    const view = this.views.find((v) => v.id === viewId);
    if (view === undefined) return;
    applyViewChanges(view, structuredClone(changes), this.schema);
  }

  deleteView(viewId: string): void {
    this.views = this.views.filter((v) => v.id !== viewId);
  }

  // ─── Hydrate ───

  /**
   * Folds a backend snapshot into the live model.
   *
   * The snapshot replaces what the model was built from, but NOT what this
   * session added since: the load is awaited, and a column added during that
   * window is newer than the snapshot. A plain replace dropped it here and
   * then wrote the reduced schema back out on the next save.
   */
  hydrate(data: Partial<DatabaseData>): void {
    if (data.schema !== undefined) {
      this.schema = this.mergeById(this.schema, structuredClone(data.schema));
    }
    if (data.views !== undefined) {
      this.views = this.mergeById(this.views, structuredClone(data.views));
    }
  }

  /** Incoming, plus whatever this session minted that it does not mention. */
  private mergeById<T extends { id: string; position: string }>(local: T[], incoming: T[]): T[] {
    const merged = new Map(local.filter((item) => this.locallyAdded.has(item.id)).map((item) => [item.id, item]));

    for (const item of incoming) {
      this.locallyAdded.delete(item.id);
      merged.set(item.id, item);
    }

    return [...merged.values()].sort((a, b) => (a.position < b.position ? -1 : 1));
  }

  /**
   * Takes schema and views from the document, as undo or a peer left them.
   * Rows stay: they are child blocks and re-sync on their own.
   */
  replaceDefinition(data: Pick<DatabaseData, 'schema' | 'views'>): void {
    this.schema = structuredClone(data.schema);
    this.views = structuredClone(data.views);
    this.locallyAdded.clear();
  }

  // ─── Snapshot ───

  snapshot(): DatabaseData {
    return {
      schema: structuredClone(this.schema),
      views: structuredClone(this.views),
      activeViewId: this.activeViewId,
    };
  }

  // ─── Static helpers ───

  private toGroupKeys(value: PropertyValue | undefined): string[] {
    if (Array.isArray(value)) {
      const ids = personIdsOf(value);

      return ids.length > 0 ? ids : [NO_VALUE_GROUP_KEY];
    }
    if (value === undefined || value === null || value === '') return [NO_VALUE_GROUP_KEY];
    if (typeof value === 'string') return [value];
    if (typeof value === 'boolean' || typeof value === 'number') return [String(value)];
    return [NO_VALUE_GROUP_KEY];
  }

  /**
   * Generates a fractional index strictly between `after` and `before`.
   *
   * Never throws. A throw here kills a drop with no message, and stored keys
   * are not always the library's own:
   * - equal neighbours: a document written before appended keys carried a
   *   random suffix holds rows two peers minted at the same moment;
   * - out-of-order neighbours (a caller that sorted another way) are swapped,
   *   so the key still lands between the two;
   * - keys the library rejects (`a000` from a `padStart`, a bad head) are
   *   normalized, or else get a code-unit key between them.
   * Every key ends in a random suffix, so two peers placing at the same moment
   * never land on the same key.
   */
  static positionBetween(after: string | null, before: string | null): string {
    return positionBetween(after, before);
  }

  private static idMinter(seed: string | undefined): (name: string) => string {
    return seed === undefined ? () => nanoid() : (name) => `${seed}-${name}`;
  }

  private createDefaultView(type: ViewType, mintId: (name: string) => string): DatabaseViewConfig {
    return createDefaultView(type, this.schema, mintId);
  }

  private newView(
    seed: Pick<DatabaseViewConfig, 'id' | 'name' | 'type' | 'position'> & ViewCreateConfig
  ): DatabaseViewConfig {
    return newView(seed, this.schema);
  }
}
