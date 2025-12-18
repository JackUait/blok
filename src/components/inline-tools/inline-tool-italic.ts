import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconItalic } from '../icons';
import type { MenuConfig } from '../../../types/tools';

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
   * Set a shortcut
   */
  public get shortcut(): string {
    return 'CMD+I';
  }

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
    if (range.collapsed) {
      return Boolean(this.findItalicElement(range.startContainer));
    }

    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          try {
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch (_error) {
            const nodeRange = document.createRange();

            nodeRange.selectNodeContents(node);

            const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0;
            const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;

            return (startsBeforeEnd && endsAfterStart) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        },
      }
    );

    const textNodes: Text[] = [];

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const value = textNode.textContent ?? '';

      if (options.ignoreWhitespace && value.trim().length === 0) {
        continue;
      }

      if (value.length === 0) {
        continue;
      }

      textNodes.push(textNode);
    }

    if (textNodes.length === 0) {
      return Boolean(this.findItalicElement(range.startContainer));
    }

    return textNodes.every((textNode) => this.hasItalicParent(textNode));
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
    if (!node) {
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE && this.isItalicTag(node as Element)) {
      return true;
    }

    return this.hasItalicParent(node.parentNode);
  }

  /**
   * Find an italic element in the parent chain
   * @param node - The node to start searching from
   */
  private findItalicElement(node: Node | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE && this.isItalicTag(node as Element)) {
      return node as HTMLElement;
    }

    return this.findItalicElement(node.parentNode);
  }

  /**
   * Check if an element is an italic tag (<i> or <em>)
   * @param node - The element to check
   */
  private isItalicTag(node: Element): boolean {
    const tag = node.tagName;

    return tag === 'I' || tag === 'EM';
  }

  /**
   * Collect all italic ancestor elements within a range
   * @param range - The range to search for italic ancestors
   */
  private collectItalicAncestors(range: Range): HTMLElement[] {
    const ancestors = new Set<HTMLElement>();
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          try {
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch (_error) {
            const nodeRange = document.createRange();

            nodeRange.selectNodeContents(node);

            const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0;
            const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;

            return (startsBeforeEnd && endsAfterStart) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        },
      }
    );

    while (walker.nextNode()) {
      const italicElement = this.findItalicElement(walker.currentNode);

      if (italicElement) {
        ancestors.add(italicElement);
      }
    }

    return Array.from(ancestors);
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
