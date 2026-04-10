import type { InlineTool, SanitizerConfig } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { IconStrikethrough } from '../icons';

import {
  isRangeFormatted,
  findFormattingAncestor,
  hasFormattingAncestor,
  collectFormattingAncestors,
  extendRangeToTrailingWhitespace,
} from './utils/formatting-range-utils';

/**
 * Check if an element is a strikethrough tag (<s>)
 * @param element - The element to check
 */
const isStrikethroughTag = (element: Element): boolean => {
  return element.tagName === 'S';
};

/**
 * Strikethrough Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with strikethrough
 */
export class StrikethroughInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Strikethrough';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'strikethrough';

  /**
   * Sanitizer Rule
   * Leave <s> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      s: {},
    } as SanitizerConfig;
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconStrikethrough,
      name: 'strikethrough',
      onActivate: () => {
        this.toggleStrikethrough();
      },
      isActive: () => {
        const selection = window.getSelection();

        return selection ? this.isSelectionVisuallyStrikethrough(selection) : false;
      },
    };
  }

  /**
   * Shortcut for strikethrough tool
   */
  public static shortcut = 'CMD+SHIFT+S';

  /**
   * Apply or remove strikethrough formatting using modern Selection API
   */
  private toggleStrikethrough(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      this.toggleCollapsedStrikethrough(range, selection);

      return;
    }

    const shouldUnwrap = this.isRangeStrikethrough(range, { ignoreWhitespace: true });

    if (shouldUnwrap) {
      this.unwrapStrikethroughTags(range);
    } else {
      this.wrapWithStrikethrough(range);
    }
  }

  /**
   * Handle toggle for collapsed selection (caret)
   * @param range - Current range
   * @param selection - Current selection
   */
  private toggleCollapsedStrikethrough(range: Range, selection: Selection): void {
    const isStrikethrough = this.isRangeStrikethrough(range, { ignoreWhitespace: true });

    if (isStrikethrough) {
      const textNode = document.createTextNode('\u200B');

      range.insertNode(textNode);
      range.selectNode(textNode);
      this.unwrapStrikethroughTags(range);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      const s = document.createElement('s');
      const textNode = document.createTextNode('\u200B');

      s.appendChild(textNode);
      range.insertNode(s);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  }

  /**
   * Check if current selection is within a strikethrough tag
   * @param selection - The Selection object to check
   */
  private isSelectionVisuallyStrikethrough(selection: Selection): boolean {
    if (selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);

    return this.isRangeStrikethrough(range, { ignoreWhitespace: true });
  }

  /**
   * Check if a range contains strikethrough text
   * @param range - The range to check
   * @param options - Options for checking strikethrough status
   */
  private isRangeStrikethrough(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isStrikethroughTag, options);
  }

  /**
   * Wrap selection with <s> tag
   * @param range - The Range object containing the selection to wrap
   */
  private wrapWithStrikethrough(range: Range): void {
    extendRangeToTrailingWhitespace(range);
    const html = this.getRangeHtmlWithoutStrikethrough(range);
    const insertedRange = this.replaceRangeWithHtml(range, `<s>${html}</s>`);
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
        const keepTrailing = node.textContent.endsWith('\u00A0') && this.isEffectivelyLastChild(node);

        node.textContent = node.textContent.replace(/\u00A0/g, ' ');

        if (keepTrailing) {
          node.textContent = node.textContent.slice(0, -1) + '\u00A0';
        }
      }
      node = walker.nextNode();
    }
  }

  /**
   * Check whether all siblings after a node are empty
   */
  private isEffectivelyLastChild(node: Node): boolean {
    const next = node.nextSibling;

    if (!next) {
      return true;
    }

    return (next.textContent ?? '').length === 0 && this.isEffectivelyLastChild(next);
  }

  /**
   * Remove strikethrough tags (<s>) while preserving content
   * @param range - The Range object containing the selection to unwrap
   */
  private unwrapStrikethroughTags(range: Range): void {
    const strikethroughAncestors = this.collectStrikethroughAncestors(range);
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const marker = document.createElement('span');
    const fragment = range.extractContents();

    marker.appendChild(fragment);
    this.removeNestedStrikethrough(marker);

    range.insertNode(marker);

    const markerRange = document.createRange();

    markerRange.selectNodeContents(marker);
    selection.removeAllRanges();
    selection.addRange(markerRange);

    for (; ;) {
      const currentStrikethrough = this.findStrikethroughElement(marker);

      if (!currentStrikethrough) {
        break;
      }

      this.moveMarkerOutOfStrikethrough(marker, currentStrikethrough);
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

    strikethroughAncestors.forEach((element) => {
      if (element.textContent.length === 0) {
        element.remove();
      }
    });
  }

  /**
   * Check if a node or any of its parents is a strikethrough tag
   * @param node - The node to check
   */
  private hasStrikethroughParent(node: Node | null): boolean {
    return hasFormattingAncestor(node, isStrikethroughTag);
  }

  /**
   * Find a strikethrough element in the parent chain
   * @param node - The node to start searching from
   */
  private findStrikethroughElement(node: Node | null): HTMLElement | null {
    return findFormattingAncestor(node, isStrikethroughTag);
  }

  /**
   * Collect all strikethrough ancestor elements within a range
   * @param range - The range to search for strikethrough ancestors
   */
  private collectStrikethroughAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isStrikethroughTag);
  }

  /**
   * Get HTML content of a range with strikethrough tags removed
   * @param range - The range to extract HTML from
   */
  private getRangeHtmlWithoutStrikethrough(range: Range): string {
    const contents = range.cloneContents();

    this.removeNestedStrikethrough(contents);

    const container = document.createElement('div');

    container.appendChild(contents);

    return container.innerHTML;
  }

  /**
   * Remove nested strikethrough tags from a root node
   * @param root - The root node to process
   */
  private removeNestedStrikethrough(root: ParentNode): void {
    const strikethroughNodes = root.querySelectorAll('s');

    strikethroughNodes.forEach((node) => {
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
   * Move a temporary marker element outside of a strikethrough ancestor while preserving content order
   * @param marker - Marker element wrapping the selection contents
   * @param strikethroughElement - Strikethrough ancestor containing the marker
   */
  private moveMarkerOutOfStrikethrough(marker: HTMLElement, strikethroughElement: HTMLElement): void {
    const parent = strikethroughElement.parentNode;

    if (!parent) {
      return;
    }

    // Remove empty text nodes to ensure accurate child count
    Array.from(strikethroughElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length === 0) {
        node.remove();
      }
    });

    const isOnlyChild = strikethroughElement.childNodes.length === 1 && strikethroughElement.firstChild === marker;

    if (isOnlyChild) {
      strikethroughElement.replaceWith(marker);

      return;
    }

    const isFirstChild = strikethroughElement.firstChild === marker;

    if (isFirstChild) {
      parent.insertBefore(marker, strikethroughElement);

      return;
    }

    const isLastChild = strikethroughElement.lastChild === marker;

    if (isLastChild) {
      parent.insertBefore(marker, strikethroughElement.nextSibling);

      return;
    }

    const trailingClone = strikethroughElement.cloneNode(false) as HTMLElement;

    while (marker.nextSibling) {
      trailingClone.appendChild(marker.nextSibling);
    }

    parent.insertBefore(trailingClone, strikethroughElement.nextSibling);
    parent.insertBefore(marker, trailingClone);
  }
}
