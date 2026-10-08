import type { SelectOption } from '../types';

/** Notion's ten option colors, in Notion's menu order. */
export const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

export type OptionColor = typeof OPTION_COLORS[number];

const isOptionColor = (color: string | undefined): color is OptionColor =>
  OPTION_COLORS.some((known) => known === color);

/** The color an option paints with. No color, or one this build does not know, is `default`. */
export const optionColorOf = (option: Pick<SelectOption, 'color'>): OptionColor =>
  isOptionColor(option.color) ? option.color : 'default';

/**
 * Color for a new option. Notion assigns colors at random; this walks the list
 * by option count instead, so the same edit gives the same color in tests.
 */
export const pickOptionColor = (existing: readonly SelectOption[]): OptionColor =>
  OPTION_COLORS[existing.length % OPTION_COLORS.length];

/** i18n key of a color's name. `default` has no color-picker entry of its own. */
export const optionColorLabelKey = (color: OptionColor): string =>
  color === 'default' ? 'tools.marker.default' : `tools.colorPicker.color.${color}`;
