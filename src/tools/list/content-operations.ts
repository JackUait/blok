/**
 * Content Operations - Pure utilities for content manipulation.
 *
 * These functions are extracted from ListItem for testability.
 * They are pure functions that operate on DOM elements without side effects.
 */

/**
 * Result of splitting content at cursor position
 */
export interface SplitContentResult {
  /** Content before the cursor */
  beforeContent: string;
  /** Content after the cursor */
  afterContent: string;
}

/**
 * Split content element's HTML at the cursor position.
 *
 * @param contentEl - The contenteditable element containing text
 * @param range - The current selection range
 * @returns Object with before/after HTML content
 */
export function splitContentAtCursor(contentEl: HTMLElement, range: Range): SplitContentResult {
  const beforeRange = document.createRange();
  beforeRange.setStart(contentEl, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  // Handle empty content - return empty strings
  if (!contentEl.lastChild) {
    return {
      beforeContent: '',
      afterContent: '',
    };
  }

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEndAfter(contentEl.lastChild);

  return {
    beforeContent: fragmentToHTML(beforeRange.cloneContents()),
    afterContent: fragmentToHTML(afterRange.cloneContents()),
  };
}

/**
 * Convert a DocumentFragment to HTML string.
 *
 * @param fragment - The fragment to convert
 * @returns HTML string representation
 */
export function fragmentToHTML(fragment: DocumentFragment): string {
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
}

/**
 * Parse HTML string into a DocumentFragment.
 *
 * @param html - HTML string to parse
 * @returns DocumentFragment with parsed nodes
 */
export function parseHTML(html: string): DocumentFragment {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();

  const fragment = document.createDocumentFragment();
  fragment.append(...Array.from(wrapper.childNodes));

  return fragment;
}

/**
 * Check if the cursor is at the start of an element.
 *
 * @param element - The element to check
 * @param range - The current selection range
 * @returns true if cursor is at the start
 */
export function isAtStart(element: HTMLElement, range: Range): boolean {
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  return preCaretRange.toString().length === 0;
}

/**
 * Check if the entire content of an element is selected.
 *
 * @param element - The content element to check
 * @param range - The current selection range
 * @returns true if the entire content is selected
 */
export function isEntireContentSelected(element: HTMLElement, range: Range): boolean {
  // Check if selection starts at the beginning
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  const isAtStart = preCaretRange.toString().length === 0;

  // Check if selection ends at the end
  const postCaretRange = document.createRange();
  postCaretRange.selectNodeContents(element);
  postCaretRange.setStart(range.endContainer, range.endOffset);
  const isAtEnd = postCaretRange.toString().length === 0;

  return isAtStart && isAtEnd;
}
