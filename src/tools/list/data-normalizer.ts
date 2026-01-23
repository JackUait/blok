/**
 * Data Normalizer - Handles normalizing and validating list item data.
 *
 * Extracted from ListItem for better organization.
 */

import type { ListItemConfig, ListItemData, ListItemStyle } from './types';

/**
 * Type for legacy list item format (used for type guard)
 */
type LegacyListItemFormat = {
  items: Array<{ content: string; checked?: boolean | string }>;
  style?: ListItemStyle;
  start?: number;
};

/**
 * Type guard for legacy list item format
 */
const isLegacyFormat = (data: unknown): data is LegacyListItemFormat => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  // Access via Object.entries to avoid type assertion
  const entries = Object.entries(data);
  const itemsEntry = entries.find(([key]) => key === 'items');
  if (itemsEntry === undefined) {
    return false;
  }

  return Array.isArray(itemsEntry[1]);
};

/**
 * Type for objects that may have ListItemData properties with loose typing
 * to handle malformed data from external sources
 */
type LooseListItemData = {
  text?: unknown;
  style?: unknown;
  checked?: unknown;
  depth?: unknown;
  start?: unknown;
  [key: string]: unknown;
};

/**
 * Type guard for objects with potential ListItemData properties
 */
const isObjectLike = (data: unknown): data is LooseListItemData => {
  return typeof data === 'object' && data !== null;
};

/**
 * Safely extract a string value from unknown input
 */
const getStringValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  return '';
};

/**
 * Safely extract a style value from unknown input
 */
const getStyleValue = (value: unknown, defaultStyle: ListItemStyle): ListItemStyle => {
  if (value === 'unordered' || value === 'ordered' || value === 'checklist') {
    return value;
  }
  return defaultStyle;
};

/**
 * Safely extract a boolean value from unknown input
 */
const getBooleanValue = (value: unknown): boolean => {
  return Boolean(value);
};

/**
 * Safely extract a number value from unknown input
 */
const getNumberValue = (value: unknown, defaultValue: number): number => {
  if (typeof value === 'number') {
    return value;
  }
  return defaultValue;
};

/**
 * Normalize incoming data to the standard ListItemData format.
 * Handles legacy formats and missing values.
 *
 * @param data - The data to normalize (can be partial, legacy format, or malformed)
 * @param settings - The list tool configuration
 * @returns Normalized ListItemData
 */
export const normalizeListItemData = (
  data: unknown,
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

  // Handle standard or loose ListItemData format
  if (isObjectLike(data)) {
    const text = getStringValue(data.text);
    const style = getStyleValue(data.style, defaultStyle);
    const checked = getBooleanValue(data.checked);
    const depth = getNumberValue(data.depth, 0);
    const startValue = data.start;

    const start = (typeof startValue === 'number' && startValue !== undefined && startValue !== 1)
      ? startValue
      : undefined;

    return {
      text,
      style,
      checked,
      depth,
      ...(start !== undefined ? { start } : {}),
    };
  }

  // Fallback for any other case
  return {
    text: '',
    style: defaultStyle,
    checked: false,
    depth: 0,
  };
}
