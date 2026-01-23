/**
 * Line position detection utilities.
 *
 * This module provides functions for detecting if the caret is on the
 * first or last line of a multi-line input.
 */

import { Dom as $ } from '../../dom';

/**
 * Gets a valid DOMRect for the caret position.
 * Falls back to container element rect or input rect if the caret rect has no dimensions.
 *
 * @param range - The range to get the rect from
 * @param input - The input element for fallback
 * @returns A valid DOMRect with dimensions
 */
export const getValidCaretRect = (range: Range, input: HTMLElement): DOMRect => {
  const caretRect = range.getBoundingClientRect();

  if (caretRect.height !== 0 || caretRect.top !== 0) {
    return caretRect;
  }

  const container = range.startContainer;
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as HTMLElement)
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
