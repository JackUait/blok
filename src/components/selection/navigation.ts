/**
 * DOM navigation utilities for selections.
 */
export class SelectionNavigation {
  /**
   * Looks ahead to find passed tag from current selection
   * @param tagName - tag to find
   * @param className - tag's class name (optional)
   * @param searchDepth - count of tags that can be included. For better performance.
   */
  static findParentTag(tagName: string, className?: string, searchDepth = 10): HTMLElement | null {
    const selection = window.getSelection();

    if (!selection || !selection.anchorNode || !selection.focusNode) {
      return null;
    }

    const boundNodes = [
      selection.anchorNode as HTMLElement,
      selection.focusNode as HTMLElement,
    ];

    const findTagFromNode = (startNode: HTMLElement): HTMLElement | null => {
      const searchUpTree = (node: HTMLElement, depth: number): HTMLElement | null => {
        if (depth <= 0 || !node) {
          return null;
        }

        const isCurrentNodeMatch = node.nodeType === Node.ELEMENT_NODE && node.tagName === tagName;
        const currentNodeHasMatchingClass = !className || (node.classList && node.classList.contains(className));

        if (isCurrentNodeMatch && currentNodeHasMatchingClass) {
          return node;
        }

        if (!node.parentNode) {
          return null;
        }

        const parent = node.parentNode as HTMLElement;

        const hasMatchingClass = !className || (parent.classList && parent.classList.contains(className));
        const hasMatchingTag = parent.tagName === tagName;

        if (hasMatchingTag && hasMatchingClass) {
          return parent;
        }

        return searchUpTree(parent, depth - 1);
      };

      return searchUpTree(startNode, searchDepth);
    };

    for (const node of boundNodes) {
      const foundTag = findTagFromNode(node);

      if (foundTag) {
        return foundTag;
      }
    }

    return null;
  }

  /**
   * Expands selection range to the passed parent node
   * @param element - element which contents should be selected
   */
  static expandToTag(element: HTMLElement): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    const range = document.createRange();

    range.selectNodeContents(element);
    selection.addRange(range);
  }
}
