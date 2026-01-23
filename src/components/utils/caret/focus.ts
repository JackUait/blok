/**
 * Focus and caret positioning utilities.
 *
 * This module provides functions for setting focus and caret position
 * in contenteditable and native input elements.
 */

import { Dom as $ } from '../../dom';

/**
 * Helper function to create a new text node and set the caret.
 *
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
  const range = document.createRange();

  range.setStart(textNode, 0);
  range.setEnd(textNode, 0);

  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Find deepest text node in the given direction.
 *
 * @param node - starting node
 * @param toStart - search direction
 * @returns The text node found, or null
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
 * Sets selection to the start or end of an element.
 * This is a cross-browser compatible way to position the caret.
 *
 * @param element - The element to set selection in
 * @param atFirstLine - Whether to set at start (true) or end (false)
 */
export const setSelectionToElement = (
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

  const targetNode = atFirstLine ? $.getDeepestNode(element, false) : $.getDeepestNode(element, true);

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
 * Set focus to contenteditable or native input element.
 *
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
   * We need to set focus at start/end to the text node inside an element
   */
  const childNodes = element.childNodes;
  const initialNode: ChildNode | null = atStart
    ? childNodes[0] ?? null
    : childNodes[childNodes.length - 1] ?? null;
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
