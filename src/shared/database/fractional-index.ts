/**
 * `generateKeyBetween` and `generateNKeysBetween` from fractional-indexing 4.0.0
 * (CC0-1.0, no rights reserved), default alphabets only. Shared code cannot import
 * npm packages (the headless and Jint bundles scan this closure). Shipped clients
 * minted keys with 4.0.0, so test/unit/shared/database/fractional-index.test.ts
 * pins this port to that version's recorded output.
 */

const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE_52_DIGITS = BASE_62_DIGITS.slice(10);
const ZERO = '0';
const LAST = 'z';

/** The package reads digits through a 256-entry table: unknown chars read as 0, wide chars as missing. */
const digitOf = (alphabet: string, text: string): number => {
  const code = text.charCodeAt(0);

  return code > 255 ? Number.NaN : Math.max(0, alphabet.indexOf(text.charAt(0)));
};

const commonPrefix = (a: string, b: string, n = 0): number =>
  ((a[n] ?? ZERO) === b[n] ? commonPrefix(a, b, n + 1) : n);

const midpoint = (a: string, b: string | null): string => {
  if (b !== null && a >= b) {
    throw new Error(`${a} >= ${b}`);
  }
  if (a.slice(-1) === ZERO || (b !== null && b !== '' && b.slice(-1) === ZERO)) {
    throw new Error('trailing zero');
  }
  if (b !== null && b !== '') {
    const n = commonPrefix(a, b);

    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }
  const digitA = a === '' ? 0 : digitOf(BASE_62_DIGITS, a);
  const digitB = b === null ? BASE_62_DIGITS.length : digitOf(BASE_62_DIGITS, b);

  if (digitB - digitA > 1) {
    return BASE_62_DIGITS[Math.round(0.5 * (digitA + digitB))] ?? '';
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }

  return (BASE_62_DIGITS[digitA] ?? '') + midpoint(a.slice(1), null);
};

const integerLength = (head: string): number => {
  const i = digitOf(BASE_52_DIGITS, head);

  if (BASE_52_DIGITS[i] === head) {
    const half = BASE_52_DIGITS.length / 2;

    return i < half ? half - i + 1 : i - half + 2;
  }
  throw new Error(`invalid order key head: ${head}`);
};

const integerPart = (key: string): string => {
  const length = integerLength(key.charAt(0));

  if (length > key.length) {
    throw new Error(`invalid order key: ${key}`);
  }

  return key.slice(0, length);
};

const SMALLEST_INTEGER = BASE_52_DIGITS.charAt(0) + ZERO.repeat(BASE_52_DIGITS.length / 2);

const validateOrderKey = (key: string): void => {
  if (key === SMALLEST_INTEGER) {
    throw new Error(`invalid order key: ${key}`);
  }
  const fraction = key.slice(integerPart(key).length);

  if (fraction.slice(-1) === ZERO) {
    throw new Error(`invalid order key: ${key}`);
  }
};

const validateInteger = (int: string): void => {
  if (int.length !== integerLength(int.charAt(0))) {
    throw new Error(`invalid integer part of order key: ${int}`);
  }
};

/** One integer step: `step` +1 or -1. Null past the largest or smallest integer. */
const stepInteger = (x: string, step: 1 | -1): string | null => {
  validateInteger(x);
  const head = x.charAt(0);
  const run = x.slice(1);
  const [wrapDigit, refill] = step === 1 ? [BASE_62_DIGITS.length, ZERO] : [-1, LAST];
  const at = [...run].map((char, i) => [i, digitOf(BASE_62_DIGITS, char) + step] as const)
    .reverse()
    .find(([, d]) => d !== wrapDigit);

  if (at !== undefined) {
    const [i, d] = at;

    return head + run.slice(0, i) + (BASE_62_DIGITS[d] ?? 'undefined') + refill.repeat(run.length - 1 - i);
  }
  const trailing = refill.repeat(run.length);
  const headIndex = digitOf(BASE_52_DIGITS, head);

  if (headIndex === (step === 1 ? BASE_52_DIGITS.length - 1 : 0)) {
    return null;
  }
  const next = BASE_52_DIGITS.charAt(headIndex + step);
  const delta = integerLength(next) - integerLength(head);

  if (delta > 0) {
    return next + trailing + refill;
  }

  return next + (delta < 0 ? trailing.slice(1) : trailing);
};

export const generateKeyBetween = (low: string | null, high: string | null): string => {
  if (low !== null) {
    validateOrderKey(low);
  }
  if (high !== null) {
    validateOrderKey(high);
  }
  const [a, b] = low !== null && high !== null && low > high ? [high, low] : [low, high];

  if (a === null && b === null) {
    return BASE_52_DIGITS.charAt(BASE_52_DIGITS.length / 2) + ZERO;
  }
  if (a === null && b !== null) {
    const ib = integerPart(b);

    if (ib === SMALLEST_INTEGER) {
      return ib + midpoint('', b.slice(ib.length));
    }
    if (ib < b) {
      return ib;
    }

    return stepInteger(ib, -1) ?? (() => {
      throw new Error('cannot decrement any more');
    })();
  }
  if (a === null) {
    throw new Error('unreachable');
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);

  if (b === null) {
    return stepInteger(ia, 1) ?? ia + midpoint(fa, null);
  }
  const ib = integerPart(b);

  if (ia === ib) {
    return ia + midpoint(fa, b.slice(ib.length));
  }
  const next = stepInteger(ia, 1);

  if (next === null) {
    throw new Error('cannot increment any more');
  }

  return next < b ? next : ia + midpoint(fa, null);
};

/**
 * `n` keys between `low` and `high`, in order. Against an open end they step
 * like repeated `generateKeyBetween`; inside a gap they bisect it, so the keys
 * stay short where a chain of single calls grows one character every few keys.
 */
export const generateNKeysBetween = (low: string | null, high: string | null, n: number): string[] => {
  if (n < 0) {
    throw new Error(`n must be >= 0: ${n}`);
  }
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [generateKeyBetween(low, high)];
  }
  if (high === null) {
    return Array.from({ length: n - 1 }).reduce<string[]>(
      keys => [...keys, generateKeyBetween(keys.at(-1) ?? null, null)],
      [generateKeyBetween(low, null)]
    );
  }
  if (low === null) {
    return Array.from({ length: n - 1 }).reduce<string[]>(
      keys => [generateKeyBetween(null, keys[0] ?? null), ...keys],
      [generateKeyBetween(null, high)]
    );
  }
  const half = Math.floor(n / 2);
  const middle = generateKeyBetween(low, high);

  return [...generateNKeysBetween(low, middle, half), middle, ...generateNKeysBetween(middle, high, n - half - 1)];
};
