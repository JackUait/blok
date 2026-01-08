import { Dom as $, isCollapsedWhitespaces } from '../dom';

const NBSP_CHAR = '\u00A0';

const whitespaceFollowingRemovedEmptyInline = new WeakSet<Text>();

/**
 * Returns TextNode containing a caret and a caret offset in it
 * Returns null if there is no caret set
 *
 * Handles a case when focusNode is an ElementNode and focusOffset is a child index,
 * returns child node with focusOffset index as a new focusNode
 */
export const getCaretNodeAndOffset = (): [Node | null, number] => {
  const selection = window.getSelection();

  if (selection === null) {
    return [null, 0];
  }

  const initialFocusNode = selection.focusNode;
  const initialFocusOffset = selection.focusOffset;

  if (initialFocusNode === null) {
    return [null, 0];
  }

  /**
   * Case when focusNode is an Element (or Document). In this case, focusOffset is a child index.
   * We need to return child with focusOffset index as a new focusNode.
   *
   * <div>|hello</div> <---- Selection references to <div> instead of text node
   *
   *
   */
  if (initialFocusNode.nodeType === Node.TEXT_NODE || initialFocusNode.childNodes.length === 0) {
    return [initialFocusNode, initialFocusOffset];
  }

  /**
   * In normal cases, focusOffset is a child index.
   */
  const regularChild = initialFocusNode.childNodes[initialFocusOffset];

  if (regularChild !== undefined) {
    return [regularChild, 0];
  }

  /**
   * But in Firefox, focusOffset can be 1 with the single child.
   */
  const fallbackChild = initialFocusNode.childNodes[initialFocusOffset - 1] ?? null;
  const textContent = fallbackChild?.textContent ?? null;

  return [fallbackChild, textContent !== null ? textContent.length : 0];
};

/**
 * Get the current caret offset within a contenteditable element.
 * Returns the number of text characters from the start of the element to the caret.
 * @param input - Optional input element. If not provided, uses the current selection's container.
 * @returns Offset in text characters, or 0 if no selection
 */
export const getCaretOffset = (input?: HTMLElement): number => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return 0;
  }

  const range = selection.getRangeAt(0);

  // If no input provided, try to find the contenteditable ancestor
  const container = input ?? range.startContainer.parentElement?.closest('[contenteditable="true"]');

  if (container === null || container === undefined) {
    return 0;
  }

  // Create a range from start of input to current caret position
  const preCaretRange = document.createRange();

  preCaretRange.selectNodeContents(container);
  preCaretRange.setEnd(range.startContainer, range.startOffset);

  // Get the text length up to the caret
  return preCaretRange.toString().length;
};

const isElementVisuallyEmpty = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if ($.isSingleTag(element) || $.isNativeInput(element)) {
    return false;
  }

  if (element.childNodes.length === 0) {
    return true;
  }

  const textContent = element.textContent ?? '';

  if (textContent.includes(NBSP_CHAR)) {
    return false;
  }

  if (!isCollapsedWhitespaces(textContent)) {
    return false;
  }

  return Array.from(element.children).every((child) => {
    return isElementVisuallyEmpty(child);
  });
};

const inlineRemovalObserver = typeof window !== 'undefined' && typeof window.MutationObserver !== 'undefined'
  ? new window.MutationObserver((records) => {
    for (const record of records) {
      const referenceNextSibling = record.nextSibling;

      record.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }

        if (!isElementVisuallyEmpty(node)) {
          return;
        }

        const candidate = referenceNextSibling instanceof Text ? referenceNextSibling : null;

        if (candidate === null) {
          return;
        }

        if (!candidate.isConnected) {
          return;
        }

        const parentElement = candidate.parentElement;

        if (!(parentElement?.isContentEditable ?? false)) {
          return;
        }

        const firstChar = candidate.textContent?.[0] ?? null;
        const isWhitespace = firstChar === NBSP_CHAR || firstChar === ' ';

        if (!isWhitespace) {
          return;
        }

        whitespaceFollowingRemovedEmptyInline.add(candidate);
      });
    }
  })
  : null;

const observedDocuments = new WeakSet<Document>();

const ensureInlineRemovalObserver = (doc: Document): void => {
  if (inlineRemovalObserver === null || observedDocuments.has(doc)) {
    return;
  }

  const startObserving = (): void => {
    if (doc.body === null) {
      return;
    }

    inlineRemovalObserver.observe(doc.body, {
      childList: true,
      subtree: true,
    });
    observedDocuments.add(doc);
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', startObserving, { once: true });
  } else {
    startObserving();
  }
};

if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
  ensureInlineRemovalObserver(window.document);
}

export const findNbspAfterEmptyInline = (root: HTMLElement): { node: Text; offset: number } | null => {
  ensureInlineRemovalObserver(root.ownerDocument);

  const [caretNode, caretOffset] = getCaretNodeAndOffset();

  if (caretNode === null || !root.contains(caretNode)) {
    return null;
  }

  if (caretNode.nodeType === Node.TEXT_NODE && caretOffset < ((caretNode.textContent ?? '').length)) {
    return null;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  walker.currentNode = caretNode;

  for (; ;) {
    const nextTextNode = walker.nextNode() as Text | null;

    if (nextTextNode === null) {
      return null;
    }

    const textContent = nextTextNode.textContent ?? '';

    if (textContent.length === 0) {
      continue;
    }

    const firstChar = textContent[0];
    const isTargetWhitespace = firstChar === NBSP_CHAR || firstChar === ' ';

    if (!isTargetWhitespace) {
      return null;
    }

    if (nextTextNode === caretNode) {
      return null;
    }

    const pathRange = document.createRange();

    try {
      pathRange.setStart(caretNode, caretOffset);
      pathRange.setEnd(nextTextNode, 0);
    } catch (_error) {
      return null;
    }

    const betweenFragment = pathRange.cloneContents();
    const container = document.createElement('div');

    container.appendChild(betweenFragment);

    const hasEmptyElementBetween = Array.from(container.querySelectorAll('*')).some((element) => {
      const text = element.textContent ?? '';

      return text.length === 0 || isCollapsedWhitespaces(text);
    });

    const wasEmptyInlineRemoved = whitespaceFollowingRemovedEmptyInline.has(nextTextNode);

    if (!hasEmptyElementBetween && !wasEmptyInlineRemoved) {
      continue;
    }

    if (wasEmptyInlineRemoved) {
      whitespaceFollowingRemovedEmptyInline.delete(nextTextNode);
    }

    return {
      node: nextTextNode,
      offset: 0,
    };
  }
};

/**
 * Checks content at left or right of the passed node for emptiness.
 * @param contenteditable - The contenteditable element containing the nodes.
 * @param fromNode - The starting node to check from.
 * @param offsetInsideNode - The offset inside the starting node.
 * @param direction - The direction to check ('left' or 'right').
 * @returns true if adjacent content is empty, false otherwise.
 */
export const checkContenteditableSliceForEmptiness = (contenteditable: HTMLElement, fromNode: Node, offsetInsideNode: number, direction: 'left' | 'right'): boolean => {
  const range = document.createRange();

  /**
   * In case of "left":
   * Set range from the start of the contenteditable to the passed offset
   */
  if (direction === 'left') {
    range.selectNodeContents(contenteditable);
    range.setEnd(fromNode, offsetInsideNode);

    /**
     * In case of "right":
     * Set range from the passed offset to the end of the contenteditable
     */
  } else {
    range.selectNodeContents(contenteditable);
    range.setStart(fromNode, offsetInsideNode);
  }

  /**
   * Clone the range's content and check its text content
   */
  const clonedContent = range.cloneContents();
  const tempDiv = document.createElement('div');

  tempDiv.appendChild(clonedContent);

  const textContent = tempDiv.textContent || '';

  /**
   * Check if we have any tags in the slice
   * We should not ignore them to allow navigation inside (e.g. empty bold tag)
   */
  const hasSignificantTags = tempDiv.querySelectorAll('img, br, hr, input, area, base, col, embed, link, meta, param, source, track, wbr').length > 0;

  if (hasSignificantTags) {
    return false;
  }

  /**
   * Check if there is a non-breaking space,
   * since textContent can replace it with a space
   */
  const hasNbsp = textContent.includes('\u00A0') || tempDiv.innerHTML.includes('&nbsp;') || range.toString().includes('\u00A0');

  /**
   * Check if we have NBSP in the text node itself (if fromNode is text node)
   * This avoids issues with range.toString() normalization
   */
  const isNBSPInTextNode = fromNode.nodeType === Node.TEXT_NODE &&
    (direction === 'left'
      ? (fromNode.textContent || '').slice(0, offsetInsideNode)
      : (fromNode.textContent || '').slice(offsetInsideNode)
    ).includes('\u00A0');

  if (hasNbsp || isNBSPInTextNode) {
    return false;
  }

  /**
   * Check for visual width
   * This helps to detect &nbsp; that might be converted to regular space in textContent but still renders with width
   */
  tempDiv.style.position = 'absolute';
  tempDiv.style.visibility = 'hidden';
  tempDiv.style.height = 'auto';
  tempDiv.style.width = 'auto';
  tempDiv.style.whiteSpace = window.getComputedStyle(contenteditable).whiteSpace;

  document.body.appendChild(tempDiv);
  const width = tempDiv.getBoundingClientRect().width;

  document.body.removeChild(tempDiv);

  if (width > 0) {
    return false;
  }

  /**
   * In HTML there are two types of whitespaces:
   * - visible (&nbsp;)
   * - invisible (trailing spaces, tabs, etc.)
   *
   * If text contains only invisible whitespaces, it is considered to be empty
   */
  if (!isCollapsedWhitespaces(textContent)) {
    return false;
  }

  const style = window.getComputedStyle(contenteditable);
  const isPre = style.whiteSpace.startsWith('pre');

  if (isPre && textContent.length > 0) {
    return false;
  }

  return true;
};

/**
 * Checks if caret is at the start of the passed input
 *
 * Cases:
 * Native input:
 * - if offset is 0, caret is at the start
 * Contenteditable:
 * - caret at the first text node and offset is 0 — caret is at the start
 * - caret not at the first text node — we need to check left siblings for emptiness
 * - caret offset > 0, but all left part is visible (nbsp) — caret is not at the start
 * - caret offset > 0, but all left part is invisible (whitespaces) — caret is at the start
 * @param input - input where caret should be checked
 */
export const isCaretAtStartOfInput = (input: HTMLElement): boolean => {
  const firstNode = $.getDeepestNode(input);

  if (firstNode === null || $.isEmpty(input)) {
    return true;
  }

  /**
   * In case of native input, we simply check if offset is 0
   */
  if ($.isNativeInput(firstNode)) {
    return (firstNode as HTMLInputElement).selectionEnd === 0;
  }

  if ($.isEmpty(input)) {
    return true;
  }

  const [caretNode, caretOffset] = getCaretNodeAndOffset();

  /**
   * If there is no selection, caret is not at the start
   */
  if (caretNode === null) {
    return false;
  }

  /**
   * If caret is inside a nested tag (e.g. <b>), we should let browser handle the navigation
   * to exit the tag first, before moving to the previous block.
   */
  const selection = window.getSelection();
  const focusNode = selection?.focusNode ?? null;

  if (focusNode !== null && focusNode !== input && !(focusNode.nodeType === Node.TEXT_NODE && focusNode.parentNode === input)) {
    return false;
  }

  /**
   * If there is nothing visible to the left of the caret, it is considered to be at the start
   */
  return checkContenteditableSliceForEmptiness(input, caretNode, caretOffset, 'left');
};

/**
 * Checks if caret is at the end of the passed input
 *
 * Cases:
 * Native input:
 * - if offset is equal to value length, caret is at the end
 * Contenteditable:
 * - caret at the last text node and offset is equal to text length — caret is at the end
 * - caret not at the last text node — we need to check right siblings for emptiness
 * - caret offset < text length, but all right part is visible (nbsp) — caret is at the end
 * - caret offset < text length, but all right part is invisible (whitespaces) — caret is at the end
 * @param input - input where caret should be checked
 */
export const isCaretAtEndOfInput = (input: HTMLElement): boolean => {
  const lastNode = $.getDeepestNode(input, true);

  if (lastNode === null) {
    return true;
  }

  /**
   * In case of native input, we simply check if offset is equal to value length
   */
  if ($.isNativeInput(lastNode)) {
    return (lastNode as HTMLInputElement).selectionEnd === (lastNode as HTMLInputElement).value.length;
  }

  const [caretNode, caretOffset] = getCaretNodeAndOffset();

  /**
   * If there is no selection, caret is not at the end
   */
  if (caretNode === null) {
    return false;
  }

  /**
   * If there is nothing visible to the right of the caret, it is considered to be at the end
   */
  return checkContenteditableSliceForEmptiness(input, caretNode, caretOffset, 'right');
};

/**
 * Gets a valid DOMRect for the caret position.
 * Falls back to container element rect or input rect if the caret rect has no dimensions.
 */
const getValidCaretRect = (range: Range, input: HTMLElement): DOMRect => {
  const caretRect = range.getBoundingClientRect();

  if (caretRect.height !== 0 || caretRect.top !== 0) {
    return caretRect;
  }

  const container = range.startContainer;
  const element = container.nodeType === Node.ELEMENT_NODE
    ? container as HTMLElement
    : container.parentElement;

  if (!element) {
    return input.getBoundingClientRect();
  }

  const elementRect = element.getBoundingClientRect();

  if (elementRect.height !== 0 || elementRect.top !== 0) {
    return elementRect;
  }

  return input.getBoundingClientRect();
};

/**
 * Checks if the caret is at the first (top) line of a multi-line input.
 * This is used for Notion-style navigation where Arrow Up should only
 * move to the previous block when the caret can't move up within the current block.
 *
 * @param input - the contenteditable element or native input to check
 * @returns true if caret is at the first line (or input is single-line)
 */
export const isCaretAtFirstLine = (input: HTMLElement): boolean => {
  /**
   * For single-line native inputs, always return true
   */
  if ($.isNativeInput(input) && input.tagName === 'INPUT') {
    return true;
  }

  /**
   * For textarea, check if cursor is before the first newline
   */
  if ($.isNativeInput(input)) {
    const nativeInput = input as HTMLTextAreaElement;
    const selectionStart = nativeInput.selectionStart ?? 0;
    const textBeforeCursor = nativeInput.value.substring(0, selectionStart);

    return !textBeforeCursor.includes('\n');
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return true;
  }

  const range = selection.getRangeAt(0);

  /**
   * Get a valid caret rect, with fallbacks for zero-dimension rects
   */
  const caretRect = getValidCaretRect(range, input);

  /**
   * Get the first line's position by creating a range at the start of the input
   */
  const firstNode = $.getDeepestNode(input, false);

  if (!firstNode) {
    return true;
  }

  const firstLineRange = document.createRange();

  try {
    firstLineRange.setStart(firstNode, 0);
    firstLineRange.setEnd(firstNode, 0);
  } catch {
    return true;
  }

  const firstLineRect = firstLineRange.getBoundingClientRect();

  /**
   * If the first line rect has no dimensions, fall back to input's top
   */
  if (firstLineRect.height === 0 && firstLineRect.top === 0) {
    const inputRect = input.getBoundingClientRect();

    /**
     * Consider caret at first line if it's within the first line height from top
     * Use a threshold based on typical line height
     */
    const lineHeight = parseFloat(window.getComputedStyle(input).lineHeight) || 20;

    return caretRect.top < inputRect.top + lineHeight;
  }

  /**
   * Compare the vertical positions - if caret is on the same line as the first character,
   * they should have similar top values (within a small threshold for rounding)
   */
  const threshold = 5; // pixels tolerance for line comparison

  return Math.abs(caretRect.top - firstLineRect.top) < threshold;
};

/**
 * Checks if the caret is at the last (bottom) line of a multi-line input.
 * This is used for Notion-style navigation where Arrow Down should only
 * move to the next block when the caret can't move down within the current block.
 *
 * @param input - the contenteditable element or native input to check
 * @returns true if caret is at the last line (or input is single-line)
 */
export const isCaretAtLastLine = (input: HTMLElement): boolean => {
  /**
   * For single-line native inputs, always return true
   */
  if ($.isNativeInput(input) && input.tagName === 'INPUT') {
    return true;
  }

  /**
   * For textarea, check if cursor is after the last newline
   */
  if ($.isNativeInput(input)) {
    const nativeInput = input as HTMLTextAreaElement;
    const selectionEnd = nativeInput.selectionEnd ?? nativeInput.value.length;
    const textAfterCursor = nativeInput.value.substring(selectionEnd);

    return !textAfterCursor.includes('\n');
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return true;
  }

  const range = selection.getRangeAt(0);

  /**
   * Get a valid caret rect, with fallbacks for zero-dimension rects
   */
  const caretRect = getValidCaretRect(range, input);

  /**
   * Get the last line's position by creating a range at the end of the input
   */
  const lastNode = $.getDeepestNode(input, true);

  if (!lastNode) {
    return true;
  }

  const lastLineRange = document.createRange();
  const lastNodeLength = $.getContentLength(lastNode);

  try {
    lastLineRange.setStart(lastNode, lastNodeLength);
    lastLineRange.setEnd(lastNode, lastNodeLength);
  } catch {
    return true;
  }

  const lastLineRect = lastLineRange.getBoundingClientRect();

  /**
   * If the last line rect has no dimensions, fall back to input's bottom
   */
  if (lastLineRect.height === 0 && lastLineRect.bottom === 0) {
    const inputRect = input.getBoundingClientRect();

    /**
     * Consider caret at last line if it's within the last line height from bottom
     * Use a threshold based on typical line height
     */
    const lineHeight = parseFloat(window.getComputedStyle(input).lineHeight) || 20;

    return caretRect.bottom > inputRect.bottom - lineHeight;
  }

  /**
   * Compare the vertical positions - if caret is on the same line as the last character,
   * they should have similar bottom values (within a small threshold for rounding)
   */
  const threshold = 5; // pixels tolerance for line comparison

  return Math.abs(caretRect.bottom - lastLineRect.bottom) < threshold;
};

/**
 * Set focus to contenteditable or native input element
 * @param element - element where to set focus
 * @param atStart - where to set focus: at the start or at the end
 */
export const focus = (element: HTMLElement, atStart = true): void => {
  /** If element is native input */
  if ($.isNativeInput(element)) {
    element.focus();
    const position = atStart ? 0 : element.value.length;

    element.setSelectionRange(position, position);

    return;
  }

  /**
   * Focus the contenteditable element to ensure caret is visible.
   * Without focus, the selection range can be set but the caret won't be visible.
   */
  element.focus();

  const range = document.createRange();
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  /**
   * Helper function to create a new text node and set the caret
   * @param parent - parent element to append the text node
   * @param prepend - should the text node be prepended or appended
   */
  const createAndFocusTextNode = (parent: Node, prepend = false): void => {
    const textNode = document.createTextNode('');

    if (prepend) {
      parent.insertBefore(textNode, parent.firstChild);
    } else {
      parent.appendChild(textNode);
    }
    range.setStart(textNode, 0);
    range.setEnd(textNode, 0);
  };

  /**
   * Find deepest text node in the given direction
   * @param node - starting node
   * @param toStart - search direction
   */
  const findTextNode = (node: ChildNode | null, toStart: boolean): ChildNode | null => {
    if (node === null) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return node;
    }

    const nextChild = toStart ? node.firstChild : node.lastChild;

    return findTextNode(nextChild, toStart);
  };

  /**
   * We need to set focus at start/end to the text node inside an element
   */
  const childNodes = element.childNodes;
  const initialNode: ChildNode | null = atStart ? childNodes[0] ?? null : childNodes[childNodes.length - 1] ?? null;
  const nodeToFocus = findTextNode(initialNode, atStart);

  /**
   * If the element is empty, create a text node and place the caret at the start
   */
  if (initialNode === null) {
    createAndFocusTextNode(element);
    selection.removeAllRanges();
    selection.addRange(range);

    return;
  }

  /**
   * If no text node is found, create one and set focus
   */
  if (nodeToFocus === null || nodeToFocus.nodeType !== Node.TEXT_NODE) {
    createAndFocusTextNode(element, atStart);
    selection.removeAllRanges();
    selection.addRange(range);

    return;
  }

  /**
   * If a text node is found, place the caret
   */
  const length = nodeToFocus.textContent?.length ?? 0;
  const position = atStart ? 0 : length;

  range.setStart(nodeToFocus, position);
  range.setEnd(nodeToFocus, position);

  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Gets the current caret's X coordinate (horizontal position).
 * Used for Notion-style navigation to preserve horizontal position when moving between blocks.
 * @returns The X coordinate of the caret, or null if no selection exists
 */
export const getCaretXPosition = (): number | null => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  /**
   * If the range has valid dimensions, return the left position
   */
  const hasValidDimensions = rect.width !== 0 || rect.height !== 0 || rect.x !== 0;

  if (hasValidDimensions) {
    return rect.left;
  }

  /**
   * If the range has no dimensions (e.g., collapsed at start of empty element),
   * try to get position from the container element
   */
  const container = range.startContainer;
  const element = container.nodeType === Node.ELEMENT_NODE
    ? container as HTMLElement
    : container.parentElement;

  if (!element) {
    return null;
  }

  const elementRect = element.getBoundingClientRect();

  return elementRect.left;
};

/**
 * Sets the caret position in an element at the closest position to the target X coordinate.
 * This is used for Notion-style navigation to preserve horizontal position when moving between blocks.
 * @param element - The contenteditable element or native input to set caret in
 * @param targetX - The target X coordinate to match
 * @param atFirstLine - If true, place caret on the first line; if false, place on the last line
 */
export const setCaretAtXPosition = (element: HTMLElement, targetX: number, atFirstLine: boolean): void => {
  /**
   * For native inputs, we need to find the character position that best matches the X coordinate
   */
  if ($.isNativeInput(element)) {
    setCaretAtXPositionInNativeInput(element as HTMLInputElement | HTMLTextAreaElement, targetX, atFirstLine);

    return;
  }

  setCaretAtXPositionInContentEditable(element, targetX, atFirstLine);
};

/**
 * Sets caret position in a native input element at the closest position to target X
 */
const setCaretAtXPositionInNativeInput = (
  input: HTMLInputElement | HTMLTextAreaElement,
  targetX: number,
  atFirstLine: boolean
): void => {
  input.focus();

  const value = input.value;

  if (value.length === 0) {
    input.setSelectionRange(0, 0);

    return;
  }

  /**
   * For textareas with multiple lines, find the target line first
   */
  if (input.tagName === 'TEXTAREA') {
    const lines = value.split('\n');
    const targetLineIndex = atFirstLine ? 0 : lines.length - 1;
    const charOffset = lines.slice(0, targetLineIndex).reduce((acc, line) => acc + line.length + 1, 0);

    const lineStart = charOffset;
    const lineEnd = charOffset + lines[targetLineIndex].length;

    /**
     * Binary search to find the best position within the line
     */
    const bestPosition = findBestPositionInRange(input, lineStart, lineEnd, targetX);

    input.setSelectionRange(bestPosition, bestPosition);

    return;
  }

  /**
   * For single-line inputs, search the entire value
   */
  const bestPosition = findBestPositionInRange(input, 0, value.length, targetX);

  input.setSelectionRange(bestPosition, bestPosition);
};

/**
 * Binary search to find the character position closest to target X in a native input
 */
const findBestPositionInRange = (
  input: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  targetX: number
): number => {
  /**
   * Create a temporary span to measure character positions
   * This is a workaround since native inputs don't expose character positions directly
   */
  const inputRect = input.getBoundingClientRect();
  const style = window.getComputedStyle(input);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;

  /**
   * For native inputs, we approximate position based on character width
   * This is not perfect but provides reasonable behavior
   */
  const relativeX = targetX - inputRect.left - paddingLeft;

  if (relativeX <= 0) {
    return start;
  }

  /**
   * Estimate character width and find approximate position
   */
  const text = input.value.substring(start, end);
  const fontSize = parseFloat(style.fontSize) || 16;
  const avgCharWidth = fontSize * 0.6; // Approximate average character width

  const estimatedPosition = Math.round(relativeX / avgCharWidth);
  const clampedPosition = Math.min(Math.max(estimatedPosition, 0), text.length);

  return start + clampedPosition;
};

/**
 * Sets caret position in a contenteditable element at the closest position to target X
 */
const setCaretAtXPositionInContentEditable = (
  element: HTMLElement,
  targetX: number,
  atFirstLine: boolean
): void => {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  /**
   * Focus the element first to ensure it can receive a selection.
   */
  element.focus();

  /**
   * Get the target line's Y position
   */
  const targetNode = atFirstLine
    ? $.getDeepestNode(element, false)
    : $.getDeepestNode(element, true);

  if (!targetNode) {
    setSelectionToElement(element, selection, atFirstLine);

    return;
  }

  /**
   * Use document.caretPositionFromPoint or document.caretRangeFromPoint
   * to find the position closest to the target X coordinate
   */
  const targetY = getTargetYPosition(element, targetNode, atFirstLine);

  if (targetY === null) {
    setSelectionToElement(element, selection, atFirstLine);

    return;
  }

  /**
   * Try to use caretPositionFromPoint (standard) or caretRangeFromPoint (WebKit)
   */
  const caretPosition = getCaretPositionFromPoint(targetX, targetY);

  /**
   * Verify that the returned caret position is actually inside the target element.
   * In Firefox, caretPositionFromPoint can return nodes outside the element
   * (e.g., sibling elements like list markers) when the X coordinate is at the edge.
   */
  if (caretPosition && element.contains(caretPosition.node)) {
    const range = document.createRange();

    try {
      range.setStart(caretPosition.node, caretPosition.offset);
      range.setEnd(caretPosition.node, caretPosition.offset);
      selection.removeAllRanges();
      selection.addRange(range);

      return;
    } catch {
      // Fall through to fallback
    }
  }

  /**
   * Fallback: set selection to start or end of element
   */
  setSelectionToElement(element, selection, atFirstLine);
};

/**
 * Sets selection to the start or end of an element.
 * This is a cross-browser compatible way to position the caret.
 */
const setSelectionToElement = (
  element: HTMLElement,
  _selection: Selection,
  atFirstLine: boolean
): void => {
  /**
   * Firefox and WebKit require the element to have focus before
   * a selection can be set on it. We must also get a fresh Selection
   * object AFTER focusing, as the pre-focus Selection may not work
   * with the newly focused element in Firefox.
   */
  element.focus();

  const freshSelection = window.getSelection();

  if (!freshSelection) {
    return;
  }

  const targetNode = atFirstLine
    ? $.getDeepestNode(element, false)
    : $.getDeepestNode(element, true);

  if (!targetNode) {
    return;
  }

  const range = document.createRange();
  const offset = atFirstLine ? 0 : $.getContentLength(targetNode);

  try {
    range.setStart(targetNode, offset);
    range.setEnd(targetNode, offset);
    freshSelection.removeAllRanges();
    freshSelection.addRange(range);
  } catch {
    // If setting range fails, use the focus utility which handles edge cases
    focus(element, atFirstLine);
  }
};

/**
 * Gets the Y coordinate for the target line (first or last)
 */
const getTargetYPosition = (element: HTMLElement, targetNode: Node, atFirstLine: boolean): number | null => {
  const range = document.createRange();

  try {
    if (atFirstLine) {
      range.setStart(targetNode, 0);
      range.setEnd(targetNode, 0);
    } else {
      const length = $.getContentLength(targetNode);

      range.setStart(targetNode, length);
      range.setEnd(targetNode, length);
    }

    const rect = range.getBoundingClientRect();

    if (rect.height === 0 && rect.top === 0) {
      const elementRect = element.getBoundingClientRect();

      return atFirstLine ? elementRect.top + 10 : elementRect.bottom - 10;
    }

    /**
     * Return the vertical center of the line
     */
    return rect.top + rect.height / 2;
  } catch {
    return null;
  }
};

/**
 * Gets caret position from screen coordinates using browser APIs.
 * Uses the standard caretPositionFromPoint API which is now widely supported.
 */
const getCaretPositionFromPoint = (x: number, y: number): { node: Node; offset: number } | null => {
  const caretPosition = document.caretPositionFromPoint(x, y);

  if (caretPosition === null) {
    return null;
  }

  return {
    node: caretPosition.offsetNode,
    offset: caretPosition.offset,
  };
};
