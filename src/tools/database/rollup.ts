import { parseDateValue } from './cells/date-value';
import { computeCalculation } from './database-calculations';
import { filesOf, personIdsOf, statusGroupOf, statusGroupsOf } from './property-values';
import { relationIdsOf } from './relation-values';
import type { PropertyDefinition, PropertyValue, RollupFunction } from './types';

/** Every Notion API rollup function, in the help page's menu order. */
export const ROLLUP_FUNCTIONS: readonly RollupFunction[] = [
  'show_original', 'show_unique',
  'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty',
  'sum', 'average', 'median', 'min', 'max', 'range',
  'earliest_date', 'latest_date', 'date_range',
  'checked', 'unchecked', 'percent_checked', 'percent_unchecked',
  'count_per_group', 'percent_per_group',
];

/** The property a rollup's value displays, sorts and filters as. */
export type RollupShape = Pick<PropertyDefinition, 'type'> & Partial<Pick<PropertyDefinition, 'config' | 'number' | 'date' | 'status' | 'relation'>>;

const GENERIC: readonly RollupFunction[] = [
  'show_original', 'show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty',
];
const NUMBER_FNS: readonly RollupFunction[] = ['sum', 'average', 'median', 'min', 'max', 'range'];
const DATE_FNS: readonly RollupFunction[] = ['earliest_date', 'latest_date', 'date_range'];
const CHECK_FNS: readonly RollupFunction[] = ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'];
const GROUP_FNS: readonly RollupFunction[] = ['count_per_group', 'percent_per_group'];

const PERCENT_FNS: ReadonlySet<RollupFunction> = new Set<RollupFunction>(['percent_empty', 'percent_not_empty', 'percent_checked', 'percent_unchecked']);

const isDateType = (target: PropertyDefinition): boolean =>
  target.type === 'date' || target.type === 'createdTime' || target.type === 'lastEditedTime';

const isOptionType = (target: PropertyDefinition): boolean =>
  target.type === 'select' || target.type === 'multiSelect' || target.type === 'status';

/**
 * The functions a target property offers. The help page groups number-only
 * and date-only functions; checked and per-group come only from the API
 * enum, so where they show is unverified.
 */
export const rollupFunctionsFor = (target: PropertyDefinition): RollupFunction[] => [
  ...GENERIC,
  ...(target.type === 'number' ? NUMBER_FNS : []),
  ...(isDateType(target) ? DATE_FNS : []),
  ...(target.type === 'checkbox' ? CHECK_FNS : []),
  ...(isOptionType(target) ? GROUP_FNS : []),
];

/** The shape of the list `show_original` gives for a target. */
const listShape = (target: PropertyDefinition): RollupShape => {
  if (isOptionType(target)) return { type: 'multiSelect', ...(target.config !== undefined ? { config: target.config } : {}) };
  if (target.type === 'person' || target.type === 'createdBy' || target.type === 'lastEditedBy') return { type: 'person' };
  if (target.type === 'relation') return { type: 'relation', ...(target.relation !== undefined ? { relation: target.relation } : {}) };
  if (target.type === 'files') return { type: 'files' };

  return { type: 'text' };
};

export const rollupResultType = (fn: RollupFunction, target: PropertyDefinition): RollupShape => {
  if (fn === 'show_original' || fn === 'show_unique') return listShape(target);
  if (fn === 'count_per_group' || fn === 'percent_per_group') return { type: 'text' };
  if (DATE_FNS.includes(fn)) return { type: 'date', ...(target.date !== undefined ? { date: target.date } : {}) };
  if (PERCENT_FNS.has(fn)) return { type: 'number', number: { format: 'percent' } };
  if (NUMBER_FNS.includes(fn)) return { type: 'number', ...(target.number !== undefined ? { number: target.number } : {}) };

  return { type: 'number' };
};

const isBlank = (value: PropertyValue | undefined): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

const textOf = (target: PropertyDefinition, value: PropertyValue | undefined): string => {
  if (value === undefined || value === null) return '';
  if (target.type === 'checkbox') return value === true ? '☑' : '☐';
  if (target.type === 'uniqueId' && typeof value === 'number') {
    const prefix = target.uniqueId?.prefix;

    return prefix !== undefined && prefix !== '' ? `${prefix}-${value}` : String(value);
  }

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const k = key(item);

    if (seen.has(k)) return false;
    seen.add(k);

    return true;
  });
};

const showList = (target: PropertyDefinition, values: Array<PropertyValue | undefined>, unique: boolean): PropertyValue => {
  const shape = listShape(target).type;

  if (shape === 'multiSelect') {
    const ids = values.flatMap((value) => personIdsOf(value ?? null));

    return unique ? [...new Set(ids)] : ids;
  }
  if (shape === 'person' || shape === 'relation') {
    const ids = values.flatMap((value) => (shape === 'person' ? personIdsOf(value ?? null) : relationIdsOf(value)));

    return (unique ? [...new Set(ids)] : ids).map((id) => ({ id }));
  }
  if (shape === 'files') {
    const files = values.flatMap((value) => filesOf(value));

    return unique ? uniqueBy(files, (file) => file.url) : files;
  }
  const texts = values.filter((value) => !isBlank(value) || target.type === 'checkbox').map((value) => textOf(target, value)).filter((text) => text !== '');

  return (unique ? [...new Set(texts)] : texts).join(', ');
};

/** Group name of each value, in the property's group or option order. */
const groupsOf = (target: PropertyDefinition, values: Array<PropertyValue | undefined>): Array<{ name: string; count: number }> => {
  const ids = values.flatMap((value) => personIdsOf(value ?? null));

  if (target.type === 'status') {
    return statusGroupsOf(target).map((group) => ({
      name: group.name,
      count: ids.filter((id) => statusGroupOf(target, id)?.id === group.id).length,
    }));
  }
  const options = [...(target.config?.options ?? [])].sort((a, b) => (a.position < b.position ? -1 : 1));

  return options.map((option) => ({ name: option.label, count: ids.filter((id) => id === option.id).length })).filter((group) => group.count > 0);
};

const perGroup = (target: PropertyDefinition, values: Array<PropertyValue | undefined>, percent: boolean): string => {
  const groups = groupsOf(target, values);
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  return groups
    .map((group) => `${group.name}: ${percent ? `${total === 0 ? 0 : Math.round((group.count / total) * 100)}%` : group.count}`)
    .join(', ');
};

const dateBound = (value: PropertyValue | undefined, side: 'start' | 'end'): string | undefined => {
  const parsed = parseDateValue(value);

  if (parsed === null) return undefined;

  return side === 'start' ? parsed.start : parsed.end ?? parsed.start;
};

const dateRollup = (fn: 'earliest_date' | 'latest_date' | 'date_range', values: Array<PropertyValue | undefined>, target: PropertyDefinition): PropertyValue => {
  const pick = (calc: 'earliest_date' | 'latest_date', side: 'start' | 'end'): string | null => {
    const result = computeCalculation(calc, values.map((value) => dateBound(value, side)), target);

    return result.kind === 'date' ? result.value : null;
  };
  const earliest = pick('earliest_date', 'start');
  const latest = pick('latest_date', 'end');

  if (fn === 'earliest_date') return earliest;
  if (fn === 'latest_date') return latest;

  return earliest === null || latest === null ? null : `${earliest}/${latest}`;
};

/**
 * One rollup value. `values` holds the target property's value for each
 * related row that still exists. `target` is the property those values
 * belong to, or for a formula target, the property its result displays as.
 */
export const computeRollup = (fn: RollupFunction, values: Array<PropertyValue | undefined>, target: PropertyDefinition): PropertyValue => {
  if (fn === 'show_original' || fn === 'show_unique') return showList(target, values, fn === 'show_unique');
  if (fn === 'count_per_group' || fn === 'percent_per_group') return perGroup(target, values, fn === 'percent_per_group');
  if (fn === 'earliest_date' || fn === 'latest_date' || fn === 'date_range') return dateRollup(fn, values, target);
  if (PERCENT_FNS.has(fn) && values.length === 0) return null;
  const result = computeCalculation(fn, values, target);

  switch (result.kind) {
    case 'number': return result.value;
    case 'percent': return result.value / 100;
    case 'date': return result.value;
    case 'dateRange': return `${result.start}/${result.end}`;
    case 'none': return null;
  }
};
