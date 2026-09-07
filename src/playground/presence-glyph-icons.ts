/**
 * The anonymous-presence silhouettes, read back out of the stylesheet that
 * owns them.
 *
 * The artwork lives in src/styles/presence.css as mask data URIs, because
 * block copy unwraps the gutter strip and a face therefore may not carry a
 * child <svg> (see anonymous-identity.ts). The icon gallery needs the same
 * shapes as markup, so this decodes the sheet instead of keeping a second
 * copy in src/components/icons/index.ts, which would drift.
 */
import { ANONYMOUS_GLYPHS, UNKNOWN_GLYPH } from '../components/modules/collaboration/anonymous-identity';
// Vitest answers EVERY query on a .css id with an empty module (`css: false`),
// `?raw` included, so unit tests must feed decodePresenceGlyphs the file from
// disk. Only a browser sees content here; the e2e icons-tab spec covers that.
import presenceCss from '../styles/presence.css?raw';

/** Gallery group the silhouettes are drawn under. */
export const PRESENCE_GLYPH_GROUP = 'Anonymous Presence';

const GLYPH_RULE = /\[data-blok-presence-glyph="([^"]+)"\]\s*\{\s*--blok-presence-glyph:\s*url\("data:image\/svg\+xml,([^"]*)"\)/g;

/**
 * Turn the sheet's mask declarations back into SVG markup, keyed by the
 * `data-blok-presence-glyph` value.
 *
 * Slot order comes first, so the gallery reads the way a room fills up.
 * Anything the sheet carries beyond that list is appended rather than
 * dropped — drift between the two then shows on the page, not just in tests.
 * @param css - text of src/styles/presence.css
 */
export function decodePresenceGlyphs(css: string): Record<string, string> {
  const decoded: Record<string, string> = {};

  for (const [, glyph, payload] of css.matchAll(GLYPH_RULE)) {
    decoded[glyph] = decodeURIComponent(payload);
  }

  const slotOrder: readonly string[] = [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH];
  const names = [
    ...slotOrder.filter(glyph => glyph in decoded),
    ...Object.keys(decoded).filter(glyph => !slotOrder.includes(glyph)),
  ];

  return Object.fromEntries(names.map(glyph => [glyph, decoded[glyph]]));
}

/** Silhouette markup for the gallery, keyed by glyph name. */
export const PRESENCE_GLYPH_ICONS = decodePresenceGlyphs(presenceCss);
