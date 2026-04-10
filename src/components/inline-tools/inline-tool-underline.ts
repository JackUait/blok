import type { InlineTool, SanitizerConfig } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { IconUnderline } from '../icons';

import {
  isRangeFormatted,
  findFormattingAncestor,
  hasFormattingAncestor,
  collectFormattingAncestors,
  extendRangeToTrailingWhitespace,
} from './utils/formatting-range-utils';

/**
 * Check if an element is an underline tag (<u>)
 * @param element - The element to check
 */
const isUnderlineTag = (element: Element): boolean => {
  return element.tagName === 'U';
};

/**
 * Underline Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with underline
 */
export class UnderlineInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Underline';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'underline';

  /**
   * Sanitizer Rule
   * Leave <u> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      u: {},
    } as SanitizerConfig;
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconUnderline,
      name: 'underline',
      onActivate: () => {
        this.toggleUnderline();
      },
      isActive: () => {
        const selection = window.getSelection();

        return selection ? this.isSelectionVisuallyUnderline(selection) : false;
      },
    };
  }

  /**
   * Shortcut for underline tool
   */
  public static shortcut = 'CMD+U';

  /**
   * Apply or remove underline formatting using modern Selection API
   */
  private toggleUnderline(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      this.toggleCollapsedUnderline(range, selection);

      return;
    }

    const shouldUnwrap = this.isRangeUnderline(range, { ignoreWhitespace: true });

    if (shouldUnwrap) {
      this.unwrapUnderlineTags(range);
    } else {
      this.wrapWithUnderline(range);
    }
  }

  /**
   * Handle toggle for collapsed selection (caret)
   * @param range - Current range
   * @param selection - Current selection
   */
  private toggleCollapsedUnderline(range: Range, selection: Selection): void {
    const isUnderline = this.isRangeUnderline(range, { ignoreWhitespace: true });

    if (isUnderline) {
      const textNode = document.createTextNode('\u200B');

      range.insertNode(textNode);
      range.selectNode(textNode);
      this.unwrapUnderlineTags(range);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      const u = document.createElement('u');
      const textNode = document.createTextNode('\u200B');

      u.appendChild(textNode);
      range.insertNode(u);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  }

  /**
   * Check if current selection is within an underline tag
   * @param selection - The Selection object to check
   */
  private isSelectionVisuallyUnderline(selection: Selection): boolean {
    if (selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);

    return this.isRangeUnderline(range, { ignoreWhitespace: true });
  }

  /**
   * Check if a range contains underline text
   * @param range - The range to check
   * @param options - Options for checking underline status
   */
  private isRangeUnderline(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isUnderlineTag, options);
  }

  /**
   * Wrap selection with <u> tag
   * @param range - The Range object containing the selection to wrap
   */
  private wrapWithUnderline(range: Range): void {
    extendRangeToTrailingWhitespace(range);
    const html = this.getRangeHtmlWithoutUnderline(range);
    const insertedRange = this.replaceRangeWithHtml(range, `<u>${html}</u>`);
    const selection = window.getSelection();

    if (selection && insertedRange) {
      const wrappedElement = insertedRange.startContainer.childNodes[insertedRange.startOffset] as HTMLElement | undefined;
      const newRange = document.createRange();

      if (wrappedElement) {
        this.normalizeNbspInElement(wrappedElement);
        newRange.selectNodeContents(wrappedElement);
      } else {
        newRange.setStart(insertedRange.startContainer, insertedRange.startOffset);
        newRange.setEnd(insertedRange.endContainer, insertedRange.endOffset);
      }

      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  }

  /**
   * Replace non-breaking spaces (\u00A0) with regular spaces in all text nodes of an element
   * @param element - The element to normalize
   */
  private normalizeNbspInElement(element: HTMLElement): void {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      if (node.textContent?.includes('\u00A0')) {
        node.textContent = node.textContent.replace(/\u00A0/g, ' ');
      }
      node = walker.nextNode();
    }
  }

  /**
   * Remove underline tags (<u>) while preserving content
   * @param range - The Range object containing the selection to unwrap
   */
  private unwrapUnderlineTags(range: Range): void {
    const underlineAncestors = this.collectUnderlineAncestors(range);
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const marker = document.createElement('span');
    const fragment = range.extractContents();

    marker.appendChild(fragment);
    this.removeNestedUnderline(marker);

    range.insertNode(marker);

    const markerRange = document.createRange();

    markerRange.selectNodeContents(marker);
    selection.removeAllRanges();
    selection.addRange(markerRange);

    for (; ;) {
      const currentUnderline = this.findUnderlineElement(marker);

      if (!currentUnderline) {
        break;
      }

      this.moveMarkerOutOfUnderline(marker, currentUnderline);
    }

    const firstChild = marker.firstChild;
    const lastChild = marker.lastChild;

    this.unwrapElement(marker);

    const finalRange = firstChild && lastChild ? (() => {
      const newRange = document.createRange();

      newRange.setStartBefore(firstChild);
      newRange.setEndAfter(lastChild);

      selection.removeAllRanges();
      selection.addRange(newRange);

      return newRange;
    })() : undefined;

    if (!finalRange) {
      selection.removeAllRanges();
    }

    underlineAncestors.forEach((element) => {
      if (element.textContent.length === 0) {
        element.remove();
      }
    });
  }

  /**
   * Check if a node or any of its parents is an underline tag
   * @param node - The node to check
   */
  private hasUnderlineParent(node: Node | null): boolean {
    return hasFormattingAncestor(node, isUnderlineTag);
  }

  /**
   * Find an underline element in the parent chain
   * @param node - The node to start searching from
   */
  private findUnderlineElement(node: Node | null): HTMLElement | null {
    return findFormattingAncestor(node, isUnderlineTag);
  }

  /**
   * Collect all underline ancestor elements within a range
   * @param range - The range to search for underline ancestors
   */
  private collectUnderlineAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isUnderlineTag);
  }

  /**
   * Get HTML content of a range with underline tags removed
   * @param range - The range to extract HTML from
   */
  private getRangeHtmlWithoutUnderline(range: Range): string {
    const contents = range.cloneContents();

    this.removeNestedUnderline(contents);

    const container = document.createElement('div');

    container.appendChild(contents);

    return container.innerHTML;
  }

  /**
   * Remove nested underline tags from a root node
   * @param root - The root node to process
   */
  private removeNestedUnderline(root: ParentNode): void {
    const underlineNodes = root.querySelectorAll('u');

    underlineNodes.forEach((node) => {
      this.unwrapElement(node);
    });
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
   * Replace the current range contents with provided HTML snippet
   * @param range - Range to replace
   * @param html - HTML string to insert
   */
  private replaceRangeWithHtml(range: Range, html: string): Range | undefined {
    const fragment = this.createFragmentFromHtml(html);
    const firstInserted = fragment.firstChild ?? null;
    const lastInserted = fragment.lastChild ?? null;

    range.deleteContents();

    if (!firstInserted || !lastInserted) {
      return;
    }

    range.insertNode(fragment);

    const newRange = document.createRange();

    newRange.setStartBefore(firstInserted);
    newRange.setEndAfter(lastInserted);

    return newRange;
  }

  /**
   * Convert an HTML snippet to a document fragment
   * @param html - HTML string to convert
   */
  private createFragmentFromHtml(html: string): DocumentFragment {
    const template = document.createElement('template');

    template.innerHTML = html;

    return template.content;
  }

  /**
   * Move a temporary marker element outside of an underline ancestor while preserving content order
   * @param marker - Marker element wrapping the selection contents
   * @param underlineElement - Underline ancestor containing the marker
   */
  private moveMarkerOutOfUnderline(marker: HTMLElement, underlineElement: HTMLElement): void {
    const parent = underlineElement.parentNode;

    if (!parent) {
      return;
    }

    // Remove empty text nodes to ensure accurate child count
    Array.from(underlineElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length === 0) {
        node.remove();
      }
    });

    const isOnlyChild = underlineElement.childNodes.length === 1 && underlineElement.firstChild === marker;

    if (isOnlyChild) {
      underlineElement.replaceWith(marker);

      return;
    }

    const isFirstChild = underlineElement.firstChild === marker;

    if (isFirstChild) {
      parent.insertBefore(marker, underlineElement);

      return;
    }

    const isLastChild = underlineElement.lastChild === marker;

    if (isLastChild) {
      parent.insertBefore(marker, underlineElement.nextSibling);

      return;
    }

    const trailingClone = underlineElement.cloneNode(false) as HTMLElement;

    while (marker.nextSibling) {
      trailingClone.appendChild(marker.nextSibling);
    }

    parent.insertBefore(trailingClone, underlineElement.nextSibling);
    parent.insertBefore(marker, trailingClone);
  }
}
