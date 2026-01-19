import { DATA_ATTR, createSelector } from '../constants';
import { Dom as $ } from '../dom';
import { log } from '../utils';

/**
 * Core browser Selection wrappers and utilities.
 * All static methods, stateless.
 */
export class SelectionCore {
  /**
   * Returns selected anchor node
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Selection/anchorNode}
   */
  static getAnchorNode(): Node | null {
    const selection = window.getSelection();
    return selection ? selection.anchorNode : null;
  }

  /**
   * Returns selected anchor element
   */
  static getAnchorElement(): Element | null {
    const selection = window.getSelection();

    if (!selection) {
      return null;
    }

    const anchorNode = selection.anchorNode;

    if (!anchorNode) {
      return null;
    }

    return $.isElement(anchorNode) ? anchorNode : anchorNode.parentElement;
  }

  /**
   * Returns selection offset according to the anchor node
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Selection/anchorOffset}
   */
  static getAnchorOffset(): number | null {
    const selection = window.getSelection();
    return selection ? selection.anchorOffset : null;
  }

  /**
   * Is current selection range collapsed
   */
  static getIsCollapsed(): boolean | null {
    const selection = window.getSelection();
    return selection ? selection.isCollapsed : null;
  }

  /**
   * Check if passed selection is at Blok's zone
   * @param selection - Selection object to check
   */
  static isSelectionAtBlok(selection: Selection | null): boolean {
    if (!selection) {
      return false;
    }

    const initialNode = selection.anchorNode || selection.focusNode;
    const selectedNode = initialNode && initialNode.nodeType === Node.TEXT_NODE
      ? initialNode.parentNode
      : initialNode;

    const blokZone = selectedNode && selectedNode instanceof Element
      ? selectedNode.closest(createSelector(DATA_ATTR.redactor))
      : null;

    return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Check if current selection is at Blok's zone
   */
  static getIsAtBlok(): boolean {
    return this.isSelectionAtBlok(this.get());
  }

  /**
   * Check if passed range is at Blok zone
   * @param range - range to check
   */
  static isRangeAtBlok(range: Range): boolean | void {
    if (!range) {
      return;
    }

    const selectedNode: Node | null =
      range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentNode
        : range.startContainer;

    const blokZone =
      selectedNode && selectedNode instanceof Element
        ? selectedNode.closest(createSelector(DATA_ATTR.redactor))
        : null;

    return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Check if selection exists (has anchor node)
   */
  static getIsSelectionExists(): boolean {
    const selection = this.get();
    return !!selection?.anchorNode;
  }

  /**
   * Returns window Selection
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/getSelection}
   */
  static get(): Selection | null {
    return window.getSelection();
  }

  /**
   * Returns first range from current selection
   */
  static getRange(): Range | null {
    return this.getRangeFromSelection(this.get());
  }

  /**
   * Returns range from passed Selection object
   * @param selection - Selection object to get Range from
   */
  static getRangeFromSelection(selection: Selection | null): Range | null {
    return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  }

  /**
   * Calculates position and size of selected text
   */
  static getRect(): DOMRect {
    const rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    } as DOMRect;

    const sel = window.getSelection();

    if (!sel) {
      log('Method window.getSelection returned null', 'warn');
      return rect;
    }

    if (sel.rangeCount === null || Number.isNaN(sel.rangeCount)) {
      log('Method SelectionUtils.rangeCount is not supported', 'warn');
      return rect;
    }

    if (sel.rangeCount === 0) {
      return rect;
    }

    const range = sel.getRangeAt(0).cloneRange();
    const initialRect = range.getBoundingClientRect();

    // Fall back to inserting a temporary element
    if (initialRect.x === 0 && initialRect.y === 0) {
      const span = document.createElement('span');

      // Ensure span has dimensions and position by adding a zero-width space character
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      const boundingRect = span.getBoundingClientRect();
      const spanParent = span.parentNode;

      spanParent?.removeChild(span);

      // Glue any broken text nodes back together
      spanParent?.normalize();

      return boundingRect;
    }

    return initialRect;
  }

  /**
   * Returns selected text as String
   */
  static getText(): string {
    const selection = window.getSelection();
    return selection?.toString() ?? '';
  }
}
