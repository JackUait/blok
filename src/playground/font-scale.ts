import type { BlokFontSizeConfig } from '../../types/configs/blok-config';

import { buildFontSizeVarLines } from '../components/utils/font-size-tokens';

/**
 * Each text scenario's built-in size — the `var(--blok-*-font-size, <here>)`
 * fallback the stylesheet declares. The playground mirrors them so one slider
 * can scale the whole editor; `calc(<default> * n)` keeps every block in its
 * original proportion. A drifted entry only skews the scaled preview: at 1x the
 * slider emits nothing, so the untouched playground can never disagree with CSS.
 */
const DEFAULTS = {
  paragraph: '1em',
  heading: { 1: '1.875rem', 2: '1.5rem', 3: '1.25rem', 4: '1.125rem', 5: '1rem', 6: '0.875rem' },
  list: { item: '1em', checklist: '1em' },
  quote: { default: '1em', large: '1.2em' },
  callout: '1em',
  code: '0.875rem',
  toggle: '1em',
  table: { compact: '0.875rem', comfortable: '1rem' },
  image: { caption: '13.5px' },
  video: { caption: '13.5px' },
  audio: { caption: '13px' },
  file: { caption: '13px' },
  embed: { caption: '0.875em' },
  bookmark: { title: '14px', description: '12px', link: '12px' },
} as const;

/** `1.875rem` at 1.25x → `calc(1.875rem * 1.25)`. */
const scaled = (size: string, scale: number): string => `calc(${size} * ${scale})`;

/**
 * Build a `style.fontSize` config that scales every scenario uniformly.
 * @param scale - multiplier, where 1 means "leave the defaults alone"
 * @returns the config to pass as `style.fontSize`, or undefined at 1x
 */
export const buildFontScaleConfig = (scale: number): BlokFontSizeConfig | undefined => {
  if (scale === 1) {
    return undefined;
  }

  const each = <T extends Record<string, string>>(group: T): Record<keyof T, string> =>
    Object.fromEntries(
      Object.entries(group).map(([key, size]) => [key, scaled(size, scale)])
    ) as Record<keyof T, string>;

  return {
    paragraph: scaled(DEFAULTS.paragraph, scale),
    heading: each(DEFAULTS.heading),
    list: each(DEFAULTS.list),
    quote: each(DEFAULTS.quote),
    callout: scaled(DEFAULTS.callout, scale),
    code: scaled(DEFAULTS.code, scale),
    toggle: scaled(DEFAULTS.toggle, scale),
    table: each(DEFAULTS.table),
    image: each(DEFAULTS.image),
    video: each(DEFAULTS.video),
    audio: each(DEFAULTS.audio),
    file: each(DEFAULTS.file),
    embed: each(DEFAULTS.embed),
    bookmark: each(DEFAULTS.bookmark),
  };
};

/** `--blok-paragraph-font-size: calc(1em * 1.25);` → the property/value pair. */
const parseVarLine = (line: string): [property: string, value: string] => {
  const separator = line.indexOf(':');

  return [line.slice(0, separator).trim(), line.slice(separator + 1).replace(/;$/, '').trim()];
};

/** Every token the scale writes, derived from the spec so nothing is orphaned on reset. */
const TOKEN_PROPERTIES = buildFontSizeVarLines(buildFontScaleConfig(2)).map(
  (line) => parseVarLine(line)[0]
);

/**
 * Apply a text scale to a live element by writing the font-size tokens inline.
 *
 * Custom properties inherit, so the editor restyles instantly — a reinit would
 * destroy the editor (and its content) on every step of a slider drag. The
 * tokens are exactly the ones {@link buildFontScaleConfig} produces, so the
 * dragged preview and the next (re)init agree.
 * @param element - holder to style; ignored when absent
 * @param scale - multiplier, where 1 clears the overrides
 */
export const applyFontScale = (element: HTMLElement | null, scale: number): void => {
  if (element === null) {
    return;
  }

  for (const property of TOKEN_PROPERTIES) {
    element.style.removeProperty(property);
  }

  for (const line of buildFontSizeVarLines(buildFontScaleConfig(scale))) {
    const [property, value] = parseVarLine(line);

    element.style.setProperty(property, value);
  }
};
