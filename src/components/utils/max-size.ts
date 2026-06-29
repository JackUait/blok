import type { MaxSizeConfig } from '../../../types/tools/max-size';

/**
 * Resolve the byte ceiling that applies to a file of the given MIME type.
 *
 * Object config is looked up by exact MIME type, then the `'*'` wildcard, then
 * the supplied `fallback`. A plain number applies to everything; `undefined`
 * config defers entirely to `fallback`.
 */
export function resolveMaxSize(
  config: MaxSizeConfig | undefined,
  mimeType: string,
  fallback: number,
): number {
  if (config === undefined) return fallback;
  if (typeof config === 'number') return config;

  return config[mimeType] ?? config['*'] ?? fallback;
}

/**
 * Pick a single number to show in the empty-state "max {size}" hint, before any
 * file is chosen. A plain number is shown as-is; for per-type config the `'*'`
 * wildcard wins, otherwise the most permissive (largest) cap. Returns
 * `undefined` when there is nothing meaningful to show.
 */
export function pickDisplayMaxSize(config: MaxSizeConfig | undefined): number | undefined {
  if (config === undefined) return undefined;
  if (typeof config === 'number') return config;

  if (config['*'] !== undefined) return config['*'];

  const values = Object.values(config);

  return values.length > 0 ? Math.max(...values) : undefined;
}
