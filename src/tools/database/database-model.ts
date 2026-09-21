import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import type {
  DatabaseData,
  DatabaseRow,
  DatabaseViewConfig,
  PropertyConfig,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
  ViewType,
} from './types';
import { DATABASE_DEFAULT_TEXT } from './database-localization';

/** Sorts after every real fractional key: 'z' is the last digit of the base62 alphabet. */
const ORPHAN_GROUP_POSITION = 'zzzzzzzz';

export class DatabaseModel {
  private schema: PropertyDefinition[];
  private rows: DatabaseRow[] = [];
  private views: DatabaseViewConfig[];
  private activeViewId: string;
  /** Ids this session minted after the model was built. A hydrate may not drop them. */
  private readonly locallyAdded = new Set<string>();

  constructor(data?: Partial<DatabaseData>) {
    if (data?.schema !== undefined && data.schema.length > 0) {
      this.schema = data.schema.map((p) => ({ ...p }));
    } else {
      this.schema = DatabaseModel.createDefaultSchema();
    }

    if (data?.views !== undefined && data.views.length > 0) {
      this.views = data.views.map((v) => ({ ...v, sorts: [...v.sorts], filters: [...v.filters], visibleProperties: [...v.visibleProperties] }));
    } else {
      const statusProp = this.schema.find((p) => p.type === 'select');
      this.views = [DatabaseModel.createDefaultView(statusProp?.id)];
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

  addProperty(name: string, type: PropertyType, config?: PropertyConfig): PropertyDefinition {
    const lastPosition = this.schema.length > 0 ? this.schema[this.schema.length - 1].position : null;
    const prop: PropertyDefinition = {
      id: nanoid(),
      name,
      type,
      position: DatabaseModel.positionBetween(lastPosition, null),
      ...(config !== undefined ? { config } : {}),
    };
    this.schema.push(prop);
    this.locallyAdded.add(prop.id);
    return prop;
  }

  updateProperty(propertyId: string, changes: Partial<Pick<PropertyDefinition, 'name' | 'config'>>): void {
    const prop = this.schema.find((p) => p.id === propertyId);
    if (prop === undefined) return;
    if (changes.name !== undefined) prop.name = changes.name;
    if (changes.config !== undefined) prop.config = changes.config;
  }

  deleteProperty(propertyId: string): void {
    this.schema = this.schema.filter((p) => p.id !== propertyId);
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

  getRowsGroupedBy(propertyId: string): Map<string, DatabaseRow[]> {
    const groups = new Map<string, DatabaseRow[]>();
    const ordered = this.getOrderedRows();
    for (const row of ordered) {
      const rawValue = row.properties[propertyId];
      const key = this.toGroupKey(rawValue);
      const existing = groups.get(key);
      if (existing !== undefined) {
        existing.push(row);
      } else {
        groups.set(key, [row]);
      }
    }
    return groups;
  }

  getSelectOptions(propertyId: string): SelectOption[] {
    const prop = this.getProperty(propertyId);
    if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) return [];
    const options = prop.config?.options ?? [];
    const sorted = [...options].sort((a, b) => (a.position < b.position ? -1 : 1));

    return [...sorted, ...this.orphanGroupOptions(propertyId, sorted)];
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
      .filter((key) => key !== '' && !knownIds.has(key))
      .map((key) => ({ id: key, label: '', position: ORPHAN_GROUP_POSITION }));
  }

  // ─── Views ───

  getViews(): DatabaseViewConfig[] {
    return [...this.views];
  }

  getView(viewId: string): DatabaseViewConfig | undefined {
    return this.views.find((v) => v.id === viewId);
  }

  addView(name: string, type: ViewType, config: Partial<Pick<DatabaseViewConfig, 'groupBy' | 'sorts' | 'filters' | 'visibleProperties'>> = {}): DatabaseViewConfig {
    const sorted = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const lastPosition = sorted.length > 0 ? sorted[sorted.length - 1].position : null;
    const view: DatabaseViewConfig = {
      id: nanoid(),
      name,
      type,
      position: DatabaseModel.positionBetween(lastPosition, null),
      groupBy: config.groupBy,
      sorts: config.sorts ?? [],
      filters: config.filters ?? [],
      visibleProperties: config.visibleProperties ?? [],
    };
    this.views.push(view);
    this.locallyAdded.add(view.id);
    return view;
  }

  updateView(viewId: string, changes: Partial<Pick<DatabaseViewConfig, 'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties'>>): void {
    const view = this.views.find((v) => v.id === viewId);
    if (view === undefined) return;
    Object.assign(view, changes);
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
      merged.set(item.id, item);
    }

    return [...merged.values()].sort((a, b) => (a.position < b.position ? -1 : 1));
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

  private toGroupKey(value: PropertyValue | undefined): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return '';
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

  private static createDefaultSchema(): PropertyDefinition[] {
    return [
      {
        id: nanoid(),
        name: DATABASE_DEFAULT_TEXT.titleProperty,
        type: 'title',
        position: 'a0',
      },
      {
        id: nanoid(),
        name: DATABASE_DEFAULT_TEXT.statusProperty,
        type: 'select',
        position: 'a1',
        config: {
          options: [
            {
              id: nanoid(),
              label: DATABASE_DEFAULT_TEXT.statusNotStarted,
              color: 'gray',
              position: 'a0',
            },
            {
              id: nanoid(),
              label: DATABASE_DEFAULT_TEXT.statusInProgress,
              color: 'blue',
              position: 'a1',
            },
            {
              id: nanoid(),
              label: DATABASE_DEFAULT_TEXT.statusDone,
              color: 'green',
              position: 'a2',
            },
          ],
        },
      },
    ];
  }

  private static createDefaultView(groupByPropertyId?: string): DatabaseViewConfig {
    return {
      id: nanoid(),
      name: DATABASE_DEFAULT_TEXT.viewBoard,
      type: 'board',
      position: 'a0',
      groupBy: groupByPropertyId,
      sorts: [],
      filters: [],
      visibleProperties: [],
    };
  }
}
