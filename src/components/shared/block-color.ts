/**
 * Shared helpers for Notion-style BLOCK-LEVEL color (text + background applied
 * to a whole block, distinct from the inline Marker which colors a selection).
 *
 * The color is stored on the block's `data` as a preset name ('red', 'blue', …)
 * — never raw HTML — and applied to the rendered element via CSS custom
 * properties that already back the inline color palette. Text tools (paragraph,
 * header) call {@link applyBlockColor} on render and expose
 * {@link buildBlockColorTunes} in their block-settings menu.
 */
import type { I18n } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { createColorPicker, formatSwatchLabel, getActivePresets } from './color-picker';
import { COLOR_PRESETS, COLOR_PRESETS_DARK, colorVarName } from './color-presets';

/**
 * Block-level color stored on a tool's data. Values are preset names.
 */
export interface BlockColorData {
  /** Preset name for the block's text color, e.g. 'red'. Absent = inherit. */
  textColor?: string;
  /** Preset name for the block's background color. Absent = none. */
  backgroundColor?: string;
}

/**
 * Sanitize entries for the block-color data fields. They hold plain preset
 * names, not HTML, so they are passed through untouched. Spread into a tool's
 * static `sanitize` config alongside its `text` field.
 */
export const BLOCK_COLOR_SANITIZE = {
  textColor: false,
  backgroundColor: false,
} as const;

/**
 * Apply (or clear) block-level text/background color on a rendered element.
 * Idempotent: passing data without a field removes that inline style.
 * @param element - the block's content element
 * @param data - the block's color data
 */
export const applyBlockColor = (element: HTMLElement, data: BlockColorData): void => {
  if (data.textColor) {
    element.style.setProperty('color', colorVarName(data.textColor, 'text'));
  } else {
    element.style.removeProperty('color');
  }

  if (data.backgroundColor) {
    element.style.setProperty('background-color', colorVarName(data.backgroundColor, 'bg'));
  } else {
    element.style.removeProperty('background-color');
  }
};

/**
 * Small inline swatch markup for a color menu entry.
 * @param cssValue - the CSS color value (var reference)
 * @param isBackground - render a filled square (bg) vs a colored glyph (text)
 */
const swatch = (cssValue: string, isBackground: boolean): string => {
  const base =
    'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;font-weight:600;';

  return isBackground
    ? `<span style="${base}background-color:${cssValue};border:1px solid rgba(0,0,0,0.08)"></span>`
    : `<span style="${base}color:${cssValue}">A</span>`;
};

/**
 * Options for {@link buildBlockColorTunes}.
 */
export interface BlockColorTuneOptions {
  /** Current block color data (drives the active swatch). */
  data: BlockColorData;
  /** The calling tool's i18n (labels are resolved via the shared picker's keys). */
  i18n: I18n;
  /**
   * Called when a swatch is picked. `value` is a preset name, or undefined to
   * clear the field. The caller persists it (e.g. via api.blocks.update) which
   * re-renders the block and re-runs applyBlockColor.
   */
  onPick: (field: keyof BlockColorData, value: string | undefined) => void;
}

/**
 * A single flat block-color command surfaced in the slash menu (toolbox), e.g.
 * "Red Background" or "Orange Text color". Activating it recolors the CURRENT
 * block rather than inserting a new one.
 */
export interface BlockColorToolboxEntry {
  /** Unique popover-item name. */
  name: string;
  /** Localized title composed from the locale's swatch-label template. */
  title: string;
  /** English counterpart of the title, used for multilingual search. */
  englishTitle: string;
  /** Inline swatch markup shown as the item icon. */
  icon: string;
  /** Which color field this command sets. */
  field: keyof BlockColorData;
  /** Preset name to apply, or undefined to clear the field (Default reset). */
  value: string | undefined;
  /** Lowercase search aliases so the entry is reachable by query. */
  searchTerms: string[];
}

/**
 * Build the flat list of block-color commands for the slash menu: one "{Color}
 * {Text color}" and one "{Color} {Background}" per preset hue, plus a Default
 * reset for each axis. Unlike {@link buildBlockColorTunes} (nested submenus for
 * the block-settings menu), these are flat, individually searchable entries —
 * so typing e.g. "/red background" or "/orange text" surfaces them directly.
 * Titles are composed via the locale's swatch-label templates so each locale
 * controls the color name, word order and casing.
 * @param i18n - translator resolving the swatch-label templates and color names
 */
export const getBlockColorToolboxEntries = (i18n: I18n): BlockColorToolboxEntry[] => {
  const english: Pick<I18n, 't'> = { t: (key) => i18n.getEnglishTranslation(key) };
  const axes: Array<{ field: keyof BlockColorData; mode: 'text' | 'bg'; labelKey: string; keyword: string }> = [
    { field: 'textColor', mode: 'text', labelKey: 'tools.marker.textColor', keyword: 'text' },
    { field: 'backgroundColor', mode: 'bg', labelKey: 'tools.marker.background', keyword: 'background' },
  ];

  return axes.flatMap((axis) => {
    const presetEntries = COLOR_PRESETS.map((preset) => ({
      name: `block-color-${axis.mode}-${preset.name}`,
      title: formatSwatchLabel(i18n, axis.labelKey, preset.name),
      englishTitle: formatSwatchLabel(english, axis.labelKey, preset.name),
      icon: swatch(colorVarName(preset.name, axis.mode), axis.field === 'backgroundColor'),
      field: axis.field,
      value: preset.name as string | undefined,
      searchTerms: ['color', axis.keyword, preset.name],
    }));

    const defaultEntry = {
      name: `block-color-${axis.mode}-default`,
      title: formatSwatchLabel(i18n, axis.labelKey, null),
      englishTitle: formatSwatchLabel(english, axis.labelKey, null),
      icon: swatch(axis.field === 'backgroundColor' ? 'transparent' : 'currentColor', axis.field === 'backgroundColor'),
      field: axis.field,
      value: undefined,
      searchTerms: ['color', axis.keyword, 'default'],
    };

    return [...presetEntries, defaultEntry];
  });
};

/**
 * Map a raw swatch CSS value emitted by the shared picker back to its preset
 * name. Both light and dark preset tables are searched since the picker
 * renders whichever matches the active theme.
 * @param color - the CSS value from the clicked swatch
 * @param field - which preset column the value came from
 */
const presetNameFromCss = (color: string, field: 'text' | 'bg'): string | undefined => {
  return [...COLOR_PRESETS, ...COLOR_PRESETS_DARK].find((preset) => preset[field] === color)?.name;
};

/**
 * Build the single "Color" block-settings entry: a submenu hosting the shared
 * two-section (Text color / Background) swatch picker used by the marker and
 * table cells — mirroring Notion's block color menu. Spread the result into a
 * tool's `renderSettings()` output.
 * @param options - data, i18n and the persistence callback
 */
export const buildBlockColorTunes = (options: BlockColorTuneOptions): MenuConfig => {
  const { data, i18n, onPick } = options;
  const activePresets = getActivePresets();

  const cssFor = (name: string | undefined, field: 'text' | 'bg'): string | null => {
    if (name === undefined) {
      return null;
    }

    return activePresets.find((preset) => preset.name === name)?.[field] ?? null;
  };

  const handle = createColorPicker({
    i18n,
    testIdPrefix: 'block-color',
    modes: [
      { key: 'textColor', labelKey: 'tools.marker.textColor', presetField: 'text' },
      { key: 'backgroundColor', labelKey: 'tools.marker.background', presetField: 'bg' },
    ],
    initialActiveColors: {
      textColor: cssFor(data.textColor, 'text'),
      backgroundColor: cssFor(data.backgroundColor, 'bg'),
    },
    onColorSelect: (color, modeKey) => {
      const field = modeKey as keyof BlockColorData;

      handle.setActiveColor(color, modeKey);

      if (color === null) {
        onPick(field, undefined);
      } else {
        onPick(field, presetNameFromCss(color, field === 'textColor' ? 'text' : 'bg'));
      }
    },
  });

  return [
    {
      title: i18n.t('toolNames.marker'),
      name: 'block-color',
      icon: swatch(data.textColor ? colorVarName(data.textColor, 'text') : 'currentColor', false),
      children: {
        searchable: false,
        items: [
          {
            type: PopoverItemType.Html,
            element: handle.element,
          },
        ],
      },
    },
  ] as MenuConfig;
};
