import { CALCULATIONS_FOR_TYPE } from './database-calculations';
import type {
  CalendarRange,
  CalculationFn,
  CardSize,
  DatabaseViewConfig,
  LoadLimit,
  OpenPagesIn,
  TimelineZoom,
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

/** Unverified for tables: Notion documents the choices (10/25/50/100), not the default. */
export const DEFAULT_LOAD_LIMIT: LoadLimit = 50;

/** Measured in research/08. */
const BOARD_DEFAULT_LOAD_LIMIT: LoadLimit = 25;

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
  LOAD_LIMITS.find((limit) => limit === view.loadLimit) ?? (view.type === 'board' ? BOARD_DEFAULT_LOAD_LIMIT : DEFAULT_LOAD_LIMIT);

const OPEN_PAGES_IN: readonly OpenPagesIn[] = ['side', 'center', 'full'];

/** Notion's per-layout defaults: gallery and calendar open in a center peek, the rest in a side peek. */
export const resolveOpenPagesIn = (view: DatabaseViewConfig): OpenPagesIn =>
  OPEN_PAGES_IN.find((mode) => mode === view.openPagesIn)
  ?? (view.type === 'gallery' || view.type === 'calendar' ? 'center' : 'side');

const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large'];

export const resolveCardSize = (view: DatabaseViewConfig): CardSize =>
  CARD_SIZES.find((size) => size === view.cardSize) ?? 'medium';

export type ResolvedCardPreview =
  | { kind: 'none' | 'cover' | 'content' }
  | { kind: 'property'; propertyId: string };

const PROPERTY_PREVIEW = 'property:';

/** Notion shows page content when no preview is picked (H-galleries). A deleted property falls back the same way. */
export const resolveCardPreview = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ResolvedCardPreview => {
  const stored = view.cardPreview;

  if (stored === 'none' || stored === 'cover' || stored === 'content') {
    return { kind: stored };
  }

  if (typeof stored === 'string' && stored.startsWith(PROPERTY_PREVIEW)) {
    const propertyId = stored.slice(PROPERTY_PREVIEW.length);

    if (schema.some((p) => p.id === propertyId)) {
      return { kind: 'property', propertyId };
    }
  }

  return { kind: 'content' };
};

/**
 * A board card's preview. Unlike the gallery, a board shows none until one
 * is picked: boards saved before card previews existed keep their look.
 */
export const resolveBoardCardPreview = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ResolvedCardPreview =>
  view.cardPreview === undefined || (view.cardPreview.startsWith(PROPERTY_PREVIEW) && resolveCardPreview(view, schema).kind !== 'property')
    ? { kind: 'none' }
    : resolveCardPreview(view, schema);

export const resolveFitImage = (view: DatabaseViewConfig): boolean => view.fitImage === true;

const CALENDAR_RANGES: readonly CalendarRange[] = ['month', 'week'];

export const resolveCalendarRange = (view: DatabaseViewConfig): CalendarRange =>
  CALENDAR_RANGES.find((range) => range === view.calendarRange) ?? 'month';

export const resolveShowWeekends = (view: DatabaseViewConfig): boolean => view.showWeekends !== false;

/** The stored date property, else the first date property in schema order, else none. */
const resolveDateProperty = (stored: string | undefined, schema: PropertyDefinition[]): string | undefined => {
  const dates = bySchemaPosition(schema).filter((p) => p.type === 'date');

  return dates.find((p) => p.id === stored)?.id ?? dates[0]?.id;
};

export const resolveTimelineBy = (view: DatabaseViewConfig, schema: PropertyDefinition[]): string | undefined =>
  resolveDateProperty(view.timelineBy, schema);

/** A separate end property, only when it is a date property other than the start. */
export const resolveTimelineEndBy = (view: DatabaseViewConfig, schema: PropertyDefinition[]): string | undefined => {
  const end = schema.find((p) => p.id === view.timelineEndBy && p.type === 'date')?.id;

  return end !== undefined && end !== resolveTimelineBy(view, schema) ? end : undefined;
};

export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['hours', 'day', 'week', 'bi_week', 'month', 'quarter', 'year', '5_years'];

/** A new Notion timeline opens at Month zoom (research/08 shot 83). */
export const resolveTimelineZoom = (view: DatabaseViewConfig): TimelineZoom =>
  TIMELINE_ZOOMS.find((zoom) => zoom === view.timelineZoom) ?? 'month';

/** A new Notion timeline has "Show table" off (research/08). */
export const resolveShowTimelineTable = (view: DatabaseViewConfig): boolean => view.showTimelineTable === true;

/** The table panel's columns. The title shows and leads; the rest stay hidden until picked. */
export const resolveTimelineTableProperties = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ResolvedViewProperty[] => {
  const resolved = resolveViewProperties({ ...view, type: 'timeline', properties: Array.isArray(view.tableProperties) ? view.tableProperties : [] }, schema);
  const titleIds = new Set(schema.filter((p) => p.type === 'title').map((p) => p.id));

  return [...resolved.filter((p) => titleIds.has(p.id)), ...resolved.filter((p) => !titleIds.has(p.id))];
};

/** The dependency relation, while that property exists. */
export const resolveArrowsBy = (view: DatabaseViewConfig, schema: PropertyDefinition[]): string | undefined =>
  schema.some((p) => p.id === view.arrowsBy) ? view.arrowsBy : undefined;

export const resolveCalendarBy = (view: DatabaseViewConfig, schema: PropertyDefinition[]): string | undefined =>
  resolveDateProperty(view.calendarBy, schema);

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
