import type {
  DatabaseRow,
  DatabaseViewConfig,
  FilterConfig,
  FilterGroup,
  FilterNode,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SortConfig,
} from './types';
import { parseDateValue } from './cells/date-value';
import { filesOf, orderedStatusOptions, personIdsOf, readPropertyValue, statusGroupsOf } from './property-values';
import { RELATIVE_DATE_OPERATORS, relativeWindow, resolveDay } from './relative-dates';

const TEXT_OPERATORS = ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'] as const;
const COMPARE_OPERATORS = ['equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to'] as const;
const NUMBER_OPERATORS = [...COMPARE_OPERATORS, 'is_empty', 'is_not_empty'] as const;
const OPTION_OPERATORS = ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'] as const;
const LIST_OPERATORS = ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'] as const;
const DATE_OPERATORS = [
  'equals', 'does_not_equal', 'before', 'after', 'on_or_before', 'on_or_after', ...RELATIVE_DATE_OPERATORS, 'is_empty', 'is_not_empty',
] as const;

/** Operator names follow the Notion API, so saved filters stay portable. */
export const FILTER_OPERATORS: Readonly<Record<PropertyType, readonly string[]>> = {
  title: TEXT_OPERATORS,
  text: TEXT_OPERATORS,
  url: TEXT_OPERATORS,
  richText: TEXT_OPERATORS,
  email: TEXT_OPERATORS,
  phone: TEXT_OPERATORS,
  number: NUMBER_OPERATORS,
  select: OPTION_OPERATORS,
  status: OPTION_OPERATORS,
  multiSelect: LIST_OPERATORS,
  person: LIST_OPERATORS,
  createdBy: LIST_OPERATORS,
  lastEditedBy: LIST_OPERATORS,
  files: ['is_empty', 'is_not_empty'],
  checkbox: ['equals', 'does_not_equal'],
  date: DATE_OPERATORS,
  createdTime: DATE_OPERATORS,
  lastEditedTime: DATE_OPERATORS,
  uniqueId: COMPARE_OPERATORS,
  relation: LIST_OPERATORS,
  // Formula and rollup filter as their result type; the model queries with
  // that property (ComputedProperties.valueProperty), never with these.
  formula: [],
  rollup: [],
};

/** A rollup that shows a list filters with Notion's API quantifiers. */
const QUANTIFIERS = ['any', 'every', 'none'] as const;

const OP = 'tools.database.filterOperator.';

const WORD_LABELS: Readonly<Record<string, string>> = {
  equals: `${OP}is`,
  does_not_equal: `${OP}isNot`,
  contains: `${OP}contains`,
  does_not_contain: `${OP}doesNotContain`,
  starts_with: `${OP}startsWith`,
  ends_with: `${OP}endsWith`,
  is_empty: `${OP}isEmpty`,
  is_not_empty: `${OP}isNotEmpty`,
  before: `${OP}before`,
  after: `${OP}after`,
  on_or_before: `${OP}onOrBefore`,
  on_or_after: `${OP}onOrAfter`,
  ...Object.fromEntries(RELATIVE_DATE_OPERATORS.map((operator) => [operator, `${OP}isWithin`])),
  relative_to_today: `${OP}isRelativeToToday`,
};

/** Number filters read as symbols in Notion's menu (research/08): =, ≠, >, <, ≥, ≤. */
const SYMBOL_LABELS: Readonly<Record<string, string>> = {
  ...WORD_LABELS,
  equals: `${OP}numberEquals`,
  does_not_equal: `${OP}numberDoesNotEqual`,
  greater_than: `${OP}greaterThan`,
  greater_than_or_equal_to: `${OP}greaterThanOrEqual`,
  less_than: `${OP}lessThan`,
  less_than_or_equal_to: `${OP}lessThanOrEqual`,
};

/** The i18n key of each operator's menu label, per type. */
export const FILTER_OPERATOR_LABEL_KEYS: Readonly<Record<PropertyType, Readonly<Record<string, string>>>> = Object.fromEntries(
  Object.keys(FILTER_OPERATORS).map((type) => [type, type === 'number' || type === 'uniqueId' ? SYMBOL_LABELS : WORD_LABELS])
) as Record<PropertyType, Record<string, string>>;

export interface QuerySource {
  schema: PropertyDefinition[];
  rows: DatabaseRow[];
  /** Keys of the groups a row belongs to. The model owns grouping; the engine only asks. */
  groupKeysOf?: (row: DatabaseRow) => string[];
  /** Today, for relative date filters. Default: the clock. */
  now?: Date;
  /** The current user's id, for a person filter's "Me". */
  me?: string | null;
}

export interface QueryRowsRequest {
  view: DatabaseViewConfig;
  group?: string;
  /** Search in view: a case-blind match on the title and property text. Session only, never saved. */
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface QueryRowsResult {
  rows: DatabaseRow[];
  nextCursor?: string;
  total?: number;
}

export interface GroupCount {
  key: string;
  count: number;
}

const isBlank = (value: PropertyValue | undefined): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

const toNumber = (value: PropertyValue | undefined): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The calendar day of an ISO string; time and zone are ignored. */
/** The local calendar day of an ISO instant, or of a stored day as is. */
const toLocalDayOf = (value: string): string | undefined => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = Date.parse(value);

  if (Number.isNaN(time)) return undefined;
  const date = new Date(time);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const toIdList = (value: PropertyValue): string[] => personIdsOf(value);

/** `undefined` means "this filter does not apply", so the row passes. */
const matchText = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const isDocument = typeof value === 'object' && value !== null && !Array.isArray(value);

  if (operator === 'is_empty' || operator === 'is_not_empty') {
    const empty = isDocument ? value.blocks.length === 0 : isBlank(value);

    return operator === 'is_empty' ? empty : !empty;
  }
  if (isDocument || typeof target !== 'string' || target === '') return undefined;

  const text = (typeof value === 'string' || typeof value === 'number' ? String(value) : '').toLowerCase();
  const needle = target.toLowerCase();

  switch (operator) {
    case 'equals': return text === needle;
    case 'does_not_equal': return text !== needle;
    case 'contains': return text.includes(needle);
    case 'does_not_contain': return !text.includes(needle);
    case 'starts_with': return text.startsWith(needle);
    case 'ends_with': return text.endsWith(needle);
    default: return undefined;
  }
};

const matchNumber = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const n = toNumber(value);

  if (operator === 'is_empty') return n === undefined;
  if (operator === 'is_not_empty') return n !== undefined;

  const t = toNumber(target);

  if (t === undefined) return undefined;
  if (n === undefined) return operator === 'does_not_equal';

  switch (operator) {
    case 'equals': return n === t;
    case 'does_not_equal': return n !== t;
    case 'greater_than': return n > t;
    case 'greater_than_or_equal_to': return n >= t;
    case 'less_than': return n < t;
    case 'less_than_or_equal_to': return n <= t;
    default: return undefined;
  }
};

const matchSelect = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const current = typeof value === 'string' ? value : '';

  if (operator === 'is_empty') return current === '';
  if (operator === 'is_not_empty') return current !== '';

  const wanted = toIdList(target);

  if (wanted.length === 0) return undefined;
  if (operator === 'equals') return wanted.includes(current);
  if (operator === 'does_not_equal') return !wanted.includes(current);

  return undefined;
};

const matchMultiSelect = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const current = personIdsOf(value);

  if (operator === 'is_empty') return current.length === 0;
  if (operator === 'is_not_empty') return current.length > 0;

  const wanted = toIdList(target);

  if (wanted.length === 0) return undefined;

  const hit = wanted.some((id) => current.includes(id));

  if (operator === 'contains') return hit;
  if (operator === 'does_not_contain') return !hit;

  return undefined;
};

const matchCheckbox = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  if (typeof target !== 'boolean') return undefined;
  const checked = value === true;

  if (operator === 'equals') return checked === target;
  if (operator === 'does_not_equal') return checked !== target;

  return undefined;
};

/** A range matches when any of its days does; a single day is a range of one. */
/** A range matches when any of its days does; a single day is a range of one. */
const matchDate = (value: PropertyValue | undefined, operator: string, target: PropertyValue, now: Date): boolean | undefined => {
  const parsed = parseDateValue(value);

  if (operator === 'is_empty') return parsed === null;
  if (operator === 'is_not_empty') return parsed !== null;

  const window = relativeWindow(operator, target, now);
  const t = window === undefined ? resolveDay(target, now) : undefined;

  if (window === undefined && t === undefined) return undefined;
  if (parsed === null) return false;

  const first = parsed.start.slice(0, 10);
  const last = (parsed.end ?? parsed.start).slice(0, 10);

  if (window !== undefined) {
    return first <= window.to && last >= window.from;
  }
  if (t === undefined) return undefined;

  switch (operator) {
    case 'equals': return first <= t && t <= last;
    case 'does_not_equal': return !(first <= t && t <= last);
    case 'before': return first < t;
    case 'after': return last > t;
    case 'on_or_before': return first <= t;
    case 'on_or_after': return last >= t;
    default: return undefined;
  }
};

/** Created and edited times are stored as ISO instants; filters compare their local day. */
const matchTimestamp = (value: PropertyValue | undefined, operator: string, target: PropertyValue, now: Date): boolean | undefined => {
  const day = typeof value === 'string' && value !== '' ? toLocalDayOf(value) : undefined;

  return matchDate(day ?? null, operator, target, now);
};

const matchFiles = (value: PropertyValue | undefined, operator: string): boolean | undefined => {
  if (operator === 'is_empty') return filesOf(value).length === 0;
  if (operator === 'is_not_empty') return filesOf(value).length > 0;

  return undefined;
};

/** A target that names a status group matches every option in it, as the Notion API does. */
const matchStatus = (property: PropertyDefinition, value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const groupIds = new Set(statusGroupsOf(property).map((g) => g.id));
  const wanted = toIdList(target).flatMap((id) => (groupIds.has(id)
    ? (property.config?.options ?? []).filter((o) => (o.groupId ?? statusGroupsOf(property)[0]?.id) === id).map((o) => o.id)
    : [id]));

  return matchSelect(value, operator, wanted.length > 0 ? wanted : target);
};

type Matcher = (value: PropertyValue | undefined, operator: string, target: PropertyValue, property: PropertyDefinition, now: Date) => boolean | undefined;

const MATCHERS: Record<PropertyType, Matcher> = {
  title: matchText,
  text: matchText,
  url: matchText,
  richText: matchText,
  email: matchText,
  phone: matchText,
  number: matchNumber,
  uniqueId: matchNumber,
  select: matchSelect,
  status: (value, operator, target, property) => matchStatus(property, value, operator, target),
  multiSelect: matchMultiSelect,
  person: matchMultiSelect,
  createdBy: matchMultiSelect,
  lastEditedBy: matchMultiSelect,
  files: matchFiles,
  checkbox: matchCheckbox,
  date: (value, operator, target, _property, now) => matchDate(value, operator, target, now),
  createdTime: (value, operator, target, _property, now) => matchTimestamp(value, operator, target, now),
  lastEditedTime: (value, operator, target, _property, now) => matchTimestamp(value, operator, target, now),
  relation: matchMultiSelect,
  formula: () => undefined,
  rollup: () => undefined,
};

const LIST_SHAPES: readonly PropertyType[] = ['multiSelect', 'person', 'relation', 'files'];

const isRollupList = (property: PropertyDefinition): boolean => property.rollup !== undefined && LIST_SHAPES.includes(property.type);

/**
 * any / every / none over a rollup list: each item is compared by id with the
 * picked ids. Every on an empty list is false, as nothing is picked.
 */
const matchQuantified = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const items = personIdsOf(value ?? null);
  const wanted = toIdList(target);

  if (operator === 'is_empty') return items.length === 0;
  if (operator === 'is_not_empty') return items.length > 0;
  if (wanted.length === 0) return undefined;
  const hit = (id: string): boolean => wanted.includes(id);

  if (operator === 'any') return items.some(hit);
  if (operator === 'every') return items.length > 0 && items.every(hit);
  if (operator === 'none') return !items.some(hit);

  return undefined;
};

/** A person filter's value for the current user (Notion API `"me"`). */
export const ME_FILTER_VALUE = 'me';

const PERSON_TYPES: readonly PropertyType[] = ['person', 'createdBy', 'lastEditedBy'];

/** Stands in for "Me" when nobody is signed in: no person has this id. */
const NOBODY = '__blok-nobody__';

/**
 * "Me" becomes the current user's id. With nobody signed in it matches
 * nobody, as the Notion API does for an internal connection.
 */
const resolveMe = (target: PropertyValue, me: string | null | undefined): PropertyValue => {
  const ids = toIdList(target);

  if (!ids.includes(ME_FILTER_VALUE)) return target;

  return ids.flatMap((id) => {
    if (id !== ME_FILTER_VALUE) return [id];

    return me === undefined || me === null || me === '' ? [NOBODY] : [me];
  });
};

/**
 * Whether one condition holds. `undefined` means the engine cannot read it
 * (unknown operator, wrong type, deleted property, missing value): hiding
 * rows on a filter written by a newer client would look like data loss.
 */
export const matchCondition = (
  row: DatabaseRow,
  condition: Pick<FilterConfig, 'propertyId' | 'operator' | 'value'>,
  schema: PropertyDefinition[],
  now: Date = new Date(),
  me?: string | null
): boolean | undefined => {
  const property = schema.find((p) => p.id === condition.propertyId);

  if (property !== undefined && isRollupList(property)) {
    return (QUANTIFIERS as readonly string[]).includes(condition.operator) || condition.operator === 'is_empty' || condition.operator === 'is_not_empty'
      ? matchQuantified(readPropertyValue(row, property), condition.operator, condition.value)
      : undefined;
  }
  // A type from a newer client has no entry here: let the row through.
  if (property === undefined || !(FILTER_OPERATORS[property.type]?.includes(condition.operator) ?? false)) return undefined;
  const target = PERSON_TYPES.includes(property.type) ? resolveMe(condition.value, me) : condition.value;

  return MATCHERS[property.type](readPropertyValue(row, property), condition.operator, target, property, now);
};

/** AND of every filter. A filter the engine cannot read lets the row through. */
export const rowMatchesFilters = (
  row: DatabaseRow,
  filters: FilterConfig[],
  schema: PropertyDefinition[],
  now: Date = new Date(),
  me?: string | null
): boolean =>
  filters.every((filter) => matchCondition(row, filter, schema, now, me) ?? true);

export const isFilterGroup = (node: FilterNode): node is FilterGroup =>
  Array.isArray((node as Partial<FilterGroup>).filterRules);

/** `undefined` means the node says nothing about the row: no readable rule inside. */
const evaluate = (row: DatabaseRow, node: FilterNode, schema: PropertyDefinition[], now: Date, me: string | null | undefined): boolean | undefined => {
  if (!isFilterGroup(node)) {
    return matchCondition(row, node, schema, now, me);
  }

  const results = node.filterRules
    .map((child) => evaluate(row, child, schema, now, me))
    .filter((result): result is boolean => result !== undefined);

  if (results.length === 0) return undefined;

  return node.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
};

/** Rules the engine cannot read are skipped, so an unfinished rule hides nothing. */
export const rowMatchesFilterTree = (
  row: DatabaseRow,
  tree: FilterGroup | undefined,
  schema: PropertyDefinition[],
  now: Date = new Date(),
  me?: string | null
): boolean => tree === undefined || (evaluate(row, tree, schema, now, me) ?? true);

/** Must match getOrderedRows: keys mix letter case, and `<` orders case differently. */
const comparePosition = (a: DatabaseRow, b: DatabaseRow): number => a.position.localeCompare(b.position);

/** Options compare with `<`, like getSelectOptions, so sort order matches column order. */
const compareKeys = (a: string, b: string): number => {
  if (a === b) return 0;

  return a < b ? -1 : 1;
};

const compareKeyLists = (a: string[], b: string[]): number => {
  const diff = a.map((key, i) => (i < b.length ? compareKeys(key, b[i]) : 0)).find((d) => d !== 0);

  return diff ?? a.length - b.length;
};

/** Returns a comparable key, or `undefined` for an empty value. */
const sortKeyOf = (property: PropertyDefinition, value: PropertyValue | undefined): string | number | string[] | undefined => {
  const optionPosition = (id: string): string | undefined => property.config?.options.find((o) => o.id === id)?.position;

  switch (property.type) {
    case 'number':
    case 'uniqueId':
      return toNumber(value);
    case 'checkbox': return value === true ? 1 : 0;
    case 'date': return parseDateValue(value)?.start;
    case 'createdTime':
    case 'lastEditedTime':
      return typeof value === 'string' ? Date.parse(value) : undefined;
    case 'select': return typeof value === 'string' && value !== '' ? optionPosition(value) ?? value : undefined;
    case 'status': {
      const rank = orderedStatusOptions(property).findIndex((o) => o.id === value);

      return rank === -1 ? undefined : rank;
    }
    case 'multiSelect': {
      const keys = toIdList(value ?? null).map((id) => optionPosition(id) ?? id).sort(compareKeys);

      return keys.length > 0 ? keys : undefined;
    }
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
    case 'relation': {
      const keys = personIdsOf(value);

      return keys.length > 0 ? keys : undefined;
    }
    case 'files': {
      const names = filesOf(value).map((file) => file.name);

      return names.length > 0 ? names : undefined;
    }
    case 'title':
    case 'text':
    case 'url':
    case 'richText':
    case 'email':
    case 'phone':
      return typeof value === 'string' && value !== '' ? value : undefined;
    case 'formula':
    case 'rollup':
      return undefined;
  }
};

const compareSortKeys = (a: string | number | string[], b: string | number | string[]): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (Array.isArray(a) && Array.isArray(b)) return compareKeyLists(a, b);
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);

  return 0;
};

/** Stable: rows equal on every sort keep position order. Empties go last in both directions. */
export const sortRows = (rows: DatabaseRow[], sorts: SortConfig[], schema: PropertyDefinition[]): DatabaseRow[] => {
  const active = sorts.flatMap((sort) => {
    const property = schema.find((p) => p.id === sort.propertyId);

    return property === undefined ? [] : [{ property, sign: sort.direction === 'desc' ? -1 : 1 }];
  });

  const compareBy = (property: PropertyDefinition, sign: number, a: DatabaseRow, b: DatabaseRow): number => {
    const ka = sortKeyOf(property, readPropertyValue(a, property));
    const kb = sortKeyOf(property, readPropertyValue(b, property));

    // Empty check runs before the sign, or descending would put empties first.
    if (ka === undefined && kb === undefined) return 0;
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;

    return compareSortKeys(ka, kb) * sign;
  };

  return [...rows].sort((a, b) => {
    const diff = active.map(({ property, sign }) => compareBy(property, sign, a, b)).find((d) => d !== 0);

    return diff ?? comparePosition(a, b);
  });
};

/** The value an `equals` filter asks for, or `undefined` when a new row cannot take it. */
/** Today in the viewer's zone, as a stored date. */
const todayValue = (): string => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const shiftDay = (day: string, by: number): string => {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + by));

  return shifted.toISOString().slice(0, 10);
};

const RELATIVE_TODAY: ReadonlySet<string> = new Set(['today', 'this_week', 'this_month', 'this_year']);

/**
 * A date a new row can take and still pass the filter. A relative "this
 * week" becomes today, as Notion fills it (research/08).
 */
const dateTargetValue = (operator: string, target: PropertyValue): string | undefined => {
  if (operator === 'is_not_empty' || operator === 'this_week' || (typeof target === 'string' && RELATIVE_TODAY.has(target))) {
    return todayValue();
  }
  const day = toDay(target);

  if (day === undefined) return undefined;

  switch (operator) {
    case 'equals':
    case 'on_or_before':
    case 'on_or_after':
      return day;
    case 'before': return shiftDay(day, -1);
    case 'after': return shiftDay(day, 1);
    default: return undefined;
  }
};

const filterTargetValue = (type: PropertyType | undefined, operator: string, target: PropertyValue): PropertyValue | undefined => {
  if (type === 'date') {
    return dateTargetValue(operator, target);
  }
  if (operator === 'contains' && type === 'person') {
    const id = toIdList(target)[0];

    return id === undefined ? undefined : [{ id }];
  }
  if (operator !== 'equals') return undefined;

  switch (type) {
    case 'select':
    case 'status':
      return toIdList(target)[0];
    case 'checkbox': return typeof target === 'boolean' ? target : undefined;
    case 'text':
    case 'email':
    case 'phone':
      return typeof target === 'string' && target !== '' ? target : undefined;
    case 'number': return toNumber(target);
    case 'title':
    case 'url':
    case 'richText':
    case 'multiSelect':
    case 'person':
    case 'files':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
    case 'relation':
    case 'formula':
    case 'rollup':
    case undefined:
      return undefined;
  }
};

/**
 * Values a new row takes from the view's `equals` filters (and a person
 * `contains`), as Notion does, so the filter does not hide the row on the
 * next redraw.
 */
export const newRowValues = (filters: FilterConfig[], schema: PropertyDefinition[]): Record<string, PropertyValue> =>
  Object.fromEntries(filters.flatMap((filter) => {
    const value = filterTargetValue(schema.find((p) => p.id === filter.propertyId)?.type, filter.operator, filter.value);

    return value === undefined ? [] : [[filter.propertyId, value]];
  }));

/** The text a search looks at for one value: option labels for selects and status, file names, the raw text otherwise. */
const searchText = (property: PropertyDefinition, value: PropertyValue | undefined): string => {
  const options = property.config?.options ?? [];
  const label = (id: string): string => options.find((o) => o.id === id)?.label ?? '';

  switch (property.type) {
    case 'select':
    case 'status':
      return typeof value === 'string' ? label(value) : '';
    case 'multiSelect': return personIdsOf(value).map(label).join(' ');
    case 'files': return filesOf(value).map((file) => file.name).join(' ');
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'number':
    case 'uniqueId':
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    // People are ids here (names live with the host); checkbox, dates and documents have no text.
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
    case 'checkbox':
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
    case 'richText':
    case 'relation':
    case 'formula':
    case 'rollup':
      return '';
  }
};

export const rowMatchesSearch = (row: DatabaseRow, search: string | undefined, schema: PropertyDefinition[]): boolean => {
  const needle = (search ?? '').trim().toLowerCase();

  if (needle === '') return true;

  return schema.some((property) => searchText(property, readPropertyValue(row, property)).toLowerCase().includes(needle));
};

const filteredRows = (source: QuerySource, view: DatabaseViewConfig, search?: string): DatabaseRow[] => {
  const now = source.now ?? new Date();

  return source.rows.filter((row) =>
    rowMatchesFilters(row, view.filters, source.schema, now, source.me) &&
    rowMatchesFilterTree(row, view.filterTree, source.schema, now, source.me) &&
    rowMatchesSearch(row, search, source.schema));
};

/**
 * In-memory answer to the view query. Synchronous for now; a remote source
 * will need the same fields behind a Promise.
 */
export const queryRows = (source: QuerySource, request: QueryRowsRequest): QueryRowsResult => {
  const { view, group } = request;
  const groupKeysOf = source.groupKeysOf;
  const matching = filteredRows(source, view, request.search);
  const inGroup = group === undefined
    ? matching
    : matching.filter((row) => groupKeysOf?.(row).includes(group) ?? false);
  const sorted = sortRows(inGroup, view.sorts, source.schema);
  const start = request.cursor === undefined ? 0 : Number(request.cursor);
  const end = request.limit === undefined ? sorted.length : start + request.limit;

  return {
    rows: sorted.slice(start, end),
    total: sorted.length,
    ...(end < sorted.length ? { nextCursor: String(end) } : {}),
  };
};

/** Group counts after filtering, in the order each key first shows up in position order. */
export const queryGroups = (source: QuerySource, view: DatabaseViewConfig, options: { search?: string } = {}): GroupCount[] => {
  const counts = new Map<string, number>();

  for (const row of sortRows(filteredRows(source, view, options.search), [], source.schema)) {
    for (const key of source.groupKeysOf?.(row) ?? []) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts].map(([key, count]) => ({ key, count }));
};
