/**
 * Selection and caret reading utilities.
 *
 * This module provides functions for reading the current selection/caret state
 * from the DOM. It is the foundation for other caret utilities.
 */

import { Dom } from '../../dom';

/**
 * Returns TextNode containing a caret and a caret offset in it.
 * Returns null if there is no caret set.
 *
 * Handles a case when focusNode is an ElementNode and focusOffset is a child index,
 * returns child node with focusOffset index as a new focusNode.
 *
 * @returns Tuple of [node, offset] or [null, 0] if no selection
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
 *
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

/**
 * Length of the text in `input` before a point inside it.
 * @param input - the editable that holds the point
 * @param node - the point's node
 * @param offset - the point's offset in that node
 */
export const textOffsetOf = (input: HTMLElement, node: Node, offset: number): number => {
  const range = document.createRange();

  range.selectNodeContents(input);
  range.setEnd(node, offset);

  return range.toString().length;
};

/**
 * A range over the text of `input` between two text offsets, clamped to its
 * length. An offset at a node edge resolves to the end of the earlier node.
 * @param input - the editable
 * @param start - text offset of the start
 * @param end - text offset of the end
 */
export const rangeAtTextOffsets = (input: HTMLElement, start: number, end: number): Range => {
  const from = Dom.getNodeByOffset(input, start);
  const to = Dom.getNodeByOffset(input, end);
  const range = document.createRange();

  range.selectNodeContents(input);
  range.collapse(false);
  if (from.node !== null && to.node !== null) {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  }

  return range;
};
