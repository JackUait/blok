import type { InlineTool, SanitizerConfig } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { IconClearFormat } from '../icons';

import {
  findFormattingAncestor,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';

/**
 * Inline formatting tags this tool strips. Links are deliberately kept —
 * clearing format should not destroy a URL the user pasted.
 */
const FORMATTING_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'MARK']);

const FORMATTING_SELECTOR = 'b, strong, i, em, u, s, strike, del, code, mark';

/**
 * Check if an element is one of the formatting tags this tool clears
 * @param element - The element to check
 */
const isFormattingTag = (element: Element): boolean => {
  return FORMATTING_TAGS.has(element.tagName);
};

/**
 * Clear Format Inline Tool
 *
 * Removes inline formatting (bold, italic, underline, strikethrough,
 * inline code, highlight) from the selection while keeping links.
 */
export class ClearFormatInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Clear formatting';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'clearFormat';

  /**
   * Shortcut for the tool
   */
  public static shortcut = 'CMD+BACKSLASH';

  /**
   * This tool introduces no tags of its own
   */
  public static get sanitize(): SanitizerConfig {
    return {};
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconClearFormat,
      name: 'clearFormat',
      onActivate: () => {
        this.clearFormatting();
      },
      isActive: () => false,
    };
  }

  /**
   * Strip formatting tags from the current selection
   */
  private clearFormatting(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      return;
    }

    const ancestors = collectFormattingAncestors(range, isFormattingTag);
    const marker = document.createElement('span');
    const fragment = range.extractContents();

    marker.appendChild(fragment);
    this.unwrapFormattingDescendants(marker);

    range.insertNode(marker);

    for (; ;) {
      const formattingAncestor = findFormattingAncestor(marker, isFormattingTag);

      if (!formattingAncestor) {
        break;
      }

      this.moveMarkerOut(marker, formattingAncestor);
    }

    const firstChild = marker.firstChild;
    const lastChild = marker.lastChild;

    this.unwrapElement(marker);

    if (firstChild && lastChild) {
      const newRange = document.createRange();

      newRange.setStartBefore(firstChild);
      newRange.setEndAfter(lastChild);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      selection.removeAllRanges();
    }

    ancestors.forEach((element) => {
      if (element.textContent.length === 0) {
        element.remove();
      }
    });
  }

  /**
   * Unwrap every formatting descendant of a root node
   * @param root - The root node to process
   */
  private unwrapFormattingDescendants(root: ParentNode): void {
    for (; ;) {
      const formatted = root.querySelector(FORMATTING_SELECTOR);

      if (!formatted) {
        break;
      }

      this.unwrapElement(formatted);
    }
  }

  /**
   * Unwrap an element by moving its children to the parent
   * @param element - The element to unwrap
   */
  private unwrapElement(element: Element): void {
    const parent = element.parentNode;

    if (!parent) {
      element.remove();

      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  }

  /**
   * Move a temporary marker outside a formatting ancestor, splitting it when
   * the marker sits in the middle
   * @param marker - Marker element wrapping the selection contents
   * @param ancestor - Formatting ancestor containing the marker
   */
  private moveMarkerOut(marker: HTMLElement, ancestor: HTMLElement): void {
    const parent = ancestor.parentNode;

    if (!parent) {
      return;
    }

    Array.from(ancestor.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length === 0) {
        node.remove();
      }
    });

    const isOnlyChild = ancestor.childNodes.length === 1 && ancestor.firstChild === marker;

    if (isOnlyChild) {
      ancestor.replaceWith(marker);

      return;
    }

    if (ancestor.firstChild === marker) {
      parent.insertBefore(marker, ancestor);

      return;
    }

    if (ancestor.lastChild === marker) {
      parent.insertBefore(marker, ancestor.nextSibling);

      return;
    }

    const trailingClone = ancestor.cloneNode(false) as HTMLElement;

    while (marker.nextSibling) {
      trailingClone.appendChild(marker.nextSibling);
    }

    parent.insertBefore(trailingClone, ancestor.nextSibling);
    parent.insertBefore(marker, trailingClone);
  }
}
