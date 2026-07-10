import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';

/**
 * Safe structural tags that should be preserved during pasting.
 * These tags define document structure (tables, lists) and should not be stripped.
 */
export const SAFE_STRUCTURAL_TAGS = new Set<string>([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
]);

/**
 * Attributes preserved on structural tags during paste sanitization.
 *
 * The paste pre-pass (preprocessNestedLists) deliberately stamps `aria-level`
 * and `data-list-style` on every `<li>` to carry nesting depth and ordered
 * context; sources like Google Docs encode list style in `style`
 * (list-style-type). Stripping these silently flattens pasted lists wherever
 * a tool's own pasteConfig doesn't re-whitelist `li` (e.g. lists inside
 * table cells), so the structural sanitize config must keep them.
 */
export const STRUCTURAL_TAG_ATTRIBUTES: Record<string, Record<string, boolean>> = {
  li: {
    style: true,
    'aria-level': true,
    'data-list-style': true,
  },
};

/**
 * Collect tag names from either a tag name string or a sanitization config object.
 * Used to extract tag names from tool paste configurations.
 */
export const collectTagNames = (tagOrSanitizeConfig: string | SanitizerConfig): string[] => {
  if (typeof tagOrSanitizeConfig === 'string') {
    return [tagOrSanitizeConfig];
  }
  if (tagOrSanitizeConfig && typeof tagOrSanitizeConfig === 'object') {
    return Object.keys(tagOrSanitizeConfig);
  }

  return [];
}
