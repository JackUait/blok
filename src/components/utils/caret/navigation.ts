/**
 * X-position navigation utilities.
 *
 * This module provides functions for Notion-style navigation where
 * horizontal position is preserved when moving between blocks.
 */

import { Dom as $ } from '../../dom';

import { setSelectionToElement } from './focus';

/**
 * Gets the Y coordinate for the target line (first or last).
 *
 * @param element - The element containing the target line
 * @param targetNode - The target node
 * @param atFirstLine - Whether targeting first line (true) or last line (false)
 * @returns The Y coordinate, or null if unable to determine
 */
export const getTargetYPosition = (
  element: HTMLElement,
  targetNode: Node,
  atFirstLine: boolean
): number | null => {
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

    // Check if getBoundingClientRect is available (may not be in jsdom)
    if (typeof range.getBoundingClientRect !== 'function') {
      const elementRect = element.getBoundingClientRect();

      return atFirstLine ? elementRect.top + 10 : elementRect.bottom - 10;
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
 *
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Object with node and offset, or null if unable to determine
 */
export const getCaretPositionFromPoint = (
  x: number,
  y: number
): { node: Node; offset: number } | null => {
  // Check if caretPositionFromPoint is available (may not be in jsdom)
  if (typeof document.caretPositionFromPoint !== 'function') {
    return null;
  }

  const caretPosition = document.caretPositionFromPoint(x, y);

  if (caretPosition === null) {
    return null;
  }

  return {
    node: caretPosition.offsetNode,
    offset: caretPosition.offset,
  };
};

/**
 * Sets caret position in a contenteditable element at the closest position to target X.
 *
 * @param element - The contenteditable element
 * @param targetX - The target X coordinate
 * @param atFirstLine - If true, place on first line; if false, place on last line
 */
export const setCaretAtXPositionInContentEditable = (
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
  const targetNode = atFirstLine ? $.getDeepestNode(element, false) : $.getDeepestNode(element, true);

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
 * Binary search to find the character position closest to target X in a native input.
 *
 * @param input - The native input element
 * @param start - Start position for search
 * @param end - End position for search
 * @param targetX - The target X coordinate
 * @returns The best character position
 */
export const findBestPositionInRange = (
  input: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  targetX: number
): number => {
  /**
   * For native inputs, we approximate position based on character width
   * This is not perfect but provides reasonable behavior
   */
  const inputRect = input.getBoundingClientRect();
  const style = window.getComputedStyle(input);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;

  /**
   * For native inputs, we approximate position based on character width
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
 * Sets caret position in a native input element at the closest position to target X.
 *
 * @param input - The native input element
 * @param targetX - The target X coordinate
 * @param atFirstLine - If true, place on first line; if false, place on last line
 */
export const setCaretAtXPositionInNativeInput = (
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
 * Sets the caret position in an element at the closest position to the target X coordinate.
 * This is used for Notion-style navigation to preserve horizontal position when moving between blocks.
 *
 * @param element - The contenteditable element or native input to set caret in
 * @param targetX - The target X coordinate to match
 * @param atFirstLine - If true, place caret on the first line; if false, place on the last line
 */
export const setCaretAtXPosition = (element: HTMLElement, targetX: number, atFirstLine: boolean): void => {
  /**
   * For native inputs, we need to find the character position that best matches the X coordinate
   */
  if ($.isNativeInput(element)) {
    setCaretAtXPositionInNativeInput(element, targetX, atFirstLine);

    return;
  }

  setCaretAtXPositionInContentEditable(element, targetX, atFirstLine);
};

/**
 * Gets the current caret's X coordinate (horizontal position).
 * Used for Notion-style navigation to preserve horizontal position when moving between blocks.
 *
 * @returns The X coordinate of the caret, or null if no selection exists
 */
export const getCaretXPosition = (): number | null => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);

  /**
   * If the range has no dimensions (e.g., collapsed at start of empty element),
   * try to get position from the container element
   */
  const container = range.startContainer;
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as HTMLElement)
      : container.parentElement;

  if (!element) {
    return null;
  }

  // Check if getBoundingClientRect is available (may not be in jsdom)
  if (typeof range.getBoundingClientRect !== 'function') {
    const elementRect = element.getBoundingClientRect();

    return elementRect.left;
  }

  const rect = range.getBoundingClientRect();

  /**
   * If the range has valid dimensions, return the left position
   */
  const hasValidDimensions = rect.width !== 0 || rect.height !== 0 || rect.x !== 0;

  if (hasValidDimensions) {
    return rect.left;
  }

  const elementRect = element.getBoundingClientRect();

  return elementRect.left;
};
