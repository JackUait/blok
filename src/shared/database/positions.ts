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
