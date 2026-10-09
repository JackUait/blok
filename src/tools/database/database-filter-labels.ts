import { nanoid } from 'nanoid';
import { RELATIVE_DATE_OPERATORS, RELATIVE_DATE_VALUES, parseRelativeSpan } from './relative-dates';
import type { FilterConfig, PropertyDefinition, PropertyType, SortConfig } from './types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `within` is a menu entry, not a saved operator: its choice saves `past_week`, `this_week` and so on. */
export interface OperatorChoice {
  operator: string;
  labelKey: string;
}

const op = (operator: string, labelKey: string): OperatorChoice => ({ operator, labelKey: `tools.database.${labelKey}` });

const EMPTY = [op('is_empty', 'filterOpIsEmpty'), op('is_not_empty', 'filterOpIsNotEmpty')];

const TEXT = [
  op('equals', 'filterOpIs'),
  op('does_not_equal', 'filterOpIsNot'),
  op('contains', 'filterOpContains'),
  op('does_not_contain', 'filterOpDoesNotContain'),
  op('starts_with', 'filterOpStartsWith'),
  op('ends_with', 'filterOpEndsWith'),
  ...EMPTY,
];

/** Menu labels measured in research/08. Date labels were not captured there; these follow Notion's help wording (unverified). */
const OPERATORS: Record<PropertyType, OperatorChoice[]> = {
  title: TEXT,
  text: TEXT,
  url: TEXT,
  richText: EMPTY,
  number: [
    op('equals', 'filterOpNumberEquals'),
    op('does_not_equal', 'filterOpNumberNotEquals'),
    op('greater_than', 'filterOpNumberGreater'),
    op('less_than', 'filterOpNumberLess'),
    op('greater_than_or_equal_to', 'filterOpNumberGreaterOrEqual'),
    op('less_than_or_equal_to', 'filterOpNumberLessOrEqual'),
    ...EMPTY,
  ],
  select: [op('equals', 'filterOpIs'), op('does_not_equal', 'filterOpIsNot'), ...EMPTY],
  multiSelect: [op('contains', 'filterOpContains'), op('does_not_contain', 'filterOpDoesNotContain'), ...EMPTY],
  checkbox: [op('equals', 'filterOpIs'), op('does_not_equal', 'filterOpIsNot')],
  date: [
    op('equals', 'filterOpIs'),
    op('does_not_equal', 'filterOpIsNot'),
    op('before', 'filterOpIsBefore'),
    op('after', 'filterOpIsAfter'),
    op('on_or_before', 'filterOpIsOnOrBefore'),
    op('on_or_after', 'filterOpIsOnOrAfter'),
    op('within', 'filterOpIsWithin'),
    op('relative_to_today', 'filterOpRelativeToToday'),
    ...EMPTY,
  ],
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

/** The menu operator a saved one belongs to: every window shows as "Is within". */
export const menuOperatorOf = (operator: string): string => (isWithin(operator) ? 'within' : operator);

export const operatorLabelKey = (type: PropertyType, operator: string): string | undefined =>
  OPERATORS[type].find((choice) => choice.operator === menuOperatorOf(operator))?.labelKey;

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

  switch (property.type) {
    case 'date': return { ...base, operator: 'this_week', value: null };
    case 'number': return { ...base, operator: 'equals', value: null };
    case 'select': return { ...base, operator: 'equals', value: [] };
    case 'multiSelect': return { ...base, operator: 'contains', value: [] };
    case 'checkbox': return { ...base, operator: 'equals', value: true };
    case 'richText': return { ...base, operator: 'is_not_empty', value: null };
    case 'title':
    case 'text':
    case 'url':
      return { ...base, operator: 'contains', value: '' };
  }
};

const isRelativeValue = (value: unknown): value is typeof RELATIVE_DATE_VALUES[number] =>
  typeof value === 'string' && (RELATIVE_DATE_VALUES as readonly string[]).includes(value);

/** The value part of a pill, or '' when the filter has none yet. */
export const filterValueText = (
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  property: PropertyDefinition,
  t: Translate
): string => {
  const { operator, value } = filter;

  if (operator === 'is_empty' || operator === 'is_not_empty') return t(operator === 'is_empty' ? 'tools.database.filterOpIsEmpty' : 'tools.database.filterOpIsNotEmpty');
  if (isWithin(operator)) return t(withinLabelKey(operator));
  if (operator === 'relative_to_today') {
    const span = parseRelativeSpan(value);

    return span === undefined ? '' : t(`tools.database.filterRelative${span.direction === 'past' ? 'Past' : 'Next'}`, { count: span.count, unit: t(`tools.database.filterUnit${span.unit.charAt(0).toUpperCase()}${span.unit.slice(1)}`) });
  }
  if (property.type === 'checkbox') return value === true ? t('tools.database.filterChecked') : t('tools.database.filterUnchecked');
  if (property.type === 'select' || property.type === 'multiSelect') {
    const ids = idsOf(value);
    const options = property.config?.options ?? [];

    return ids.map((id) => options.find((o) => o.id === id)?.label ?? '').filter((label) => label !== '').join(', ');
  }
  if (property.type === 'date' && isRelativeValue(value)) return t(relativeValueLabelKey(value));

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/** "Due: This week" with a value, or just "Due" (research/08 pills). */
export const filterPillLabel = (
  filter: Pick<FilterConfig, 'operator' | 'value'>,
  property: PropertyDefinition,
  t: Translate
): string => {
  const value = filterValueText(filter, property, t);

  return value === '' ? property.name : `${property.name}: ${value}`;
};

/** Per-type sort labels from the header menu (research/08). */
export const sortDirectionLabelKey = (type: PropertyType, direction: SortConfig['direction']): string => {
  const asc = direction === 'asc';

  switch (type) {
    case 'number': return asc ? 'tools.database.sortLowHigh' : 'tools.database.sortHighLow';
    case 'date': return asc ? 'tools.database.sortOldNew' : 'tools.database.sortNewOld';
    case 'title':
    case 'text':
    case 'url':
      return asc ? 'tools.database.sortAZ' : 'tools.database.sortZA';
    case 'select':
    case 'multiSelect':
    case 'checkbox':
    case 'richText':
      return asc ? 'tools.database.sortAscending' : 'tools.database.sortDescending';
  }
};
