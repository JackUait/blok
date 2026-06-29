/**
 * Shared sanitizer rules for inline content that must survive across block
 * tools (paragraph, header, …) and, crucially, across "Turn into" conversion.
 *
 * Conversion re-sanitizes the source HTML with the TARGET tool's `text` field
 * config (see block-mutation.ts). If a tool's `text` config omits inline tags,
 * bold/italic/links/code/color are silently stripped on conversion. To match
 * Notion (formatting is preserved when you change a block's type), every text
 * tool spreads {@link INLINE_TEXT_SANITIZE} into its `text` sanitize config.
 */
import type { SanitizerConfig } from '../../../types';

/**
 * CSS properties that may remain on color-bearing inline elements (<mark>).
 * Everything else is stripped to prevent style-based injection via pasted HTML.
 */
const ALLOWED_COLOR_STYLE_PROPS = new Set(['color', 'background-color']);

/**
 * Function rule preserving an inline element's color/background-color styles
 * while removing every other CSS property. Mirrors the Marker inline tool so
 * colored text survives save, paste, and conversion identically.
 * @param node - live DOM node provided by HTMLJanitor
 * @returns attribute config keeping `style` only when a color remains
 */
export const preserveColorStyles = (node: Element): { [attr: string]: boolean | string } => {
  const style = (node as HTMLElement).style;

  const props = Array.from({ length: style.length }, (_, i) => style.item(i));

  for (const prop of props) {
    if (!ALLOWED_COLOR_STYLE_PROPS.has(prop)) {
      style.removeProperty(prop);
    }
  }

  return style.length > 0 ? { style: true } : {};
};

/**
 * Function rule preserving inline equation spans. The LaTeX source lives in the
 * `data-latex` attribute and is re-rendered on load, so only that attribute is
 * kept; any rendered KaTeX markup inside is regenerated and need not survive.
 *
 * Decorative / unknown spans return `false` rather than `{}`: HTMLJanitor only
 * unwraps a node when its rule is `false`/`undefined`. Returning `{}` keeps the
 * tag (just stripping its attributes), which would leak every `<span>` through
 * as a bare `<span>` — `text` tools allow `span` ONLY to round-trip equations,
 * so a span without `data-latex` must be unwrapped, not emptied.
 * @param node - live DOM node provided by HTMLJanitor
 * @returns attribute config keeping `data-latex` when present, else `false` to drop the tag
 */
export const preserveEquationSpan = (node: Element): { [attr: string]: boolean | string } | false => {
  return node.getAttribute('data-latex') !== null ? { 'data-latex': true } : false;
};

/**
 * Tag → rule map for inline formatting that text-bearing block tools allow in
 * their `text` field. Spread this into a tool's `text` sanitize config so the
 * marks produced by the inline tools (bold, italic, underline, strikethrough,
 * link, inline code, marker color, equation) round-trip through save and
 * "Turn into" conversion the way they do in Notion.
 */
export const INLINE_TEXT_SANITIZE = {
  br: true,
  strong: {},
  b: {},
  em: {},
  i: {},
  u: {},
  s: {},
  del: {},
  a: { href: true, target: true, rel: true },
  code: {},
  mark: preserveColorStyles,
  span: preserveEquationSpan,
} as unknown as SanitizerConfig;
