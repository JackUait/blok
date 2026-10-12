import type { DatabaseViewConfig, PropertyDefinition, ViewPropertySetting } from './types';

/*
 * How a view's stored `properties` resolve into columns. Shared by the editor's view
 * settings (src/tools/database/view-settings.ts re-exports these) and the headless
 * database actions, which build views the same way the editor does.
 */

export interface ResolvedViewProperty {
  id: string;
  visible: boolean;
  /** Pixels. Undefined means the renderer's default width. */
  width?: number;
  wrap: boolean;
}


export const bySchemaPosition = (schema: PropertyDefinition[]): PropertyDefinition[] =>
  [...schema].sort((a, b) => (a.position < b.position ? -1 : 1));

/** A property the view does not mention: shown in a table, hidden elsewhere. The title always shows. */
const defaultVisible = (view: DatabaseViewConfig, property: PropertyDefinition): boolean =>
  property.type === 'title' || view.type === 'table' || view.type === 'form';

/** Stored entries merged by id. The first occurrence keeps its place; later fields win. */
export const mergeDuplicates = (entries: ViewPropertySetting[]): ViewPropertySetting[] => {
  const merged = new Map<string, ViewPropertySetting>();

  for (const entry of entries) {
    merged.set(entry.id, { ...merged.get(entry.id), ...entry });
  }

  return [...merged.values()];
};

/** `visibleProperties` as a v1.16.1 client wrote it, turned into entries. */
export const legacyEntries = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ViewPropertySetting[] => {
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

export const resolveWrapCells = (view: DatabaseViewConfig): boolean => view.wrapCells === true;

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
