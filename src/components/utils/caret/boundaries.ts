/**
 * Caret boundary detection utilities.
 *
 * This module provides functions for detecting if the caret is at the
 * start or end of an input element.
 */

import { Dom as $, isCollapsedWhitespaces } from '../../dom';

import { getCaretNodeAndOffset } from './selection';

/**
 * Checks content at left or right of the passed node for emptiness.
 *
 * @param contenteditable - The contenteditable element containing the nodes.
 * @param fromNode - The starting node to check from.
 * @param offsetInsideNode - The offset inside the starting node.
 * @param direction - The direction to check ('left' or 'right').
 * @returns true if adjacent content is empty, false otherwise.
 */
export const checkContenteditableSliceForEmptiness = (
  contenteditable: HTMLElement,
  fromNode: Node,
  offsetInsideNode: number,
  direction: 'left' | 'right'
): boolean => {
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
  const hasSignificantTags = tempDiv.querySelectorAll(
    'img, br, hr, input, area, base, col, embed, link, meta, param, source, track, wbr'
  ).length > 0;

  if (hasSignificantTags) {
    return false;
  }

  /**
   * Check if there is a non-breaking space,
   * since textContent can replace it with a space
   */
  const hasNbsp =
    textContent.includes('\u00A0') ||
    tempDiv.innerHTML.includes('&nbsp;') ||
    range.toString().includes('\u00A0');

  /**
   * Check if we have NBSP in the text node itself (if fromNode is text node)
   * This avoids issues with range.toString() normalization
   */
  const isNBSPInTextNode =
    fromNode.nodeType === Node.TEXT_NODE &&
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
 * Checks if caret is at the start of the passed input.
 *
 * Cases:
 * Native input:
 * - if offset is 0, caret is at the start
 * Contenteditable:
 * - caret at the first text node and offset is 0 — caret is at the start
 * - caret not at the first text node — we need to check left siblings for emptiness
 * - caret offset > 0, but all left part is visible (nbsp) — caret is not at the start
 * - caret offset > 0, but all left part is invisible (whitespaces) — caret is at the start
 *
 * @param input - input where caret should be checked
 * @returns true if caret is at the start of the input
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

  if (
    focusNode !== null &&
    focusNode !== input &&
    !(focusNode.nodeType === Node.TEXT_NODE && focusNode.parentNode === input)
  ) {
    return false;
  }

  /**
   * If there is nothing visible to the left of the caret, it is considered to be at the start
   */
  return checkContenteditableSliceForEmptiness(input, caretNode, caretOffset, 'left');
};

/**
 * Checks if caret is at the end of the passed input.
 *
 * Cases:
 * Native input:
 * - if offset is equal to value length, caret is at the end
 * Contenteditable:
 * - caret at the last text node and offset is equal to text length — caret is at the end
 * - caret not at the last text node — we need to check right siblings for emptiness
 * - caret offset < text length, but all right part is visible (nbsp) — caret is at the end
 * - caret offset < text length, but all right part is invisible (whitespaces) — caret is at the end
 *
 * @param input - input where caret should be checked
 * @returns true if caret is at the end of the input
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
