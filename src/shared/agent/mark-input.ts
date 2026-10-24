import { COLOR_PRESETS } from '../../components/shared/color-presets';
import { mapToNearestPresetName, parseColor } from '../color-mapping';
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

/** parseColor reads only the comma syntax; the browser serializes `rgb(1 2 3 / 50%)` to it before the load path maps it. */
const commaSyntax = (value: string): string => value.replace(/^(rgba?|hsla?)\(\s*([^,)]*?)\s*\)$/i, (whole, fn: string, body: string) =>
  body.includes(',') ? whole : `${fn}(${body.split(/\s*\/\s*|\s+/).join(', ')})`);

type ColorMode = 'text' | 'bg';

/** migrateMarkColors strips exactly these backgrounds on load. */
const isPageBackground = (color: string): boolean => isDefaultWhiteBackground(color) || isDefaultDarkBackground(color);

/**
 * What the editor's load path (migrateMarkColors, then the reader) makes of a
 * colour, measured in a real editor. A note means the value changed.
 */
const snapColor = (value: string, mode: ColorMode): { value?: string; note?: string } => {
  const raw = value.trim();
  const preset = PRESET_VAR.exec(raw);

  if (PRESETS.has(raw)) {
    return { value: raw };
  }
  if (preset !== null && preset[2] === mode && PRESETS.has(preset[1])) {
    return { value: preset[1] };
  }
  if (!isSafeCssColor(raw)) {
    return { note: `"${value}" is not a colour, so it was dropped. Use a preset name.` };
  }
  if (raw.startsWith('var(')) {
    return { value: raw };
  }

  const rgb = parseColor(commaSyntax(raw));
  const rgbText = rgb === null ? undefined : `rgb(${rgb.join(', ')})`;

  if (raw.toLowerCase() === 'transparent'
    || (mode === 'bg' && (isPageBackground(raw) || (rgbText !== undefined && isPageBackground(rgbText))))) {
    return { note: `"${value}" shows no ${mode === 'bg' ? 'background' : 'colour'}, so it was dropped.` };
  }

  if (rgbText === undefined && raw.includes('(')) {
    return { note: `"${value}" is a colour form Blok does not store. Use a preset name or a #rrggbb value.` };
  }

  // A named colour stays as written, as it does on load.
  const name = rgbText === undefined ? null : mapToNearestPresetName(rgbText, mode);

  return name === null || name === raw
    ? { value: raw }
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
