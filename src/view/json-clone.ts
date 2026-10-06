/**
 * Structural clone of a parsed-JSON value. Hand-written because the bare
 * ECMAScript engine the server runtime runs on has no `structuredClone`.
 *
 * JSON-origin values only: a `Date`, `Map` or class instance becomes `{}`.
 * Built with `Object.fromEntries`, which defines keys: plain assignment would
 * hit the `__proto__` setter and drop that own key.
 * @param value - value to clone
 */
export const cloneJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(cloneJson);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]));
};
