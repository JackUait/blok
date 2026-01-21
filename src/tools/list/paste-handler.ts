/**
 * Paste Handler - Handles pasting list content from external sources.
 *
 * Extracted from ListItem for better organization.
 */

import type { ListItemStyle } from './types';

/**
 * Type guard to check if paste event data is an HTMLElement
 */
export const isPasteEventHTMLElement = (data: unknown): data is HTMLElement => {
  return data instanceof HTMLElement;
};

/**
 * Ordered list style types from CSS list-style-type property
 */
const ORDERED_LIST_STYLE_TYPES = new Set([
  'decimal',
  'decimal-leading-zero',
  'lower-roman',
  'upper-roman',
  'lower-greek',
  'lower-latin',
  'upper-latin',
  'lower-alpha',
  'upper-alpha',
  'arabic-indic',
  'armenian',
  'bengali',
  'cambodian',
  'cjk-decimal',
  'devanagari',
  'georgian',
  'gujarati',
  'gurmukhi',
  'hebrew',
  'kannada',
  'khmer',
  'lao',
  'malayalam',
  'mongolian',
  'myanmar',
  'oriya',
  'persian',
  'telugu',
  'thai',
  'tibetan',
]);

/**
 * Unordered list style types from CSS list-style-type property
 */
const UNORDERED_LIST_STYLE_TYPES = new Set([
  'disc',
  'circle',
  'square',
  'none',
]);

/**
 * Extract list style type from element's style attribute
 *
 * @param content - The element to check
 * @returns 'ordered', 'unordered', or null if not determined
 */
const getListStyleFromAttribute = (content: HTMLElement): 'ordered' | 'unordered' | null => {
  // Check data-list-style attribute first (used by some editors)
  const dataStyle = content.getAttribute('data-list-style');
  if (dataStyle === 'ordered') return 'ordered';
  if (dataStyle === 'unordered') return 'unordered';

  // Check inline style attribute
  const styleAttr = content.getAttribute('style');
  if (!styleAttr) return null;

  // Extract list-style-type from inline style
  const listStyleMatch = styleAttr.match(/list-style-type\s*:\s*([^;]+)/);
  if (!listStyleMatch) return null;

  const listStyleType = listStyleMatch[1].trim().toLowerCase();

  if (ORDERED_LIST_STYLE_TYPES.has(listStyleType)) return 'ordered';
  if (UNORDERED_LIST_STYLE_TYPES.has(listStyleType)) return 'unordered';

  return null;
};

/**
 * Detect list style from pasted content based on parent element
 *
 * @param content - The pasted content element
 * @param currentStyle - The current style to fall back to
 * @returns The detected list style
 */
export const detectStyleFromPastedContent = (content: HTMLElement, currentStyle: ListItemStyle): ListItemStyle => {
  const parentList = content.parentElement;

  // First, check parent element tag (most reliable)
  if (parentList) {
    if (parentList.tagName === 'OL') return 'ordered';
    if (parentList.tagName === 'UL') {
      // Check for checkbox inputs to detect checklist
      const hasCheckbox = content.querySelector('input[type="checkbox"]');
      return hasCheckbox ? 'checklist' : 'unordered';
    }
  }

  // If no parent or parent is not OL/UL, check element's own attributes
  // This handles cases where the list structure is lost during paste processing
  // (e.g., Google Docs paste where <li> elements are extracted from their parent)
  const styleFromAttr = getListStyleFromAttribute(content);
  if (styleFromAttr) return styleFromAttr;

  // Fall back to current style
  return currentStyle;
};

/**
 * Extract text and checkbox state from pasted content
 *
 * @param content - The pasted content element
 * @returns Object with extracted text and checked state
 */
export const extractPastedContent = (content: HTMLElement): { text: string; checked: boolean } => {
  const text = content.innerHTML || content.textContent || '';

  // Check for checked state if checklist
  const checkbox = content.querySelector('input[type="checkbox"]');
  const checked = checkbox instanceof HTMLInputElement ? checkbox.checked : false;

  return { text, checked };
};

/**
 * Extract depth from pasted content for nested lists.
 *
 * Google Docs (and some other editors) use aria-level to indicate nesting depth.
 * The aria-level attribute is 1-based (1 = root level), while our depth system is 0-based.
 *
 * @param content - The pasted content element
 * @returns The depth level (0 = root, 1 = first indent, etc.)
 */
export const extractDepthFromPastedContent = (content: HTMLElement): number => {
  // Check for aria-level attribute (used by Google Docs and other editors)
  const ariaLevel = content.getAttribute('aria-level');

  if (ariaLevel) {
    const level = parseInt(ariaLevel, 10);
    // Convert 1-based aria-level to 0-based depth
    // Also ensure the value is non-negative
    return Math.max(0, level - 1);
  }

  // Default to root level (depth 0) if no aria-level attribute
  return 0;
};
