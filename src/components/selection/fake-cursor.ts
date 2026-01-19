import { DATA_ATTR, createSelector } from '../constants';
import { Dom as $ } from '../dom';

import { SelectionCore } from './core';

/**
 * Fake cursor management utilities.
 */
export class SelectionFakeCursor {
  /**
   * Adds fake cursor to the current range
   */
  static addFakeCursor(): void {
    const range = SelectionCore.getRange();

    if (range === null) {
      return;
    }

    const fakeCursor = $.make('span');

    fakeCursor.setAttribute(DATA_ATTR.fakeCursor, '');
    fakeCursor.setAttribute('data-blok-mutation-free', 'true');

    range.collapse();
    range.insertNode(fakeCursor);
  }

  /**
   * Check if passed element contains a fake cursor
   * @param el - where to check
   */
  static isFakeCursorInsideContainer(el: HTMLElement): boolean {
    return $.find(el, createSelector(DATA_ATTR.fakeCursor)) !== null;
  }

  /**
   * Removes fake cursor from a container
   * @param container - container to look for
   */
  static removeFakeCursor(container: HTMLElement = document.body): void {
    const fakeCursor = $.find(container, createSelector(DATA_ATTR.fakeCursor));

    if (!fakeCursor) {
      return;
    }

    fakeCursor.remove();
  }
}
