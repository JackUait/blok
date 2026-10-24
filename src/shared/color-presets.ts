/**
 * Shared color preset used across marker and table cell color pickers.
 */
export interface ColorPreset {
  name: string;
  text: string;
  bg: string;
}

/**
 * Ten Notion-style color presets for light mode.
 * `text` is used for foreground (text-color mode), `bg` for background swatches.
 */
export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'gray', text: '#787774', bg: '#f1f1ef' },
  { name: 'brown', text: '#9f6b53', bg: '#f4eeee' },
  { name: 'orange', text: '#d9730d', bg: '#fbecdd' },
  { name: 'yellow', text: '#cb9b00', bg: '#fbf3db' },
  { name: 'green', text: '#448361', bg: '#edf3ec' },
  { name: 'blue', text: '#337ea9', bg: '#e7f3f8' },
  { name: 'purple', text: '#9065b0', bg: '#f6f3f9' },
  { name: 'pink', text: '#c14c8a', bg: '#f9f0f5' },
  { name: 'red', text: '#d44c47', bg: '#fdebec' },
];

/**
 * Dark-mode adapted presets. Text colors are lightened for readability on dark
 * swatch backgrounds; background colors are deep/muted to integrate with dark UI.
 * All pairs achieve at least 3.8:1 WCAG contrast. Backgrounds are equalized at
 * ~L19% HSL with increased saturation so each hue family is clearly identifiable.
 */
export const COLOR_PRESETS_DARK: ColorPreset[] = [
  { name: 'gray',   text: '#9b9b9b', bg: '#2f2f2f' },
  { name: 'brown',  text: '#c59177', bg: '#452a1c' },
  { name: 'orange', text: '#dc8c47', bg: '#4d2f14' },
  { name: 'yellow', text: '#d4ab49', bg: '#544012' },
  { name: 'green',  text: '#5db184', bg: '#1e432f' },
  { name: 'blue',   text: '#5c9fcc', bg: '#123a54' },
  { name: 'purple', text: '#a67dca', bg: '#341d49' },
  { name: 'pink',   text: '#d45e99', bg: '#4b1b33' },
  { name: 'red',    text: '#dd5e5a', bg: '#4e1a18' },
];

/**
 * Construct a CSS custom property reference for a named preset color.
 *
 * @param name - The color preset name (e.g. 'red', 'blue')
 * @param mode - 'text' for foreground, 'bg' for background
 * @returns CSS var reference, e.g. `var(--blok-color-red-text)`
 */
export function colorVarName(name: string, mode: 'text' | 'bg'): string {
  return `var(--blok-color-${name}-${mode})`;
}
