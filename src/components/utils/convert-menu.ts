import type { BlockToolData } from '@/types';
import type { MenuConfigItem } from '../../../types/tools';
import { IconCheck } from '../icons';
import type { BlockToolAdapter } from '../tools/block';
import { CURRENT_CONVERT_VARIANT } from './blocks';
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
  group?: 'heading' | 'toggle-heading';
  isCurrent?: boolean;
}

// Same order as the slash menu's sections; entries without a section go last.
const SECTION_ORDER = ['basic', 'media', 'database', 'advanced'];

const sectionRank = (section: string | undefined): number => {
  const rank = section === undefined ? -1 : SECTION_ORDER.indexOf(section);

  return rank === -1 ? SECTION_ORDER.length : rank;
};

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
  const entries: { entry: ConvertMenuEntry; rank: number }[] = [];

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

      const headingKind = titleKey?.match(/^tools\.header\.(heading|toggleHeading)[1-6]$/)?.[1];
      const regularHeadingGroup = headingKind === 'heading' ? 'heading' : undefined;
      const group = headingKind === 'toggleHeading' ? 'toggle-heading' : regularHeadingGroup;

      const isCurrent = CURRENT_CONVERT_VARIANT in toolboxItem && toolboxItem[CURRENT_CONVERT_VARIANT] === true;

      if (isCurrent && group === undefined) {
        return;
      }

      entries.push({ rank: sectionRank(toolboxItem.section), entry: {
        icon: toolboxItem.icon,
        title: translateToolTitle(i18n, toolboxItem, tool.name),
        englishTitle,
        name: toolboxItem.name ?? tool.name,
        searchTerms: toolboxItem.searchTerms,
        toolName: tool.name,
        data: toolboxItem.data,
        group,
        ...(isCurrent ? { isCurrent: true } : {}),
      } });
    });
  });

  // Array sort is stable, so toolbox order holds inside each section.
  return entries
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry }) => entry);
};

/**
 * Keep native items so search, keyboard navigation, and activation share the menu pipeline.
 */
export const buildConvertMenuItems = (
  entries: ConvertMenuEntry[],
  onActivate: (entry: ConvertMenuEntry) => void | Promise<void>,
): MenuConfigItem[] => {
  return entries.map(entry => ({
    icon: entry.icon,
    title: entry.title,
    name: entry.name,
    englishTitle: entry.englishTitle,
    searchTerms: entry.searchTerms,
    ...(entry.isCurrent ? { isActive: true, trailingIcon: IconCheck } : {}),
    dataset: { 'blok-convert-item': 'true' },
    closeOnActivate: true,
    onActivate: () => onActivate(entry),
  }));
};
