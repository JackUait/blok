/**
 * Split an imported page heading into its emoji icon and its title, the
 * inverse of the exporters' `🚀 Title` heading.
 *
 * PURITY: no runtime imports — the server runtime bundles the importers.
 */
import type { PageIcon } from '../../types/tools/page';

/**
 * Code-point ranges, not `\p{Extended_Pictographic}`: an engine without that
 * property (the C# server's) would fail to parse the whole module.
 * Symbols that render as text by default (©, ®, ™, arrows, ▶) count only with
 * the emoji selector U+FE0F, so a title like "© 2026 Report" keeps its "©".
 */
const EMOJI_BASE = '[\\u2600-\\u27BF\\u2B00-\\u2BFF\\u231A\\u231B\\u23E9-\\u23F3\\u23F8-\\u23FA\\u{1F000}-\\u{1FAFF}]';
const TEXT_SYMBOL = '[\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u21AA\\u2300-\\u23FF\\u24C2\\u25AA-\\u25FE\\u2934\\u2935\\u3030\\u303D\\u3297\\u3299]\\uFE0F';
const MODIFIERS = '(?:\\uFE0F|\\u20E3|[\\u{1F3FB}-\\u{1F3FF}]|[\\u{E0020}-\\u{E007F}])*';
const PICTOGRAPH = `(?:${EMOJI_BASE}|${TEXT_SYMBOL})${MODIFIERS}`;
const FLAG = '[\\u{1F1E6}-\\u{1F1FF}]{2}';
const KEYCAP = '[0-9#*]\\uFE0F?\\u20E3';
const LEADING_EMOJI = new RegExp(`^(${FLAG}|${KEYCAP}|${PICTOGRAPH}(?:\\u200D${PICTOGRAPH})*) +(?=\\S)`, 'u');

/**
 * Only a leading emoji followed by a space counts as the icon.
 * @param text - the heading's plain text
 * @returns the title, plus the icon when the text starts with one
 */
export const splitPageTitle = (text: string): { title: string; icon?: PageIcon } => {
  const trimmed = text.trim();
  const match = LEADING_EMOJI.exec(trimmed);

  if (match === null) {
    return { title: trimmed };
  }

  return { title: trimmed.slice(match[0].length), icon: { type: 'emoji', value: match[1] } };
};

const withoutNul = (text: string): string => text.replaceAll('\u0000', '');

/** The server drops page metadata that still contains U+0000. */
export function cleanPageField(value: string): string;
export function cleanPageField(value: PageIcon): PageIcon;
export function cleanPageField(value: null): null;
export function cleanPageField(value: undefined): undefined;
export function cleanPageField(value: string | PageIcon | null | undefined): string | PageIcon | null | undefined;
export function cleanPageField(value: unknown): unknown {
  if (typeof value === 'string') {
    return withoutNul(value);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([name, field]): [string, unknown] =>
      [name, typeof field === 'string' ? withoutNul(field) : field])
  );
}
