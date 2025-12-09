/**
 * Placeholder utilities for contenteditable elements
 *
 * Provides unified handling for:
 * - Placeholder styling classes
 * - Caret positioning when content is empty
 * - Focus and input event handlers
 *
 * @license MIT
 */

/**
 * Placeholder styling classes using Tailwind arbitrary variants.
 * Applied to ::before pseudo-element only when element is empty.
 * Uses data-placeholder attribute for the placeholder text.
 */
export const PLACEHOLDER_CLASSES: string[] = [
  'empty:before:pointer-events-none',
  'empty:before:text-gray-text',
  'empty:before:cursor-text',
  'empty:before:content-[attr(data-placeholder)]',
  '[&[data-blok-empty=true]]:before:pointer-events-none',
  '[&[data-blok-empty=true]]:before:text-gray-text',
  '[&[data-blok-empty=true]]:before:cursor-text',
  '[&[data-blok-empty=true]]:before:content-[attr(data-placeholder)]',
];

/**
 * Alternative placeholder classes using data-placeholder-active attribute.
 * Used by some tools that need a different attribute name.
 */
export const PLACEHOLDER_ACTIVE_CLASSES: string[] = [
  'empty:before:pointer-events-none',
  'empty:before:text-gray-text',
  'empty:before:cursor-text',
  'empty:before:content-[attr(data-placeholder-active)]',
  '[&[data-empty=true]]:before:pointer-events-none',
  '[&[data-empty=true]]:before:text-gray-text',
  '[&[data-empty=true]]:before:cursor-text',
  '[&[data-empty=true]]:before:content-[attr(data-placeholder-active)]',
];

/**
 * Check if an element's content is empty
 *
 * @param element - The element to check
 * @returns true if the element is empty or contains only a <br>
 */
export const isContentEmpty = (element: HTMLElement): boolean => {
  const content = element.innerHTML.trim();
  return content === '' || content === '<br>';
};

/**
 * Set caret to the start of an element.
 * Clears any <br> tags to ensure clean empty state for placeholder.
 *
 * @param element - The element to set caret in
 */
export const setCaretToStart = (element: HTMLElement): void => {
  // Clear any <br> tags to ensure clean empty state for placeholder
  if (element.innerHTML === '<br>') {
    // eslint-disable-next-line no-param-reassign
    element.innerHTML = '';
  }

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Handler that sets caret to start when element is empty.
 * Used for focus and input events.
 *
 * @param element - The element to handle
 */
const handleEmptyElement = (element: HTMLElement): void => {
  if (!isContentEmpty(element)) return;
  setCaretToStart(element);
};

/**
 * Set up placeholder behavior for a contenteditable element.
 * Adds focus and input event listeners to handle caret positioning
 * when the element is empty.
 *
 * @param element - The contenteditable element
 * @param placeholder - Optional placeholder text to set
 * @param attributeName - The attribute name for placeholder text (default: 'data-placeholder')
 */
export const setupPlaceholder = (
  element: HTMLElement,
  placeholder?: string,
  attributeName: 'data-placeholder' | 'data-placeholder-active' = 'data-placeholder'
): void => {
  // Always set the attribute, even if empty (for consistency and testing)
  element.setAttribute(attributeName, placeholder ?? '');

  const handler = (): void => handleEmptyElement(element);

  element.addEventListener('focus', handler);
  element.addEventListener('input', handler);
};

/**
 * Apply placeholder attribute to an element
 *
 * @param element - The element to apply placeholder to
 * @param placeholder - The placeholder text
 * @param attributeName - The attribute name (default: 'data-placeholder')
 */
export const applyPlaceholderAttribute = (
  element: HTMLElement,
  placeholder: string,
  attributeName: 'data-placeholder' | 'data-placeholder-active' = 'data-placeholder'
): void => {
  element.setAttribute(attributeName, placeholder);
};
