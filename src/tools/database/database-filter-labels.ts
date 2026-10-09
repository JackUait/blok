import { nanoid } from 'nanoid';
import { RELATIVE_DATE_OPERATORS, RELATIVE_DATE_VALUES, parseRelativeSpan } from './relative-dates';
import { ME_FILTER_VALUE } from './database-query';
import type { FilterConfig, PropertyDefinition, PropertyType, SortConfig } from './types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `within` is a menu entry, not a saved operator: its choice saves `past_week`, `this_week` and so on. */
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

/** Date labels were not captured in research/08; these follow Notion's help wording (unverified). */
const DATE = [
  op('equals', 'is'),
  op('does_not_equal', 'isNot'),
  op('before', 'before'),
  op('after', 'after'),
  op('on_or_before', 'onOrBefore'),
  op('on_or_after', 'onOrAfter'),
  op('within', 'isWithin'),
  op('relative_to_today', 'isRelativeToToday'),
  ...EMPTY,
];

/** Menu labels measured in research/08; status, person and files there too. */
const OPERATORS: Record<PropertyType, OperatorChoice[]> = {
  title: TEXT,
  text: TEXT,
  url: TEXT,
  email: TEXT,
  phone: TEXT,
  richText: EMPTY,
  number: [...COMPARE, ...EMPTY],
  uniqueId: COMPARE,
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
};

/** A rollup that shows a list: Notion's API filters it with any / every / none. */
const QUANTIFIED = [op('any', 'any'), op('every', 'every'), op('none', 'none'), ...EMPTY];

const LIST_SHAPES: readonly PropertyType[] = ['multiSelect', 'person', 'relation', 'files'];

/** Whether a property (as its value shows) is a rollup list. */
export const isRollupList = (property: Pick<PropertyDefinition, 'type' | 'rollup'>): boolean =>
  property.rollup !== undefined && LIST_SHAPES.includes(property.type);

/** Operators for a property as its value shows: a rollup list gets any / every / none. */
export const operatorChoicesFor = (property: Pick<PropertyDefinition, 'type' | 'rollup'>): OperatorChoice[] =>
  isRollupList(property) ? QUANTIFIED : OPERATORS[property.type];

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

/** The menu operator a saved one belongs to: every window shows as "Is within". */
export const menuOperatorOf = (operator: string): string => (isWithin(operator) ? 'within' : operator);

export const operatorLabelKey = (type: PropertyType, operator: string): string | undefined =>
  [...OPERATORS[type], ...QUANTIFIED].find((choice) => choice.operator === menuOperatorOf(operator))?.labelKey;

/** Whether an operator takes a value from the person. */
export const operatorNeedsValue = (operator: string): boolean => {
  if (operator === 'relative_to_today') return true;

  return operator !== 'is_empty' && operator !== 'is_not_empty' && !(RELATIVE_DATE_OPERATORS as readonly string[]).includes(operator);
};

const idsOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');

  return typeof value === 'string' && value !== '' ? [value] : [];
};

/** A new simple filter on `property`, before the person picks a value. */
export const defaultFilterFor = (property: PropertyDefinition): FilterConfig & { id: string } => {
  const base = { id: nanoid(), propertyId: property.id };

  if (isRollupList(property)) return { ...base, operator: 'any', value: [] };

  switch (property.type) {
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return { ...base, operator: 'this_week', value: null };
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
      return { ...base, operator: 'is_not_empty', value: null };
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return { ...base, operator: 'contains', value: '' };
  }
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
  const { operator, value } = filter;

  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return t(operator === 'is_empty' ? 'tools.database.filterOperator.isEmpty' : 'tools.database.filterOperator.isNotEmpty');
  }
  if (isWithin(operator)) return t(withinLabelKey(operator));
  if (operator === 'relative_to_today') {
    const span = parseRelativeSpan(value);

    return span === undefined ? '' : t(`tools.database.filterRelative${span.direction === 'past' ? 'Past' : 'Next'}`, { count: span.count, unit: t(`tools.database.filterUnit${span.unit.charAt(0).toUpperCase()}${span.unit.slice(1)}`) });
  }
  if (property.type === 'checkbox') return value === true ? t('tools.database.filterChecked') : t('tools.database.filterUnchecked');
  if (property.type === 'person' || property.type === 'createdBy' || property.type === 'lastEditedBy') {
    return idsOf(value).map((id) => (id === ME_FILTER_VALUE ? t('tools.database.filterMe') : personName(id) ?? '')).filter((name) => name !== '').join(', ');
  }
  if (property.type === 'relation') {
    return idsOf(value).map((id) => rowTitle(id) ?? '').filter((name) => name !== '').join(', ');
  }
  if (property.type === 'select' || property.type === 'multiSelect' || property.type === 'status') {
    const ids = idsOf(value);
    const options = property.config?.options ?? [];

    return ids.map((id) => options.find((o) => o.id === id)?.label ?? '').filter((label) => label !== '').join(', ');
  }
  if (['date', 'createdTime', 'lastEditedTime'].includes(property.type) && isRelativeValue(value)) return t(relativeValueLabelKey(value));

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/** "Due: This week" with a value, or just "Due" (research/08 pills). */
export const filterPillLabel = (
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  property: PropertyDefinition,
  t: Translate,
  personName?: (id: string) => string | undefined
): string => {
  const value = filterValueText(filter, property, t, personName);

  return value === '' ? property.name : `${property.name}: ${value}`;
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
      return asc ? 'tools.database.sortAscending' : 'tools.database.sortDescending';
  }
};
