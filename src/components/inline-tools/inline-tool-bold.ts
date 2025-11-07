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
    let parent: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as Element;

    while (parent && parent.nodeType === Node.ELEMENT_NODE) {
      if ((parent as Element).tagName === 'B') {
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
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
    let boldElement: HTMLElement | null = null;

    // Find the <b> element
    if (container.nodeType === Node.ELEMENT_NODE && (container as Element).tagName === 'B') {
      boldElement = container as HTMLElement;
    } else {
      let parent: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as Element;

      while (parent && parent.nodeType === Node.ELEMENT_NODE) {
        if ((parent as Element).tagName === 'B') {
          boldElement = parent as HTMLElement;
          break;
        }
        parent = parent.parentElement;
      }
    }

    if (boldElement) {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return;
      }

      // Save references to first and last child before unwrapping
      const firstChild = boldElement.firstChild;
      const lastChild = boldElement.lastChild;

      // Replace <b> with its contents
      const parent = boldElement.parentNode;

      if (parent && firstChild && lastChild) {
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
    }
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
