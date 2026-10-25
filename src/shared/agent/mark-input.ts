import { COLOR_PRESETS } from '../color-presets';
import { nearestPresetName, parseAnyCssColor } from '../color-mapping';
import { isSafeCssColor } from '../css-color';
import { isDefaultDarkBackground, isDefaultWhiteBackground } from '../default-page-colors';
import { DEFAULT_LINK_REL, DEFAULT_LINK_TARGET, SAME_PAGE_LINK_TARGET } from '../link-defaults';

import type { RichTextLink, RichTextMarks, RichTextSegment } from '../../../types/rich-text';

/**
 * The marker's first-use colour. LOCKSTEP with `MarkerInlineTool.DEFAULT_SHORTCUT_COLOR`,
 * which reads it from here: a highlight with no colour is stored as this background.
 */
export const DEFAULT_HIGHLIGHT_BACKGROUND = 'yellow';

/** Fills the target and rel of a link the way the host's Link tool would. */
export type LinkResolver = (link: RichTextLink) => RichTextLink;

const PRESETS: ReadonlySet<string> = new Set(COLOR_PRESETS.map(preset => preset.name));
const PRESET_VAR = /^var\(--blok-color-([a-z]+)-(text|bg)\)$/;

type ColorMode = 'text' | 'bg';

/** Page backgrounds are gray: the dark one (#191918) has a channel spread of 1. */
const NEUTRAL_MAX_SPREAD = 10;

/** White, or the near-black, near-gray dark page background. A dark blue is a colour, not the page. */
const isPageBackground = (color: string, rgb: readonly number[] | null): boolean => isDefaultWhiteBackground(color)
  || (isDefaultDarkBackground(color) && rgb !== null && Math.max(...rgb) - Math.min(...rgb) <= NEUTRAL_MAX_SPREAD);

const HEX_ALPHA = /^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/i;
const LAST_NUMBER = /([+-]?(?:\d+(?:\.\d+)?|\.\d+))%?\s*\)$/;

/** An alpha of 0 in #rgba, #rrggbbaa, `rgb(r, g, b, a)` or `rgb(r g b / a)`. */
const isFullyTransparent = (raw: string): boolean => {
  const hex = HEX_ALPHA.exec(raw);

  if (hex !== null) {
    return /^0+$/.test(hex[1] ?? hex[2]);
  }

  const hasAlpha = raw.includes('/') || (raw.match(/,/g)?.length ?? 0) === 3;
  const alpha = hasAlpha ? LAST_NUMBER.exec(raw) : null;

  return alpha !== null && Number(alpha[1]) <= 0;
};

/**
 * What the editor's load path (migrateMarkColors, then the reader) makes of a
 * colour, measured in a real editor. A note means the value changed.
 */
const snapColor = (value: string, mode: ColorMode): { value?: string; note?: string } => {
  const raw = value.trim();
  // CSS colour keywords ignore case; the browser serializes them in lower case.
  const lower = raw.toLowerCase();
  const preset = PRESET_VAR.exec(raw);

  if (PRESETS.has(lower)) {
    return { value: lower };
  }
  if (preset !== null && preset[2] === mode && PRESETS.has(preset[1])) {
    return { value: preset[1] };
  }
  if (!isSafeCssColor(raw)) {
    return { note: `"${value}" was dropped: Blok reads a preset name, hex, rgb, hsl, a CSS colour name or var(--name).` };
  }
  if (raw.startsWith('var(')) {
    return { value: raw };
  }
  if (lower === 'transparent' || isFullyTransparent(raw)) {
    return { note: `"${value}" is see-through, so it was dropped.` };
  }

  const rgb = parseAnyCssColor(raw);
  const rgbText = rgb === null ? undefined : `rgb(${rgb.join(', ')})`;

  if (mode === 'bg' && (isPageBackground(raw, rgb) || (rgbText !== undefined && isPageBackground(rgbText, rgb)))) {
    return { note: `"${value}" is the page background, so it was dropped.` };
  }

  // A named colour (or currentcolor) stays as written, as it does on load.
  const name = rgbText === undefined ? null : nearestPresetName(rgbText, mode);

  return name === null
    ? { value: rgbText === undefined ? lower : raw }
    : { value: name, note: `"${value}" was stored as the nearest preset, "${name}".` };
};

/** Data fields every tool reads as block colour: the toolbox colour commands write them on any tool that keeps them. */
export const BLOCK_COLOR_FIELDS = { textColor: 'text', backgroundColor: 'bg' } as const;

/**
 * A block colour as the block colour menu would save it: always a preset name.
 * A colour becomes the nearest preset; anything else is dropped. A note means the value changed.
 */
export const snapBlockColor = (value: string, mode: ColorMode): { value?: string; note?: string } => {
  const raw = value.trim();
  const lower = raw.toLowerCase();
  const preset = PRESET_VAR.exec(raw);

  if (PRESETS.has(lower)) {
    return { value: lower };
  }
  if (preset !== null && preset[2] === mode && PRESETS.has(preset[1])) {
    return { value: preset[1] };
  }

  const rgb = isSafeCssColor(raw) && !isFullyTransparent(raw) ? parseAnyCssColor(raw) : null;
  const rgbText = rgb === null ? undefined : `rgb(${rgb.join(', ')})`;

  if (mode === 'bg' && rgbText !== undefined && (isPageBackground(raw, rgb) || isPageBackground(rgbText, rgb))) {
    return { note: `"${value}" is the page background, so it was dropped.` };
  }

  const name = rgbText === undefined ? null : nearestPresetName(rgbText, mode);

  return name === null
    ? { note: `"${value}" was dropped: a block colour is a preset name (${[...PRESETS].join(', ')}).` }
    : { value: name, note: `"${value}" was stored as the nearest preset, "${name}".` };
};

/** Defaults of the Link tool when the host sets no `link` config. */
export const defaultLinkResolver: LinkResolver = link => ({
  href: link.href,
  target: link.target ?? (link.href.trim().startsWith('#') ? SAME_PAGE_LINK_TARGET : DEFAULT_LINK_TARGET),
  rel: link.rel ?? DEFAULT_LINK_REL,
});

/**
 * Marks the agent wrote, made into what the user's own inline tools write, so a
 * read after the write equals a read after reload. Returns the notes for the model.
 * @param marks - one run's marks, already validated
 * @param resolveLink - fills a link's target and rel
 */
export const normalizeAgentMarks = (marks: RichTextMarks, resolveLink: LinkResolver): { marks: RichTextMarks; notes: string[] } => {
  const next: RichTextMarks = { ...marks };
  const notes: string[] = [];

  for (const [key, mode] of [['color', 'text'], ['background', 'bg']] as const) {
    const value = next[key];

    if (value === undefined) {
      continue;
    }

    const snapped = snapColor(value, mode);

    if (snapped.note !== undefined) {
      notes.push(`${key}: ${snapped.note}`);
    }
    if (snapped.value === undefined) {
      Reflect.deleteProperty(next, key);
    } else {
      next[key] = snapped.value;
    }
  }
  if (next.highlight === true) {
    Reflect.deleteProperty(next, 'highlight');
    if (next.background === undefined) {
      next.background = DEFAULT_HIGHLIGHT_BACKGROUND;
      notes.push(`highlight: stored as background "${DEFAULT_HIGHLIGHT_BACKGROUND}", the marker's highlight.`);
    }
  }
  if (next.sup === true && next.sub === true) {
    Reflect.deleteProperty(next, 'sub');
    notes.push('sup and sub cannot share a run; sup was kept.');
  }
  if (next.link !== undefined) {
    next.link = resolveLink(next.link);
  }

  return { marks: next, notes };
};

/** A page mention renders its own link, so a link mark on it would nest anchors. */
export const dropLinkOnPageMention = (segment: RichTextSegment): { segment: RichTextSegment; note?: string } => {
  if (!('embed' in segment) || !('page' in segment.embed) || segment.marks?.link === undefined) {
    return { segment };
  }

  const { link: _link, ...rest } = segment.marks;

  return {
    segment: { embed: segment.embed, ...(Object.keys(rest).length === 0 ? {} : { marks: rest }) },
    note: 'A page mention is a link already, so the link mark on it was dropped.',
  };
};

const LINK_FIELDS: ReadonlySet<string> = new Set(['href', 'target', 'rel']);

/**
 * `false` and `null` mean "not set" (a host may write `bold: false`), and a link
 * keeps only href, target and rel. Other wrong types are left for validation.
 * @param marks - one run's marks as the agent sent them
 */
export const looseMarkInput = (marks: RichTextMarks): { marks: Record<string, unknown>; notes: string[] } => {
  const notes: string[] = [];
  const next: Record<string, unknown> = {};
  const entries: Array<[string, unknown]> = Object.entries(marks);

  for (const [key, value] of entries) {
    if (value === false || value === null) {
      notes.push(`${key}: ${String(value)} means not set, so it was left off.`);
    } else if (key === 'link' && typeof value === 'object' && !Array.isArray(value)) {
      const extra = Object.keys(value).filter(field => !LINK_FIELDS.has(field));

      notes.push(...extra.map(field => `link: "${field}" dropped. A link keeps only href, target and rel.`));
      next[key] = Object.fromEntries(Object.entries(value).filter(([field]) => LINK_FIELDS.has(field)));
    } else if (value !== undefined) {
      next[key] = value;
    }
  }

  return { marks: next, notes };
};
