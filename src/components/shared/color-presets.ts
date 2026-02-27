/**
 * Shared color preset used across marker and table cell color pickers.
 */
export interface ColorPreset {
  name: string;
  text: string;
  bg: string;
}

/**
 * Ten Notion-style color presets.
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
