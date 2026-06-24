/**
 * Structural deep equality for JSON-like values (Blok `OutputData`).
 *
 * Used to dedupe reactive `data` updates so identical content does not trigger
 * a redundant re-render that would clobber the caret/selection. Handles the
 * value shapes that appear in editor data: plain objects, arrays, and
 * primitives (including `null`/`undefined`).
 * @param a - first value to compare
 * @param b - second value to compare
 * @returns true when both values are structurally equal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);

  if (aIsArray !== bIsArray) {
    return false;
  }

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) {
      return false;
    }

    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key])
  );
}
