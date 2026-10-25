import { DATABASE_DEFAULT_TEXT } from '../database/default-text';
import { comparePositions } from '../database/positions';
import { typeConversion } from '../database/property-conversion';
import {
  createDefaultSchema,
  createDefaultStatusOptions,
  createDefaultStatusSettings,
  createDefaultView,
  freePropertyName,
  isListValueType,
  newView,
  positionBetween,
} from '../database/schema-ops';
import { applyViewChanges, GROUPABLE_TYPES, groupByChange, layoutChange, subGroupByChange, withEntryIds } from '../database/view-changes';
import { revealedInLegacyView } from '../database/view-properties';

import type { BlockPosition } from '../../../types/api/blocks';
import type { ToolActionContext, ToolActionImpl } from '../../../types/tools/tool-description';
import type { ConvertibleRow } from '../database/property-conversion';
import type { ConvertedValue, DatabaseViewConfig, PropertyDefinition, PropertyType, SelectOption, TemplateRepeat, ViewType } from '../database/types';

type TargetBlock = NonNullable<ToolActionContext['block']>;

export interface DatabaseState {
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
}

export interface Placement {
  before?: string;
  after?: string;
}

// The Jint realm has no structuredClone; block data is JSON.
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const databaseTarget = (ctx: ToolActionContext): TargetBlock =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a database block.');

export const readDatabase = (block: TargetBlock): DatabaseState => {
  const { schema, views, activeViewId } = block.data;

  return {
    schema: Array.isArray(schema) ? jsonCopy(schema as PropertyDefinition[]) : [],
    views: Array.isArray(views) ? jsonCopy(views as DatabaseViewConfig[]) : [],
    activeViewId: typeof activeViewId === 'string' ? activeViewId : '',
  };
};

/** Schema and views are frozen while the title property carries `databaseLocked` (the editor's structureLocked). */
export const assertUnlocked = (ctx: ToolActionContext, state: DatabaseState): void => {
  if (state.schema.some(property => property.type === 'title' && property.databaseLocked === true)) {
    ctx.fail('PRECONDITION_FAILED', 'This database is locked: its properties and views cannot change. Rows can.');
  }
};

/** The schema with `property` added, and the views only when a legacy table view had to show it. */
const withNewProperty = (state: DatabaseState, property: PropertyDefinition): { schema: PropertyDefinition[]; views?: DatabaseViewConfig[] } => {
  const schema = [...state.schema, property];
  const views = state.views.map(view => revealedInLegacyView(view, schema, property));

  return views.some((view, i) => view !== state.views[i]) ? { schema, views } : { schema };
};

/** Opens the target database for a schema or view change. */
const openDatabase = (ctx: ToolActionContext): { block: TargetBlock; state: DatabaseState } => {
  const block = databaseTarget(ctx);
  const state = readDatabase(block);

  assertUnlocked(ctx, state);

  return { block, state };
};

export const sortedByPosition = <T extends { position: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => comparePositions(a.position, b.position));

/** A position next to `ref` (by id), or after the last item. */
export const positionAround = <T extends { id: string; position: string }>(ctx: ToolActionContext, items: T[], ref: Placement = {}): string => {
  const sorted = sortedByPosition(items);
  const anchor = ref.before ?? ref.after;

  if (anchor === undefined) {
    return positionBetween(sorted.at(-1)?.position ?? null, null);
  }
  const index = sorted.findIndex(item => item.id === anchor);
  const item = sorted[index] ?? ctx.fail('PRECONDITION_FAILED', `No item with id ${anchor}.`);

  return ref.before === undefined
    ? positionBetween(item.position, sorted[index + 1]?.position ?? null)
    : positionBetween(sorted[index - 1]?.position ?? null, item.position);
};

// newView keeps `groupBy: undefined` as the editor model does; saved JSON drops it, so a write must too.
const savedView = (view: DatabaseViewConfig): DatabaseViewConfig => jsonCopy(view);

const exactlyOnePlacement = (ctx: ToolActionContext, ref: Placement): void => {
  if ((ref.before === undefined) === (ref.after === undefined)) {
    ctx.fail('INVALID_ARGS', 'Pass exactly one of before or after.');
  }
};

const viewIndex = (ctx: ToolActionContext, state: DatabaseState, viewId: string): number => {
  const index = state.views.findIndex(view => view.id === viewId);

  return index >= 0 ? index : ctx.fail('PRECONDITION_FAILED', `This database has no view ${viewId}.`);
};

/** The names the editor gives a new view of each layout (DatabaseTool.addView). */
const VIEW_NAMES: Partial<Record<ViewType, string>> = {
  board: DATABASE_DEFAULT_TEXT.viewTypeBoard,
  list: DATABASE_DEFAULT_TEXT.viewTypeList,
  table: DATABASE_DEFAULT_TEXT.viewTypeTable,
  gallery: DATABASE_DEFAULT_TEXT.viewTypeGallery,
  calendar: DATABASE_DEFAULT_TEXT.viewTypeCalendar,
  timeline: DATABASE_DEFAULT_TEXT.viewTypeTimeline,
  chart: DATABASE_DEFAULT_TEXT.viewTypeChart,
  feed: DATABASE_DEFAULT_TEXT.viewTypeFeed,
  form: DATABASE_DEFAULT_TEXT.viewTypeForm,
  map: DATABASE_DEFAULT_TEXT.viewTypeMap,
};

interface CreateArgs {
  title?: string;
  view?: 'board' | 'list' | 'table';
  parentId?: string | null;
  position?: BlockPosition;
}

const create: ToolActionImpl<CreateArgs, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const mint = (): string => ctx.newId();
    const schema = createDefaultSchema(mint);
    const kind = args.view ?? 'board';
    const base = savedView(createDefaultView(kind, schema, mint));
    const view = kind === 'list' ? { ...base, name: DATABASE_DEFAULT_TEXT.viewTypeList } : base;
    const id = ctx.insert({
      // The host's registry key, not 'database'.
      type: ctx.tool,
      data: { ...(args.title === undefined ? {} : { title: args.title }), schema, views: [view], activeViewId: view.id },
      parentId: args.parentId,
      position: args.position,
    });

    return { id, childIds: [] };
  },
};

const GROUPED_VIEWS = new Set<ViewType>(['board', 'chart']);

/** As DatabaseTool.ensurePlaceProperty: a map needs a place, so one named Place is added when there is none. */
const withPlaceProperty = (ctx: ToolActionContext, state: DatabaseState): Partial<DatabaseState> => {
  if (state.schema.some(property => property.type === 'place')) {
    return {};
  }
  const property: PropertyDefinition = {
    id: ctx.newId(),
    name: freePropertyName(state.schema.map(each => each.name), DATABASE_DEFAULT_TEXT.placeProperty),
    type: 'place',
    position: positionAround(ctx, state.schema),
  };

  return withNewProperty(state, property);
};

const addView: ToolActionImpl<{ type: ViewType; name?: string; groupBy?: string }, undefined, { viewId: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const given = args.groupBy === undefined
      ? undefined
      : state.schema.find(property => property.id === args.groupBy) ?? ctx.fail('PRECONDITION_FAILED', `This database has no property ${args.groupBy}.`);
    // The editor groups a new board or chart by the first select property.
    const groupBy = given ?? (GROUPED_VIEWS.has(args.type) ? state.schema.find(property => property.type === 'select') : undefined);

    if (args.type === 'board' && groupBy?.type !== 'select') {
      ctx.fail('PRECONDITION_FAILED', 'A board view groups by a select property: pass groupBy with the id of one, or add one first.');
    }
    const place = args.type === 'map' ? withPlaceProperty(ctx, state) : {};
    const schema = place.schema ?? state.schema;
    const views = place.views ?? state.views;
    const view = savedView(newView({
      id: ctx.newId(),
      name: args.name ?? VIEW_NAMES[args.type] ?? DATABASE_DEFAULT_TEXT.viewTypeBoard,
      type: args.type,
      position: positionAround(ctx, state.views),
      ...(groupBy === undefined ? {} : { groupBy: groupBy.id }),
    }, schema));

    ctx.update(block.id, { ...place, views: [...views, view], activeViewId: view.id });

    return { viewId: view.id };
  },
};

const renameView: ToolActionImpl<{ viewId: string; name: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const index = viewIndex(ctx, state, args.viewId);

    ctx.update(block.id, { views: state.views.map((view, i) => (i === index ? { ...view, name: args.name } : view)) });

    return undefined;
  },
};

const moveView: ToolActionImpl<{ viewId: string } & Placement> = {
  run: (ctx, args) => {
    exactlyOnePlacement(ctx, args);
    const { block, state } = openDatabase(ctx);
    const index = viewIndex(ctx, state, args.viewId);
    const others = state.views.filter(view => view.id !== args.viewId);
    const position = positionAround(ctx, others, { before: args.before, after: args.after });

    ctx.update(block.id, { views: state.views.map((view, i) => (i === index ? { ...view, position } : view)) });

    return undefined;
  },
};

const deleteView: ToolActionImpl<{ viewId: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const index = viewIndex(ctx, state, args.viewId);

    if (state.views.length === 1) {
      ctx.fail('PRECONDITION_FAILED', 'A database keeps at least one view.');
    }
    const views = state.views.filter(view => view.id !== args.viewId);
    // As the editor: the view now at the deleted one's index, or the last one.
    const neighbour = views[Math.min(index, views.length - 1)];

    ctx.update(block.id, state.activeViewId === args.viewId && neighbour !== undefined ? { views, activeViewId: neighbour.id } : { views });

    return undefined;
  },
};

const duplicateView: ToolActionImpl<{ viewId: string }, undefined, { viewId: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const source = state.views[viewIndex(ctx, state, args.viewId)];

    if (source === undefined) {
      return ctx.fail('PRECONDITION_FAILED', `This database has no view ${args.viewId}.`);
    }
    // As the editor's duplicateView: every setting is copied, the copy goes last and opens.
    const { id: _id, position: _position, ...settings } = source;
    const copy = savedView(newView({ ...settings, id: ctx.newId(), position: positionAround(ctx, state.views) }, state.schema));

    ctx.update(block.id, { views: [...state.views, copy], activeViewId: copy.id });

    return { viewId: copy.id };
  },
};

// ─── View settings (the view settings panel, column header menus, group menus) ───

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The schema a view's settings name: the view's data source, else this linked
 * database's source, else its own. Undefined when the source is in another
 * document, so nothing can be checked here.
 */
const referenceSchema = (ctx: ToolActionContext, block: TargetBlock, state: DatabaseState, dataSourceId: unknown): PropertyDefinition[] | undefined => {
  const schemaOf = (id: string): PropertyDefinition[] | undefined => {
    const data = id === block.id ? block.data : ctx.read(id)?.data;

    return isRecord(data) && Array.isArray(data.schema) ? data.schema as PropertyDefinition[] : undefined;
  };

  if (typeof dataSourceId === 'string' && dataSourceId !== '' && dataSourceId !== block.id) {
    return schemaOf(dataSourceId) ?? ctx.fail('PRECONDITION_FAILED', `dataSourceId ${dataSourceId} is not a database block in this document.`);
  }
  const source = block.data.source;

  if (!isRecord(source) || typeof source.databaseId !== 'string') {
    return state.schema;
  }

  return typeof source.documentId === 'string' && source.documentId !== '' ? undefined : schemaOf(source.databaseId);
};

/** Fills in missing ids on an advanced filter tree, at every layer. */
const withNodeIds = (ctx: ToolActionContext, node: Record<string, unknown>): Record<string, unknown> => ({
  ...node,
  id: typeof node.id === 'string' && node.id !== '' ? node.id : ctx.newId(),
  ...(Array.isArray(node.filterRules) ? { filterRules: (node.filterRules as unknown[]).map(child => (isRecord(child) ? withNodeIds(ctx, child) : child)) } : {}),
});

const filterRuleProperties = (node: unknown): string[] => {
  if (!isRecord(node)) {
    return [];
  }

  return Array.isArray(node.filterRules)
    ? node.filterRules.flatMap(filterRuleProperties)
    : [typeof node.propertyId === 'string' ? node.propertyId : ''];
};

const idsIn = (list: unknown, key: string): string[] =>
  (Array.isArray(list) ? list : []).flatMap(entry => (isRecord(entry) && typeof entry[key] === 'string' ? [entry[key]] : []));

/** The property ids a view's settings name, other than the ones a type check covers. */
const namedProperties = (changes: Record<string, unknown>): string[] => {
  const preview = typeof changes.cardPreview === 'string' && changes.cardPreview.startsWith('property:') ? [changes.cardPreview.slice('property:'.length)] : [];
  const measure = typeof changes.chartMeasure === 'string' && changes.chartMeasure.includes(':') ? [changes.chartMeasure.slice(changes.chartMeasure.indexOf(':') + 1)] : [];

  return [
    ...idsIn(changes.filters, 'propertyId'),
    ...idsIn(changes.sorts, 'propertyId'),
    ...idsIn(changes.colorRules, 'propertyId'),
    ...idsIn(changes.calculations, 'id'),
    ...(isRecord(changes.groupCalculation) && typeof changes.groupCalculation.id === 'string' ? [changes.groupCalculation.id] : []),
    ...filterRuleProperties(changes.filterTree),
    ...preview,
    ...measure,
  ];
};

const DATE_SETTINGS = ['calendarBy', 'timelineBy', 'timelineEndBy'] as const;

/** Refuses a setting that names a property this database lacks, or one of a type it cannot use. */
const checkReferences = (ctx: ToolActionContext, schema: PropertyDefinition[], view: DatabaseViewConfig, changes: Record<string, unknown>, databaseId: string): void => {
  const find = (id: string): PropertyDefinition =>
    schema.find(property => property.id === id) ?? ctx.fail('PRECONDITION_FAILED', `This database has no property ${id}.`);
  const named = (key: string): PropertyDefinition | undefined => (typeof changes[key] === 'string' ? find(changes[key]) : undefined);

  for (const key of ['groupBy', 'subGroupBy']) {
    const property = named(key);

    if (property !== undefined && !GROUPABLE_TYPES.includes(property.type)) {
      ctx.fail('PRECONDITION_FAILED', `A view cannot group by property ${property.id}: a ${property.type} property has no groups.`);
    }
  }
  for (const key of DATE_SETTINGS) {
    const property = named(key);

    if (property !== undefined && property.type !== 'date') {
      ctx.fail('PRECONDITION_FAILED', `${key} names a date property; ${property.id} is a ${property.type} property.`);
    }
  }
  const place = named('mapBy');

  if (place !== undefined && place.type !== 'place') {
    ctx.fail('PRECONDITION_FAILED', `mapBy names a place property; ${place.id} is a ${place.type} property.`);
  }
  const arrows = named('arrowsBy');

  if (arrows !== undefined && (arrows.type !== 'relation' || arrows.relation?.targetDatabaseId !== databaseId)) {
    ctx.fail('PRECONDITION_FAILED', `arrowsBy names a relation from this database to itself; ${arrows.id} is not one.`);
  }
  namedProperties(changes).forEach(find);
  // An entry the view already holds may name a property a peer added: keep it.
  for (const key of ['properties', 'tableProperties'] as const) {
    const held = new Set(idsIn(view[key], 'id'));

    idsIn(changes[key], 'id').filter(id => !held.has(id)).forEach(find);
  }
};

const updateView: ToolActionImpl<{ viewId: string; changes: Record<string, unknown> }> = {
  run: (ctx, args) => {
    if (Object.keys(args.changes).length === 0) {
      ctx.fail('INVALID_ARGS', 'changes is empty: pass at least one view key.');
    }
    const { block, state } = openDatabase(ctx);
    const index = viewIndex(ctx, state, args.viewId);
    const view = state.views[index] ?? ctx.fail('PRECONDITION_FAILED', `This database has no view ${args.viewId}.`);
    const changes: Record<string, unknown> = jsonCopy(args.changes);
    const schema = referenceSchema(ctx, block, state, 'dataSourceId' in changes ? changes.dataSourceId : view.dataSourceId);

    if (schema !== undefined) {
      checkReferences(ctx, schema, view, changes, block.id);
    }
    // As "Save for everyone": every filter and sort carries the id each reader derives.
    for (const key of ['filters', 'sorts'] as const) {
      if (Array.isArray(changes[key])) {
        changes[key] = withEntryIds(changes[key] as Array<{ id?: string }>);
      }
    }
    if (isRecord(changes.filterTree)) {
      changes.filterTree = withNodeIds(ctx, { conjunction: 'and', filterRules: [], ...changes.filterTree });
    }
    if (Array.isArray(changes.colorRules)) {
      changes.colorRules = (changes.colorRules as unknown[]).map(rule => (isRecord(rule) && (typeof rule.id !== 'string' || rule.id === '') ? { ...rule, id: ctx.newId() } : rule));
    }
    // As the group pickers: a new grouping starts from its type's defaults; settings sent with it win.
    const picked = (key: 'groupBy' | 'subGroupBy'): PropertyDefinition | undefined => schema?.find(property => property.id === changes[key]);
    const groupBy = picked('groupBy');
    const subGroupBy = picked('subGroupBy');
    const grouping = {
      ...(groupBy === undefined ? {} : groupByChange(view, groupBy)),
      ...(subGroupBy === undefined ? {} : subGroupByChange(view, subGroupBy)),
    };
    const next = jsonCopy(view);

    applyViewChanges(next, { ...grouping, ...changes }, schema ?? state.schema);
    if (next.type === 'board' && next.groupBy === undefined) {
      ctx.fail('PRECONDITION_FAILED', 'A board view keeps its grouping: pass groupBy with another property instead of null.');
    }
    ctx.update(block.id, { views: state.views.map((each, i) => (i === index ? savedView(next) : each)) });

    return undefined;
  },
};

/** As DatabaseTool.setActiveLayout, for any view. */
const setLayout: ToolActionImpl<{ viewId: string; type: ViewType }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const index = viewIndex(ctx, state, args.viewId);
    const view = state.views[index] ?? ctx.fail('PRECONDITION_FAILED', `This database has no view ${args.viewId}.`);

    if (view.type === args.type) {
      return undefined;
    }
    const sourceSchema = referenceSchema(ctx, block, state, view.dataSourceId);
    const change = layoutChange(view, args.type, sourceSchema ?? state.schema)
      ?? ctx.fail('PRECONDITION_FAILED', 'A board groups its rows: add a select, status or other groupable property first.');
    // The editor adds the place where the view's rows live; only this database's own schema can take it here.
    const place = change.needsPlace && sourceSchema === state.schema ? withPlaceProperty(ctx, state) : {};
    const next = jsonCopy(view);

    applyViewChanges(next, change.changes, place.schema ?? state.schema);
    const views = (place.views ?? state.views).map((each, i) => (i === index ? savedView(next) : each));

    ctx.update(block.id, { ...place, views });

    return undefined;
  },
};

/** As DatabaseTool.setDatabaseLocked: the lock lives on the title property. A linked database without one gets a stand-in title. */
const setLock: ToolActionImpl<{ locked: boolean }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const title = state.schema.find(property => property.type === 'title');

    if (title === undefined && !args.locked) {
      return undefined;
    }
    const titled = title === undefined
      ? [{ id: ctx.newId(), name: DATABASE_DEFAULT_TEXT.titleProperty, type: 'title' as const, position: 'a0' }, ...state.schema]
      : state.schema;
    const schema = titled.map((property) => {
      if (property.type !== 'title') {
        return property;
      }
      const { databaseLocked: _was, ...rest } = property;

      return args.locked ? { ...rest, databaseLocked: true } : rest;
    });

    ctx.update(block.id, { schema });

    return undefined;
  },
};

// ─── Properties and options ───

const OPTION_TYPES = new Set<PropertyType>(['select', 'multiSelect', 'status']);

interface RowRef {
  id: string;
  position: string;
  properties: Record<string, unknown>;
  template: boolean;
}

/** Every database-row child, templates included. The order key is `data.position`. */
const rowBlocksOf = (ctx: ToolActionContext, databaseId: string): RowRef[] =>
  (ctx.read(databaseId)?.children ?? []).flatMap((rowId) => {
    const row = ctx.read(rowId);
    const data: Record<string, unknown> = typeof row?.data === 'object' && row.data !== null ? { ...row.data } : {};
    const properties = data.properties;

    return row === null || row.type !== 'database-row'
      ? []
      : [{
        id: rowId,
        position: typeof data.position === 'string' ? data.position : '',
        properties: typeof properties === 'object' && properties !== null ? { ...properties } : {},
        template: data.template === true,
      }];
  });

/** The database's rows. A template is a row block too, but no view, query or row write sees it (DatabaseTool.syncRowsFromBlocks). */
export const rowsOf = (ctx: ToolActionContext, databaseId: string): RowRef[] =>
  rowBlocksOf(ctx, databaseId).filter(row => !row.template);

const templatesOf = (ctx: ToolActionContext, databaseId: string): RowRef[] =>
  rowBlocksOf(ctx, databaseId).filter(row => row.template);

const propertyAt = (ctx: ToolActionContext, state: DatabaseState, propertyId: string): number => {
  const index = state.schema.findIndex(property => property.id === propertyId);

  return index >= 0 ? index : ctx.fail('PRECONDITION_FAILED', `This database has no property ${propertyId}.`);
};

const optionsOf = (ctx: ToolActionContext, state: DatabaseState, index: number): SelectOption[] => {
  const property = state.schema[index];

  return property !== undefined && OPTION_TYPES.has(property.type)
    ? [...(property.config?.options ?? [])]
    : ctx.fail('PRECONDITION_FAILED', `Property ${property?.id ?? ''} is not a select, multi-select or status property.`);
};

const withOptions = (state: DatabaseState, index: number, options: SelectOption[]): PropertyDefinition[] =>
  state.schema.map((property, i) => (i === index ? { ...property, config: { ...(property.config ?? {}), options } } : property));

interface NewOption {
  label: string;
  color?: string;
}

interface AddPropertyArgs extends Placement {
  name: string;
  type: PropertyType;
  options?: NewOption[];
}

const addProperty: ToolActionImpl<AddPropertyArgs, undefined, { propertyId: string }> = {
  run: (ctx, args) => {
    if (args.type === 'title') {
      ctx.fail('PRECONDITION_FAILED', 'A database has exactly one title property.');
    }
    if (args.options !== undefined && args.type !== 'select' && args.type !== 'multiSelect') {
      ctx.fail('PRECONDITION_FAILED', 'Only select and multiSelect properties take options. A status property starts with its default options.');
    }
    if (args.before !== undefined && args.after !== undefined) {
      ctx.fail('INVALID_ARGS', 'Pass before or after, not both.');
    }
    const { block, state } = openDatabase(ctx);
    const options = (args.options ?? []).reduce<SelectOption[]>((list, option) => [...list, {
      id: ctx.newId(),
      label: option.label,
      ...(option.color === undefined ? {} : { color: option.color }),
      position: positionBetween(list.at(-1)?.position ?? null, null),
    }], []);
    // As the editor's addProperty: a status gets the default options and groups, a relation points at this database.
    const extra: Partial<PropertyDefinition> = args.type === 'status'
      ? {
        config: {
          options: createDefaultStatusOptions({
            notStarted: DATABASE_DEFAULT_TEXT.statusNotStarted,
            inProgress: DATABASE_DEFAULT_TEXT.statusInProgress,
            done: DATABASE_DEFAULT_TEXT.statusDone,
          }, () => ctx.newId()),
        },
        status: createDefaultStatusSettings(),
      }
      : {
        ...(args.type === 'select' || args.type === 'multiSelect' ? { config: { options } } : {}),
        ...(args.type === 'relation' ? { relation: { targetDatabaseId: block.id } } : {}),
      };
    const property: PropertyDefinition = {
      id: ctx.newId(),
      name: freePropertyName(state.schema.map(each => each.name), args.name),
      type: args.type,
      position: positionAround(ctx, state.schema, { before: args.before, after: args.after }),
      ...extra,
    };

    ctx.update(block.id, withNewProperty(state, property));
    if (isListValueType(args.type)) {
      rowsOf(ctx, block.id)
        .filter(row => row.properties[property.id] === undefined || row.properties[property.id] === null)
        .forEach(row => ctx.update(row.id, { properties: { ...row.properties, [property.id]: [] } }));
    }

    return { propertyId: property.id };
  },
};

const addOption: ToolActionImpl<{ propertyId: string } & NewOption, undefined, { optionId: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const index = propertyAt(ctx, state, args.propertyId);
    const options = optionsOf(ctx, state, index);
    const property = state.schema[index];
    // A new status option sits in the first group, as Notion puts new options in To-do.
    const groupId = property?.type === 'status'
      ? sortedByPosition(property.status?.groups ?? createDefaultStatusSettings().groups)[0]?.id
      : undefined;
    const option: SelectOption = {
      id: ctx.newId(),
      label: args.label,
      ...(args.color === undefined ? {} : { color: args.color }),
      position: positionAround(ctx, options),
      ...(groupId === undefined ? {} : { groupId }),
    };

    ctx.update(block.id, { schema: withOptions(state, index, [...options, option]) });

    return { optionId: option.id };
  },
};

interface OptionArgs {
  propertyId: string;
  optionId: string;
}

/** Opens one option of one property for an edit. */
const openOption = (ctx: ToolActionContext, args: OptionArgs): { block: TargetBlock; state: DatabaseState; index: number; options: SelectOption[] } => {
  const { block, state } = openDatabase(ctx);
  const index = propertyAt(ctx, state, args.propertyId);
  const options = optionsOf(ctx, state, index);

  if (!options.some(option => option.id === args.optionId)) {
    ctx.fail('PRECONDITION_FAILED', `Property ${args.propertyId} has no option ${args.optionId}.`);
  }

  return { block, state, index, options };
};

const renameOption: ToolActionImpl<OptionArgs & { label: string }> = {
  run: (ctx, args) => {
    const { block, state, index, options } = openOption(ctx, args);

    ctx.update(block.id, { schema: withOptions(state, index, options.map(option => (option.id === args.optionId ? { ...option, label: args.label } : option))) });

    return undefined;
  },
};

const moveOption: ToolActionImpl<OptionArgs & Placement> = {
  run: (ctx, args) => {
    exactlyOnePlacement(ctx, args);
    const { block, state, index, options } = openOption(ctx, args);
    const others = options.filter(option => option.id !== args.optionId);
    const position = positionAround(ctx, others, { before: args.before, after: args.after });

    ctx.update(block.id, { schema: withOptions(state, index, options.map(option => (option.id === args.optionId ? { ...option, position } : option))) });

    return undefined;
  },
};

const holds = (value: unknown, optionId: string): boolean => (Array.isArray(value) ? value.includes(optionId) : value === optionId);

/**
 * The editor (handleOptionDelete, clearRemovedOptions) keeps the rows and empties the value:
 * null for a single value, the array without the option for a multi-select. `rows: 'delete'`
 * deletes those rows instead.
 */
const deleteOption: ToolActionImpl<OptionArgs & { rows: 'delete' | 'keep' }> = {
  run: (ctx, args) => {
    const { block, state, index, options } = openOption(ctx, args);

    if (options.length <= 1) {
      ctx.fail('PRECONDITION_FAILED', 'A property keeps at least one option.');
    }
    rowsOf(ctx, block.id)
      .filter(row => holds(row.properties[args.propertyId], args.optionId))
      .forEach((row) => {
        const value = row.properties[args.propertyId];

        if (args.rows === 'delete') {
          ctx.remove(row.id, { withChildren: true });
        } else {
          ctx.update(row.id, {
            properties: { ...row.properties, [args.propertyId]: Array.isArray(value) ? value.filter(id => id !== args.optionId) : null },
          });
        }
      });
    ctx.update(block.id, { schema: withOptions(state, index, options.filter(option => option.id !== args.optionId)) });

    return undefined;
  },
};

// ─── Rows ───

const titleOf = (state: DatabaseState, values: Record<string, unknown>): string | undefined => {
  const value = values[state.schema.find(property => property.type === 'title')?.id ?? ''];

  return typeof value === 'string' ? value : undefined;
};

/** `group` is an option of the property the open view groups by (a board column). */
const groupValue = (ctx: ToolActionContext, state: DatabaseState, group: string | undefined): Record<string, unknown> => {
  if (group === undefined) {
    return {};
  }
  const groupBy = state.views.find(view => view.id === state.activeViewId)?.groupBy;
  const property = state.schema.find(candidate => candidate.id === groupBy);

  if (property === undefined || !OPTION_TYPES.has(property.type)) {
    return ctx.fail('PRECONDITION_FAILED', 'group needs the open view to be grouped by a select or status property. Set the value with values instead.');
  }
  if (!(property.config?.options ?? []).some(option => option.id === group)) {
    return ctx.fail('PRECONDITION_FAILED', `Property ${property.id} has no option ${group}.`);
  }

  return { [property.id]: property.type === 'multiSelect' ? [group] : group };
};

/** As the editor's createRowData (withEmptyLists): `[]` for every list property the row holds no value for. */
const withEmptyLists = (state: DatabaseState, properties: Record<string, unknown>): Record<string, unknown> => ({
  ...properties,
  ...Object.fromEntries(state.schema
    .filter(property => isListValueType(property.type) && (properties[property.id] === undefined || properties[property.id] === null))
    .map(property => [property.id, []])),
});

const rowOf = (ctx: ToolActionContext, databaseId: string, rowId: string): RowRef =>
  rowsOf(ctx, databaseId).find(row => row.id === rowId)
    ?? ctx.fail('PRECONDITION_FAILED', `Block ${rowId} is not a row of this database.`);

const templateOf = (ctx: ToolActionContext, databaseId: string, templateId: string): RowRef =>
  templatesOf(ctx, databaseId).find(row => row.id === templateId)
    ?? ctx.fail('PRECONDITION_FAILED', `Block ${templateId} is not a template of this database.`);

const addRow: ToolActionImpl<{ values?: Record<string, unknown>; group?: string } & Placement, undefined, { rowId: string }> = {
  run: (ctx, args) => {
    if (args.before !== undefined && args.after !== undefined) {
      ctx.fail('INVALID_ARGS', 'Pass before or after, not both.');
    }
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const properties = withEmptyLists(state, { ...(args.values ?? {}), ...groupValue(ctx, state, args.group) });
    const title = titleOf(state, properties);
    const rowId = ctx.insert({
      type: 'database-row',
      data: {
        properties,
        position: positionAround(ctx, rowsOf(ctx, block.id), { before: args.before, after: args.after }),
        ...(title === undefined ? {} : { title }),
      },
      parentId: block.id,
    });

    return { rowId };
  },
};

const setRowValues: ToolActionImpl<{ rowId: string; values: Record<string, unknown> }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    // Editing a template's values is a row edit too (the editor's template page).
    const row = rowBlocksOf(ctx, block.id).find(candidate => candidate.id === args.rowId)
      ?? ctx.fail('PRECONDITION_FAILED', `Block ${args.rowId} is not a row of this database.`);
    const properties = { ...row.properties, ...args.values };
    const title = titleOf(readDatabase(block), properties);

    ctx.update(args.rowId, { properties, ...(title === undefined ? {} : { title }) });

    return undefined;
  },
};

const moveRow: ToolActionImpl<{ rowId: string; group?: string } & Placement> = {
  run: (ctx, args) => {
    exactlyOnePlacement(ctx, args);
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const current = rowOf(ctx, block.id, args.rowId);
    const others = rowsOf(ctx, block.id).filter(row => row.id !== args.rowId);

    ctx.update(args.rowId, {
      position: positionAround(ctx, others, { before: args.before, after: args.after }),
      ...(args.group === undefined ? {} : { properties: { ...current.properties, ...groupValue(ctx, state, args.group) } }),
    });

    return undefined;
  },
};

// ─── Property settings, option colour, templates (the editor's property and template menus) ───

/** Setting keys a property menu writes (PropertySettingsV2). `type` and `config` are not settings. */
const SETTING_KEYS = ['description', 'icon', 'pageVisibility', 'number', 'date', 'status', 'uniqueId', 'person', 'formula', 'relation', 'rollup', 'button', 'dependency', 'autofill'] as const;

/** The row page layout (Customize layout), saved on the title property (PageLayoutFields). */
const PAGE_LAYOUT_KEYS = [
  'pageLayoutStructure', 'pageLayoutGroupIn', 'pageLayoutPropertyIcons', 'pageLayoutPropertyLabels', 'pageLayoutTemplates',
  'pageLayoutFullWidth', 'pageLayoutTabsId', 'pageLayoutPlacements', 'pageLayoutSections',
] as const;

/** Refuses a layout that names a property, section or tabs block this database lacks. */
const checkPageLayout = (ctx: ToolActionContext, block: TargetBlock, state: DatabaseState, title: PropertyDefinition, settings: Record<string, unknown>): void => {
  const sections = new Set(idsIn('pageLayoutSections' in settings ? settings.pageLayoutSections : title.pageLayoutSections, 'id'));

  for (const placement of Array.isArray(settings.pageLayoutPlacements) ? settings.pageLayoutPlacements : []) {
    if (!isRecord(placement)) {
      continue;
    }
    if (!state.schema.some(property => property.id === placement.id)) {
      ctx.fail('PRECONDITION_FAILED', `This database has no property ${String(placement.id)}.`);
    }
    if (placement.place === 'section' && !sections.has(String(placement.sectionId))) {
      ctx.fail('PRECONDITION_FAILED', `The row page layout has no section ${String(placement.sectionId)}: add it to pageLayoutSections.`);
    }
  }
  const tabsId = settings.pageLayoutTabsId;

  if (typeof tabsId === 'string' && (!block.children.includes(tabsId) || ctx.read(tabsId)?.type !== 'tabs')) {
    ctx.fail('PRECONDITION_FAILED', `pageLayoutTabsId names a tabs block that is a child of this database; ${tabsId} is not one.`);
  }
};

/** As DatabaseModel.updateProperty: a key given as null is removed, any other value replaces it. */
const updateProperty: ToolActionImpl<{ propertyId: string; name?: string; settings?: Record<string, unknown> }> = {
  run: (ctx, args) => {
    const name = args.name?.trim();

    if (name === '') {
      ctx.fail('INVALID_ARGS', 'A property name cannot be empty.');
    }
    const { block, state } = openDatabase(ctx);
    const index = propertyAt(ctx, state, args.propertyId);

    // Same rule as the property menu: exact and case-sensitive; the current name always stays allowed.
    const taken = name !== undefined && name !== state.schema[index]?.name
      && state.schema.some((property, i) => i !== index && property.name === name);

    if (taken) {
      ctx.fail('PRECONDITION_FAILED', `A property named ${name} already exists in this database.`);
    }
    const layout = Object.keys(args.settings ?? {}).filter(key => PAGE_LAYOUT_KEYS.some(known => known === key));
    const property = state.schema[index];

    if (layout.length > 0) {
      if (property?.type !== 'title') {
        ctx.fail('PRECONDITION_FAILED', `${layout.join(', ')} go on the title property only.`);
      }
      checkPageLayout(ctx, block, state, property, args.settings ?? {});
    }
    const settings = Object.entries(args.settings ?? {}).filter(([key]) => SETTING_KEYS.some(known => known === key) || layout.includes(key));
    const schema = state.schema.map((property, i) => (i !== index
      ? property
      : {
        ...Object.fromEntries(Object.entries(property).filter(([key]) => !settings.some(([changed, value]) => changed === key && value === null))),
        ...Object.fromEntries(settings.filter(([, value]) => value !== null)),
        ...(name === undefined ? {} : { name }),
      } as PropertyDefinition));

    ctx.update(block.id, { schema });

    return undefined;
  },
};

/** As DatabaseTool.duplicateProperty: a copy right after the original, named "<name> (copy)", with every row's value. */
const duplicateProperty: ToolActionImpl<{ propertyId: string }, undefined, { propertyId: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const source = state.schema[propertyAt(ctx, state, args.propertyId)];

    if (source === undefined || source.type === 'title' || source.type === 'uniqueId') {
      return ctx.fail('PRECONDITION_FAILED', 'The title and ID properties cannot be duplicated.');
    }
    const { id: _id, position: _position, name, ...rest } = jsonCopy(source);
    const copy: PropertyDefinition = {
      ...rest,
      id: ctx.newId(),
      name: freePropertyName(state.schema.map(each => each.name), DATABASE_DEFAULT_TEXT.duplicatePropertyName.replace('{name}', name)),
      position: positionAround(ctx, state.schema, { after: source.id }),
    };

    ctx.update(block.id, withNewProperty(state, copy));
    for (const row of rowsOf(ctx, block.id)) {
      const value = row.properties[source.id];
      const empty = value === undefined || value === null;

      if (!empty || isListValueType(copy.type)) {
        ctx.update(row.id, { properties: { ...row.properties, [copy.id]: empty ? [] : jsonCopy(value) } });
      }
    }

    return { propertyId: copy.id };
  },
};

/** As DatabaseTool.deleteProperty: the schema entry goes, row values stay (D9). The title cannot go. */
const deleteProperty: ToolActionImpl<{ propertyId: string }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const index = propertyAt(ctx, state, args.propertyId);

    if (state.schema[index]?.type === 'title') {
      ctx.fail('PRECONDITION_FAILED', 'A database keeps its title property.');
    }
    ctx.update(block.id, { schema: state.schema.filter((_, i) => i !== index) });

    return undefined;
  },
};

const recolorOption: ToolActionImpl<OptionArgs & { color: string }> = {
  run: (ctx, args) => {
    const { block, state, index, options } = openOption(ctx, args);

    ctx.update(block.id, { schema: withOptions(state, index, options.map(option => (option.id === args.optionId ? { ...option, color: args.color } : option))) });

    return undefined;
  },
};

/** As DatabaseTool.addTemplate: an empty template row after the last template. */
const addTemplate: ToolActionImpl<Record<string, never>, undefined, { templateId: string }> = {
  run: (ctx) => {
    const block = databaseTarget(ctx);
    const titleId = readDatabase(block).schema.find(property => property.type === 'title')?.id;
    const templateId = ctx.insert({
      type: 'database-row',
      data: {
        properties: titleId === undefined ? {} : { [titleId]: '' },
        position: positionAround(ctx, templatesOf(ctx, block.id)),
        title: '',
        template: true,
      },
      parentId: block.id,
    });

    return { templateId };
  },
};

/** As DatabaseTool.setDefaultTemplate: the id lives on the title property; null clears it. */
const setDefaultTemplate: ToolActionImpl<{ templateId: string | null }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);

    if (args.templateId !== null) {
      templateOf(ctx, block.id, args.templateId);
    }
    const schema = state.schema.map((property) => {
      if (property.type !== 'title') {
        return property;
      }
      const { defaultTemplateId: _previous, ...rest } = property;

      return args.templateId === null ? rest : { ...rest, defaultTemplateId: args.templateId };
    });

    ctx.update(block.id, { schema });

    return undefined;
  },
};

/** As DatabaseTool.setTemplateRepeat: Blok stores the schedule, the host runs it. null clears it. */
const setTemplateRepeat: ToolActionImpl<{ templateId: string; repeat: TemplateRepeat | null }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);

    templateOf(ctx, block.id, args.templateId);
    ctx.update(args.templateId, { repeat: args.repeat ?? undefined });

    return undefined;
  },
};

// ─── Property type change (the property menu's "Type") ───

/** Their values come from block metadata or render-time numbering, which only the editor has (readPropertyValue). */
const EDITOR_ONLY_SOURCES = new Set<PropertyType>(['createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId']);

/** A row's kept originals (`convertedValues`), keyed by property id. */
const convertedOf = (ctx: ToolActionContext, rowId: string): Record<string, ConvertedValue> => {
  const data = ctx.read(rowId)?.data;
  const kept = isRecord(data) ? data.convertedValues : undefined;

  return isRecord(kept) ? { ...kept } as Record<string, ConvertedValue> : {};
};

/** As DatabaseTool.changePropertyType: the property's new definition and every row value it converts, in one step. */
const changePropertyType: ToolActionImpl<{ propertyId: string; type: PropertyType }> = {
  run: (ctx, args) => {
    const { block, state } = openDatabase(ctx);
    const index = propertyAt(ctx, state, args.propertyId);
    const property = state.schema[index] ?? ctx.fail('PRECONDITION_FAILED', `This database has no property ${args.propertyId}.`);

    if (property.type === 'title' || args.type === 'title') {
      ctx.fail('PRECONDITION_FAILED', 'The title property never changes type, and no property becomes a title.');
    }
    if (property.type === args.type) {
      ctx.fail('PRECONDITION_FAILED', `Property ${property.id} is already ${args.type}.`);
    }
    if (EDITOR_ONLY_SOURCES.has(property.type)) {
      ctx.fail('PRECONDITION_FAILED', `A ${property.type} property's values exist only in the editor, so its type can only change there.`);
    }
    const rows = rowsOf(ctx, block.id).map((row): ConvertibleRow => ({
      id: row.id,
      position: row.position,
      properties: row.properties as ConvertibleRow['properties'],
      convertedValues: convertedOf(ctx, row.id),
    }));
    // No DOM here: a legacy HTML rich text value cannot be read as text the way the editor reads it.
    const conversion = typeConversion(() => ctx.fail('PRECONDITION_FAILED', 'This property still holds rich text stored as HTML by an older version of Blok. Change its type in the editor.'));
    const plan = conversion.planTypeChange(property, args.type, rows, () => ctx.newId())
      ?? ctx.fail('PRECONDITION_FAILED', `Property ${property.id} cannot change to ${args.type}.`);
    const next = args.type === 'relation' && plan.property.relation === undefined
      ? { ...plan.property, relation: { targetDatabaseId: block.id } }
      : plan.property;

    ctx.update(block.id, { schema: state.schema.map((candidate, i) => (i === index ? next : candidate)) });
    for (const write of plan.writes) {
      const row = rows.find(candidate => candidate.id === write.rowId);

      if (row === undefined) {
        continue;
      }
      // As DatabaseRow.updateConvertedValues: null drops the property's entry, and an empty map goes away.
      const others = Object.entries(row.convertedValues ?? {}).filter(([key]) => key !== property.id);
      const kept = Object.fromEntries(write.stash === null || write.stash === undefined ? others : [...others, [property.id, write.stash]]);

      ctx.update(row.id, {
        properties: { ...row.properties, [property.id]: write.value },
        ...(write.stash === undefined ? {} : { convertedValues: Object.keys(kept).length === 0 ? undefined : kept }),
      });
    }

    return undefined;
  },
};

export const DATABASE_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = {
  create, addView, renameView, duplicateView, deleteView, moveView, updateView, setLayout, setLock,
  addProperty, addOption, renameOption, moveOption, deleteOption,
  addRow, moveRow, setRowValues,
  updateProperty, duplicateProperty, deleteProperty, recolorOption,
  addTemplate, setDefaultTemplate, setTemplateRepeat, changePropertyType,
};
