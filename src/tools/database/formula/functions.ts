import {
  addToDate, dateDifference, datePart, dateUnit, formatDatePattern, parseIsoDate, startOfDay,
} from './dates';
import type { DatePart } from './dates';
import { T, elementOf, isDate, isRef, listOf, typeName, unify } from './types';
import type { FormulaDate, FormulaText, FormulaType, FormulaValue } from './types';
import {
  compareValues, formulaValueToText, isEmptyValue, isText, num, plainText, richText, textRuns, valuesEqual,
} from './values';

export interface RunContext {
  now: number;
  timeZone?: string;
  rowId: string;
  people?: (id: string) => { name?: string; email?: string } | undefined;
}

/**
 * A parameter. `numbers` takes a number or a list of numbers (min, sum...).
 * `element` must fit the element type of argument 1 (includes).
 */
export type ParamSpec = 'number' | 'text' | 'boolean' | 'date' | 'person' | 'page' | 'any' | 'list' | 'numbers' | 'textOrList' | 'element';

export interface FunctionDef {
  params: ParamSpec[];
  optional?: ParamSpec[];
  /** Zero or more trailing arguments of this kind. */
  rest?: ParamSpec;
  returns: FormulaType | ((args: FormulaType[]) => FormulaType | { error: string });
  run: (args: FormulaValue[], ctx: RunContext) => FormulaValue;
  /** Off by default: an empty argument makes the result empty without calling `run`. */
  keepEmpty?: boolean;
}

const SPEC_NAMES: Record<ParamSpec, string> = {
  number: 'Number', text: 'Text', boolean: 'Boolean', date: 'Date', person: 'Person', page: 'Page', any: 'any value',
  list: 'a list', numbers: 'Number', textOrList: 'Text or a list', element: '',
};

const isLoose = (type: FormulaType): boolean => type.kind === 'any' || type.kind === 'empty';

/** `undefined` when the type fits, else the name of what was expected. */
export const paramMismatch = (spec: ParamSpec, type: FormulaType, first: FormulaType | undefined): string | undefined => {
  if (isLoose(type) || spec === 'any') return undefined;
  switch (spec) {
    case 'list': return type.kind === 'list' ? undefined : SPEC_NAMES.list;
    case 'numbers':
      return type.kind === 'number' || (type.kind === 'list' && (isLoose(type.of) || type.of.kind === 'number')) ? undefined : SPEC_NAMES.numbers;
    case 'textOrList': return type.kind === 'text' || type.kind === 'list' ? undefined : SPEC_NAMES.textOrList;
    case 'element': {
      const element = first === undefined ? T.any : elementOf(first);

      return unify(element, type) === undefined ? typeName(element) : undefined;
    }
    case 'number':
    case 'text':
    case 'boolean':
    case 'date':
    case 'person':
    case 'page':
      return type.kind === spec ? undefined : SPEC_NAMES[spec];
  }
};

// Runtime narrowing. The checker has already proved the types, so these only guard empties and `any`.
const n = (value: FormulaValue): number => (typeof value === 'number' ? value : Number.NaN);
const s = (value: FormulaValue): string => (isText(value) ? plainText(value) : formulaValueToText(value));
const textArg = (value: FormulaValue): FormulaText => (isText(value) ? value : s(value));
const list = (value: FormulaValue): FormulaValue[] => (Array.isArray(value) ? value : []);
const date = (value: FormulaValue): FormulaDate => (isDate(value) ? value : { kind: 'date', start: Number.NaN, hasTime: false });
const chars = (value: FormulaValue): string[] => Array.from(s(value));

const math = (fn: (...xs: number[]) => number, arity = 1): FunctionDef => ({
  params: Array<ParamSpec>(arity).fill('number'),
  returns: T.number,
  run: (args) => num(fn(...args.map(n))),
});

const regex = (pattern: string, flags: string): RegExp | null => {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};

/** Round half up at `places` decimals; string exponents avoid 1.005 * 100 = 100.49999. */
const roundTo = (value: number, places: number): number => {
  const p = Math.trunc(places);

  if (p === 0 || /e/i.test(String(value))) return Math.round(value * 10 ** p) / 10 ** p;

  return Number(`${Math.round(Number(`${value}e${p}`))}e${-p}`);
};

const numbersOf = (args: FormulaValue[]): number[] =>
  args.flatMap((arg) => (Array.isArray(arg) ? arg : [arg])).filter((x): x is number => typeof x === 'number');

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const aggregate = (fn: (xs: number[]) => number, emptyResult: number | null): FunctionDef => ({
  params: ['numbers'],
  rest: 'numbers',
  returns: T.number,
  run: (args) => {
    const xs = numbersOf(args);

    return xs.length === 0 ? emptyResult : num(fn(xs));
  },
});

const sameList = (args: FormulaType[]): FormulaType => args[0];
const elementType = (args: FormulaType[]): FormulaType => elementOf(args[0]);

const STYLE_NAMES = ['b', 'u', 'i', 'c', 's'];
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const VALID_STYLES = new Set([...STYLE_NAMES, ...COLORS, ...COLORS.map((color) => `${color}_background`)]);

/** Symbols for `formatNumber`. Codes beyond the documented "usd" are unverified. */
const CURRENCIES: Record<string, string> = {
  usd: '$', dollar: '$', eur: '€', euro: '€', gbp: '£', pound: '£', jpy: '¥', yen: '¥', rub: '₽', ruble: '₽',
  inr: '₹', rupee: '₹', krw: '₩', won: '₩', cny: 'CN¥', yuan: 'CN¥', brl: 'R$', real: 'R$', try: '₺', lira: '₺',
};

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatNumber = (value: number, format: string, decimals: number | undefined): string | null => {
  const fixed = (x: number, fallback?: number): string => {
    const places = decimals ?? fallback;

    return places === undefined ? String(x) : x.toFixed(Math.max(0, Math.min(100, Math.trunc(places))));
  };
  const withCommas = (x: number, fallback?: number): string => {
    const [whole, fraction] = fixed(Math.abs(x), fallback).split('.');

    return `${groupThousands(whole)}${fraction === undefined ? '' : `.${fraction}`}`;
  };
  const sign = value < 0 ? '-' : '';

  if (format === 'number') return fixed(value);
  if (format === 'number_with_commas') return `${sign}${withCommas(value)}`;
  if (format === 'percent') return `${fixed(num(value * 100) ?? 0)}%`;
  const symbol = CURRENCIES[format.toLowerCase()];

  return symbol === undefined ? null : `${sign}${symbol}${withCommas(value, 2)}`;
};

const datePartFn = (part: DatePart): FunctionDef => ({
  params: ['date'], returns: T.number, run: ([d], ctx) => num(datePart(date(d).start, part, ctx.timeZone)),
});

const shiftDate = (sign: 1 | -1): FunctionDef => ({
  params: ['date', 'number', 'text'],
  returns: T.date,
  run: ([d, amount, unitText], ctx) => {
    const unit = dateUnit(s(unitText));
    const value = date(d);

    if (unit === undefined) return null;
    const shift = (ms: number): number => addToDate(ms, sign * n(amount), unit, ctx.timeZone);

    return { ...value, start: shift(value.start), ...(value.end === undefined ? {} : { end: shift(value.end) }) };
  },
});

export const FUNCTIONS: Record<string, FunctionDef> = {
  // ─── Generic ───
  empty: { params: [], optional: ['any'], keepEmpty: true, returns: (args) => (args.length === 0 ? T.empty : T.boolean), run: (args) => (args.length === 0 ? null : isEmptyValue(args[0])) },
  length: { params: ['textOrList'], returns: T.number, run: ([x]) => (Array.isArray(x) ? x.length : chars(x).length) },
  format: { params: ['any'], keepEmpty: true, returns: T.text, run: ([x], ctx) => formulaValueToText(x, ctx) },
  equal: { params: ['any', 'any'], keepEmpty: true, returns: T.boolean, run: ([a, b]) => valuesEqual(a, b) },
  unequal: { params: ['any', 'any'], keepEmpty: true, returns: T.boolean, run: ([a, b]) => !valuesEqual(a, b) },
  toNumber: {
    params: ['any'],
    returns: T.number,
    run: ([x]) => {
      if (typeof x === 'number') return num(x);
      if (typeof x === 'boolean') return x ? 1 : 0;
      if (isDate(x)) return x.start;
      if (!isText(x) || plainText(x).trim() === '') return null;

      return num(Number(plainText(x)));
    },
  },

  // ─── Text ───
  substring: {
    params: ['text', 'number'],
    optional: ['number'],
    returns: T.text,
    run: ([x, start, end]) => chars(x).slice(Math.max(0, n(start)), end === undefined ? undefined : Math.max(0, n(end))).join(''),
  },
  contains: { params: ['text', 'text'], returns: T.boolean, run: ([x, search]) => s(x).includes(s(search)) },
  test: { params: ['text', 'text'], returns: T.boolean, run: ([x, pattern]) => regex(s(pattern), '')?.test(s(x)) ?? null },
  match: {
    params: ['text', 'text'],
    returns: listOf(T.text),
    run: ([x, pattern]) => {
      const re = regex(s(pattern), 'g');

      return re === null ? null : Array.from(s(x).matchAll(re), (m) => m[0]);
    },
  },
  replace: {
    params: ['text', 'text', 'text'],
    returns: T.text,
    run: ([x, pattern, replacement]) => {
      const re = regex(s(pattern), '');

      return re === null ? null : s(x).replace(re, s(replacement));
    },
  },
  replaceAll: {
    params: ['text', 'text', 'text'],
    returns: T.text,
    run: ([x, pattern, replacement]) => {
      const re = regex(s(pattern), 'g');

      return re === null ? null : s(x).replace(re, s(replacement));
    },
  },
  lower: { params: ['text'], returns: T.text, run: ([x]) => s(x).toLowerCase() },
  upper: { params: ['text'], returns: T.text, run: ([x]) => s(x).toUpperCase() },
  trim: { params: ['text'], returns: T.text, run: ([x]) => s(x).trim() },
  repeat: { params: ['text', 'number'], returns: T.text, run: ([x, times]) => s(x).repeat(Math.max(0, Math.trunc(n(times)) || 0)) },
  padStart: { params: ['text', 'number'], optional: ['text'], returns: T.text, run: ([x, size, fill]) => s(x).padStart(n(size), fill === undefined ? ' ' : s(fill)) },
  padEnd: { params: ['text', 'number'], optional: ['text'], returns: T.text, run: ([x, size, fill]) => s(x).padEnd(n(size), fill === undefined ? ' ' : s(fill)) },
  link: { params: ['text', 'text'], returns: T.text, run: ([label, url]) => ({ kind: 'richText', runs: [{ text: s(label), styles: [], link: s(url) }] }) },
  style: {
    params: ['text'],
    rest: 'text',
    returns: T.text,
    run: ([x, ...styles]) => {
      const added = styles.map(s).filter((name) => VALID_STYLES.has(name));

      return richText(textRuns(textArg(x)).map((run) => ({ ...run, styles: [...new Set([...run.styles, ...added])] })));
    },
  },
  unstyle: {
    params: ['text'],
    rest: 'text',
    returns: T.text,
    run: ([x, ...styles]) => {
      const removed = new Set(styles.map(s));

      return richText(textRuns(textArg(x)).map((run) => ({ ...run, styles: removed.size === 0 ? [] : run.styles.filter((name) => !removed.has(name)) })));
    },
  },
  split: { params: ['text', 'text'], returns: listOf(T.text), run: ([x, separator]) => s(x).split(s(separator)) },
  join: { params: ['list', 'text'], returns: T.text, run: ([items, joiner], ctx) => list(items).map((item) => formulaValueToText(item, ctx)).join(s(joiner)) },
  formatNumber: {
    params: ['number'],
    optional: ['text', 'number'],
    returns: T.text,
    run: ([value, format, decimals]) => formatNumber(n(value), format === undefined ? 'number' : s(format), decimals === undefined ? undefined : n(decimals)),
  },

  // ─── Math ───
  add: math((a, b) => a + b, 2),
  subtract: math((a, b) => a - b, 2),
  multiply: math((a, b) => a * b, 2),
  divide: math((a, b) => a / b, 2),
  mod: math((a, b) => a % b, 2),
  pow: math((a, b) => a ** b, 2),
  abs: math(Math.abs),
  round: { params: ['number'], optional: ['number'], returns: T.number, run: ([x, places]) => num(roundTo(n(x), places === undefined ? 0 : n(places))) },
  ceil: math(Math.ceil),
  floor: math(Math.floor),
  sqrt: math(Math.sqrt),
  cbrt: math(Math.cbrt),
  exp: math(Math.exp),
  ln: math(Math.log),
  log10: math(Math.log10),
  log2: math(Math.log2),
  sign: math(Math.sign),
  pi: { params: [], returns: T.number, run: () => Math.PI },
  e: { params: [], returns: T.number, run: () => Math.E },
  min: aggregate((xs) => Math.min(...xs), null),
  max: aggregate((xs) => Math.max(...xs), null),
  sum: aggregate((xs) => xs.reduce((a, b) => a + b, 0), 0),
  mean: aggregate((xs) => xs.reduce((a, b) => a + b, 0) / xs.length, null),
  median: aggregate(median, null),

  // ─── Dates ───
  now: { params: [], returns: T.date, run: (_, ctx) => ({ kind: 'date', start: ctx.now, hasTime: true }) },
  today: { params: [], returns: T.date, run: (_, ctx) => ({ kind: 'date', start: startOfDay(ctx.now, ctx.timeZone), hasTime: false }) },
  minute: datePartFn('minute'),
  hour: datePartFn('hour'),
  day: datePartFn('day'),
  date: datePartFn('date'),
  week: datePartFn('week'),
  month: datePartFn('month'),
  year: datePartFn('year'),
  dateAdd: shiftDate(1),
  dateSubtract: shiftDate(-1),
  dateBetween: {
    params: ['date', 'date', 'text'],
    returns: T.number,
    run: ([a, b, unitText], ctx) => {
      const unit = dateUnit(s(unitText));

      return unit === undefined ? null : dateDifference(date(a).start, date(b).start, unit, ctx.timeZone);
    },
  },
  dateRange: {
    params: ['date', 'date'],
    returns: T.date,
    run: ([a, b]) => ({ kind: 'date', start: date(a).start, end: date(b).end ?? date(b).start, hasTime: date(a).hasTime || date(b).hasTime }),
  },
  dateStart: { params: ['date'], returns: T.date, run: ([d]) => ({ kind: 'date', start: date(d).start, hasTime: date(d).hasTime }) },
  dateEnd: { params: ['date'], returns: T.date, run: ([d]) => ({ kind: 'date', start: date(d).end ?? date(d).start, hasTime: date(d).hasTime }) },
  timestamp: { params: ['date'], returns: T.number, run: ([d]) => date(d).start },
  fromTimestamp: {
    params: ['number'],
    returns: T.date,
    run: ([ms]) => (Number.isFinite(n(ms)) ? { kind: 'date', start: Math.floor(n(ms) / 60_000) * 60_000, hasTime: true } : null),
  },
  formatDate: { params: ['date', 'text'], returns: T.text, run: ([d, pattern], ctx) => formatDatePattern(date(d).start, s(pattern), ctx.timeZone) },
  parseDate: { params: ['text'], returns: T.date, run: ([x], ctx) => parseIsoDate(s(x), ctx.timeZone) },

  // ─── People and pages ───
  name: { params: ['person'], returns: T.text, run: ([p], ctx) => (isRef(p) ? ctx.people?.(p.id)?.name ?? null : null) },
  email: { params: ['person'], returns: T.text, run: ([p], ctx) => (isRef(p) ? ctx.people?.(p.id)?.email ?? null : null) },
  id: { params: [], optional: ['page'], returns: T.text, run: ([page], ctx) => (isRef(page) ? page.id : ctx.rowId) },

  // ─── Lists ───
  at: {
    params: ['list', 'number'],
    returns: elementType,
    run: ([items, i]) => {
      const all = list(items);
      const index = Math.trunc(n(i));

      return all[index < 0 ? all.length + index : index] ?? null;
    },
  },
  first: { params: ['list'], returns: elementType, run: ([items]) => list(items)[0] ?? null },
  last: { params: ['list'], returns: elementType, run: ([items]) => list(items).at(-1) ?? null },
  slice: { params: ['list', 'number'], optional: ['number'], returns: sameList, run: ([items, start, end]) => list(items).slice(n(start), end === undefined ? undefined : n(end)) },
  concat: {
    params: ['list'],
    rest: 'list',
    returns: (args) => args.reduce<FormulaType | { error: string }>(
      (acc, type) => ('error' in acc ? acc : unify(acc, type) ?? { error: `concat() cannot join ${typeName(acc)} and ${typeName(type)}` }),
      args[0]
    ),
    run: (args) => args.flatMap(list),
  },
  sort: { params: ['list'], returns: sameList, run: ([items]) => [...list(items)].sort(compareValues) },
  reverse: { params: ['list'], returns: sameList, run: ([items]) => [...list(items)].reverse() },
  unique: {
    params: ['list'],
    returns: sameList,
    run: ([items]) => list(items).filter((item, i, all) => all.findIndex((other) => valuesEqual(item, other)) === i),
  },
  includes: { params: ['list', 'element'], keepEmpty: true, returns: T.boolean, run: ([items, value]) => list(items).some((item) => valuesEqual(item, value)) },
  flat: {
    params: ['list'],
    returns: (args) => {
      const element = elementOf(args[0]);

      return element.kind === 'list' ? element : args[0];
    },
    run: ([items]) => list(items).flatMap((item) => (Array.isArray(item) ? item : [item])),
  },
};
