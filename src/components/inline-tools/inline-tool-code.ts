import type { InlineTool, SanitizerConfig } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { IconCode } from '../icons';

import {
  isRangeFormatted,
  findFormattingAncestor,
  collectFormattingAncestors,
  extendRangeToTrailingWhitespace,
} from './utils/formatting-range-utils';

/**
 * Check if an element is a code tag (<code>)
 * @param element - The element to check
 */
const isCodeTag = (element: Element): boolean => {
  return element.tagName === 'CODE';
};

/**
 * Code Inline Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with inline code
 */
export class CodeInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Code';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'inlineCode';

  /**
   * Sanitizer Rule
   * Leave <code> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      code: {},
    } as SanitizerConfig;
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconCode,
      name: 'code',
      onActivate: () => {
        this.toggleCode();
      },
      isActive: () => {
        const selection = window.getSelection();

        return selection ? this.isSelectionVisuallyCode(selection) : false;
      },
    };
  }

  /**
   * Shortcut for code tool
   */
  public static shortcut = 'CMD+E';

  /**
   * Apply or remove code formatting using modern Selection API
   */
  private toggleCode(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      this.toggleCollapsedCode(range, selection);

      return;
    }

    const shouldUnwrap = this.isRangeCode(range, { ignoreWhitespace: true });

    if (shouldUnwrap) {
      this.unwrapCodeTags(range);
    } else {
      this.wrapWithCode(range);
    }
  }

  /**
   * Handle toggle for collapsed selection (caret)
   * @param range - Current range
   * @param selection - Current selection
   */
  private toggleCollapsedCode(range: Range, selection: Selection): void {
    const isCode = this.isRangeCode(range, { ignoreWhitespace: true });

    if (isCode) {
      const textNode = document.createTextNode('\u200B');

      range.insertNode(textNode);
      range.selectNode(textNode);
      this.unwrapCodeTags(range);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      const code = document.createElement('code');
      const textNode = document.createTextNode('\u200B');

      code.appendChild(textNode);
      range.insertNode(code);

      const newRange = document.createRange();

      newRange.setStart(textNode, 1);
      newRange.setEnd(textNode, 1);

      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  }

  /**
   * Check if current selection is within a code tag
   * @param selection - The Selection object to check
   */
  private isSelectionVisuallyCode(selection: Selection): boolean {
    if (selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);

    return this.isRangeCode(range, { ignoreWhitespace: true });
  }

  /**
   * Check if a range contains code text
   * @param range - The range to check
   * @param options - Options for checking code status
   */
  private isRangeCode(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isCodeTag, options);
  }

  /**
   * Wrap selection with <code> tag
   * @param range - The Range object containing the selection to wrap
   */
  private wrapWithCode(range: Range): void {
    extendRangeToTrailingWhitespace(range);
    const html = this.getRangeHtmlWithoutCode(range);
    const insertedRange = this.replaceRangeWithHtml(range, `<code>${html}</code>`);
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
   * Remove code tags (<code>) while preserving content
   * @param range - The Range object containing the selection to unwrap
   */
  private unwrapCodeTags(range: Range): void {
    const codeAncestors = this.collectCodeAncestors(range);
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const marker = document.createElement('span');
    const fragment = range.extractContents();

    marker.appendChild(fragment);
    this.removeNestedCode(marker);

    range.insertNode(marker);

    const markerRange = document.createRange();

    markerRange.selectNodeContents(marker);
    selection.removeAllRanges();
    selection.addRange(markerRange);

    for (; ;) {
      const currentCode = this.findCodeElement(marker);

      if (!currentCode) {
        break;
      }

      this.moveMarkerOutOfCode(marker, currentCode);
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

    codeAncestors.forEach((element) => {
      if (element.textContent.length === 0) {
        element.remove();
      }
    });
  }

  /**
   * Find a code element in the parent chain
   * @param node - The node to start searching from
   */
  private findCodeElement(node: Node | null): HTMLElement | null {
    return findFormattingAncestor(node, isCodeTag);
  }

  /**
   * Collect all code ancestor elements within a range
   * @param range - The range to search for code ancestors
   */
  private collectCodeAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isCodeTag);
  }

  /**
   * Get HTML content of a range with code tags removed
   * @param range - The range to extract HTML from
   */
  private getRangeHtmlWithoutCode(range: Range): string {
    const contents = range.cloneContents();

    this.removeNestedCode(contents);

    const container = document.createElement('div');

    container.appendChild(contents);

    return container.innerHTML;
  }

  /**
   * Remove nested code tags from a root node
   * @param root - The root node to process
   */
  private removeNestedCode(root: ParentNode): void {
    const codeNodes = root.querySelectorAll('code');

    codeNodes.forEach((node) => {
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
   * Move a temporary marker element outside of a code ancestor while preserving content order
   * @param marker - Marker element wrapping the selection contents
   * @param codeElement - Code ancestor containing the marker
   */
  private moveMarkerOutOfCode(marker: HTMLElement, codeElement: HTMLElement): void {
    const parent = codeElement.parentNode;

    if (!parent) {
      return;
    }

    // Remove empty text nodes to ensure accurate child count
    Array.from(codeElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length === 0) {
        node.remove();
      }
    });

    const isOnlyChild = codeElement.childNodes.length === 1 && codeElement.firstChild === marker;

    if (isOnlyChild) {
      codeElement.replaceWith(marker);

      return;
    }

    const isFirstChild = codeElement.firstChild === marker;

    if (isFirstChild) {
      parent.insertBefore(marker, codeElement);

      return;
    }

    const isLastChild = codeElement.lastChild === marker;

    if (isLastChild) {
      parent.insertBefore(marker, codeElement.nextSibling);

      return;
    }

    const trailingClone = codeElement.cloneNode(false) as HTMLElement;

    while (marker.nextSibling) {
      trailingClone.appendChild(marker.nextSibling);
    }

    parent.insertBefore(trailingClone, codeElement.nextSibling);
    parent.insertBefore(marker, trailingClone);
  }
}
