/**
 * Blok's copy writes a preset mark colour as its literal (resolvePresetColors),
 * since other apps cannot read the token. This pass turns an exact preset
 * literal back into its token, so the pasted mark follows the theme again.
 *
 * Exact match only: snapping any colour to the nearest preset would recolour
 * marks from other apps. The Google Docs pass does its own nearest mapping.
 */
import { COLOR_PRESETS, COLOR_PRESETS_DARK, colorVarName } from '../../../shared/color-presets';
import { parseColor } from '../../../shared/color-mapping';
import { parseUntrustedDocument } from '../../utils/inert-html';

const PROP_MODE = { 'color': 'text', 'background-color': 'bg' } as const;
// Values that set no colour of their own; a mark with them is just noise.
const NO_COLOR = new Set(['inherit', 'currentcolor', 'initial', 'unset']);

const presetName = (value: string, mode: 'text' | 'bg'): string | undefined => {
  const rgb = parseColor(value.trim());

  if (rgb === null) {
    return undefined;
  }

  return [...COLOR_PRESETS, ...COLOR_PRESETS_DARK].find((preset) => {
    const presetRgb = parseColor(preset[mode]);

    return presetRgb !== null && presetRgb.every((channel, i) => channel === rgb[i]);
  })?.name;
};

const restoreMark = (mark: HTMLElement): boolean => {
  const before = mark.getAttribute('style');

  for (const [prop, mode] of Object.entries(PROP_MODE)) {
    const value = mark.style.getPropertyValue(prop).trim();

    if (NO_COLOR.has(value.toLowerCase())) {
      mark.style.removeProperty(prop);
      continue;
    }

    const name = value === '' ? undefined : presetName(value, mode);

    if (name !== undefined) {
      mark.style.setProperty(prop, colorVarName(name, mode));
    }
  }

  // The transparent filler only exists to hide the default mark fill under a text colour.
  if (mark.style.getPropertyValue('color') === '' && mark.style.getPropertyValue('background-color') === 'transparent') {
    mark.style.removeProperty('background-color');
  }

  return mark.getAttribute('style') !== before;
};

/**
 * @param html - raw clipboard HTML string
 * @returns the rewritten HTML, or the input when nothing applies
 */
export function restorePresetMarkColors(html: string): string {
  if (!/<mark[\s>]/i.test(html)) {
    return html;
  }

  const doc = parseUntrustedDocument(html);
  const changed = Array.from(doc.body.querySelectorAll<HTMLElement>('mark[style]')).map(restoreMark);

  return changed.some(Boolean) ? doc.documentElement.outerHTML : html;
}
