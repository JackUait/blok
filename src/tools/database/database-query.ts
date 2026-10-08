import type {
  DatabaseRow,
  DatabaseViewConfig,
  FilterConfig,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SortConfig,
} from './types';

const TEXT_OPERATORS = ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'] as const;

/** Operator names follow the Notion API, so saved filters stay portable. */
export const FILTER_OPERATORS: Readonly<Record<PropertyType, readonly string[]>> = {
  title: TEXT_OPERATORS,
  text: TEXT_OPERATORS,
  url: TEXT_OPERATORS,
  richText: TEXT_OPERATORS,
  number: ['equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'is_empty', 'is_not_empty'],
  select: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  multiSelect: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  checkbox: ['equals', 'does_not_equal'],
  date: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'],
};

export interface QuerySource {
  schema: PropertyDefinition[];
  rows: DatabaseRow[];
  /** Keys of the groups a row belongs to. The model owns grouping; the engine only asks. */
  groupKeysOf?: (row: DatabaseRow) => string[];
}

export interface QueryRowsRequest {
  view: DatabaseViewConfig;
  group?: string;
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
const toDay = (value: PropertyValue | undefined): string | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;

const toIdList = (value: PropertyValue): string[] => {
  if (Array.isArray(value)) return value;

  return typeof value === 'string' && value !== '' ? [value] : [];
};

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
  const current = Array.isArray(value) ? value : [];

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

const matchDate = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const day = toDay(value);

  if (operator === 'is_empty') return day === undefined;
  if (operator === 'is_not_empty') return day !== undefined;

  const t = toDay(target);

  if (t === undefined) return undefined;
  if (day === undefined) return false;

  switch (operator) {
    case 'equals': return day === t;
    case 'before': return day < t;
    case 'after': return day > t;
    case 'on_or_before': return day <= t;
    case 'on_or_after': return day >= t;
    default: return undefined;
  }
};

const MATCHERS: Record<PropertyType, (value: PropertyValue | undefined, operator: string, target: PropertyValue) => boolean | undefined> = {
  title: matchText,
  text: matchText,
  url: matchText,
  richText: matchText,
  number: matchNumber,
  select: matchSelect,
  multiSelect: matchMultiSelect,
  checkbox: matchCheckbox,
  date: matchDate,
};

/**
 * AND of every filter. A filter the engine cannot read (unknown operator,
 * wrong type, deleted property, missing value) lets the row through: hiding
 * rows on a filter written by a newer client would look like data loss.
 */
export const rowMatchesFilters = (row: DatabaseRow, filters: FilterConfig[], schema: PropertyDefinition[]): boolean =>
  filters.every((filter) => {
    const property = schema.find((p) => p.id === filter.propertyId);

    if (property === undefined || !FILTER_OPERATORS[property.type].includes(filter.operator)) return true;

    return MATCHERS[property.type](row.properties[filter.propertyId], filter.operator, filter.value) ?? true;
  });

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
    case 'number': return toNumber(value);
    case 'checkbox': return value === true ? 1 : 0;
    case 'date': return toDay(value);
    case 'select': return typeof value === 'string' && value !== '' ? optionPosition(value) ?? value : undefined;
    case 'multiSelect': {
      const keys = toIdList(value ?? null).map((id) => optionPosition(id) ?? id).sort(compareKeys);

      return keys.length > 0 ? keys : undefined;
    }
    case 'title':
    case 'text':
    case 'url':
    case 'richText':
      return typeof value === 'string' && value !== '' ? value : undefined;
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
    const ka = sortKeyOf(property, a.properties[property.id]);
    const kb = sortKeyOf(property, b.properties[property.id]);

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
const filterTargetValue = (type: PropertyType | undefined, target: PropertyValue): PropertyValue | undefined => {
  switch (type) {
    case 'select': return toIdList(target)[0];
    case 'checkbox': return typeof target === 'boolean' ? target : undefined;
    case 'text': return typeof target === 'string' && target !== '' ? target : undefined;
    case 'number': return toNumber(target);
    case 'title':
    case 'url':
    case 'richText':
    case 'multiSelect':
    case 'date':
    case undefined:
      return undefined;
  }
};

/**
 * Values a new row takes from the view's `equals` filters, as Notion does,
 * so the filter does not hide the row on the next redraw.
 */
export const newRowValues = (filters: FilterConfig[], schema: PropertyDefinition[]): Record<string, PropertyValue> =>
  Object.fromEntries(filters.flatMap((filter) => {
    const value = filter.operator === 'equals'
      ? filterTargetValue(schema.find((p) => p.id === filter.propertyId)?.type, filter.value)
      : undefined;

    return value === undefined ? [] : [[filter.propertyId, value]];
  }));

const filteredRows = (source: QuerySource, view: DatabaseViewConfig): DatabaseRow[] =>
  source.rows.filter((row) => rowMatchesFilters(row, view.filters, source.schema));

/**
 * In-memory answer to the view query. Synchronous for now; a remote source
 * will need the same fields behind a Promise.
 */
export const queryRows = (source: QuerySource, request: QueryRowsRequest): QueryRowsResult => {
  const { view, group } = request;
  const groupKeysOf = source.groupKeysOf;
  const inGroup = group === undefined
    ? filteredRows(source, view)
    : filteredRows(source, view).filter((row) => groupKeysOf?.(row).includes(group) ?? false);
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
export const queryGroups = (source: QuerySource, view: DatabaseViewConfig): GroupCount[] => {
  const counts = new Map<string, number>();

  for (const row of sortRows(filteredRows(source, view), [], source.schema)) {
    for (const key of source.groupKeysOf?.(row) ?? []) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts].map(([key, count]) => ({ key, count }));
};
