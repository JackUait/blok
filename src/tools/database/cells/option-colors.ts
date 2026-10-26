import type { SelectOption } from '../types';

import { OPTION_COLORS, type OptionColor } from '../../../shared/database/option-colors';

export { OPTION_COLORS, pickOptionColor } from '../../../shared/database/option-colors';
export type { OptionColor } from '../../../shared/database/option-colors';

const isOptionColor = (color: string | undefined): color is OptionColor =>
  OPTION_COLORS.some((known) => known === color);

/** The color an option paints with. No color, or one this build does not know, is `default`. */
export const optionColorOf = (option: Pick<SelectOption, 'color'>): OptionColor =>
  isOptionColor(option.color) ? option.color : 'default';

/** i18n key of a color's name. `default` has no color-picker entry of its own. */
export const optionColorLabelKey = (color: OptionColor): string =>
  color === 'default' ? 'tools.marker.default' : `tools.colorPicker.color.${color}`;

/**
 * A status option with no colour draws the gray pill and checks no colour
 * (research/30 §10f: Not started; research/31 §7b: Idea). Gray is the measured
 * pill; why Notion picks it is not known. For drawing only: never save it.
 */
export const shownStatusOption = <T extends Pick<SelectOption, 'color'>>(option: T): T =>
  (option.color === undefined ? { ...option, color: 'gray' } : option);

/** An 18px square of a colour, painted by the `data-blok-database-option-swatch` rules in database.css. */
export const optionSwatch = (color: OptionColor): HTMLElement => {
  const el = document.createElement('span');

  el.setAttribute('data-blok-database-option-swatch', '');
  el.setAttribute('data-color', color);
  el.setAttribute('aria-hidden', 'true');

  return el;
};
