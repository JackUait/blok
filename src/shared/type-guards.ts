/**
 * Checks if passed argument is a plain object (created by {} or Object constructor)
 */
export const isObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(v);

  return proto === null || proto === Object.prototype;
};
