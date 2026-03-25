// src/tools/callout/style-config.ts

import type { CalloutColor } from './types';

export interface ColorConfig {
  name: CalloutColor;
  i18nKey: string;
  bgVar: string;
  textVar: string;
}

export const COLOR_CONFIGS: ColorConfig[] = [
  { name: 'default', i18nKey: 'tools.callout.colorDefault', bgVar: '', textVar: '' },
  { name: 'gray',    i18nKey: 'tools.callout.colorGray',    bgVar: '--blok-color-gray-bg',   textVar: '--blok-color-gray-text' },
  { name: 'brown',   i18nKey: 'tools.callout.colorBrown',   bgVar: '--blok-color-brown-bg',  textVar: '--blok-color-brown-text' },
  { name: 'orange',  i18nKey: 'tools.callout.colorOrange',  bgVar: '--blok-color-orange-bg', textVar: '--blok-color-orange-text' },
  { name: 'yellow',  i18nKey: 'tools.callout.colorYellow',  bgVar: '--blok-color-yellow-bg', textVar: '--blok-color-yellow-text' },
  { name: 'green',   i18nKey: 'tools.callout.colorGreen',   bgVar: '--blok-color-green-bg',  textVar: '--blok-color-green-text' },
  { name: 'teal',    i18nKey: 'tools.callout.colorTeal',    bgVar: '--blok-color-teal-bg',   textVar: '--blok-color-teal-text' },
  { name: 'blue',    i18nKey: 'tools.callout.colorBlue',    bgVar: '--blok-color-blue-bg',   textVar: '--blok-color-blue-text' },
  { name: 'purple',  i18nKey: 'tools.callout.colorPurple',  bgVar: '--blok-color-purple-bg', textVar: '--blok-color-purple-text' },
  { name: 'pink',    i18nKey: 'tools.callout.colorPink',    bgVar: '--blok-color-pink-bg',   textVar: '--blok-color-pink-text' },
  { name: 'red',     i18nKey: 'tools.callout.colorRed',     bgVar: '--blok-color-red-bg',    textVar: '--blok-color-red-text' },
];

/** Returns CSS variable value string for use in inline style, e.g. "var(--blok-color-blue-bg)" */
export function colorVarStyle(varName: string): string {
  return varName === '' ? '' : `var(${varName})`;
}
