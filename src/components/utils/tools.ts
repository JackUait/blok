import type BlockToolAdapter from '../tools/block';
import type { ToolboxConfigEntry, TranslationKey } from '@/types';
import { isFunction, isString } from '../utils';
import I18n from '../i18n';

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
 * Try to translate a key in the toolNames namespace.
 *
 * @param key - The key to look up (without the toolNames prefix)
 * @returns The translated string or undefined if not found
 */
const tryTranslate = (key: string): string | undefined => {
  const fullKey = `toolNames.${key}` as TranslationKey;

  return I18n.hasTranslation(fullKey) ? I18n.t(fullKey) : undefined;
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
 * @param entry - Toolbox config entry with title and optional titleKey
 * @param fallback - Fallback string if no translation or title exists
 * @returns Translated title string
 */
export const translateToolTitle = (entry: ToolboxConfigEntry, fallback = ''): string => {
  // Try titleKey first (explicit translation key)
  const titleKeyTranslation = entry.titleKey ? tryTranslate(entry.titleKey) : undefined;

  if (titleKeyTranslation !== undefined) {
    return titleKeyTranslation;
  }

  // Try title as translation key (for external tools without titleKey)
  const titleTranslation = entry.title ? tryTranslate(entry.title) : undefined;

  if (titleTranslation !== undefined) {
    return titleTranslation;
  }

  if (entry.title) {
    return entry.title;
  }

  // Try fallback as translation key (for tools without title)
  const fallbackTranslation = fallback ? tryTranslate(fallback) : undefined;

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
 * @param titleKey - Translation key (e.g., 'bold', 'link', 'text')
 * @param title - Fallback title string (e.g., 'Bold', 'Link', 'Text')
 * @returns Translated tool name, or the title as fallback
 */
export const translateToolName = (titleKey: string | undefined, title: string): string => {
  // Try explicit titleKey first
  const titleKeyTranslation = titleKey ? tryTranslate(titleKey) : undefined;

  if (titleKeyTranslation !== undefined) {
    return titleKeyTranslation;
  }

  // Try title as translation key (for external tools without titleKey)
  const titleTranslation = tryTranslate(title);

  return titleTranslation ?? title;
};
