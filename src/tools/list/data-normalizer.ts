/**
 * Data Normalizer - Handles normalizing and validating list item data.
 *
 * Extracted from ListItem for better organization.
 */

import type { ListItemConfig, ListItemData, ListItemStyle } from './types';

/**
 * Type guard for legacy list item format
 */
const isLegacyFormat = (
  data: unknown,
): data is { items: Array<{ content: string; checked?: boolean }>, style?: ListItemStyle, start?: number } => {
  if (typeof data !== 'object' || data === null || !('items' in data)) {
    return false;
  }
  const potentialData = data as { items: unknown };
  return Array.isArray(potentialData.items);
};

/**
 * Normalize incoming data to the standard ListItemData format.
 * Handles legacy formats and missing values.
 *
 * @param data - The data to normalize
 * @param settings - The list tool configuration
 * @returns Normalized ListItemData
 */
export const normalizeListItemData = (
  data: ListItemData | Record<string, never>,
  settings: ListItemConfig,
): ListItemData => {
  const defaultStyle = settings.defaultStyle || 'unordered';

  if (!data || typeof data !== 'object') {
    return {
      text: '',
      style: defaultStyle,
      checked: false,
      depth: 0,
    };
  }

  // Handle legacy format with items[] array - extract first item's content
  // This provides backward compatibility when legacy data is passed directly to the tool
  if (isLegacyFormat(data)) {
    const firstItem = data.items[0];
    const text = firstItem?.content || '';
    const checked = firstItem?.checked || false;

    return {
      text,
      style: data.style || defaultStyle,
      checked: Boolean(checked),
      depth: 0,
      ...(data.start !== undefined && data.start !== 1 ? { start: data.start } : {}),
    };
  }

  return {
    text: data.text || '',
    style: data.style || defaultStyle,
    checked: Boolean(data.checked),
    depth: data.depth ?? 0,
    ...(data.start !== undefined && data.start !== 1 ? { start: data.start } : {}),
  };
}
