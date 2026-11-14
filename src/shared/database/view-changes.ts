import { DATABASE_DEFAULT_TEXT } from './default-text';
import { visibleRowPropertyIds } from './view-properties';

import type { DatabaseViewConfig, DatabaseViewSettingKey, PropertyDefinition, PropertyType, ViewType } from './types';

/*
 * The rules a view write follows, shared by the editor (DatabaseModel.updateView,
 * the view settings, the layout switch) and the database.updateView and
 * database.setLayout agent actions. Pure and JSON only: the Jint realm runs it.
 */

export type ViewChanges = Partial<Pick<DatabaseViewConfig,
  'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties' | 'rowOrder' | DatabaseViewSettingKey
>>;

/** Rich text holds a document, which has no group. Notion also leaves out Files, Button and ID (research/08). */
export const GROUPABLE_TYPES: readonly PropertyType[] = [
  'title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone',
  'person', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'relation', 'formula', 'rollup',
];

export const OPTION_GROUP_TYPES: readonly PropertyType[] = ['select', 'multiSelect', 'status'];

/**
 * Applies a view write in place. A key given as undefined (the editor) or null
 * (an agent) is removed. `visibleProperties` follows `properties`, because
 * v1.16.1 clients read only it.
 */
export const applyViewChanges = (view: DatabaseViewConfig, changes: Readonly<Record<string, unknown>>, schema: PropertyDefinition[]): void => {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null) {
      Reflect.deleteProperty(view, key);
    } else {
      Reflect.set(view, key, value);
    }
  }
  if (changes.properties !== undefined) {
    Reflect.set(view, 'visibleProperties', visibleRowPropertyIds(view, schema));
  }
};

/**
 * Gives every entry an id. Old documents hold filters and sorts without one;
 * every write adds them so two peers' entries pair by id. The id comes from
 * the entry's place in the stored list, so every read (and every peer)
 * derives the same one: a pill drawn from one read finds its filter in the next.
 */
export const withEntryIds = <T extends { id?: string }>(entries: readonly T[]): Array<T & { id: string }> =>
  entries.map((entry, index) => (typeof entry.id === 'string' && entry.id !== '' ? entry as T & { id: string } : { ...entry, id: `legacy-${index}` }));

/**
 * The write when people pick what a view groups by. A switch to another
 * property starts from that type's defaults (research/23 §2e): a number hides
 * empty groups, a select does not. Re-picking the same property keeps them.
 */
export const groupByChange = (
  view: DatabaseViewConfig | undefined,
  property: PropertyDefinition
): Pick<DatabaseViewConfig, 'groupBy' | 'groupSettings'> => {
  if (property.id === view?.groupBy) return { groupBy: property.id };

  return { groupBy: property.id, groupSettings: property.type === 'number' ? { hideEmptyGroups: true } : {} };
};

/**
 * The write when people pick a board's sub-group. Notion hid the bands with no
 * cards right after the pick (research/30 B26); the switch itself was not read.
 * Re-picking the same property keeps the settings.
 */
export const subGroupByChange = (
  view: DatabaseViewConfig | undefined,
  property: PropertyDefinition
): Pick<DatabaseViewConfig, 'subGroupBy' | 'subGroupSettings'> => {
  if (property.id === view?.subGroupBy) return { subGroupBy: property.id };

  return { subGroupBy: property.id, subGroupSettings: { hideEmptyGroups: true } };
};

/** The name Add view gives each layout; stored in English and shown translated (database-localization.ts). */
export const DEFAULT_VIEW_NAMES: Readonly<Partial<Record<ViewType, string>>> = {
  table: DATABASE_DEFAULT_TEXT.viewTypeTable,
  board: DATABASE_DEFAULT_TEXT.viewTypeBoard,
  list: DATABASE_DEFAULT_TEXT.viewTypeList,
  gallery: DATABASE_DEFAULT_TEXT.viewTypeGallery,
  calendar: DATABASE_DEFAULT_TEXT.viewTypeCalendar,
  timeline: DATABASE_DEFAULT_TEXT.viewTypeTimeline,
  chart: DATABASE_DEFAULT_TEXT.viewTypeChart,
  feed: DATABASE_DEFAULT_TEXT.viewTypeFeed,
  // notion-motion.md Round 31 §1.
  form: DATABASE_DEFAULT_TEXT.viewFormBuilder,
  map: DATABASE_DEFAULT_TEXT.viewTypeMap,
  dashboard: DATABASE_DEFAULT_TEXT.viewTypeDashboard,
};

/** Form views made before "Form builder" were named "Form". */
const isDefaultName = (view: DatabaseViewConfig): boolean =>
  view.name === DEFAULT_VIEW_NAMES[view.type] || (view.type === 'form' && view.name === DATABASE_DEFAULT_TEXT.viewTypeForm);

export interface LayoutChange {
  changes: ViewChanges;
  /** A map needs a place property; the caller adds one when the schema has none. */
  needsPlace: boolean;
}

/**
 * The write when people switch a view's layout. A board needs a grouping: the
 * first select-like property, else the first property it can group by. Undefined
 * when a board has nothing to group by. A view still named after its old layout
 * takes the new layout's name. A timeline's table columns are born
 * empty with the switch: two peers adding the first column would race to create the key.
 */
export const layoutChange = (view: DatabaseViewConfig, type: ViewType, schema: PropertyDefinition[]): LayoutChange | undefined => {
  const groupable = (p: PropertyDefinition): boolean => p.type !== 'title' && GROUPABLE_TYPES.includes(p.type);
  const groupBy = type === 'board' && view.groupBy === undefined
    ? (schema.find((p) => OPTION_GROUP_TYPES.includes(p.type)) ?? schema.find(groupable))?.id
    : undefined;

  if (type === 'board' && view.groupBy === undefined && groupBy === undefined) return undefined;

  // notion-motion.md Round 30 §1: "Table" became "Calendar". A custom name is kept (Notion unread).
  const renamed = isDefaultName(view) ? DEFAULT_VIEW_NAMES[type] : undefined;

  return {
    changes: {
      type,
      ...(renamed !== undefined ? { name: renamed } : {}),
      ...(groupBy !== undefined ? { groupBy } : {}),
      ...(type === 'timeline' && !Array.isArray(view.tableProperties) ? { tableProperties: [] } : {}),
    },
    needsPlace: type === 'map' && !schema.some((p) => p.type === 'place'),
  };
};
