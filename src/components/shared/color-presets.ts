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
  { name: 'teal', text: '#2b9a8f', bg: '#e4f5f3' },
  { name: 'blue', text: '#337ea9', bg: '#e7f3f8' },
  { name: 'purple', text: '#9065b0', bg: '#f6f3f9' },
  { name: 'pink', text: '#c14c8a', bg: '#f9f0f5' },
  { name: 'red', text: '#d44c47', bg: '#fdebec' },
];

/**
 * Dark-mode adapted presets. Text colors are lightened for readability on dark
 * swatch backgrounds; background colors are deep/muted to integrate with dark UI.
 * Values sourced from Notion's dark theme stylesheet.
 */
export const COLOR_PRESETS_DARK: ColorPreset[] = [
  { name: 'gray',   text: '#9b9b9b', bg: '#2f2f2f' },
  { name: 'brown',  text: '#ba856f', bg: '#4a3228' },
  { name: 'orange', text: '#c77d48', bg: '#5c3b23' },
  { name: 'yellow', text: '#ca9849', bg: '#564328' },
  { name: 'green',  text: '#529e72', bg: '#243d30' },
  { name: 'teal',   text: '#4dab9a', bg: '#2e4d4b' },
  { name: 'blue',   text: '#5e87c9', bg: '#143a4e' },
  { name: 'purple', text: '#9d68d3', bg: '#3c2d49' },
  { name: 'pink',   text: '#d15796', bg: '#4e2c3c' },
  { name: 'red',    text: '#df5452', bg: '#522e2a' },
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
