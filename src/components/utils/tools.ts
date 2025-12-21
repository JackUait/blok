import type { BlockToolAdapter } from '../tools/block';
import type { ToolboxConfigEntry } from '@/types';
import { isFunction, isString } from '../utils';

/**
 * Interface for i18n instance needed by tool utilities
 */
export interface I18nInstance {
  t(key: string, vars?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/**
 * Check if tool has valid conversion config for export or import.
 * @param tool - tool to check
 * @param direction - export for tool to merge from, import for tool to merge to
 */
export const isToolConvertable = (tool: BlockToolAdapter, direction: 'export' | 'import'): boolean => {
  if (!tool.conversionConfig) {
    return false;
  }

  const conversionProp = tool.conversionConfig[direction];

  return isFunction(conversionProp) || isString(conversionProp);
};

/**
 * Try to translate a key, supporting both full keys and toolNames namespace.
 *
 * If the key contains a dot (e.g., 'tools.header.heading1'), it's treated as a full key.
 * Otherwise, it's prefixed with 'toolNames.' (e.g., 'text' → 'toolNames.text').
 *
 * @param i18n - I18n instance
 * @param key - The key to look up (full key or short key without toolNames prefix)
 * @returns The translated string or undefined if not found
 */
const tryTranslate = (i18n: I18nInstance, key: string): string | undefined => {
  // If key contains a dot, treat it as a full key (e.g., 'tools.header.heading1')
  // Otherwise, prefix with 'toolNames.' (e.g., 'text' → 'toolNames.text')
  const fullKey = key.includes('.') ? key : `toolNames.${key}`;

  return i18n.has(fullKey) ? i18n.t(fullKey) : undefined;
};

/**
 * Translate a toolbox entry title using the i18n system.
 *
 * Priority:
 * 1. If titleKey is set, look up toolNames.{titleKey}
 * 2. If title is set, look up toolNames.{title} (for external tools without titleKey)
 * 3. If fallback is set, look up toolNames.{fallback} (for tools without title)
 * 4. Return the first available string: title or fallback
 *
 * @param i18n - I18n instance
 * @param entry - Toolbox config entry with title and optional titleKey
 * @param fallback - Fallback string if no translation or title exists
 * @returns Translated title string
 */
export const translateToolTitle = (i18n: I18nInstance, entry: ToolboxConfigEntry, fallback = ''): string => {
  // Try titleKey first (explicit translation key)
  const titleKeyTranslation = entry.titleKey ? tryTranslate(i18n, entry.titleKey) : undefined;

  if (titleKeyTranslation !== undefined) {
    return titleKeyTranslation;
  }

  // Try title as translation key (for external tools without titleKey)
  const titleTranslation = entry.title ? tryTranslate(i18n, entry.title) : undefined;

  if (titleTranslation !== undefined) {
    return titleTranslation;
  }

  if (entry.title) {
    return entry.title;
  }

  // Try fallback as translation key (for tools without title)
  const fallbackTranslation = fallback ? tryTranslate(i18n, fallback) : undefined;

  return fallbackTranslation ?? fallback;
};

/**
 * Translate a tool name using the toolNames namespace.
 *
 * Priority:
 * 1. If titleKey is set, look up toolNames.{titleKey}
 * 2. If title is set, look up toolNames.{title} (for external tools without titleKey)
 * 3. Return the title as-is
 *
 * @param i18n - I18n instance
 * @param titleKey - Translation key (e.g., 'bold', 'link', 'text')
 * @param title - Fallback title string (e.g., 'Bold', 'Link', 'Text')
 * @returns Translated tool name, or the title as fallback
 */
export const translateToolName = (i18n: I18nInstance, titleKey: string | undefined, title: string): string => {
  // Try explicit titleKey first
  const titleKeyTranslation = titleKey ? tryTranslate(i18n, titleKey) : undefined;

  if (titleKeyTranslation !== undefined) {
    return titleKeyTranslation;
  }

  // Try title as translation key (for external tools without titleKey)
  const titleTranslation = tryTranslate(i18n, title);

  return titleTranslation ?? title;
};
