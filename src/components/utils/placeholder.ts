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
  'empty:before:text-block-placeholder',
  'empty:before:cursor-text',
  'empty:before:content-[attr(data-placeholder)]',
  'data-[blok-empty=true]:before:pointer-events-none',
  'data-[blok-empty=true]:before:text-block-placeholder',
  'data-[blok-empty=true]:before:cursor-text',
  'data-[blok-empty=true]:before:content-[attr(data-placeholder)]',
];

/**
 * Alternative placeholder classes using data-blok-placeholder-active attribute.
 * Used by some tools that need a different attribute name.
 */
export const PLACEHOLDER_ACTIVE_CLASSES: string[] = [
  'empty:before:pointer-events-none',
  'empty:before:text-block-placeholder',
  'empty:before:cursor-text',
  'empty:before:content-[attr(data-blok-placeholder-active)]',
  'data-[empty=true]:before:pointer-events-none',
  'data-[empty=true]:before:text-block-placeholder',
  'data-[empty=true]:before:cursor-text',
  'data-[empty=true]:before:content-[attr(data-blok-placeholder-active)]',
];

/**
 * Placeholder classes that only show placeholder when element is focused.
 * Uses data-blok-placeholder-active attribute and only displays when element is empty AND focused.
 * Used by paragraph tool.
 */
export const PLACEHOLDER_FOCUS_ONLY_CLASSES: string[] = [
  'empty:focus:before:pointer-events-none',
  'empty:focus:before:text-block-placeholder',
  'empty:focus:before:cursor-text',
  'empty:focus:before:content-[attr(data-blok-placeholder-active)]',
  '[&[data-empty=true]:focus]:before:pointer-events-none',
  '[&[data-empty=true]:focus]:before:text-block-placeholder',
  '[&[data-empty=true]:focus]:before:cursor-text',
  '[&[data-empty=true]:focus]:before:content-[attr(data-blok-placeholder-active)]',
];

/**
 * Placeholder visibility policy — the single vocabulary that selects which
 * class array (and CSS `::before` visibility rule) a consumer wants:
 *
 * - `always`        — visible whenever empty (uses `data-placeholder`)
 * - `always-active` — visible whenever empty (uses `data-blok-placeholder-active`)
 * - `focus`         — visible only when empty AND focused
 */
export type PlaceholderVisibility = 'always' | 'always-active' | 'focus';

/**
 * Resolve the placeholder class array for a given visibility policy.
 *
 * Consolidates the near-duplicate class-array variants behind one vocabulary
 * keyed on {@link PlaceholderVisibility}. The class strings remain literal
 * (Tailwind scans the source for them) — this is the single lookup seam
 * callers use instead of importing the individual constants.
 *
 * @param visibility - when the placeholder should be shown
 * @returns the matching class array
 */
export const getPlaceholderClasses = (visibility: PlaceholderVisibility): string[] => {
  switch (visibility) {
    case 'always-active':
      return PLACEHOLDER_ACTIVE_CLASSES;
    case 'focus':
      return PLACEHOLDER_FOCUS_ONLY_CLASSES;
    case 'always':
    default:
      return PLACEHOLDER_CLASSES;
  }
};

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
 * Roles that support `aria-placeholder` (ARIA 1.2: it is supported only on
 * textbox, searchbox and combobox — it is NOT a global attribute).
 */
const ARIA_PLACEHOLDER_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

/**
 * Whether the host's role permits `aria-placeholder`.
 *
 * `contenteditable` does NOT give an element a textbox role: a `<div>`'s implicit
 * role stays `generic`, which supports no ARIA attributes beyond the globals. So
 * writing `aria-placeholder` onto a contenteditable div (paragraph, list item,
 * heading, quote…) is invalid ARIA — assistive tech ignores it, and it raises a
 * CRITICAL axe `aria-allowed-attr` violation. Only write it where the host
 * actually declares a supporting role, or is a native text input.
 *
 * @param element - the placeholder host
 * @returns true when `aria-placeholder` is a valid attribute on this element
 */
const supportsAriaPlaceholder = (element: HTMLElement): boolean => {
  const role = element.getAttribute('role');

  if (role !== null) {
    return ARIA_PLACEHOLDER_ROLES.has(role.trim().toLowerCase());
  }

  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
};

/**
 * Set up placeholder behavior for a contenteditable element.
 * Adds a focus event listener to position the caret at the start
 * when the element is empty. Does NOT handle caret positioning on
 * input events — doing so would race with the browser's own editing
 * model and destroy content mid-typing (e.g. "Hello world" → "He").
 *
 * @param element - The contenteditable element
 * @param placeholder - Optional placeholder text to set
 * @param attributeName - The attribute name for placeholder text (default: 'data-placeholder')
 * @param visibility - When the placeholder is visible (drives the unified
 *   `data-blok-placeholder-visible` state vocabulary; default: 'always')
 */
export const setupPlaceholder = (
  element: HTMLElement,
  placeholder?: string,
  attributeName: 'data-placeholder' | 'data-blok-placeholder-active' = 'data-placeholder',
  visibility: PlaceholderVisibility = 'always'
): (() => void) => {
  const text = placeholder ?? '';

  // Always set the attribute, even if empty (for consistency and testing)
  element.setAttribute(attributeName, text);

  // Expose the placeholder to assistive tech — the CSS `::before` text is
  // invisible to screen readers, so mirror it onto `aria-placeholder`. Only on
  // hosts whose role supports the attribute; see supportsAriaPlaceholder.
  if (supportsAriaPlaceholder(element)) {
    element.setAttribute('aria-placeholder', text);
  }

  // Single visibility-policy vocabulary shared across every placeholder host.
  element.setAttribute('data-blok-placeholder-visible', visibility);

  const handler = (): void => handleEmptyElement(element);

  element.addEventListener('focus', handler);

  return () => {
    element.removeEventListener('focus', handler);
    element.removeAttribute(attributeName);
    element.removeAttribute('aria-placeholder');
    element.removeAttribute('data-blok-placeholder-visible');
  };
};
