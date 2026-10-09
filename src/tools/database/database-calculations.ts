import { personIdsOf } from './property-values';
import type { CalculationFn, PropertyDefinition, PropertyType, PropertyValue } from './types';

export type CalculationResult =
  | { kind: 'number'; value: number }
  /** 0 to 100. */
  | { kind: 'percent'; value: number }
  /** The stored date string, unformatted. */
  | { kind: 'date'; value: string }
  | { kind: 'dateRange'; start: string; end: string }
  /** No cell holds a value the function can read. */
  | { kind: 'none' };

const GENERIC: readonly CalculationFn[] = ['count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'];

/**
 * The calculations each property type offers, in menu order. Notion's help
 * lists the generic, number and date groups. Checkbox getting only the
 * checked group is unverified: those four names appear only in Notion's API
 * aggregator enum.
 */
export const CALCULATIONS_FOR_TYPE: Readonly<Record<PropertyType, readonly CalculationFn[]>> = {
  title: GENERIC,
  text: GENERIC,
  richText: GENERIC,
  select: GENERIC,
  multiSelect: GENERIC,
  url: GENERIC,
  number: [...GENERIC, 'sum', 'average', 'median', 'min', 'max', 'range'],
  date: [...GENERIC, 'earliest_date', 'latest_date', 'date_range'],
  checkbox: ['count', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'],
  status: GENERIC,
  email: GENERIC,
  phone: GENERIC,
  person: GENERIC,
  files: GENERIC,
  createdBy: GENERIC,
  lastEditedBy: GENERIC,
  uniqueId: GENERIC,
  createdTime: [...GENERIC, 'earliest_date', 'latest_date', 'date_range'],
  lastEditedTime: [...GENERIC, 'earliest_date', 'latest_date', 'date_range'],
  relation: GENERIC,
  // A formula or rollup calculates as its result type: callers ask with that property.
  formula: GENERIC,
  rollup: GENERIC,
};

const isEmpty = (value: PropertyValue | undefined): boolean => {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return value.blocks.length === 0;

  return false;
};

/** One entry per value: a multi-select cell gives one per option. */
const itemsOf = (value: PropertyValue | undefined): Array<string | number | boolean> => {
  if (value === undefined || value === null || isEmpty(value)) return [];
  // Person and file entries count by id, so two rows naming one person are one unique value.
  if (Array.isArray(value)) return personIdsOf(value);
  if (typeof value === 'object') return [JSON.stringify(value)];

  return [value];
};

const toNumber = (value: PropertyValue | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const percent = (part: number, whole: number): CalculationResult =>
  ({ kind: 'percent', value: whole === 0 ? 0 : (part / whole) * 100 });

const count = (value: number): CalculationResult => ({ kind: 'number', value });

const median = (sorted: number[]): number => {
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

type NumberFn = 'sum' | 'average' | 'median' | 'min' | 'max' | 'range';
type DateFn = 'earliest_date' | 'latest_date' | 'date_range';

const numberCalculation = (fn: NumberFn, numbers: number[]): CalculationResult => {
  if (numbers.length === 0) return { kind: 'none' };

  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((total, n) => total + n, 0);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  switch (fn) {
    case 'sum': return count(sum);
    case 'average': return count(sum / numbers.length);
    case 'median': return count(median(sorted));
    case 'min': return count(min);
    case 'max': return count(max);
    case 'range': return count(max - min);
  }
};

const dateCalculation = (fn: DateFn, values: Array<PropertyValue | undefined>): CalculationResult => {
  const dated = values
    .filter((v): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)))
    .map((v) => ({ value: v, time: Date.parse(v) }))
    .sort((a, b) => a.time - b.time);

  if (dated.length === 0) return { kind: 'none' };

  const earliest = dated[0].value;
  const latest = dated[dated.length - 1].value;

  switch (fn) {
    case 'earliest_date': return { kind: 'date', value: earliest };
    case 'latest_date': return { kind: 'date', value: latest };
    case 'date_range': return { kind: 'dateRange', start: earliest, end: latest };
  }
};

/**
 * One footer calculation over a column. `values` holds one entry per row in
 * the view, `undefined` for a row with no value.
 */
export const computeCalculation = (
  fn: CalculationFn,
  values: Array<PropertyValue | undefined>,
  _property: PropertyDefinition
): CalculationResult => {
  const total = values.length;
  const numbers = (): number[] => values.map(toNumber).filter((n): n is number => n !== null);
  const empty = values.filter(isEmpty).length;
  const checked = values.filter((v) => v === true).length;

  switch (fn) {
    case 'count': return count(total);
    case 'count_values': return count(values.reduce<number>((n, v) => n + itemsOf(v).length, 0));
    case 'unique': return count(new Set(values.flatMap(itemsOf)).size);
    case 'empty': return count(empty);
    case 'not_empty': return count(total - empty);
    case 'percent_empty': return percent(empty, total);
    case 'percent_not_empty': return percent(total - empty, total);
    case 'checked': return count(checked);
    case 'unchecked': return count(total - checked);
    case 'percent_checked': return percent(checked, total);
    case 'percent_unchecked': return percent(total - checked, total);
    case 'earliest_date':
    case 'latest_date':
    case 'date_range':
      return dateCalculation(fn, values);
    case 'sum':
    case 'average':
    case 'median':
    case 'min':
    case 'max':
    case 'range':
      return numberCalculation(fn, numbers());
  }
};
