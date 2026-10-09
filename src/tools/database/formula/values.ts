import { formatDateValue } from './dates';
import { isDate, isRef, isRichText } from './types';
import type { FormulaRichText, FormulaText, FormulaValue, StyledRun } from './types';

export interface TextContext {
  timeZone?: string;
  people?: (id: string) => { name?: string; email?: string } | undefined;
  /** A related page's title, for `format()`. Without it a page prints its id. */
  pageTitle?: (id: string) => string | undefined;
}

/** -0 prints as "0" and NaN or ±Infinity become empty. */
export const num = (value: number): number | null => {
  if (!Number.isFinite(value)) return null;

  return value === 0 ? 0 : value;
};

export const plainText = (value: FormulaText): string =>
  typeof value === 'string' ? value : value.runs.map((run) => run.text).join('');

export const isText = (value: FormulaValue): value is FormulaText => typeof value === 'string' || isRichText(value);

/** "0, "", [] are considered empty" (help: empty). False and an empty value count too. */
export const isEmptyValue = (value: FormulaValue): boolean => {
  if (value === null || value === false || value === 0) return true;
  if (isText(value)) return plainText(value) === '';

  return Array.isArray(value) && value.length === 0;
};

export const truthy = (value: FormulaValue): boolean => !isEmptyValue(value);

export const valuesEqual = (a: FormulaValue, b: FormulaValue): boolean => {
  if (isText(a) && isText(b)) return plainText(a) === plainText(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]));
  }
  if (isDate(a) && isDate(b)) return a.start === b.start && a.end === b.end;
  if (isRef(a) && isRef(b)) return a.kind === b.kind && a.id === b.id;

  return a === b;
};

/** Orders two values of one type. Empty sorts after everything. */
export const compareValues = (a: FormulaValue, b: FormulaValue): number => {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (isDate(a) && isDate(b)) return a.start - b.start;
  if (isText(a) && isText(b)) {
    const [x, y] = [plainText(a), plainText(b)];

    return Number(x > y) - Number(x < y);
  }

  return 0;
};

/** `format()`: how a value reads as text. */
export const formulaValueToText = (value: FormulaValue, context: TextContext = {}): string => {
  if (value === null) return '';
  if (typeof value === 'number') return String(num(value) ?? '');
  if (typeof value === 'boolean' || typeof value === 'string') return String(value);
  if (Array.isArray(value)) return value.map((item) => formulaValueToText(item, context)).join(', ');
  if (isRichText(value)) return plainText(value);
  if (isDate(value)) return formatDateValue(value, context.timeZone);

  const name = value.kind === 'person' ? context.people?.(value.id)?.name : context.pageTitle?.(value.id);

  return name ?? value.id;
};

const runsOf = (value: FormulaText): StyledRun[] => (typeof value === 'string' ? [{ text: value, styles: [] }] : value.runs);

/** Plain + plain stays a string; any styled side keeps its runs. */
export const concatText = (a: FormulaText, b: FormulaText): FormulaText => {
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  const runs = [...runsOf(a), ...runsOf(b)].filter((run) => run.text !== '');

  return { kind: 'richText', runs };
};

export const richText = (runs: StyledRun[]): FormulaRichText | string =>
  runs.every((run) => run.styles.length === 0 && run.link === undefined) ? runs.map((run) => run.text).join('') : { kind: 'richText', runs };

export const textRuns = runsOf;
