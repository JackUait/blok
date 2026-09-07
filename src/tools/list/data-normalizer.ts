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
  items: Array<string | { content?: string; text?: string; checked?: boolean | string }>;
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
 * Whether this item already carries text that `save()` produced.
 *
 * NON-EMPTY is the test, not mere presence: legacy data reaches the tool with an
 * empty `text` default alongside its `items` array, so presence alone would make
 * every legacy import normalize to an empty item.
 */
const hasAuthoritativeText = (data: Record<string, unknown>): boolean =>
  Object.entries(data).some(([key, value]) => key === 'text' && typeof value === 'string' && value !== '');

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
  // This provides backward compatibility when legacy data is passed directly to the tool.
  //
  // A `text` string means save() has already written this item, so it is the
  // authoritative value and the legacy branch must stand down. A collaborative
  // document never deletes a data key it once held, so a migrated item keeps its
  // stale `items` array forever — reading it here would re-derive the text from
  // items[0] on every load and discard every edit made since the migration (and
  // reset depth to 0, which the standard branch below preserves).
  if (isLegacyFormat(data) && !hasAuthoritativeText(data)) {
    const firstItem = data.items[0];
    // handle string items and old {text,checked} shape
    const extractLegacy = (item: typeof firstItem): { text: string; checked: boolean | string | undefined } => {
      if (typeof item === 'string') {
        return { text: item, checked: false };
      }
      if (item !== null && typeof item === 'object') {
        return { text: item.content ?? item.text ?? '', checked: item.checked ?? false };
      }
      return { text: '', checked: false };
    };
    const { text, checked } = extractLegacy(firstItem);

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
