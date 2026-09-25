/**
 * Other apps cannot resolve Blok's color tokens, so copied HTML carries the
 * light preset literal instead.
 */
import { COLOR_PRESETS } from './color-presets';

const PRESET_COLOR_VAR = /var\(--blok-color-([a-z]+)-(text|bg)\)/g;

/**
 * Swap every `var(--blok-color-<name>-(text|bg))` in a CSS string for the
 * light preset literal. Unknown names are left as they are.
 * @param css - a style attribute value
 */
export const resolvePresetColorVars = (css: string): string =>
  css.replace(PRESET_COLOR_VAR, (match, name: string, mode: 'text' | 'bg') =>
    COLOR_PRESETS.find((preset) => preset.name === name)?.[mode] ?? match);

/**
 * Resolve the color tokens in every `style` attribute under `root`.
 * @param root - the finished clipboard HTML
 */
export const resolvePresetColors = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    element.setAttribute('style', resolvePresetColorVars(element.getAttribute('style') ?? ''));
  });
};
