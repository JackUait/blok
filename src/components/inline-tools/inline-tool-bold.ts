import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconBold } from '@codexteam/icons';
import type { MenuConfig } from '../../../types/tools';

/**
 * Bold Tool
 *
 * Inline Toolbar Tool
 *
 * Makes selected text bolder
 */
export default class BoldInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   *
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for hover-tooltip
   */
  public static title = 'Bold';

  /**
   * Sanitizer Rule
   * Leave <b> tags
   *
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      b: {},
    } as SanitizerConfig;
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconBold,
      name: 'bold',
      onActivate: () => {
        this.toggleBold();
      },
      isActive: () => {
        const selection = window.getSelection();

        return selection ? this.isSelectionBold(selection) : false;
      },
    };
  }

  /**
   * Apply or remove bold formatting using modern Selection API
   */
  private toggleBold(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      return;
    }

    // Check if selection is already wrapped in <b> tag
    const isBold = this.isSelectionBold(selection);

    if (isBold) {
      // Unwrap: remove <b> tags while preserving content
      this.unwrapBoldTags(range);
    } else {
      // Wrap: surround selection with <b> tag
      this.wrapWithBold(range);
    }
  }

  /**
   * Check if current selection is within a <b> tag
   *
   * @param selection - The Selection object to check
   */
  private isSelectionBold(selection: Selection): boolean {
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    // Check if container itself is a <b> tag
    if (container.nodeType === Node.ELEMENT_NODE && (container as Element).tagName === 'B') {
      return true;
    }

    // Check if container is inside a <b> tag
    const startParent: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as Element;

    return this.hasBoldParent(startParent);
  }

  /**
   * Recursively check if a node or any of its parents is a <b> tag
   *
   * @param node - The node to check
   */
  private hasBoldParent(node: Node | null): boolean {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const element = node as Element;

    if (element.tagName === 'B') {
      return true;
    }

    return this.hasBoldParent(element.parentElement);
  }

  /**
   * Recursively find a <b> element in the parent chain
   *
   * @param node - The node to start searching from
   */
  private findBoldElement(node: Node | null): HTMLElement | null {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as Element;

    if (element.tagName === 'B') {
      return element as HTMLElement;
    }

    return this.findBoldElement(element.parentElement);
  }

  /**
   * Wrap selection with <b> tag
   *
   * @param range - The Range object containing the selection to wrap
   */
  private wrapWithBold(range: Range): void {
    const bElement = document.createElement('b');

    try {
      range.surroundContents(bElement);
    } catch (error) {
      // If surroundContents fails (e.g., range spans multiple elements),
      // extract content and wrap it
      const contents = range.extractContents();

      bElement.appendChild(contents);
      range.insertNode(bElement);
    }

    // Restore selection
    const selection = window.getSelection();

    if (selection) {
      selection.removeAllRanges();
      const newRange = document.createRange();

      newRange.selectNodeContents(bElement);
      selection.addRange(newRange);
    }
  }

  /**
   * Remove <b> tags while preserving content
   *
   * @param range - The Range object containing the selection to unwrap
   */
  private unwrapBoldTags(range: Range): void {
    const container = range.commonAncestorContainer;

    // Find the <b> element
    const boldElement: HTMLElement | null = container.nodeType === Node.ELEMENT_NODE && (container as Element).tagName === 'B'
      ? container as HTMLElement
      : this.findBoldElement(container.nodeType === Node.TEXT_NODE ? container.parentElement : container as Element);

    if (!boldElement) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    // Save references to first and last child before unwrapping
    const firstChild = boldElement.firstChild;
    const lastChild = boldElement.lastChild;

    // Replace <b> with its contents
    const parent = boldElement.parentNode;

    if (!parent || !firstChild || !lastChild) {
      return;
    }

    this.unwrapBoldElement(boldElement, parent, firstChild, lastChild, selection, range);
  }

  /**
   * Unwrap a bold element by moving its children to the parent
   *
   * @param boldElement - The <b> element to unwrap
   * @param parent - The parent node of the bold element
   * @param firstChild - The first child of the bold element
   * @param lastChild - The last child of the bold element
   * @param selection - The current selection
   * @param range - The original range
   */
  private unwrapBoldElement(
    boldElement: HTMLElement,
    parent: Node,
    firstChild: Node,
    lastChild: Node,
    selection: Selection,
    range: Range
  ): void {
    // Insert all children before the bold element
    while (boldElement.firstChild) {
      parent.insertBefore(boldElement.firstChild, boldElement);
    }
    parent.removeChild(boldElement);

    // Restore selection to the unwrapped content
    selection.removeAllRanges();
    const newRange = document.createRange();

    if (firstChild === lastChild && firstChild.nodeType === Node.TEXT_NODE) {
      // Single text node: try to preserve offsets
      const textLength = firstChild.textContent?.length ?? 0;
      const start = Math.min(range.startOffset, textLength);
      const end = Math.min(range.endOffset, textLength);

      newRange.setStart(firstChild, start);
      newRange.setEnd(firstChild, end);
    } else {
      // Multiple nodes: select from first to last
      newRange.setStartBefore(firstChild);
      newRange.setEndAfter(lastChild);
    }

    selection.addRange(newRange);
  }

  /**
   * Set a shortcut
   *
   * @returns {boolean}
   */
  public get shortcut(): string {
    return 'CMD+B';
  }
}
