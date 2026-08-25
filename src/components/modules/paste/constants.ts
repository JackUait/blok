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
 * Stamp set by the Google Docs preprocessor on a pasted `<table>` whose rows
 * all have exactly 2 or 3 cells. The HTML handler expands a stamped table
 * into a column layout (`column_list` + `column` blocks) instead of a table
 * block, stacking each table column's cells top-to-bottom. Survives the
 * whole-document sanitize pass via the Table tool's pasteConfig whitelist.
 */
export const COLUMNS_CANDIDATE_ATTR = 'data-blok-columns-candidate';

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

/**
 * Language of a pasted code block, stamped by the AI-chat preprocessor when the
 * source renders the language outside the `<pre>` (Gemini prints it in the code
 * block's header bar). Whitelisted on `pre` by the Code tool's pasteConfig so it
 * survives sanitization, and read back in that tool's `onPaste`.
 */
export const CODE_LANGUAGE_ATTR = 'data-blok-code-language';
