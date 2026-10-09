import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import type {
  DatabaseData,
  DatabaseRow,
  DatabaseViewConfig,
  DatabaseViewSettingKey,
  GroupSettings,
  PropertyConfig,
  PropertyDefinition,
  PropertySettingsV2,
  PropertyType,
  PropertyValue,
  SelectOption,
  ViewType,
} from './types';
import { DATABASE_DEFAULT_TEXT } from './database-localization';
import { queryGroups, queryRows } from './database-query';
import { orderedStatusOptions, personIdsOf, readPropertyValue, statusGroupOf, statusGroupsOf } from './property-values';
import type { GroupCount, QueryRowsRequest, QueryRowsResult, QuerySource } from './database-query';
import { resolveViewProperties, visibleRowPropertyIds } from './view-settings';
import { NO_VALUE_GROUP_KEY, groupKeysFor, orderGroupKeys } from './group-keys';

export type ViewCreateConfig = Partial<Pick<DatabaseViewConfig, 'groupBy' | 'sorts' | 'filters' | 'visibleProperties' | DatabaseViewSettingKey>>;

export type ViewChanges = Partial<Pick<DatabaseViewConfig,
  'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties' | DatabaseViewSettingKey
>>;

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
}

/** Sorts after every real fractional key: 'z' is the last digit of the base62 alphabet. */
const ORPHAN_GROUP_POSITION = 'zzzzzzzz';

export { NO_VALUE_GROUP_KEY };

/** What `updateProperty` may change. */
export type PropertyChanges = Partial<Pick<PropertyDefinition, 'name' | 'config'>> & Partial<PropertySettingsV2>;

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

  constructor(data?: Partial<DatabaseData>, options: DatabaseModelOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
    this.me = options.me ?? ((): null => null);
    if (data?.schema !== undefined && data.schema.length > 0) {
      this.schema = data.schema.map((p) => ({ ...p }));
    } else {
      this.schema = DatabaseModel.createDefaultSchema(DatabaseModel.idMinter(options.idSeed));
    }

    if (data?.views !== undefined && data.views.length > 0) {
      this.views = structuredClone(data.views);
    } else {
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

  /**
   * Adds a property at the end, or beside `at.afterId` / before `at.beforeId`.
   * Positions stay fractional keys, so two peers adding at once both land.
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
      name,
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

  // ─── Row projection ───

  setRows(rows: DatabaseRow[]): void {
    this.rows = rows;
  }

  getOrderedRows(): DatabaseRow[] {
    return [...this.rows].sort((a, b) => a.position.localeCompare(b.position));
  }

  getRow(rowId: string): DatabaseRow | undefined {
    return this.rows.find((r) => r.id === rowId);
  }

  createRowData(properties?: Record<string, PropertyValue>): DatabaseRow {
    const ordered = this.getOrderedRows();
    const lastPosition = ordered.length > 0 ? ordered[ordered.length - 1].position : null;
    return {
      id: nanoid(),
      position: DatabaseModel.positionBetween(lastPosition, null),
      properties: properties ?? {},
    };
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
    const property = this.getProperty(propertyId);

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
    return queryRows(this.querySource(request.view), request);
  }

  queryGroups(view: DatabaseViewConfig, options: { search?: string } = {}): GroupCount[] {
    return queryGroups(this.querySource(view), view, options);
  }

  /**
   * The view's groups in display order, with counts after filters and search.
   * A select lists every option, empty ones too; other types list the groups
   * rows fall in. `hideEmptyGroups` drops groups with no row.
   */
  listGroups(view: DatabaseViewConfig, options: { search?: string } = {}): GroupCount[] {
    const property = view.groupBy === undefined ? undefined : this.getProperty(view.groupBy);

    if (property === undefined) return [];
    const settings = view.groupSettings ?? {};
    const counts = new Map(this.queryGroups(view, options).map((g) => [g.key, g.count]));
    const isOptionType = property.type === 'select' || property.type === 'multiSelect' || property.type === 'status';
    const groupOptions = isOptionType ? this.getSelectOptions(property.id, { statusBy: view.groupByStatus }) : [];
    const keys = isOptionType
      ? [...groupOptions.map((o) => o.id), NO_VALUE_GROUP_KEY]
      : [...new Set([...this.queryGroups({ ...view, filters: [], filterTree: undefined }).map((g) => g.key), ...counts.keys()])];
    const ordered = orderGroupKeys(property, keys, settings, this.now(), isOptionType ? groupOptions : undefined);

    return ordered
      .map((key) => ({ key, count: counts.get(key) ?? 0 }))
      .filter((group) => settings.hideEmptyGroups !== true || group.count > 0);
  }

  private querySource(view: DatabaseViewConfig): QuerySource {
    const now = this.now();

    return {
      schema: this.schema,
      rows: this.rows,
      now,
      me: this.me(),
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
        : orderedStatusOptions(prop);
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
    Object.assign(view, structuredClone(changes));
    if (changes.properties !== undefined) {
      view.visibleProperties = visibleRowPropertyIds(view, this.schema);
    }
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
   * The ordering guard is load-bearing: fractional-indexing >= 4 silently swaps
   * out-of-order arguments instead of throwing, which would turn a caller-side
   * ordering bug (stale/unsorted neighbour lookup) into silently corrupted
   * positions. Callers must pass neighbours read from a position-sorted list.
   *
   * Two extra rules exist because this key is minted from local state while a
   * peer mints one from the same state:
   * - appending (`before === null`) adds a random suffix, so two peers adding
   *   at the same moment never land on the same key;
   * - equal neighbours are tolerated instead of throwing, because a document
   *   written before that suffix existed still holds duplicate keys, and a
   *   throw here kills the whole drop and loses the user's move.
   */
  static positionBetween(after: string | null, before: string | null): string {
    if (after !== null && before !== null) {
      if (after > before) {
        throw new Error(`DatabaseModel.positionBetween: keys out of order (${after} >= ${before})`);
      }

      if (after === before) {
        return after + DatabaseModel.randomKeySuffix();
      }
    }

    const key = generateKeyBetween(after, before);

    if (after !== null && before === null) {
      return key + DatabaseModel.randomKeySuffix();
    }

    return key;
  }

  /**
   * Random tail for an appended key. `key + suffix` sorts strictly after `key`
   * and strictly before the next key with a larger integer part, so the suffix
   * only breaks ties between peers.
   *
   * Digits only, although fractional-indexing takes the whole base62 alphabet:
   * rows are ordered with `localeCompare` and options with `<`, and those two
   * disagree on letter case. The last digit may not be '0' — the library
   * rejects a key ending in one.
   */
  private static randomKeySuffix(): string {
    const digit = (from: number): string => String(from + Math.floor(Math.random() * (10 - from)));

    return `${digit(0)}${digit(0)}${digit(0)}${digit(1)}`;
  }

  private static idMinter(seed: string | undefined): (name: string) => string {
    return seed === undefined ? () => nanoid() : (name) => `${seed}-${name}`;
  }

  private static createDefaultSchema(mintId: (name: string) => string): PropertyDefinition[] {
    return [
      {
        id: mintId('title'),
        name: DATABASE_DEFAULT_TEXT.titleProperty,
        type: 'title',
        position: 'a0',
      },
      {
        id: mintId('status'),
        name: DATABASE_DEFAULT_TEXT.statusProperty,
        type: 'select',
        position: 'a1',
        config: {
          options: [
            {
              id: mintId('not-started'),
              label: DATABASE_DEFAULT_TEXT.statusNotStarted,
              color: 'gray',
              position: 'a0',
            },
            {
              id: mintId('in-progress'),
              label: DATABASE_DEFAULT_TEXT.statusInProgress,
              color: 'blue',
              position: 'a1',
            },
            {
              id: mintId('done'),
              label: DATABASE_DEFAULT_TEXT.statusDone,
              color: 'green',
              position: 'a2',
            },
          ],
        },
      },
    ];
  }

  private createDefaultView(type: ViewType, mintId: (name: string) => string): DatabaseViewConfig {
    const statusProp = this.schema.find((p) => p.type === 'select');

    return this.newView({
      id: mintId('view'),
      name: type === 'table' ? DATABASE_DEFAULT_TEXT.viewTypeTable : DATABASE_DEFAULT_TEXT.viewBoard,
      type,
      position: 'a0',
      ...(type === 'board' ? { groupBy: statusProp?.id } : {}),
    });
  }

  /**
   * A view as it is first written. `properties`, `calculations`, `filterTree`,
   * `colorRules`, the group lists and both group settings maps exist from birth so two peers' first edits
   * merge: a key both peers create at once is last-writer-wins. `properties`
   * is never empty (there is always a title), so the CRDT keys its entries by
   * id; the empty lists rely on the eager array rule in yjs/serializer.ts.
   * The tree id derives from the view id, so seeded clients write the same one.
   */
  private newView(
    seed: Pick<DatabaseViewConfig, 'id' | 'name' | 'type' | 'position'> & ViewCreateConfig
  ): DatabaseViewConfig {
    const base: DatabaseViewConfig = {
      ...seed,
      groupBy: seed.groupBy,
      sorts: seed.sorts ?? [],
      filters: seed.filters ?? [],
      visibleProperties: seed.visibleProperties ?? [],
      calculations: seed.calculations ?? [],
      hiddenGroups: seed.hiddenGroups ?? [],
      collapsedGroups: seed.collapsedGroups ?? [],
      filterTree: seed.filterTree ?? { id: `${seed.id}-filters`, conjunction: 'and', filterRules: [] },
      colorRules: seed.colorRules ?? [],
      groupSettings: seed.groupSettings ?? {},
      subGroupSettings: seed.subGroupSettings ?? {},
      ...(seed.type === 'timeline' ? { tableProperties: seed.tableProperties ?? [] } : {}),
    };
    const properties = seed.properties ?? resolveViewProperties(base, this.schema).map(({ id, visible }) => ({ id, visible }));

    return { ...base, properties, visibleProperties: visibleRowPropertyIds({ ...base, properties }, this.schema) };
  }
}
