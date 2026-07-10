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
 * Find the checkbox input that marks pasted content as a checklist item.
 * Handles both a checkbox nested inside an `<li>` (GitHub task lists) and the
 * content being a bare `<input>` itself (tag-substitution paste of a lone input).
 *
 * @param content - The pasted content element
 * @returns The checkbox input, or null when none is present
 */
const findChecklistCheckbox = (content: HTMLElement): HTMLInputElement | null => {
  if (content instanceof HTMLInputElement && content.type === 'checkbox') {
    return content;
  }

  const checkbox = content.querySelector('input[type="checkbox"]');

  return checkbox instanceof HTMLInputElement ? checkbox : null;
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
  const hasCheckbox = findChecklistCheckbox(content) !== null;

  // First, check parent element tag (most reliable)
  if (parentList?.tagName === 'OL') return 'ordered';

  if (parentList?.tagName === 'UL') {
    // Check for checkbox inputs to detect checklist
    return hasCheckbox ? 'checklist' : 'unordered';
  }

  // If no parent or parent is not OL/UL, check element's own attributes
  // This handles cases where the list structure is lost during paste processing
  // (e.g., Google Docs paste where <li> elements are extracted from their parent)
  const styleFromAttr = getListStyleFromAttribute(content);
  if (styleFromAttr) return styleFromAttr;

  // A detached item that still carries a checkbox is a checklist item — the
  // paste splitter clones each <li> out of its ancestor <ul>, so the parent
  // tag check above never fires for sanitized paste content
  if (hasCheckbox) return 'checklist';

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
  const checkbox = findChecklistCheckbox(content);

  if (checkbox === null) {
    const text = content.innerHTML || content.textContent || '';

    return { text, checked: false };
  }

  // Strip the checkbox control(s) from the item text — the checklist tool
  // renders its own checkbox, so leaving the pasted <input> in the text would
  // duplicate it
  const withoutCheckboxes = content.cloneNode(true) as HTMLElement;

  withoutCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((input) => input.remove());

  return {
    text: withoutCheckboxes.innerHTML.trim(),
    checked: checkbox.checked,
  };
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

  // Fallback for rendered HTML without aria-level (generic web pages, copied
  // <ul>/<ol> from a browser). Plain nested lists carry their depth purely in the
  // DOM structure: a deeper item has more ancestor list elements. The immediate
  // enclosing list is depth 0, so subtract it from the ancestor count.
  // Mirrors the offline CLI converter so editor + CLI paste agree.
  const domNestingDepth = countAncestorListElements(content) - 1;

  if (domNestingDepth > 0) {
    return domNestingDepth;
  }

  // Default to root level (depth 0)
  return 0;
};

/**
 * Count the number of <ul>/<ol> ancestors above the given list item, walking up
 * the parent chain. A root-level item enclosed in a single list returns 1; an
 * item nested one level deeper (its list is itself inside another list) returns 2.
 *
 * @param content - the list item element
 * @returns the number of ancestor list elements (0 when detached / not in a list)
 */
const countAncestorListElements = (content: HTMLElement): number => {
  const parent = content.parentElement;

  if (parent === null) {
    return 0;
  }

  const isList = parent.tagName === 'UL' || parent.tagName === 'OL';

  return (isList ? 1 : 0) + countAncestorListElements(parent);
};
