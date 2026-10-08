import { CALCULATIONS_FOR_TYPE } from './database-calculations';
import type {
  CalculationFn,
  DatabaseViewConfig,
  LoadLimit,
  OpenPagesIn,
  PropertyDefinition,
  ViewCalculation,
  ViewPropertySetting,
} from './types';

/**
 * Read-time defaults for a view's optional fields. Read every view field
 * through here: old documents lack them, and v1.16.1 documents only carry
 * `visibleProperties`.
 */

export const LOAD_LIMITS: readonly LoadLimit[] = [10, 25, 50, 100];

/** Unverified: Notion documents the choices (10/25/50/100), not the default. */
export const DEFAULT_LOAD_LIMIT: LoadLimit = 50;

export interface ResolvedViewProperty {
  id: string;
  visible: boolean;
  /** Pixels. Undefined means the renderer's default width. */
  width?: number;
  wrap: boolean;
}

export type ViewPropertyPatch = Partial<Pick<ViewPropertySetting, 'visible' | 'width' | 'wrap'>>;

const bySchemaPosition = (schema: PropertyDefinition[]): PropertyDefinition[] =>
  [...schema].sort((a, b) => (a.position < b.position ? -1 : 1));

/** A property the view does not mention: shown in a table, hidden elsewhere. The title always shows. */
const defaultVisible = (view: DatabaseViewConfig, property: PropertyDefinition): boolean =>
  property.type === 'title' || view.type === 'table';

/** Stored entries merged by id. The first occurrence keeps its place; later fields win. */
const mergeDuplicates = (entries: ViewPropertySetting[]): ViewPropertySetting[] => {
  const merged = new Map<string, ViewPropertySetting>();

  for (const entry of entries) {
    merged.set(entry.id, { ...merged.get(entry.id), ...entry });
  }

  return [...merged.values()];
};

/** `visibleProperties` as a v1.16.1 client wrote it, turned into entries. */
const legacyEntries = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ViewPropertySetting[] => {
  const ordered = bySchemaPosition(schema);
  const listed = view.visibleProperties ?? [];

  if (listed.length === 0) {
    return ordered.map((p) => ({ id: p.id, visible: defaultVisible(view, p) }));
  }

  const known = new Set(ordered.map((p) => p.id));
  const shown = listed.filter((id, index) => known.has(id) && listed.indexOf(id) === index);
  const titles = ordered.filter((p) => p.type === 'title' && !shown.includes(p.id));
  const rest = ordered.filter((p) => p.type !== 'title' && !shown.includes(p.id));

  return [
    ...titles.map((p) => ({ id: p.id, visible: true })),
    ...shown.map((id) => ({ id, visible: true })),
    ...rest.map((p) => ({ id: p.id, visible: false })),
  ];
};

const validWidth = (width: unknown): number | undefined =>
  typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : undefined;

/**
 * Every schema property, in column order, with its settings in this view.
 * Entries for properties the schema lacks are skipped; schema properties the
 * view does not mention go last.
 */
export const resolveViewProperties = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ResolvedViewProperty[] => {
  const entries = Array.isArray(view.properties) ? mergeDuplicates(view.properties) : legacyEntries(view, schema);
  const propertiesById = new Map(schema.map((p) => [p.id, p]));
  const wrapAll = resolveWrapCells(view);
  const seen = new Set<string>();
  const resolved: ResolvedViewProperty[] = [];

  const push = (property: PropertyDefinition, entry: ViewPropertySetting | undefined): void => {
    const width = validWidth(entry?.width);

    seen.add(property.id);
    resolved.push({
      id: property.id,
      visible: typeof entry?.visible === 'boolean' ? entry.visible : defaultVisible(view, property),
      ...(width !== undefined ? { width } : {}),
      wrap: typeof entry?.wrap === 'boolean' ? entry.wrap : wrapAll,
    });
  };

  for (const entry of entries) {
    const property = propertiesById.get(entry.id);

    if (property !== undefined) {
      push(property, entry);
    }
  }

  for (const property of bySchemaPosition(schema)) {
    if (!seen.has(property.id)) {
      push(property, undefined);
    }
  }

  return resolved;
};

/**
 * Visible non-title property ids, in column order. This is the legacy
 * `visibleProperties` value and what a list row shows beside its title.
 */
export const visibleRowPropertyIds = (view: DatabaseViewConfig, schema: PropertyDefinition[]): string[] => {
  const titleIds = new Set(schema.filter((p) => p.type === 'title').map((p) => p.id));

  return resolveViewProperties(view, schema)
    .filter((p) => p.visible && !titleIds.has(p.id))
    .map((p) => p.id);
};

/**
 * The stored `properties` list to write. Unknown fields and entries for ids
 * this client's schema lacks are kept: a peer's schema may be ahead.
 */
const storedOrMaterialised = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ViewPropertySetting[] =>
  Array.isArray(view.properties)
    ? mergeDuplicates(view.properties.map((entry) => ({ ...entry })))
    : legacyEntries(view, schema);

/** The `properties` list after changing one column's settings. */
export const withPropertySetting = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  propertyId: string,
  patch: ViewPropertyPatch
): ViewPropertySetting[] => {
  const entries = storedOrMaterialised(view, schema);
  const index = entries.findIndex((entry) => entry.id === propertyId);

  if (index !== -1) {
    entries[index] = { ...entries[index], ...patch };

    return entries;
  }

  const current = resolveViewProperties(view, schema).find((p) => p.id === propertyId);

  return [...entries, { id: propertyId, visible: current?.visible ?? true, ...patch }];
};

/** The `properties` list after moving one column before another, or to the end when `beforeId` is null. */
export const withPropertyOrder = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  propertyId: string,
  beforeId: string | null
): ViewPropertySetting[] => {
  const stored = storedOrMaterialised(view, schema);
  const storedIds = new Set(stored.map((entry) => entry.id));
  const missing = resolveViewProperties(view, schema)
    .filter((p) => !storedIds.has(p.id))
    .map((p) => ({ id: p.id, visible: p.visible }));
  const entries = [...stored, ...missing];
  const moving = entries.find((entry) => entry.id === propertyId);

  if (moving === undefined || propertyId === beforeId) {
    return entries;
  }

  const rest = entries.filter((entry) => entry.id !== propertyId);
  const at = beforeId === null ? -1 : rest.findIndex((entry) => entry.id === beforeId);

  if (at === -1) {
    return [...rest, moving];
  }

  return [...rest.slice(0, at), moving, ...rest.slice(at)];
};

export const resolveWrapCells = (view: DatabaseViewConfig): boolean => view.wrapCells === true;

export const resolveShowVerticalLines = (view: DatabaseViewConfig): boolean => view.showVerticalLines !== false;

export const resolveFrozenColumnCount = (view: DatabaseViewConfig): number => {
  const count = view.frozenColumnCount;

  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

export const resolveLoadLimit = (view: DatabaseViewConfig): LoadLimit =>
  LOAD_LIMITS.find((limit) => limit === view.loadLimit) ?? DEFAULT_LOAD_LIMIT;

const OPEN_PAGES_IN: readonly OpenPagesIn[] = ['side', 'center', 'full'];

/** Notion's per-layout defaults: gallery (and calendar) open in a center peek, the rest in a side peek. */
export const resolveOpenPagesIn = (view: DatabaseViewConfig): OpenPagesIn =>
  OPEN_PAGES_IN.find((mode) => mode === view.openPagesIn) ?? (view.type === 'gallery' ? 'center' : 'side');

/**
 * Property id → calculation. Two peers can add a calculation to one column
 * at once and leave two entries; the last one wins. A function the column's
 * type does not offer is skipped.
 */
export const resolveCalculations = (view: DatabaseViewConfig, schema: PropertyDefinition[]): Map<string, CalculationFn> => {
  const propertiesById = new Map(schema.map((p) => [p.id, p]));
  const resolved = new Map<string, CalculationFn>();

  for (const entry of view.calculations ?? []) {
    const property = propertiesById.get(entry.id);

    if (property !== undefined && CALCULATIONS_FOR_TYPE[property.type]?.includes(entry.fn)) {
      resolved.set(entry.id, entry.fn);
    }
  }

  return resolved;
};

/** The `calculations` list after setting one column's function, or clearing it with null. */
export const withCalculation = (view: DatabaseViewConfig, propertyId: string, fn: CalculationFn | null): ViewCalculation[] => {
  const entries = (view.calculations ?? []).map((entry) => ({ ...entry }));
  const index = entries.findIndex((entry) => entry.id === propertyId);
  const others = entries.filter((entry) => entry.id !== propertyId);

  if (fn === null) {
    return others;
  }

  if (index === -1) {
    return [...entries, { id: propertyId, fn }];
  }

  return [...others.slice(0, index), { ...entries[index], fn }, ...others.slice(index)];
};
