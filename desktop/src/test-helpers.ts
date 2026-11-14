/** Narrow a possibly-null DOM/query result for desktop unit tests. */
export function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value == null) throw new Error(`expected ${label}`);
  return value;
}

/** Read a fetch mock RequestInit body as a string for assertions. */
export function requestBody(init: unknown): string {
  if (!init || typeof init !== 'object') return '{}';
  const body = (init as RequestInit).body;
  if (typeof body === 'string') return body;
  if (body == null) return '{}';
  throw new Error('expected string request body');
}
