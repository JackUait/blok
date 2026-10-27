import { DATABASE_DEFAULT_TEXT } from '../database/default-text';
import { comparePositions } from '../database/positions';
import { isAnnotationType } from '../annotation-blocks';
import { resolveDynamicProperties } from '../database/dynamic-values';
import { addRelated, relationEdit, relationIdsOf, removeRelated } from '../database/relation-values';
import { copiedReminders } from '../database/reminder-fit';
import { mapRowValues } from '../database/row-move';
import { linkedRowHome } from '../database/linked-source';
import { newRowValues, prefillFilters, THIS_PAGE_FILTER_VALUE } from '../database/new-row-values';
import { lastRowKey, pinnedRowOrders, rowOrderKey, UNORDERED_VIEW_TYPES } from '../database/row-order';
import { descendantsOf, relationPair } from '../database/sub-item-tree';
import { typeConversion } from '../database/property-conversion';
import { inheritedRollupFormat } from '../database/rollup';
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
import { DATE_VALUE_FORMAT, parseDateValue } from '../database/date-value';
import { isOutputData, isPlaceValue, isVerificationValue } from '../database/tier3-values';
import { isFileValue, isReadOnlyType, personIdsOf } from '../database/value-helpers';
import { revealedInLegacyView } from '../database/view-properties';
import { formAnswerProblem, formQuestions } from '../database/form-questions';
import { MAX_NOTIFY_PEOPLE, runButtonActions } from '../database/button-actions';
import { plainLine } from '../agent/approval';
import type { FormAnswerProblem } from '../database/form-questions';

import type { InsertSpec } from '../../../types/agent';
import type { BlockPosition } from '../../../types/api/blocks';
import type { ToolActionContext, ToolActionImpl } from '../../../types/tools/tool-description';
import type { ChildCommandRoute } from '../agent/types';
import type { ConvertibleRow } from '../database/property-conversion';
import type { ButtonCallbackAction, ButtonSendNotificationAction, ConvertedValue, DatabaseViewConfig, DateReminder, PropertyDefinition, PropertyType, PropertyValue, RelationSettings, SelectOption, TemplateRepeat, ViewType } from '../database/types';

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

const lockedSchema = (schema: unknown): boolean => Array.isArray(schema)
  && schema.some((property: unknown) => isRecord(property) && property.type === 'title' && property.databaseLocked === true);

/** A database held in another database follows that one's lock, up the chain (the editor's holderLocked). */
const holderLocked = (ctx: ToolActionContext, id: string, seen: ReadonlySet<string> = new Set([id])): boolean => {
  const parentId = ctx.read(id)?.parentId ?? null;
  const parent = parentId === null || seen.has(parentId) ? null : ctx.read(parentId);

  if (parentId === null || parent?.type !== 'database') {
    return false;
  }

  return (isRecord(parent.data) && lockedSchema(parent.data.schema)) || holderLocked(ctx, parentId, new Set([...seen, parentId]));
};

/** Schema and views are frozen while the title property carries `databaseLocked` (the editor's structureLocked). */
export const assertUnlocked = (ctx: ToolActionContext, state: DatabaseState): void => {
  if (lockedSchema(state.schema)) {
    ctx.fail('PRECONDITION_FAILED', 'This database is locked: its properties and views cannot change. Rows can.');
  }
  if (ctx.block !== undefined && holderLocked(ctx, ctx.block.id)) {
    ctx.fail('PRECONDITION_FAILED', 'This database sits inside a locked database, so its properties and views cannot change. Rows can.');
  }
};

/** Database fields the editor freezes with the schema while the database is locked (structureLocked). */
const LOCKED_FIELDS = ['automations', 'source', 'hideDataSourceTitles', 'starter'];

/** Everything a database lock freezes: the schema (which holds the lock), the views and LOCKED_FIELDS. */
export const LOCK_PROTECTED_FIELDS: readonly string[] = ['schema', 'views', ...LOCKED_FIELDS];

export const rejectDatabaseWrite = (data: Record<string, unknown>, written: readonly string[]): string | undefined => {
  const locked = Array.isArray(data.schema) && data.schema.some(property => isRecord(property) && property.type === 'title' && property.databaseLocked === true);
  const frozen = written.filter(field => LOCKED_FIELDS.includes(field));

  return locked && frozen.length > 0
    ? `This database is locked: ${frozen.join(', ')} cannot change. database.setLock can unlock it once the person approves.`
    : undefined;
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
    return schemaOf(dataSourceId) ?? ctx.fail('PRECONDITION_FAILED', `dataSourceId ${dataSourceId} is not a database block in the document you read.`);
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
    const calendarId = isRecord(args.changes.calendarSync) ? args.changes.calendarSync.calendarId : undefined;

    // The person is asked about the calendar by name: one with hidden characters could be shown as another.
    if (typeof calendarId === 'string' && (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(calendarId) || calendarId.trim() !== calendarId)) {
      ctx.fail('INVALID_ARGS', 'calendarSync.calendarId must be one plain line, without control or format characters.');
    }
    if (isRecord(args.changes.form) && args.changes.form.public === true && args.changes.form.closed === true) {
      ctx.fail('INVALID_ARGS', 'form.public and form.closed are one choice, "Who can fill out": send one of them.');
    }
    if (args.changes.form === null) {
      ctx.fail('INVALID_ARGS', 'form cannot be removed: send null for one form key instead.');
    }
    const { block, state } = openDatabase(ctx);
    const index = viewIndex(ctx, state, args.viewId);
    const view = state.views[index] ?? ctx.fail('PRECONDITION_FAILED', `This database has no view ${args.viewId}.`);
    const changes: Record<string, unknown> = jsonCopy(args.changes);

    if (isRecord(changes.form)) {
      // Merged: the settings not named stay as the person set them. Sharing changes ask the person (executor).
      const merged: Record<string, unknown> = { ...(view.form ?? {}), ...changes.form };

      // "Who can fill out" is one choice, as the Share panel writes it.
      if (changes.form.public === true) {
        delete merged.closed;
      }
      if (changes.form.closed === true) {
        delete merged.public;
      }
      changes.form = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null && value !== false));
    }
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
    if (!args.locked && title?.databaseLocked === true) {
      const requireApproval = ctx.requireApproval
        // Fails closed in a runtime that cannot ask.
        ?? ctx.fail('PRECONDITION_FAILED', 'Unlocking a locked database needs a person\'s approval, and this runtime cannot ask for one.');

      requireApproval('database.unlock');
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

const isText = (value: unknown): boolean => typeof value === 'string';

/** What each cell editor writes, by property type. Options and relations also name ids checked below. */
const VALUE_SHAPES: Partial<Record<PropertyType, { fits: (value: unknown, template: boolean) => boolean; shape: string }>> = {
  title: { fits: isText, shape: 'a string; pass "" to clear it' },
  text: { fits: isText, shape: 'a string' },
  richText: { fits: value => isText(value) || isOutputData(value as PropertyValue), shape: 'a string, or { blocks } with the text' },
  url: { fits: isText, shape: 'a string' },
  email: { fits: isText, shape: 'a string' },
  phone: { fits: isText, shape: 'a string' },
  number: { fits: value => typeof value === 'number' && Number.isFinite(value), shape: 'a number, or null' },
  checkbox: { fits: value => typeof value === 'boolean', shape: 'true or false' },
  select: { fits: isText, shape: 'one option id, or null' },
  status: { fits: isText, shape: 'one option id, or null' },
  multiSelect: { fits: value => Array.isArray(value) && value.every(isText), shape: 'an array of option ids, or null' },
  // A template's @today and @now fill in when a row is made from it.
  date: {
    fits: (value, template) => typeof value === 'string' && (parseDateValue(value) !== null || (template && (value === '@today' || value === '@now'))),
    shape: `a date string (${DATE_VALUE_FORMAT}), or null`,
  },
  person: { fits: value => Array.isArray(value) && value.every(item => isRecord(item) && typeof item.id === 'string' && item.id !== ''), shape: 'an array of { id } person objects' },
  files: { fits: value => Array.isArray(value) && value.every(isFileValue), shape: 'an array of { id, name, url } files' },
  relation: { fits: value => Array.isArray(value) && value.every(item => isText(item) || (isRecord(item) && typeof item.id === 'string')), shape: 'an array of { id } row references' },
  place: { fits: value => isPlaceValue(value as PropertyValue), shape: 'a { name, address, lat, lon } place, or null' },
  verification: { fits: value => isVerificationValue(value as PropertyValue), shape: '{ state: "verified" | "unverified" }, or null' },
};

/** The ids a value names that its property does not offer: options, or rows of the related database. */
const missingIds = (ctx: ToolActionContext, databaseId: string, property: PropertyDefinition, value: unknown): { id: string; where: string } | undefined => {
  if (OPTION_TYPES.has(property.type)) {
    const known = new Set((property.config?.options ?? []).map(option => option.id));
    // The shape check before this one made every entry a string.
    const id = (Array.isArray(value) ? value as unknown[] : [value]).filter((each): each is string => typeof each === 'string').find(each => !known.has(each));

    return id === undefined ? undefined : { id, where: `Property ${property.id} has no option ${id}. Add it with database.addOption first.` };
  }
  const target = property.relation?.targetDatabaseId ?? databaseId;

  if (property.type !== 'relation' || property.relation?.targetDocumentId !== undefined || schemaOf(ctx, target) === undefined) {
    return undefined;
  }
  const rows = new Set(rowsOf(ctx, target).map(each => each.id));
  const id = relationIdsOf(value).find(each => !rows.has(each));

  return id === undefined ? undefined : { id, where: `Property ${property.id} relates to database ${target}, which has no row ${id}.` };
};

/** One value, checked as the property's cell editor would write it. Null empties a person, files or relation list to []. */
const checkedValue = (ctx: ToolActionContext, databaseId: string, property: PropertyDefinition, value: unknown, template: boolean): unknown => {
  const rule = VALUE_SHAPES[property.type];

  if (isReadOnlyType(property.type)) {
    return ctx.fail('PRECONDITION_FAILED', `Property ${property.id} is a ${property.type} property: Blok computes its value, so it cannot be set.`);
  }
  if (value === null && property.type !== 'title') {
    return isListValueType(property.type) ? [] : null;
  }
  // A type from a newer Blok has no rule here: its value passes as given.
  if (rule !== undefined && !rule.fits(value, template)) {
    return ctx.fail('INVALID_ARGS', `Property ${property.id} is a ${property.type} property: its value is ${rule.shape}.`);
  }
  const missing = missingIds(ctx, databaseId, property, value);

  return missing === undefined ? value : ctx.fail('PRECONDITION_FAILED', missing.where);
};

const checkedValues = (ctx: ToolActionContext, databaseId: string, state: DatabaseState, values: Record<string, unknown>, template = false): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).map(([propertyId, value]) => {
    const property = state.schema.find(each => each.id === propertyId) ?? ctx.fail('PRECONDITION_FAILED', `This database has no property ${propertyId}.`);

    return [propertyId, checkedValue(ctx, databaseId, property, value, template)];
  }));

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

/** Page fields a row copies from a template (writeNewRow, applyTemplate). */
const PAGE_FIELDS = ['icon', 'cover', 'fullWidth'] as const;

const rawData = (ctx: ToolActionContext, id: string): Record<string, unknown> => {
  const data = ctx.read(id)?.data;

  return isRecord(data) ? data : {};
};

/**
 * As DatabaseTool.copyChildBlocks: the page body as insert specs, comment
 * threads left behind. A table's cells get new ids, so its grid names them.
 */
const bodyOf = (ctx: ToolActionContext, fromId: string): InsertSpec[] => (ctx.read(fromId)?.children ?? []).flatMap((childId) => {
  const child = ctx.read(childId);

  if (child === null || isAnnotationType(child.type)) {
    return [];
  }
  const children = bodyOf(ctx, childId);
  const data = isRecord(child.data) ? jsonCopy(child.data) : {};
  const ids = new Map(child.children.map((id, index) => [id, children[index]]));

  if (child.type === 'table' && Array.isArray(data.content)) {
    const renamed = (id: unknown): unknown => (typeof id === 'string' ? ids.get(id)?.id ?? id : id);

    data.content = (data.content as unknown[]).map((cells): unknown => (Array.isArray(cells)
      ? (cells as unknown[]).map((cell): unknown => (isRecord(cell) && Array.isArray(cell.blocks) ? { ...cell, blocks: (cell.blocks as unknown[]).map(renamed) } : cell))
      : cells));
  }

  return [{ type: child.type, id: ctx.newId(), data, children }];
});

// A top-level id would stay reserved: only ids a parent names are claimed (createActionContext).
const copyBody = (ctx: ToolActionContext, fromId: string, toId: string): void =>
  bodyOf(ctx, fromId).forEach(({ id: _id, ...spec }) => ctx.insert({ ...spec, parentId: toId, copy: true }));

const dynamicContext = (ctx: ToolActionContext): { me: string | null; now: Date } =>
  ({ me: ctx.actorId ?? null, now: new Date(ctx.now ?? Date.now()) });

/** As DatabaseModel.withStatusDefaults: a status with a default option fills a row that names no value for it. */
const withStatusDefaults = (state: DatabaseState, properties: Record<string, unknown>): Record<string, unknown> => ({
  ...properties,
  ...Object.fromEntries(state.schema.flatMap((property) => {
    const id = property.type === 'status' ? property.status?.defaultOptionId : undefined;

    return id !== undefined && !(property.id in properties) && (property.config?.options ?? []).some(option => option.id === id) ? [[property.id, id]] : [];
  })),
});

/** As DatabaseModel.withCreatedByDefaults: a person property that defaults to "Created by" starts with the agent. */
const withCreatedBy = (ctx: ToolActionContext, state: DatabaseState, properties: Record<string, unknown>): Record<string, unknown> => {
  const me = ctx.actorId;

  return me === undefined ? properties : {
    ...properties,
    ...Object.fromEntries(state.schema
      .filter(property => property.type === 'person' && property.person?.default === 'createdBy' && personIdsOf(properties[property.id] as PropertyValue).length === 0)
      .map(property => [property.id, [{ id: me }]])),
  };
};

/** The open view and its own manual order, if it keeps one. */
const openOrder = (state: DatabaseState): { view?: DatabaseViewConfig; order?: Record<string, string> } => {
  const view = state.views.find(each => each.id === state.activeViewId);

  return { view, order: view?.rowOrder };
};

/** A key next to the row `ref` names, in a view's manual order of `rows`. */
const keyAround = (ctx: ToolActionContext, rows: RowRef[], order: Record<string, string> | undefined, ref: Placement): string =>
  positionAround(ctx, rows.map(each => ({ id: each.id, position: rowOrderKey(each, order) })), ref);

/** The views with new own orders, by view id. */
const withRowOrders = (state: DatabaseState, orders: Record<string, Record<string, string>>): { views: DatabaseViewConfig[] } => ({
  views: state.views.map(each => (orders[each.id] === undefined ? each : { ...each, rowOrder: orders[each.id] })),
});

interface AddRowArgs extends Placement {
  values?: Record<string, unknown>;
  group?: string;
  template?: string | null;
  page?: string;
}

/**
 * The database whose row pages show `blockId`, as the editor's attachLayoutTab
 * lends it: the block sits in a tab of that database's layout tabs block.
 */
const rowPageHost = (ctx: ToolActionContext, blockId: string): string | undefined => {
  const tab = ctx.read(ctx.read(blockId)?.parentId ?? '');
  const tabs = tab?.type === 'tab' ? ctx.read(tab.parentId ?? '') : null;
  const host = tabs?.type === 'tabs' ? ctx.read(tabs.parentId ?? '') : null;

  if (tabs === null || host === null || host.type !== 'database' || !isRecord(host.data)) {
    return undefined;
  }
  const named = (Array.isArray(host.data.schema) ? host.data.schema as PropertyDefinition[] : []).find(property => property.type === 'title')?.pageLayoutTabsId;
  // As layoutTabsBlock: the one the title names, else the first; a draft is nobody's layout yet.
  const layouts = host.children.filter((id) => {
    const child = ctx.read(id);

    return child?.type === 'tabs' && !(isRecord(child.data) && child.data.draft !== undefined);
  });
  const layout = layouts.find(id => id === named) ?? layouts[0];
  const draft = isRecord(tab?.data) && tab.data.draft !== undefined;

  return layout === tabs.id && !draft ? host.id : undefined;
};

/**
 * The row page a new row links to through a "This page" filter (the editor's
 * thisPage). The agent names it, as a person opens one. Off a row page there
 * is none: the editor then fills nothing.
 */
const pageOf = (ctx: ToolActionContext, blockId: string, state: DatabaseState, filters: ReturnType<typeof prefillFilters>, page: string | undefined): string | undefined => {
  const host = rowPageHost(ctx, blockId);

  if (page !== undefined) {
    if (host === undefined) {
      return ctx.fail('PRECONDITION_FAILED', `Database ${blockId} is not shown on a row page, so page names nothing. Leave page out.`);
    }
    if (!rowsOf(ctx, host).some(each => each.id === page)) {
      return ctx.fail('PRECONDITION_FAILED', `Block ${page} is not a row of database ${host}, whose row pages show this view.`);
    }

    return page;
  }
  const asksPage = filters.some(filter => filter.operator === 'contains'
    && state.schema.find(property => property.id === filter.propertyId)?.type === 'relation'
    && personIdsOf(filter.value).includes(THIS_PAGE_FILTER_VALUE));

  if (host !== undefined && asksPage) {
    return ctx.fail('INVALID_ARGS', `Database ${blockId} is shown on the row pages of database ${host} and its filter links new rows to "This page". Pass page: the id of the row whose page you add to.`);
  }

  return undefined;
};

/** As linkPageBack: each two-way relation holding the row page gets the new row on the page's side too. */
const linkPage = (ctx: ToolActionContext, dataId: string, schema: PropertyDefinition[], properties: Record<string, unknown>, page: string, rowId: string): void => {
  for (const property of schema) {
    const synced = property.type === 'relation' ? syncedMirror(ctx, dataId, property) : undefined;
    const target = property.relation?.targetDatabaseId;

    if (synced !== undefined && target !== undefined && relationIdsOf(properties[property.id]).includes(page)) {
      writeRelated(ctx, target, page, synced, current => addRelated(current, rowId, null));
    }
  }
};

/**
 * As the toolbar New (writeNewRow): the row starts from the default template,
 * the one `template` names, or none for null. Its values, icon, cover, page
 * width, reminders and page body are copied; the caller's values win, except
 * an empty title. As newRowProperties, the open view's filters fill the values
 * they ask for, over the template.
 */
const addRow: ToolActionImpl<AddRowArgs, undefined, { rowId: string }> = {
  run: (ctx, args) => {
    if (args.before !== undefined && args.after !== undefined) {
      ctx.fail('INVALID_ARGS', 'Pass before or after, not both.');
    }
    const { block, dataId, state } = rowHome(ctx);
    const titleId = state.schema.find(property => property.type === 'title')?.id;
    const defaultId = state.schema.find(property => property.type === 'title')?.defaultTemplateId;
    const pick = args.template === undefined ? templatesOf(ctx, dataId).find(template => template.id === defaultId) : undefined;
    const template = args.template === null ? undefined : pick ?? (typeof args.template === 'string' ? templateOf(ctx, dataId, args.template) : undefined);
    const context = dynamicContext(ctx);
    // As newRowProperties: written raw, so a filter on a deleted option does not refuse the row.
    const filters = prefillFilters(state.views.find(view => view.id === state.activeViewId));
    const rowPage = pageOf(ctx, block.id, state, filters, args.page);
    const prefill = newRowValues(filters, state.schema, context.me, rowPage ?? null, context.now);
    const given = withCreatedBy(ctx, state, { ...(titleId === undefined ? {} : { [titleId]: '' }), ...prefill, ...checkedValues(ctx, dataId, state, args.values ?? {}), ...groupValue(ctx, state, args.group) });
    const chosen = Object.fromEntries(Object.entries(given)
      .filter(([id, value]) => !(id === titleId && (value === '' || value === null)) && !(Array.isArray(value) && value.length === 0)));
    const filled = template === undefined ? given : { ...given, ...resolveDynamicProperties(jsonCopy(template.properties) as Record<string, PropertyValue>, context), ...chosen };
    const properties = withStatusDefaults(state, withEmptyLists(state, filled));
    const page = template === undefined ? {} : rawData(ctx, template.id);
    const reminders = template === undefined ? undefined : copiedReminders(isRecord(page.reminders) ? page.reminders as Record<string, DateReminder> : undefined, properties, context.now);
    const rows = rowsOf(ctx, dataId);
    const placement = { before: args.before, after: args.after };
    const anchored = args.before !== undefined || args.after !== undefined;
    // As createRowData: past every own order's keys too, so the row goes last in every view.
    const position = anchored ? positionAround(ctx, rows, placement) : positionBetween(lastRowKey(rows, state.views.map(view => view.rowOrder)), null);
    const { view, order } = openOrder(state);
    const id = ctx.newId();

    // As addTableRow, and first: in the editor an insert opens a sync window that reads a later database write as an echo.
    if (anchored && view !== undefined && order !== undefined) {
      ctx.update(block.id, withRowOrders(state, { [view.id]: { ...order, [id]: keyAround(ctx, rows, order, placement) } }));
    }
    // As linkPageBack, and before the insert: the row page lists the new row on its two-way side.
    if (rowPage !== undefined) {
      linkPage(ctx, dataId, state.schema, properties, rowPage, id);
    }
    const rowId = ctx.insert({
      type: 'database-row',
      id,
      data: {
        properties,
        position,
        title: titleOf(state, properties) ?? '',
        ...Object.fromEntries(PAGE_FIELDS.filter(field => page[field] !== undefined).map(field => [field, page[field]])),
        ...(reminders === undefined ? {} : { reminders }),
      },
      parentId: dataId,
    });

    if (template !== undefined) {
      copyBody(ctx, template.id, rowId);
    }

    return { rowId };
  },
};

const blank = (value: unknown): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** As DatabaseTool.insertRow (createRowData): a new last row with these values, no template, no view prefill, no status default. */
const insertPlainRow = (ctx: ToolActionContext, dataId: string, state: DatabaseState, given: Record<string, unknown>): string => {
  const properties = withEmptyLists(state, withCreatedBy(ctx, state, given));

  return ctx.insert({
    type: 'database-row',
    id: ctx.newId(),
    data: { properties, position: positionBetween(lastRowKey(rowsOf(ctx, dataId), state.views.map(each => each.rowOrder)), null), title: titleOf(state, properties) ?? '' },
    parentId: dataId,
  });
};

/** The same context, aimed at another database block, as a button's "in another database" step is. */
const aimedAt = (ctx: ToolActionContext, databaseId: string | undefined): ToolActionContext => {
  if (databaseId === undefined || databaseId === ctx.block?.id) {
    return ctx;
  }
  const found = ctx.read(databaseId);

  if (found?.type !== 'database') {
    return ctx.fail('PRECONDITION_FAILED', `The button names database ${databaseId}, which is not one here.`);
  }

  return { ...ctx, block: { id: found.id, type: found.type, data: isRecord(found.data) ? found.data : {}, children: found.children } };
};

// A notification is a sentence or two; a longer one is cut where the person can still read it.
const MAX_HOOK_MESSAGE = 500;

type ButtonHookShown = { kind: 'callback'; name?: string } | { kind: 'notify'; to: string[]; message?: string };

const cleanText = (value: unknown, max?: number): string | undefined => (typeof value === 'string' ? plainLine(value, max) : undefined);

const cleanIds = (ids: readonly unknown[]): string[] =>
  ids.flatMap(id => (typeof id === 'string' ? [cleanText(id) ?? ''] : [])).filter(id => id !== '').slice(0, MAX_NOTIFY_PEOPLE);

/** A step the host gets holds only its declared fields, as plain lines: nothing the agent added rides along. */
const cleanCallback = (action: ButtonCallbackAction): ButtonCallbackAction => {
  const name = cleanText(action.name);

  return { id: cleanText(action.id) ?? '', type: 'callback', ...(name !== undefined && { name }) };
};

const cleanNotify = (action: ButtonSendNotificationAction): ButtonSendNotificationAction => {
  const message = cleanText(action.message, MAX_HOOK_MESSAGE);
  const given = action.recipients;
  const recipients = ((): ButtonSendNotificationAction['recipients'] => {
    if (given?.type === 'people') {
      return { type: 'people', people: cleanIds((Array.isArray(given.people) ? given.people : []).map(person => (isRecord(person) ? person.id : undefined))).map(id => ({ id })) };
    }
    const propertyId = given?.type === 'property' ? cleanText(given.propertyId) : undefined;

    return propertyId === undefined ? undefined : { type: 'property', propertyId };
  })();

  return { id: cleanText(action.id) ?? '', type: 'sendNotification', ...(recipients !== undefined && { recipients }), ...(message !== undefined && { message }) };
};

/**
 * As DatabaseTool.pressButton, through the same runButtonActions: the button's
 * steps in order, its writes in this batch with every agent check. Each "Show
 * confirmation" asks the person first; a no stops the whole press. Opening a
 * page or a link stays the person's: an agent's press opens nothing. The host
 * callback and notification run once the writes landed.
 */
const pressButton: ToolActionImpl<{ rowId: string; propertyId: string }> = {
  run: (ctx, args) => {
    const { dataId, state } = rowHome(ctx);
    const property = state.schema.find(each => each.id === args.propertyId)
      ?? ctx.fail('PRECONDITION_FAILED', `This database has no property ${args.propertyId}.`);

    if (property.type !== 'button') {
      ctx.fail('PRECONDITION_FAILED', `Property ${property.id} is a ${property.type} property, not a button.`);
    }
    rowOf(ctx, dataId, args.rowId);
    const actions = property.button?.buttonActions ?? [];
    const confirm = ctx.requireConfirmation ?? ((): never => ctx.fail('PRECONDITION_FAILED', 'This button asks for confirmation, and this runtime cannot ask a person.'));
    const allowHooks = ctx.requireHostHooks ?? ((): never => ctx.fail('PRECONDITION_FAILED', 'This button calls the host, and this runtime cannot ask a person.'));
    const record = ctx.hostEffect ?? ((): never => ctx.fail('PRECONDITION_FAILED', 'This runtime cannot run a button\'s host steps.'));
    // A yes covers this row and these exact steps: steps rewritten while the person decides ask again.
    const bound = { rowId: args.rowId, steps: JSON.stringify(actions) };
    const hooks: Array<{ effect: Record<string, unknown>; shown: ButtonHookShown }> = [];

    actions.forEach((action) => {
      if (action.type === 'showConfirmation') {
        confirm({ ...bound, message: action.message, confirmLabel: action.confirmLabel, cancelLabel: action.cancelLabel });
      }
    });
    const context = dynamicContext(ctx);
    const here = (databaseId: string | undefined): boolean => databaseId === undefined || databaseId === dataId;

    runButtonActions(actions, args.rowId, {
      oneStep: (fn) => fn(),
      writeValues: (rowId, changes, databaseId) => {
        setRowValues.run(here(databaseId) ? ctx : aimedAt(ctx, databaseId), { rowId, values: changes }, undefined);
      },
      // The agent's own blocks: block.insert's checks, never a copy's pass.
      insertBlocks: (rowId, blocks) => blocks.forEach((each) => {
        ctx.insert({ type: each.type, data: jsonCopy(each.data), parentId: rowId, position: 'end', checked: true });
      }),
      openRow: () => undefined,
      openUrl: () => undefined,
      callback: (action) => {
        const clean = cleanCallback(action);

        hooks.push({ effect: { kind: 'buttonCallback', rowId: args.rowId, propertyId: property.id, action: clean }, shown: { kind: 'callback', ...(clean.name !== undefined && { name: clean.name }) } });
      },
      me: () => context.me,
      now: () => context.now,
      addPage: (databaseId, name, properties) => {
        const target = here(databaseId) ? { dataId, state } : rowHome(aimedAt(ctx, databaseId));
        const titleId = target.state.schema.find(each => each.type === 'title')?.id;
        const values = checkedValues(ctx, target.dataId, target.state, { ...properties, ...(name === '' || titleId === undefined ? {} : { [titleId]: name }) });

        return insertPlainRow(ctx, target.dataId, target.state, values);
      },
      source: (databaseId) => {
        const { dataId: home, state: other } = rowHome(aimedAt(ctx, databaseId));

        return { schema: other.schema, rows: rowsOf(ctx, home).map(row => ({ id: row.id, position: row.position, properties: row.properties as Record<string, PropertyValue> })) };
      },
      rowValues: (rowId) => rowsOf(ctx, dataId).find(row => row.id === rowId)?.properties as Record<string, PropertyValue> | undefined,
      notify: (action, to, message) => {
        const recipients = cleanIds(to);
        const text = cleanText(message, MAX_HOOK_MESSAGE);

        hooks.push({
          effect: { kind: 'buttonNotify', rowId: args.rowId, propertyId: property.id, action: cleanNotify(action), to: recipients, message: text ?? '' },
          shown: { kind: 'notify', to: recipients, ...(text !== undefined && { message: text }) },
        });
      },
    });
    // The host hears what the person saw and allowed, after the writes it follows.
    if (hooks.length > 0) {
      allowHooks({ ...bound, hooks: hooks.map(hook => hook.shown) });
      hooks.forEach(hook => record(hook.effect));
    }

    return undefined;
  },
};

const FORM_PROBLEMS: Record<FormAnswerProblem, string> = {
  required: 'is required',
  email: 'needs an email address',
  relationLimit: 'takes one page',
  maxSelections: 'takes fewer selections',
};

/**
 * As DatabaseTool.submitForm with the form's Submit checks: an answer becomes a
 * row, answered as the person, and the host's forms.onSubmit hears of it. The
 * form's own view holds the questions; a linked form's row goes to its source.
 */
const submitForm: ToolActionImpl<{ viewId: string; answers: Record<string, unknown> }, undefined, { rowId: string }> = {
  run: (ctx, args) => {
    const { block, dataId, state } = rowHome(ctx);
    const view = state.views.find(each => each.id === args.viewId)
      ?? ctx.fail('PRECONDITION_FAILED', `This database has no view ${args.viewId}.`);

    if (view.type !== 'form') {
      ctx.fail('PRECONDITION_FAILED', `View ${view.id} is a ${view.type} view, not a form.`);
    }
    if (view.form?.closed === true) {
      ctx.fail('PRECONDITION_FAILED', 'This form is closed: it takes no answers.');
    }
    // An anonymous answer has no author, and an agent only ever answers as its person.
    if (view.form?.anonymous === true) {
      ctx.fail('PRECONDITION_FAILED', 'This form takes anonymous answers, and an agent answers only as the person. Ask the person to fill it out.');
    }
    const questions = formQuestions(view, state.schema);
    const asked = new Set(questions.map(question => question.property.id));
    const stray = Object.keys(args.answers).find(propertyId => !asked.has(propertyId));

    if (stray !== undefined) {
      ctx.fail('INVALID_ARGS', `Property ${stray} is not a question of this form.`);
    }
    // As the form's Submit: a blank answer is a question left empty.
    const given = Object.fromEntries(Object.entries(checkedValues(ctx, dataId, state, args.answers)).filter(([, value]) => !blank(value)));

    questions.forEach((question) => {
      const problem = formAnswerProblem(question, given[question.property.id] as PropertyValue | undefined);

      if (problem !== undefined) {
        ctx.fail('PRECONDITION_FAILED', `Question ${question.property.id} ${FORM_PROBLEMS[problem]}.`);
      }
    });
    const rowId = insertPlainRow(ctx, dataId, state, given);
    const record = ctx.hostEffect ?? ctx.fail('PRECONDITION_FAILED', 'This runtime cannot tell the host about a form answer.');

    record({
      kind: 'formSubmitted',
      submission: {
        databaseId: block.id,
        viewId: view.id,
        values: given,
        rowId,
        sharing: { public: view.form?.public === true, anonymous: false, submissionAccess: view.form?.submissionAccess ?? 'none' },
      },
    });

    return { rowId };
  },
};

/**
 * As DatabaseTool.applyTemplate (a template picked on an empty row page): the
 * template fills the row's empty values and missing icon, cover and width,
 * adds reminders beside the dates it fills, and copies its body.
 */
const applyTemplate: ToolActionImpl<{ rowId: string; templateId: string }> = {
  run: (ctx, args) => {
    const { dataId, state } = rowHome(ctx);
    const target = rowOf(ctx, dataId, args.rowId);
    const template = templateOf(ctx, dataId, args.templateId);

    if ((ctx.read(target.id)?.children ?? []).some(id => !isAnnotationType(ctx.read(id)?.type))) {
      ctx.fail('PRECONDITION_FAILED', `Row ${target.id} already has page content. A template applies to an empty page only.`);
    }
    const context = dynamicContext(ctx);
    const changes = Object.fromEntries(Object.entries(resolveDynamicProperties(jsonCopy(template.properties) as Record<string, PropertyValue>, context))
      .filter(([id, value]) => !blank(value) && blank(target.properties[id])));
    const page = rawData(ctx, template.id);
    const own = rawData(ctx, target.id);
    const ownReminders = isRecord(own.reminders) ? own.reminders : {};
    const added = Object.entries(copiedReminders(isRecord(page.reminders) ? page.reminders as Record<string, DateReminder> : undefined, changes, context.now) ?? {})
      .filter(([propertyId]) => ownReminders[propertyId] === undefined);
    const properties = { ...target.properties, ...changes };
    const title = titleOf(state, properties);

    ctx.update(target.id, {
      properties,
      ...(title === undefined ? {} : { title }),
      ...Object.fromEntries(PAGE_FIELDS.filter(field => own[field] === undefined && page[field] !== undefined).map(field => [field, page[field]])),
      ...(added.length === 0 ? {} : { reminders: { ...ownReminders, ...Object.fromEntries(added) } }),
    });
    copyBody(ctx, template.id, target.id);

    return undefined;
  },
};

/** A database block's schema, or undefined when `databaseId` is not one in this document. */
const schemaOf = (ctx: ToolActionContext, databaseId: string): PropertyDefinition[] | undefined => {
  const found = ctx.read(databaseId);

  return found !== null && isRecord(found.data) && Array.isArray(found.data.schema) ? found.data.schema as PropertyDefinition[] : undefined;
};

/**
 * As the editor's dataId: a linked view's rows, templates and schema are its
 * source's, its views stay its own. A source this runtime cannot write is refused.
 */
const rowHome = (ctx: ToolActionContext): { block: TargetBlock; dataId: string; state: DatabaseState } => {
  const block = databaseTarget(ctx);
  const own = readDatabase(block);
  const home = linkedRowHome(block, id => ctx.read(id));

  if (home === undefined) {
    return { block, dataId: block.id, state: own };
  }
  if ('refusal' in home) {
    return ctx.fail('PRECONDITION_FAILED', home.refusal);
  }

  return { block, dataId: home.databaseId, state: { ...own, schema: jsonCopy(schemaOf(ctx, home.databaseId) ?? []) } };
};

/**
 * As DatabaseTool.syncedMirror: the other side of a two-way relation, only
 * while it still points back. A mirror deleted or retyped gets no writes.
 */
const syncedMirror = (ctx: ToolActionContext, databaseId: string, property: PropertyDefinition): string | undefined => {
  const settings = property.relation;
  const id = settings?.twoWay === true && settings.targetDocumentId === undefined ? settings.syncedPropertyId : undefined;
  const mirror = id === undefined || settings === undefined ? undefined : schemaOf(ctx, settings.targetDatabaseId)?.find(each => each.id === id);

  return mirror?.type === 'relation' && mirror.relation?.targetDatabaseId === databaseId && mirror.relation.syncedPropertyId === property.id
    ? id
    : undefined;
};

/** A row's values as they stand now, earlier writes of this action included. Undefined for a template or a missing row. */
const liveValues = (ctx: ToolActionContext, databaseId: string, rowId: string): Record<string, unknown> | undefined => {
  const found = ctx.read(rowId);

  if (found === null || found.type !== 'database-row' || found.parentId !== databaseId || !isRecord(found.data) || found.data.template === true) {
    return undefined;
  }

  return isRecord(found.data.properties) ? { ...found.data.properties } : {};
};

/** As DatabaseTool.writeForeignRow: one relation value on another row, skipped when that row is gone. */
const writeRelated = (ctx: ToolActionContext, databaseId: string, rowId: string, propertyId: string, change: (value: unknown) => unknown): void => {
  const values = liveValues(ctx, databaseId, rowId);

  if (values !== undefined) {
    ctx.update(rowId, { properties: { ...values, [propertyId]: change(values[propertyId]) } });
  }
};

const asRelation = (ids: string[]): Array<{ id: string }> => ids.map(id => ({ id }));

/**
 * As DatabaseTool.commitRelation: the row's own new list (a one-page limit keeps
 * the last id) and, to run after the row is written, the other side.
 */
const relationWrite = (
  ctx: ToolActionContext, databaseId: string, property: PropertyDefinition, row: RowRef, value: unknown
): { value: Array<{ id: string }>; after: () => void } => {
  const settings = property.relation;
  const stored = relationIdsOf(row.properties[property.id]);
  const edit = relationEdit(stored, stored, value, settings?.limit);

  if (edit === null || settings === undefined) {
    return { value: asRelation(edit?.own ?? stored), after: () => undefined };
  }
  // A template is no row: the editor writes no other side for one.
  const synced = row.template ? undefined : syncedMirror(ctx, databaseId, property);
  const target = settings.targetDatabaseId;
  const after = (): void => {
    if (synced !== undefined) {
      edit.link.forEach(id => writeRelated(ctx, target, id, synced, current => addRelated(current, row.id, null)));
      edit.unlink.forEach(id => writeRelated(ctx, target, id, synced, current => removeRelated(current, row.id)));
    } else if (target === databaseId && !row.template) {
      // A one-way self-relation shows both ways: the other row's pointer goes too.
      edit.removed
        .filter(id => relationIdsOf(liveValues(ctx, databaseId, id)?.[property.id]).includes(row.id))
        .forEach(id => writeRelated(ctx, databaseId, id, property.id, current => removeRelated(current, row.id)));
    }
  };

  return { value: asRelation(edit.own), after };
};

const setRowValues: ToolActionImpl<{ rowId: string; values: Record<string, unknown> }> = {
  run: (ctx, args) => {
    const { dataId, state } = rowHome(ctx);
    // Editing a template's values is a row edit too (the editor's template page).
    const row = rowBlocksOf(ctx, dataId).find(candidate => candidate.id === args.rowId)
      ?? ctx.fail('PRECONDITION_FAILED', `Block ${args.rowId} is not a row of this database.`);
    const effects: Array<() => void> = [];
    const values = Object.fromEntries(Object.entries(checkedValues(ctx, dataId, state, args.values, row.template)).map(([propertyId, value]) => {
      const property = state.schema.find(each => each.id === propertyId);

      if (property?.type !== 'relation') {
        return [propertyId, value];
      }
      const write = relationWrite(ctx, dataId, property, row, value);

      effects.push(write.after);

      return [propertyId, write.value];
    }));
    const properties = { ...row.properties, ...values };
    const title = titleOf(state, properties);
    // As updateRowBlock: a cleared date takes its reminder along in the same write.
    const reminders = rawData(ctx, row.id).reminders;
    const kept = isRecord(reminders) ? Object.fromEntries(Object.entries(reminders).filter(([propertyId]) => values[propertyId] !== null)) : undefined;
    const dropped = isRecord(reminders) && kept !== undefined && Object.keys(kept).length < Object.keys(reminders).length;

    ctx.update(args.rowId, {
      properties,
      ...(title === undefined ? {} : { title }),
      ...(dropped ? { reminders: Object.keys(kept).length === 0 ? undefined : kept } : {}),
    });
    effects.forEach(effect => effect());

    return undefined;
  },
};

/** As DatabaseTool.unlinkDeletedRow: the row leaves the relations of this database that point at it, and their other sides. */
const unlinkRow = (ctx: ToolActionContext, databaseId: string, schema: PropertyDefinition[], rowId: string): void => {
  const values = liveValues(ctx, databaseId, rowId) ?? {};

  for (const property of schema) {
    const settings = property.relation;

    if (property.type !== 'relation' || settings === undefined) {
      continue;
    }
    const synced = syncedMirror(ctx, databaseId, property);

    if (synced !== undefined) {
      relationIdsOf(values[property.id]).forEach(id => writeRelated(ctx, settings.targetDatabaseId, id, synced, current => removeRelated(current, rowId)));
    }
    if (settings.targetDatabaseId === databaseId) {
      rowsOf(ctx, databaseId)
        .filter(other => other.id !== rowId && relationIdsOf(other.properties[property.id]).includes(rowId))
        .forEach(other => writeRelated(ctx, databaseId, other.id, property.id, current => removeRelated(current, rowId)));
    }
  }
};

const subtreeOf = (ctx: ToolActionContext, id: string): string[] =>
  [id, ...(ctx.read(id)?.children ?? []).flatMap(child => subtreeOf(ctx, child))];

/**
 * As the editor's row delete (deleteRowBlock): a parent's sub-items go too, and
 * every relation pointing at a deleted row lets go of it. A template is
 * deleteTemplate: it stops being the default.
 */
const deleteRow: ToolActionImpl<{ rowId: string }, undefined, { removedIds: string[] }> = {
  run: (ctx, args) => {
    const { dataId, state } = rowHome(ctx);
    const target = rowBlocksOf(ctx, dataId).find(candidate => candidate.id === args.rowId)
      ?? ctx.fail('PRECONDITION_FAILED', `Block ${args.rowId} is not a row of this database.`);

    if (target.template) {
      const removedIds = subtreeOf(ctx, target.id);

      if (state.schema.some(property => property.type === 'title' && property.defaultTemplateId === target.id)) {
        ctx.update(dataId, {
          schema: state.schema.map((property) => {
            if (property.defaultTemplateId !== target.id) {
              return property;
            }
            const { defaultTemplateId: _gone, ...rest } = property;

            return rest;
          }),
        });
      }
      ctx.remove(target.id, { withChildren: true });

      return { removedIds };
    }
    const pair = relationPair(state.schema, dataId, 'parentItem', 'subItems');
    const subItems = pair === undefined ? [] : descendantsOf(target.id, rowsOf(ctx, dataId), pair.forward);
    const doomed = [...[...subItems].reverse(), target.id];
    const removedIds = [target.id, ...subItems].flatMap(id => subtreeOf(ctx, id));

    doomed.forEach((id) => {
      unlinkRow(ctx, dataId, state.schema, id);
      ctx.remove(id, { withChildren: true });
    });

    return { removedIds };
  },
};

/** The data a copy of a row or template carries over: values aside, its page fields and reminders. */
const copiedPage = (ctx: ToolActionContext, sourceId: string, properties: Record<string, unknown>): Record<string, unknown> => {
  const page = rawData(ctx, sourceId);
  const reminders = copiedReminders(isRecord(page.reminders) ? page.reminders as Record<string, DateReminder> : undefined, properties, dynamicContext(ctx).now);

  return {
    ...Object.fromEntries(PAGE_FIELDS.filter(field => page[field] !== undefined).map(field => [field, page[field]])),
    ...(reminders === undefined ? {} : { reminders }),
  };
};

/**
 * As the row menu's Duplicate (duplicateTableRow): the copy goes right after
 * the original with its page body, in the open view's own order too, and a parent's sub-items are copied under
 * the copy. A template copy is duplicateTemplate: it stays a template.
 */
const duplicateRow: ToolActionImpl<{ rowId: string }, undefined, { rowId: string }> = {
  run: (ctx, args) => {
    const { block, dataId, state } = rowHome(ctx);
    const source = rowBlocksOf(ctx, dataId).find(candidate => candidate.id === args.rowId)
      ?? ctx.fail('PRECONDITION_FAILED', `Block ${args.rowId} is not a row of this database.`);
    const siblings = source.template ? templatesOf(ctx, dataId) : rowsOf(ctx, dataId);
    const ordered = sortedByPosition(siblings);
    const next = ordered[ordered.findIndex(each => each.id === source.id) + 1]?.position ?? null;
    const pair = source.template ? undefined : relationPair(state.schema, dataId, 'parentItem', 'subItems');
    const family = [source.id, ...(pair === undefined ? [] : descendantsOf(source.id, rowsOf(ctx, dataId), pair.forward))];
    const copies = new Map(family.map(id => [id, ctx.newId()]));
    const remap = (value: unknown): Array<{ id: string }> =>
      relationIdsOf(value).flatMap(id => (copies.has(id) ? [{ id: copies.get(id) ?? id }] : []));
    const cursor = { after: source.position };
    const view = source.template ? undefined : state.views.find(each => each.id === state.activeViewId);
    const order = view?.rowOrder;

    // A view with its own order gets keys for the copies too, right after the original there.
    if (view !== undefined && order !== undefined) {
      const keyOf = (each: RowRef): string => order[each.id] ?? each.position;
      const manual = [...rowsOf(ctx, dataId)].sort((a, b) => comparePositions(keyOf(a), keyOf(b)));
      const after = manual[manual.findIndex(each => each.id === source.id) + 1];
      const keys = { ...order };

      family.reduce((previous, sourceId) => {
        const key = positionBetween(previous, after === undefined ? null : keyOf(after));

        keys[copies.get(sourceId) ?? sourceId] = key;

        return key;
      }, keyOf(source));
      // Before the inserts: in the editor an insert opens a sync window that reads a later database write as an echo.
      ctx.update(block.id, { views: state.views.map(each => (each.id === view.id ? { ...each, rowOrder: keys } : each)) });
    }

    for (const sourceId of family) {
      const original = siblings.find(each => each.id === sourceId);
      const id = copies.get(sourceId);

      if (original === undefined || id === undefined) {
        continue;
      }
      // Inside the copied family, its own links point at the copies; the top copy keeps its parent.
      const links = pair === undefined ? {} : {
        [pair.backward]: remap(original.properties[pair.backward]),
        ...(sourceId === source.id ? {} : { [pair.forward]: remap(original.properties[pair.forward]) }),
      };
      const properties = { ...withEmptyLists(state, jsonCopy(original.properties)), ...links };
      const position = positionBetween(cursor.after, next);

      cursor.after = position;
      ctx.insert({
        type: 'database-row',
        id,
        data: {
          properties,
          position,
          title: titleOf(state, properties) ?? '',
          ...(source.template ? { template: true } : {}),
          ...copiedPage(ctx, sourceId, properties),
        },
        parentId: dataId,
      });
      copyBody(ctx, sourceId, id);
    }
    const copy = copies.get(source.id) ?? source.id;
    const parent = pair === undefined ? undefined : relationIdsOf(source.properties[pair.forward]).pop();

    // The copy sits beside the original: its parent lists it too.
    if (pair !== undefined && parent !== undefined) {
      writeRelated(ctx, dataId, parent, pair.backward, current => addRelated(current, copy, null));
    }

    return { rowId: copy };
  },
};

/** For each two-way relation of `schema` to another database: every row the values name there, with the mirror property. */
const eachOtherSide = (
  ctx: ToolActionContext, databaseId: string, schema: PropertyDefinition[], values: Record<string, unknown>,
  visit: (database: string, rowId: string, mirror: string) => void
): void => schema.forEach((property) => {
  const settings = property.relation;
  const mirror = syncedMirror(ctx, databaseId, property);

  if (settings !== undefined && mirror !== undefined && settings.targetDatabaseId !== databaseId) {
    relationIdsOf(values[property.id]).forEach(id => visit(settings.targetDatabaseId, id, mirror));
  }
});

/**
 * As the row menu's Move to (moveRowTo): the row and its sub-items go to the
 * end of another database of this document with their pages. Values follow
 * the target's properties by name and type, options by label; the rest stays
 * behind. Two-way relations let go of the rows here and pick them up there.
 */
const moveRowTo: ToolActionImpl<{ rowId: string; databaseId: string }> = {
  run: (ctx, args) => {
    const { block, dataId, state } = rowHome(ctx);
    const moving = rowOf(ctx, dataId, args.rowId);
    const target = ctx.read(args.databaseId);
    const targetSchema = schemaOf(ctx, args.databaseId);

    if (args.databaseId === block.id || args.databaseId === dataId || target === null || target.type !== block.type || targetSchema === undefined || (isRecord(target.data) && isRecord(target.data.source))) {
      ctx.fail('PRECONDITION_FAILED', `${args.databaseId} is not another database of this document; a linked view of a database is not one either.`);
    }
    const rows = rowsOf(ctx, dataId);
    const pair = relationPair(state.schema, dataId, 'parentItem', 'subItems');
    const family = new Set([moving.id, ...(pair === undefined ? [] : descendantsOf(moving.id, rows, pair.forward))]);
    const targetPair = relationPair(targetSchema ?? [], args.databaseId, 'parentItem', 'subItems');
    const cursor = { after: sortedByPosition(rowsOf(ctx, args.databaseId)).at(-1)?.position ?? null };
    const moved = rows.filter(each => family.has(each.id)).map((each) => {
      const properties: Record<string, unknown> = mapRowValues(each.properties as Record<string, PropertyValue>, state.schema, targetSchema ?? []);

      if (pair !== undefined && targetPair !== undefined) {
        properties[targetPair.forward] = asRelation(relationIdsOf(each.properties[pair.forward]).filter(id => family.has(id)));
        properties[targetPair.backward] = asRelation(relationIdsOf(each.properties[pair.backward]).filter(id => family.has(id)));
      }
      const position = positionBetween(cursor.after, null);

      cursor.after = position;

      return { id: each.id, before: each.properties, properties: withEmptyLists({ ...state, schema: targetSchema ?? [] }, properties), position };
    });

    for (const row of moved) {
      eachOtherSide(ctx, dataId, state.schema, row.before, (database, id, mirror) =>
        writeRelated(ctx, database, id, mirror, current => removeRelated(current, row.id)));
      eachOtherSide(ctx, args.databaseId, targetSchema ?? [], row.properties, (database, id, mirror) =>
        writeRelated(ctx, database, id, mirror, current => addRelated(current, row.id, null)));
    }
    for (const row of moved) {
      const title = titleOf({ ...state, schema: targetSchema ?? [] }, row.properties);

      ctx.update(row.id, { properties: row.properties, position: row.position, title: title ?? '' });
      ctx.move(row.id, { parentId: args.databaseId, position: 'end' });
    }

    return undefined;
  },
};

// Rows and templates only: a tabs layout block or a nested database is an ordinary child.
export const DATABASE_CHILD_COMMAND: ChildCommandRoute = (command, child) => (child.type === 'database-row'
  ? { action: command === 'delete' ? 'deleteRow' : 'duplicateRow', args: { rowId: child.id } }
  : undefined);

/**
 * As placeRow (a row dropped in a view): in a view with its own order only
 * that order changes; otherwise the row's position moves, after the other
 * views that show rows pin it where they show it.
 */
const moveRow: ToolActionImpl<{ rowId: string; group?: string } & Placement> = {
  run: (ctx, args) => {
    exactlyOnePlacement(ctx, args);
    const { block, dataId, state } = rowHome(ctx);
    const current = rowOf(ctx, dataId, args.rowId);
    const others = rowsOf(ctx, dataId).filter(row => row.id !== args.rowId);
    const { view, order } = openOrder(state);
    const key = keyAround(ctx, others, order, { before: args.before, after: args.after });
    const values = args.group === undefined ? {} : { properties: { ...current.properties, ...groupValue(ctx, state, args.group) } };

    if (view !== undefined && order !== undefined) {
      ctx.update(block.id, withRowOrders(state, { [view.id]: { ...order, [args.rowId]: key } }));
      if (args.group !== undefined) ctx.update(args.rowId, values);

      return undefined;
    }
    const pinned = view === undefined
      ? []
      : pinnedRowOrders(state.views, view.id, [current], each => !UNORDERED_VIEW_TYPES.has(each.type) && (each.dataSourceId ?? dataId) === dataId);

    if (pinned.length > 0) {
      ctx.update(block.id, withRowOrders(state, Object.fromEntries(pinned.map(each => [each.viewId, each.rowOrder]))));
    }
    ctx.update(args.rowId, { position: key, ...values });

    return undefined;
  },
};

// ─── Property settings, option colour, templates (the editor's property and template menus) ───

/** Setting keys a property menu writes (PropertySettingsV2). `type` and `config` are not settings. */
const SETTING_KEYS = ['description', 'icon', 'pageVisibility', 'number', 'date', 'status', 'optionSort', 'uniqueId', 'person', 'formula', 'relation', 'rollup', 'button', 'dependency', 'autofill'] as const;

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

/**
 * As DatabaseTool.setRelationTwoWay. Two-way on, with no syncedPropertyId and
 * no live mirror yet, makes the other side: a relation on the target database
 * (this one for a self-relation) that points back. Off drops the link on this
 * side; the mirror stays as a one-way relation.
 */
const twoWayPairing = (
  ctx: ToolActionContext, block: TargetBlock, property: PropertyDefinition, given: Record<string, unknown>
): { relation: Record<string, unknown>; target: string; mirror?: PropertyDefinition } => {
  // The mirror's name is input only: it never lands in the saved relation.
  const { syncedPropertyName, ...input } = given;
  const target = typeof input.targetDatabaseId === 'string' ? input.targetDatabaseId : property.relation?.targetDatabaseId ?? block.id;

  if (input.twoWay !== true) {
    const { twoWay: _twoWay, syncedPropertyId: _synced, ...oneWay } = input;

    return { relation: input.twoWay === false ? oneWay : input, target };
  }
  if (typeof input.syncedPropertyId === 'string') {
    return { relation: input, target };
  }
  if (input.targetDocumentId !== undefined) {
    return ctx.fail('PRECONDITION_FAILED', 'A relation to a database in another document cannot be two-way.');
  }
  const targetSchema = schemaOf(ctx, target) ?? ctx.fail('PRECONDITION_FAILED', `${target} is not a database block in the document you read.`);
  const held = property.relation?.syncedPropertyId;
  const live = held === undefined ? undefined : syncedMirror(ctx, block.id, { ...property, relation: { ...(input as unknown as RelationSettings), syncedPropertyId: held } });

  if (live !== undefined && typeof syncedPropertyName === 'string') {
    return ctx.fail('PRECONDITION_FAILED', `The mirror exists already: rename it with updateProperty name, propertyId ${live} on database ${target}.`);
  }
  if (live !== undefined) {
    return { relation: { ...input, syncedPropertyId: live }, target };
  }
  const title = typeof block.data.title === 'string' && block.data.title !== '' ? block.data.title : property.name;
  const names = (target === block.id ? readDatabase(block).schema : targetSchema).map(each => each.name);
  const wanted = typeof syncedPropertyName === 'string' ? syncedPropertyName.trim() : '';
  const mirror: PropertyDefinition = {
    id: ctx.newId(),
    name: freePropertyName(names, wanted === '' ? DATABASE_DEFAULT_TEXT.relationReverseName.replace('{name}', title) : wanted),
    type: 'relation',
    position: positionAround(ctx, target === block.id ? readDatabase(block).schema : targetSchema),
    relation: { targetDatabaseId: block.id, twoWay: true, syncedPropertyId: property.id },
  };

  return { relation: { ...input, syncedPropertyId: mirror.id }, target, mirror };
};

/** As the property menu's target pick: a rollup given a new target takes a Number target's format. */
const withTargetFormat = (ctx: ToolActionContext, block: TargetBlock, schema: PropertyDefinition[], before: PropertyDefinition | undefined, after: PropertyDefinition): PropertyDefinition => {
  const targetId = after.rollup?.targetPropertyId;

  if (after.type !== 'rollup' || targetId === undefined || targetId === before?.rollup?.targetPropertyId) {
    return after;
  }
  const relation = schema.find(property => property.id === after.rollup?.relationPropertyId)?.relation;

  if (relation === undefined || relation.targetDocumentId !== undefined) {
    return after;
  }
  const source = relation.targetDatabaseId === block.id ? schema : schemaOf(ctx, relation.targetDatabaseId);

  return { ...after, ...inheritedRollupFormat(after, source?.find(property => property.id === targetId)) };
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
    const given = Object.entries(args.settings ?? {}).filter(([key]) => SETTING_KEYS.some(known => known === key) || layout.includes(key));
    const pairing = property?.type === 'relation' && isRecord(args.settings?.relation)
      ? twoWayPairing(ctx, block, property, args.settings.relation)
      : undefined;
    const settings = pairing === undefined ? given : given.map(([key, value]): [string, unknown] => [key, key === 'relation' ? pairing.relation : value]);
    const updated = state.schema.map((property, i) => (i !== index
      ? property
      : {
        ...Object.fromEntries(Object.entries(property).filter(([key]) => !settings.some(([changed, value]) => changed === key && value === null))),
        ...Object.fromEntries(settings.filter(([, value]) => value !== null)),
        ...(name === undefined ? {} : { name }),
      } as PropertyDefinition));
    // A number cleared in the same update stays cleared.
    const schema = args.settings?.number === null
      ? updated
      : updated.map((each, i) => (i === index ? withTargetFormat(ctx, block, updated, property, each) : each));
    const mirror = pairing?.mirror;

    if (mirror === undefined || pairing === undefined) {
      ctx.update(block.id, { schema });

      return undefined;
    }
    if (pairing.target === block.id) {
      ctx.update(block.id, withNewProperty({ ...state, schema }, mirror));
    } else {
      ctx.update(block.id, { schema });
      const target = ctx.read(pairing.target);
      const data = isRecord(target?.data) ? target.data : {};

      ctx.update(pairing.target, withNewProperty({
        schema: schemaOf(ctx, pairing.target) ?? [],
        views: Array.isArray(data.views) ? data.views as DatabaseViewConfig[] : [],
        activeViewId: '',
      }, mirror));
    }
    // The other side starts empty on every row, then holds each row this side names.
    rowsOf(ctx, pairing.target)
      .filter(each => each.properties[mirror.id] === undefined || each.properties[mirror.id] === null)
      .forEach(each => writeRelated(ctx, pairing.target, each.id, mirror.id, () => []));
    rowsOf(ctx, block.id).forEach(each => relationIdsOf(each.properties[args.propertyId])
      .forEach(id => writeRelated(ctx, pairing.target, id, mirror.id, current => addRelated(current, each.id, null))));

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
    const { dataId, state } = rowHome(ctx);
    const titleId = state.schema.find(property => property.type === 'title')?.id;
    const templateId = ctx.insert({
      type: 'database-row',
      data: {
        properties: titleId === undefined ? {} : { [titleId]: '' },
        position: positionAround(ctx, templatesOf(ctx, dataId)),
        title: '',
        template: true,
      },
      parentId: dataId,
    });

    return { templateId };
  },
};

/** As DatabaseTool.setDefaultTemplate: the id lives on the title property; null clears it. A linked view writes its source's (adoptLinkedSchema). */
const setDefaultTemplate: ToolActionImpl<{ templateId: string | null }> = {
  run: (ctx, args) => {
    const { dataId, state } = rowHome(ctx);

    if (args.templateId !== null) {
      templateOf(ctx, dataId, args.templateId);
    }
    const schema = state.schema.map((property) => {
      if (property.type !== 'title') {
        return property;
      }
      const { defaultTemplateId: _previous, ...rest } = property;

      return args.templateId === null ? rest : { ...rest, defaultTemplateId: args.templateId };
    });

    ctx.update(dataId, { schema });

    return undefined;
  },
};

/** As DatabaseTool.setTemplateRepeat: Blok stores the schedule, the host runs it. null clears it. */
const setTemplateRepeat: ToolActionImpl<{ templateId: string; repeat: TemplateRepeat | null }> = {
  run: (ctx, args) => {
    const { dataId } = rowHome(ctx);

    templateOf(ctx, dataId, args.templateId);
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
  addRow, moveRow, setRowValues, deleteRow, applyTemplate, duplicateRow, moveRowTo,
  updateProperty, duplicateProperty, deleteProperty, recolorOption,
  addTemplate, setDefaultTemplate, setTemplateRepeat, changePropertyType, submitForm, pressButton,
};
