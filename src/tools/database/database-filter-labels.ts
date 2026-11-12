import { nanoid } from 'nanoid';
import { RELATIVE_DATE_OPERATORS, RELATIVE_DATE_VALUES, parseRelativeSpan } from './relative-dates';
import type { RelativeDateUnit } from './relative-dates';
import { ME_FILTER_VALUE, THIS_PAGE_FILTER_VALUE } from './database-query';
import { isPageListRollup } from '../../shared/database/value-helpers';
import type { FilterConfig, PropertyDefinition, PropertyType, SortConfig } from './types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface OperatorChoice {
  operator: string;
  labelKey: string;
}

/** Keys under `tools.database.filterOperator.`, shared with database-query's FILTER_OPERATOR_LABEL_KEYS. */
const op = (operator: string, labelKey: string): OperatorChoice => ({ operator, labelKey: `tools.database.filterOperator.${labelKey}` });

const EMPTY = [op('is_empty', 'isEmpty'), op('is_not_empty', 'isNotEmpty')];

const TEXT = [
  op('equals', 'is'),
  op('does_not_equal', 'isNot'),
  op('contains', 'contains'),
  op('does_not_contain', 'doesNotContain'),
  op('starts_with', 'startsWith'),
  op('ends_with', 'endsWith'),
  ...EMPTY,
];

const COMPARE = [
  op('equals', 'numberEquals'),
  op('does_not_equal', 'numberDoesNotEqual'),
  op('greater_than', 'greaterThan'),
  op('less_than', 'lessThan'),
  op('greater_than_or_equal_to', 'greaterThanOrEqual'),
  op('less_than_or_equal_to', 'lessThanOrEqual'),
];

const LIST = [op('contains', 'contains'), op('does_not_contain', 'doesNotContain'), ...EMPTY];

/** Notion's date menu, measured (findings V18, shot 18c). */
const DATE = [
  op('equals', 'is'),
  op('before', 'before'),
  op('after', 'after'),
  op('on_or_before', 'onOrBefore'),
  op('on_or_after', 'onOrAfter'),
  op('is_between', 'isBetween'),
  op('relative_to_today', 'isRelativeToToday'),
  ...EMPTY,
];

/** Saved before Notion's menu was measured: no longer offered, still named. */
const LEGACY_DATE = [op('does_not_equal', 'isNot')];

/** Menu labels measured in research/08; status, person and files there too. */
const OPERATORS: Record<PropertyType, OperatorChoice[]> = {
  title: TEXT,
  text: TEXT,
  url: TEXT,
  email: TEXT,
  phone: TEXT,
  richText: EMPTY,
  number: [...COMPARE, ...EMPTY],
  uniqueId: [...COMPARE, ...EMPTY],
  select: [op('equals', 'is'), op('does_not_equal', 'isNot'), ...EMPTY],
  status: [op('equals', 'is'), op('does_not_equal', 'isNot')],
  multiSelect: LIST,
  person: LIST,
  createdBy: LIST,
  lastEditedBy: LIST,
  files: EMPTY,
  checkbox: [op('equals', 'is'), op('does_not_equal', 'isNot')],
  date: DATE,
  createdTime: DATE,
  lastEditedTime: DATE,
  relation: LIST,
  // A formula or rollup filters by its result type: callers pass that property.
  formula: TEXT,
  rollup: TEXT,
  button: [],
  // Measured: only the two emptiness checks (research/20 §1d). Saved text filters still match.
  place: EMPTY,
  verification: EMPTY,
};

/**
 * Types "+ Filter" offers: every type with an operator. Rich text holds a
 * document, which the toolbar picker leaves out too.
 */
export const FILTERABLE_TYPES: readonly PropertyType[] = (Object.keys(OPERATORS) as PropertyType[])
  .filter((type) => type !== 'richText' && OPERATORS[type].length > 0);

/** Notion's first rollup menu, in its order (notion-motion.md Round 13, r13-filter-ops-rollup.raw). */
const QUANTIFIERS = [op('any', 'any'), op('none', 'none'), op('every', 'every')];

/** A rollup that shows a list: Notion's API filters it with any / every / none. */
const QUANTIFIED = [...QUANTIFIERS, ...EMPTY];

export const quantifierChoices = (): OperatorChoice[] => QUANTIFIERS;

/**
 * A saved operator may lead with a part: a Name rollup's quantifier
 * (`any:contains`) or a date's End date side (`end:before`).
 */
const LEAD = /^(any|none|every|end):(.+)$/;

export const splitOperator = (operator: string): { lead?: string; operator: string } => {
  const match = LEAD.exec(operator);

  return match === null ? { operator } : { lead: match[1], operator: match[2] };
};

export const joinOperator = (lead: string | undefined, operator: string): string => (lead === undefined ? operator : `${lead}:${operator}`);

/**
 * A Name rollup filter in Notion's form: a quantifier, then a text operator. Filters saved
 * before it (a bare `any` with row ids, a plain text operator) keep the row picker.
 */
export const isQuantifiedText = (property: PropertyDefinition, operator: string): boolean => {
  const { lead } = splitOperator(operator);

  return isPageListRollup(property) && lead !== undefined && lead !== 'end';
};

/** `next` with the lead part `current` carries, unless `next` brings its own. */
export const keepLead = (current: string, next: string): string =>
  (splitOperator(next).lead === undefined ? joinOperator(splitOperator(current).lead, next) : next);

const LIST_SHAPES: readonly PropertyType[] = ['multiSelect', 'person', 'relation', 'files'];

/** Whether a property (as its value shows) is a rollup list. */
export const isRollupList = (property: Pick<PropertyDefinition, 'type' | 'rollup'>): boolean =>
  property.rollup !== undefined && LIST_SHAPES.includes(property.type);

/**
 * Operators for a property as its value shows: a rollup list gets any / every / none.
 * A rollup of the Name picks its quantifier apart, then a text operator.
 */
export const operatorChoicesFor = (property: PropertyDefinition, operator: string): OperatorChoice[] => {
  if (isQuantifiedText(property, operator)) return TEXT;

  return isRollupList(property) ? QUANTIFIED : OPERATORS[property.type];
};

export const operatorChoices = (type: PropertyType): OperatorChoice[] => OPERATORS[type];

/** The windows "Is within" offers, in menu order. */
export const WITHIN_OPERATORS = ['this_week', 'past_week', 'past_month', 'past_year', 'next_week', 'next_month', 'next_year'] as const;

const WITHIN_LABEL_KEYS: Record<typeof WITHIN_OPERATORS[number], string> = {
  this_week: 'tools.database.filterDateThisWeek',
  past_week: 'tools.database.filterDatePastWeek',
  past_month: 'tools.database.filterDatePastMonth',
  past_year: 'tools.database.filterDatePastYear',
  next_week: 'tools.database.filterDateNextWeek',
  next_month: 'tools.database.filterDateNextMonth',
  next_year: 'tools.database.filterDateNextYear',
};

export const withinLabelKey = (operator: typeof WITHIN_OPERATORS[number]): string => WITHIN_LABEL_KEYS[operator];

const RELATIVE_VALUE_LABEL_KEYS: Record<typeof RELATIVE_DATE_VALUES[number], string> = {
  today: 'tools.database.filterDateToday',
  tomorrow: 'tools.database.filterDateTomorrow',
  yesterday: 'tools.database.filterDateYesterday',
  one_week_ago: 'tools.database.filterDateOneWeekAgo',
  one_week_from_now: 'tools.database.filterDateOneWeekFromNow',
  one_month_ago: 'tools.database.filterDateOneMonthAgo',
  one_month_from_now: 'tools.database.filterDateOneMonthFromNow',
};

export const relativeValueLabelKey = (value: typeof RELATIVE_DATE_VALUES[number]): string => RELATIVE_VALUE_LABEL_KEYS[value];

const isWithin = (operator: string): operator is typeof WITHIN_OPERATORS[number] =>
  (WITHIN_OPERATORS as readonly string[]).includes(operator);

/** The menu operator a saved one belongs to: every window shows as "Is relative to today". */
export const menuOperatorOf = (operator: string): string => {
  const inner = splitOperator(operator).operator;

  return isWithin(inner) ? 'relative_to_today' : inner;
};

const isDateType = (type: PropertyType): boolean => type === 'date' || type === 'createdTime' || type === 'lastEditedTime';

export const operatorLabelKey = (type: PropertyType, operator: string): string | undefined => {
  const inner = splitOperator(operator).operator;

  return [...OPERATORS[type], ...TEXT, ...QUANTIFIED, ...(isDateType(type) ? LEGACY_DATE : [])]
    .find((choice) => choice.operator === menuOperatorOf(inner) || choice.operator === inner)?.labelKey;
};

/** Whether an operator takes a value from the person. */
export const operatorNeedsValue = (operator: string): boolean => {
  const inner = splitOperator(operator).operator;

  if (inner === 'relative_to_today' || inner === 'is_between') return true;

  return inner !== 'is_empty' && inner !== 'is_not_empty' && !(RELATIVE_DATE_OPERATORS as readonly string[]).includes(inner);
};

const idsOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');

  return typeof value === 'string' && value !== '' ? [value] : [];
};

/** A new simple filter on `property`, before the person picks a value. */
export const defaultFilterFor = (property: PropertyDefinition): FilterConfig & { id: string } => {
  const base = { id: nanoid(), propertyId: property.id };

  // notion-motion.md Round 13: a rollup filter opens on "any" + "contains".
  if (isPageListRollup(property)) return { ...base, operator: 'any:contains', value: '' };
  if (isRollupList(property)) return { ...base, operator: 'any', value: [] };

  switch (property.type) {
    case 'date':
    case 'lastEditedTime':
      return { ...base, operator: 'this_week', value: null };
    // notion-motion.md Round 13: Created time opens on "is" with no date, so it hides nothing.
    case 'createdTime':
      return { ...base, operator: 'equals', value: null };
    case 'number':
    case 'uniqueId':
      return { ...base, operator: 'equals', value: null };
    case 'select':
    case 'status':
      return { ...base, operator: 'equals', value: [] };
    case 'multiSelect':
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
    case 'relation':
      return { ...base, operator: 'contains', value: [] };
    case 'checkbox': return { ...base, operator: 'equals', value: true };
    case 'richText':
    case 'files':
    case 'formula':
    case 'rollup':
    case 'button':
    case 'verification':
    case 'place':
      return { ...base, operator: 'is_not_empty', value: null };
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return { ...base, operator: 'contains', value: '' };
  }
};

const THIS_LABEL_KEYS: Record<RelativeDateUnit, string> = {
  day: 'tools.database.filterDateToday',
  week: 'tools.database.filterDateThisWeek',
  month: 'tools.database.filterDateThisMonth',
  year: 'tools.database.filterDateThisYear',
};

const isRelativeValue = (value: unknown): value is typeof RELATIVE_DATE_VALUES[number] =>
  typeof value === 'string' && (RELATIVE_DATE_VALUES as readonly string[]).includes(value);

/** The value part of a pill, or '' when the filter has none yet. */
export const filterValueText = (
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  property: PropertyDefinition,
  t: Translate,
  personName: (id: string) => string | undefined = () => undefined,
  rowTitle: (id: string) => string | undefined = () => undefined
): string => {
  const { value } = filter;
  const operator = splitOperator(filter.operator).operator;

  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return t(operator === 'is_empty' ? 'tools.database.filterOperator.isEmpty' : 'tools.database.filterOperator.isNotEmpty');
  }
  if (isWithin(operator)) return t(withinLabelKey(operator));
  if (operator === 'relative_to_today') {
    const span = parseRelativeSpan(value);

    if (span === undefined) return '';
    if (span.direction === 'this') return t(THIS_LABEL_KEYS[span.unit]);

    return t(`tools.database.filterRelative${span.direction === 'past' ? 'Past' : 'Next'}`, { count: span.count, unit: t(`tools.database.filterUnit${span.unit.charAt(0).toUpperCase()}${span.unit.slice(1)}`) });
  }
  if (operator === 'is_between') {
    const range = typeof value === 'string' ? value.split('/') : [];

    return range.length === 2 ? `${range[0]} → ${range[1]}` : '';
  }
  if (property.type === 'checkbox') return value === true ? t('tools.database.filterChecked') : t('tools.database.filterUnchecked');
  if (property.type === 'person' || property.type === 'createdBy' || property.type === 'lastEditedBy') {
    return idsOf(value).map((id) => (id === ME_FILTER_VALUE ? t('tools.database.filterMe') : personName(id) ?? '')).filter((name) => name !== '').join(', ');
  }
  if (isQuantifiedText(property, filter.operator)) return typeof value === 'string' ? value : '';
  if (property.type === 'relation') {
    return idsOf(value).map((id) => (id === THIS_PAGE_FILTER_VALUE ? t('tools.database.filterThisPage') : rowTitle(id) ?? '')).filter((name) => name !== '').join(', ');
  }
  if (property.type === 'select' || property.type === 'multiSelect' || property.type === 'status') {
    const ids = idsOf(value);
    const options = property.config?.options ?? [];

    return ids.map((id) => options.find((o) => o.id === id)?.label ?? '').filter((label) => label !== '').join(', ');
  }
  if (['date', 'createdTime', 'lastEditedTime'].includes(property.type) && isRelativeValue(value)) return t(relativeValueLabelKey(value));

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/** Types whose pill names the operator too (notion-motion.md Round 18 §2). Other types are unread. */
const PILL_OPERATOR_TYPES: ReadonlySet<PropertyType> = new Set(['title', 'text', 'url', 'email', 'phone', 'number', 'uniqueId']);

/**
 * A pill's two parts: "Name:" + "Contains a", "Number" + "= 5" (Round 18 §2,
 * no colon before a symbol), "Due:" + "This week" (research/08), or "Due" + "".
 */
export const filterPillParts = (
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  property: PropertyDefinition,
  t: Translate,
  personName?: (id: string) => string | undefined,
  rowTitle?: (id: string) => string | undefined
): { name: string; value: string } => {
  const value = filterValueText(filter, property, t, personName, rowTitle);

  if (value === '') return { name: property.name, value };
  const { lead, operator } = splitOperator(filter.operator);
  const key = lead === undefined && PILL_OPERATOR_TYPES.has(property.type) && operatorNeedsValue(operator)
    ? operatorLabelKey(property.type, operator)
    : undefined;

  if (key === undefined) return { name: `${property.name}:`, value };
  const symbol = property.type === 'number' || property.type === 'uniqueId';

  return { name: symbol ? property.name : `${property.name}:`, value: `${t(key)} ${value}` };
};

/** The whole pill as one line, for its label. */
export const filterPillLabel = (
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  property: PropertyDefinition,
  t: Translate,
  personName?: (id: string) => string | undefined,
  rowTitle?: (id: string) => string | undefined
): string => {
  const { name, value } = filterPillParts(filter, property, t, personName, rowTitle);

  return value === '' ? name : `${name} ${value}`;
};

/** Per-type sort labels from the header menu (research/08). */
export const sortDirectionLabelKey = (type: PropertyType, direction: SortConfig['direction']): string => {
  const asc = direction === 'asc';

  switch (type) {
    case 'number':
    case 'uniqueId':
      return asc ? 'tools.database.sortLowHigh' : 'tools.database.sortHighLow';
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return asc ? 'tools.database.sortOldNew' : 'tools.database.sortNewOld';
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'place':
      return asc ? 'tools.database.sortAZ' : 'tools.database.sortZA';
    // Measured for select (research/08); status sorts by its group and option order the same way.
    // Checkbox, people and files were not measured: the plain words are the safe reading.
    case 'select':
    case 'multiSelect':
    case 'status':
    case 'checkbox':
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
    case 'files':
    case 'richText':
    case 'relation':
    case 'formula':
    case 'rollup':
    case 'button':
    case 'verification':
      return asc ? 'tools.database.sortAscending' : 'tools.database.sortDescending';
  }
};
