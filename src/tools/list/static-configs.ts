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
  },
});

/**
 * Paste configuration for list tool
 *
 * Allows LI tag with style and aria-level attributes to preserve:
 * - list-style-type from external sources (e.g., Google Docs, Word)
 * - aria-level for nested list depth information
 */
export const getListPasteConfig = (): PasteConfig => ({
  tags: [
    {
      li: {
        // Allow style attribute to preserve list-style-type from external sources
        style: true,
        // Allow aria-level attribute to preserve nested list depth
        'aria-level': true,
      },
    },
  ],
});

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
