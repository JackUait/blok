/**
 * Static Configurations - Static configuration objects for the list tool.
 *
 * Extracted from ListItem for better organization.
 */

import type { ConversionConfig, PasteConfig, ToolSanitizerConfig } from '../../../types';

import type { ListItemData } from './types';

/**
 * Sanitization configuration for list content
 */
export const getListSanitizeConfig = (): ToolSanitizerConfig => ({
  text: {
    br: true,
    a: {
      href: true,
      target: '_blank',
      rel: 'nofollow',
    },
    b: true,
    i: true,
    mark: true,
  },
});

/**
 * Paste configuration for list tool
 */
export const getListPasteConfig = (): PasteConfig => ({ tags: ['LI'] });

/**
 * Conversion configuration for list tool
 */
export const getListConversionConfig = (): ConversionConfig<ListItemData> => ({
  export: (data: ListItemData): string => {
    return data.text;
  },
  import: (content: string): ListItemData => {
    return {
      text: content,
      style: 'unordered',
      checked: false,
    };
  },
});
