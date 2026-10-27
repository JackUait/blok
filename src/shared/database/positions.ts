import { generateKeyBetween, generateNKeysBetween } from './fractional-index';

/**
 * Row, option and view positions are fractional-index keys. They are ordered
 * by plain code-unit compare, the order the library mints them in.
 * `localeCompare` is wrong here: it puts `a0l` before `a0V` and `Zz` after `a0`.
 */
export const comparePositions = (a: string, b: string): number => {
  if (a === b) return 0;

  return a < b ? -1 : 1;
};

/** Length of a key's integer part from its head, or null for a head the library rejects. */
const integerLength = (head: string): number | null => {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;

  return null;
};

/**
 * The key without trailing zeros in its fraction. The library rejects
 * `a000` (a `padStart` key), but `a0` names the same spot: every key it mints
 * above `a0` is also above `a000`, and every one below is below it.
 */
export const normalizeKey = (key: string | null): string | null => {
  if (key === null) return null;
  const length = integerLength(key.charAt(0));

  if (length === null || key.length <= length) return key;
  const fraction = key.slice(length).replace(/0+$/, '');

  return key.slice(0, length) + fraction;
};

/**
 * A key strictly between two keys the library cannot read (a bad head, an
 * empty string), by code-unit order. Never throws: a stored key from an old
 * document or a host must not kill a drop.
 */
export const looseKeyBetween = (after: string, before: string | null, tail: string): string => {
  if (before === null || !before.startsWith(after)) {
    // Any extension of `after` stays below a `before` it does not prefix.
    return `${after}V${tail}`;
  }
  const rest = before.slice(after.length);
  const code = rest.charCodeAt(0);

  if (code > 1) {
    return `${after}${String.fromCharCode(code - 1)}V${tail}`;
  }

  return rest.length > 1 ? `${after}${rest.charAt(0)}${looseKeyBetween('', rest.slice(1), tail)}` : after;
};

/**
 * Random tail for a new key, so two peers placing into the same gap at the
 * same moment do not mint the same key.
 *
 * Digits only, although fractional-indexing takes the whole base62 alphabet.
 * Digits sort below 'V', the first character the library writes when it
 * extends a key, so a tailed key stays below a key minted just past it; a
 * base62 tail breaks positionsBetween's order. The last digit may not be
 * '0' — the library rejects a key ending in one.
 */
const randomKeySuffix = (): string => {
  const digit = (from: number): string => String(from + Math.floor(Math.random() * (10 - from)));

  return `${digit(0)}${digit(0)}${digit(0)}${digit(1)}`;
};

/**
 * `key` plus a random tail, still below `high`. A tail could pass a `high`
 * that `key` is a prefix of (a0V under a0V5), so the key first moves toward
 * `low` until it is not. Moving toward `high` instead would dig into high's
 * digit tail, where repeated inserts grow keys several times as fast.
 * All three keys must be ones the library reads.
 */
const withTail = (low: string | null, key: string, high: string | null): string =>
  (high !== null && high.startsWith(key) ? withTail(low, generateKeyBetween(low, key), key) : key + randomKeySuffix());

/**
 * A fractional-index key between two neighbours (DatabaseModel.positionBetween documents
 * the cases). Every key ends in a random tail, so two peers placing into the same gap at
 * the same moment never land on the same key.
 */
export const positionBetween = (after: string | null, before: string | null): string => {
  const [low, high] = after !== null && before !== null && after > before ? [before, after] : [after, before];

  if (low !== null && low === high) {
    return low + randomKeySuffix();
  }

  try {
    const [bottom, top] = [normalizeKey(low), normalizeKey(high)];

    return withTail(bottom, generateKeyBetween(bottom, top), top);
  } catch {
    return looseKeyBetween(low ?? '', high, randomKeySuffix());
  }
};

/**
 * `n` keys between two neighbours, in order, for rows placed together. The
 * gap is bisected, so the keys stay short: a chain of positionBetween calls
 * into one gap grows a character every few rows.
 */
export const positionsBetween = (after: string | null, before: string | null, n: number): string[] => {
  const [low, high] = after !== null && before !== null && after > before ? [before, after] : [after, before];
  const tied = low !== null && low === high;

  try {
    // Equal neighbours leave no gap: the keys go just after both, as positionBetween's do.
    const bottom = normalizeKey(low);
    const top = tied ? `${bottom ?? ''}${randomKeySuffix()}` : normalizeKey(high);
    const keys = generateNKeysBetween(bottom, top, n);

    return keys.map((key, i) => withTail(keys[i - 1] ?? bottom, key, keys[i + 1] ?? top));
  } catch {
    return Array.from({ length: n }).reduce<string[]>(keys => [...keys, positionBetween(keys.at(-1) ?? low, tied ? null : high)], []);
  }
};
