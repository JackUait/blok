import type { BlockToolData } from '@/types';
import type { BlockToolAdapter } from '../tools/block';
import { translateToolTitle, type I18nInstance } from './tools';

/**
 * i18n surface the convert-menu builder needs: the {@link I18nInstance} used by
 * translateToolTitle, plus getEnglishTranslation for building search titles.
 */
export interface ConvertMenuI18n extends I18nInstance {
  getEnglishTranslation(key: string): string;
}

/**
 * A single "Turn into" menu entry, shared by the inline toolbar and block
 * settings. Both menus map this to their own item type and attach their own
 * onActivate handler.
 */
export interface ConvertMenuEntry {
  /** Toolbox icon (always present — upstream filtering drops icon-less entries) */
  icon: string;
  /** Localized, human-readable title (resolved from title ?? titleKey) */
  title: string;
  /** English title for multilingual search */
  englishTitle?: string;
  /** Item name = toolboxItem.name ?? tool.name (used for data-blok-item-name) */
  name: string;
  /** Search aliases carried through from the toolbox entry */
  searchTerms?: string[];
  /** Tool name passed to blocks.convert() */
  toolName: string;
  /** Convert payload from the toolbox entry */
  data?: BlockToolData;
}

/**
 * Turn the already-filtered convertible tools into flat menu entries.
 *
 * The tools are pre-filtered by getConvertibleToolsForBlock /
 * getConvertibleToolsForBlocks (export/import gating + current-variant dedup),
 * so this function only flattens toolboxes and resolves display fields.
 *
 * The title is resolved via translateToolTitle, which handles titleKey — a
 * toolbox entry with only titleKey and no raw title still produces a title.
 * This is the fix for the inline dropdown, which previously dropped such
 * entries entirely.
 * @param convertibleTools - tools the current block(s) can convert to
 * @param i18n - i18n instance for title resolution
 */
export const buildConvertMenuEntries = (
  convertibleTools: BlockToolAdapter[],
  i18n: ConvertMenuI18n,
): ConvertMenuEntry[] => {
  const entries: ConvertMenuEntry[] = [];

  convertibleTools.forEach((tool) => {
    tool.toolbox?.forEach((toolboxItem) => {
      if (toolboxItem.icon === undefined) {
        return;
      }

      const titleKey = toolboxItem.titleKey;
      const resolvedTitleKey = titleKey?.includes('.') ? titleKey : `toolNames.${titleKey}`;
      const englishTitleKey = titleKey ? resolvedTitleKey : undefined;
      const englishTitle = englishTitleKey
        ? i18n.getEnglishTranslation(englishTitleKey)
        : toolboxItem.title;

      entries.push({
        icon: toolboxItem.icon,
        title: translateToolTitle(i18n, toolboxItem, tool.name),
        englishTitle,
        name: toolboxItem.name ?? tool.name,
        searchTerms: toolboxItem.searchTerms,
        toolName: tool.name,
        data: toolboxItem.data,
      });
    });
  });

  return entries;
};
