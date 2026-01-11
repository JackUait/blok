import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconItalic } from '../icons';
import type { MenuConfig } from '../../../types/tools';
import {
  isRangeFormatted,
  findFormattingAncestor,
  hasFormattingAncestor,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';

/**
 * Check if an element is an italic tag (<i> or <em>)
 * @param element - The element to check
 */
const isItalicTag = (element: Element): boolean => {
  const tag = element.tagName;

  return tag === 'I' || tag === 'EM';
};

/**
 * Italic Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with italic
 */
export class ItalicInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Italic';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'italic';

  /**
   * Sanitizer Rule
   * Leave <i> and <em> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      i: {},
      em: {},
    } as SanitizerConfig;
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconItalic,
      name: 'italic',
      onActivate: () => {
        this.toggleItalic();
      },
      isActive: () => {
        const selection = window.getSelection();

        return selection ? this.isSelectionVisuallyItalic(selection) : false;
      },
    };
  }

  /**
   * Shortcut for italic tool
   */
  public static shortcut = 'CMD+I';

  /**
   * Apply or remove italic formatting using modern Selection API
   */
  private toggleItalic(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      this.toggleCollapsedItalic(range, selection);

      return;
    }

    const shouldUnwrap = this.isRangeItalic(range, { ignoreWhitespace: true });

    if (shouldUnwrap) {
      this.unwrapItalicTags(range);
    } else {
      this.wrapWithItalic(range);
    }
  }

  /**
   * Handle toggle for collapsed selection (caret)
   * @param range - Current range
   * @param selection - Current selection
   */
  private toggleCollapsedItalic(range: Range, selection: Selection): void {
    const isItalic = this.isRangeItalic(range, { ignoreWhitespace: true });

    if (isItalic) {
      const textNode = document.createTextNode('\u200B');

      range.insertNode(textNode);
      range.selectNode(textNode);
      this.unwrapItalicTags(range);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      const i = document.createElement('i');
      const textNode = document.createTextNode('\u200B');

      i.appendChild(textNode);
      range.insertNode(i);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  }

  /**
   * Check if current selection is within an italic tag
   * @param selection - The Selection object to check
   */
  private isSelectionVisuallyItalic(selection: Selection): boolean {
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);

    return this.isRangeItalic(range, { ignoreWhitespace: true });
  }

  /**
   * Check if a range contains italic text
   * @param range - The range to check
   * @param options - Options for checking italic status
   */
  private isRangeItalic(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isItalicTag, options);
  }

  /**
   * Wrap selection with <i> tag
   * @param range - The Range object containing the selection to wrap
   */
  private wrapWithItalic(range: Range): void {
    const html = this.getRangeHtmlWithoutItalic(range);
    const insertedRange = this.replaceRangeWithHtml(range, `<i>${html}</i>`);
    const selection = window.getSelection();

    if (selection && insertedRange) {
      selection.removeAllRanges();
      selection.addRange(insertedRange);
    }
  }

  /**
   * Remove italic tags (<i>/<em>) while preserving content
   * @param range - The Range object containing the selection to unwrap
   */
  private unwrapItalicTags(range: Range): void {
    const italicAncestors = this.collectItalicAncestors(range);
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const marker = document.createElement('span');
    const fragment = range.extractContents();

    marker.appendChild(fragment);
    this.removeNestedItalic(marker);

    range.insertNode(marker);

    const markerRange = document.createRange();

    markerRange.selectNodeContents(marker);
    selection.removeAllRanges();
    selection.addRange(markerRange);

    for (; ;) {
      const currentItalic = this.findItalicElement(marker);

      if (!currentItalic) {
        break;
      }

      this.moveMarkerOutOfItalic(marker, currentItalic);
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

    italicAncestors.forEach((element) => {
      if ((element.textContent ?? '').length === 0) {
        element.remove();
      }
    });
  }

  /**
   * Check if a node or any of its parents is an italic tag
   * @param node - The node to check
   */
  private hasItalicParent(node: Node | null): boolean {
    return hasFormattingAncestor(node, isItalicTag);
  }

  /**
   * Find an italic element in the parent chain
   * @param node - The node to start searching from
   */
  private findItalicElement(node: Node | null): HTMLElement | null {
    return findFormattingAncestor(node, isItalicTag);
  }

  /**
   * Collect all italic ancestor elements within a range
   * @param range - The range to search for italic ancestors
   */
  private collectItalicAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isItalicTag);
  }

  /**
   * Get HTML content of a range with italic tags removed
   * @param range - The range to extract HTML from
   */
  private getRangeHtmlWithoutItalic(range: Range): string {
    const contents = range.cloneContents();

    this.removeNestedItalic(contents);

    const container = document.createElement('div');

    container.appendChild(contents);

    return container.innerHTML;
  }

  /**
   * Remove nested italic tags from a root node
   * @param root - The root node to process
   */
  private removeNestedItalic(root: ParentNode): void {
    const italicNodes = root.querySelectorAll?.('i,em');

    if (!italicNodes) {
      return;
    }

    italicNodes.forEach((node) => {
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
   * Move a temporary marker element outside of an italic ancestor while preserving content order
   * @param marker - Marker element wrapping the selection contents
   * @param italicElement - Italic ancestor containing the marker
   */
  private moveMarkerOutOfItalic(marker: HTMLElement, italicElement: HTMLElement): void {
    const parent = italicElement.parentNode;

    if (!parent) {
      return;
    }

    // Remove empty text nodes to ensure accurate child count
    Array.from(italicElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length === 0) {
        node.remove();
      }
    });

    const isOnlyChild = italicElement.childNodes.length === 1 && italicElement.firstChild === marker;

    if (isOnlyChild) {
      italicElement.replaceWith(marker);

      return;
    }

    const isFirstChild = italicElement.firstChild === marker;

    if (isFirstChild) {
      parent.insertBefore(marker, italicElement);

      return;
    }

    const isLastChild = italicElement.lastChild === marker;

    if (isLastChild) {
      parent.insertBefore(marker, italicElement.nextSibling);

      return;
    }

    const trailingClone = italicElement.cloneNode(false) as HTMLElement;

    while (marker.nextSibling) {
      trailingClone.appendChild(marker.nextSibling);
    }

    parent.insertBefore(trailingClone, italicElement.nextSibling);
    parent.insertBefore(marker, trailingClone);
  }
}
