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
 * Allows LI tag with style, aria-level and data-list-style attributes to preserve:
 * - list-style-type from external sources (e.g., Google Docs, Word)
 * - aria-level for nested list depth information
 * - data-list-style stamped by the HTML paste pre-pass so the resolved
 *   ordered/unordered context survives once the <li> is detached from its
 *   ancestor <ul>/<ol>
 *
 * Also allows INPUT with type/checked so generic HTML checklists (e.g. GitHub
 * task lists: `<li><input type="checkbox" checked>…</li>`) survive the paste
 * sanitizer — the checkbox drives checklist style detection and checked state
 * in the paste handler and is stripped from the item text afterwards.
 */
export const getListPasteConfig = (): PasteConfig => ({
  tags: [
    {
      li: {
        // Allow style attribute to preserve list-style-type from external sources
        style: true,
        // Allow aria-level attribute to preserve nested list depth
        'aria-level': true,
        // Allow data-list-style so a detached <li> keeps its ordered/unordered context
        'data-list-style': true,
      },
    },
    {
      input: {
        // Keep checkbox inputs so checklist detection and checked state survive sanitization
        type: true,
        checked: true,
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
