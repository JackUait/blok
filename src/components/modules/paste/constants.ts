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
]);

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
