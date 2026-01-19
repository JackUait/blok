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
 * Detect list style from pasted content based on parent element
 *
 * @param content - The pasted content element
 * @param currentStyle - The current style to fall back to
 * @returns The detected list style
 */
export const detectStyleFromPastedContent = (content: HTMLElement, currentStyle: ListItemStyle): ListItemStyle => {
  const parentList = content.parentElement;
  if (!parentList) return currentStyle;

  if (parentList.tagName === 'OL') return 'ordered';
  if (parentList.tagName !== 'UL') return currentStyle;

  // Check for checkbox inputs to detect checklist
  const hasCheckbox = content.querySelector('input[type="checkbox"]');
  return hasCheckbox ? 'checklist' : 'unordered';
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
