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
