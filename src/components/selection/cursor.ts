import { Dom as $ } from '../dom';

import { SelectionCore } from './core';

/**
 * Cursor positioning utilities.
 * Mostly stateless functions.
 */
export class SelectionCursor {
  /**
   * Set focus to contenteditable or native input element
   * @param element - element where to set focus
   * @param offset - offset of cursor
   */
  static setCursor(element: HTMLElement, offset = 0): DOMRect {
    const range = document.createRange();
    const selection = window.getSelection();

    const isNativeInput = $.isNativeInput(element);

    if (isNativeInput && !$.canSetCaret(element)) {
      return element.getBoundingClientRect();
    }

    if (isNativeInput) {
       
      element.focus();
      // eslint-disable-next-line no-param-reassign
      element.selectionStart = offset;
      // eslint-disable-next-line no-param-reassign
      element.selectionEnd = offset;

      return element.getBoundingClientRect();
    }

    range.setStart(element, offset);
    range.setEnd(element, offset);

    if (!selection) {
      return element.getBoundingClientRect();
    }

    selection.removeAllRanges();
    selection.addRange(range);

    return range.getBoundingClientRect();
  }

  /**
   * Check if current range exists and belongs to container
   * @param container - where range should be
   */
  static isRangeInsideContainer(container: HTMLElement): boolean {
    const range = SelectionCore.getRange();

    if (range === null) {
      return false;
    }

    return container.contains(range.startContainer);
  }

  /**
   * Collapse current selection to end of focus node
   */
  static collapseToEnd(): void {
    const sel = window.getSelection();

    if (!sel || !sel.focusNode) {
      return;
    }

    const range = document.createRange();

    range.selectNodeContents(sel.focusNode);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
