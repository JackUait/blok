import type { SelectOption } from './types';

/** Notion's ten option colors, in Notion's menu order. */
export const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

export type OptionColor = typeof OPTION_COLORS[number];

/**
 * Color for a new option. Notion assigns colors at random; this walks the list
 * by option count instead, so the same edit gives the same color in tests.
 */
export const pickOptionColor = (existing: readonly SelectOption[]): OptionColor =>
  OPTION_COLORS[existing.length % OPTION_COLORS.length];
