/**
 * TextRange interface for IE9-
 */
import * as _ from './utils';
import $ from './dom';

interface TextRange {
  boundingTop: number;
  boundingLeft: number;
  boundingBottom: number;
  boundingRight: number;
  boundingHeight: number;
  boundingWidth: number;
}

/**
 * Interface for object returned by document.selection in IE9-
 */
interface MSSelection {
  createRange: () => TextRange;
  type: string;
}

/**
 * Extends Document interface for IE9-
 */
interface Document {
  selection?: MSSelection;
}

/**
 * Working with selection
 *
 * @typedef {SelectionUtils} SelectionUtils
 */
export default class SelectionUtils {
  /**
   * Selection instances
   *
   * @todo Check if this is still relevant
   */
  public instance: Selection | null = null;
  public selection: Selection | null = null;

  /**
   * This property can store SelectionUtils's range for restoring later
   *
   * @type {Range|null}
   */
  public savedSelectionRange: Range | null = null;

  /**
   * Fake background is active
   *
   * @returns {boolean}
   */
  public isFakeBackgroundEnabled = false;

  /**
   * Editor styles
   *
   * @returns {{editorWrapper: string, editorZone: string}}
   */
  public static get CSS(): { editorWrapper: string; editorZone: string } {
    return {
      editorWrapper: 'codex-editor',
      editorZone: 'codex-editor__redactor',
    };
  }

  /**
   * Returns selected anchor
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Selection/anchorNode}
   *
   * @returns {Node|null}
   */
  public static get anchorNode(): Node | null {
    const selection = window.getSelection();

    return selection ? selection.anchorNode : null;
  }

  /**
   * Returns selected anchor element
   *
   * @returns {Element|null}
   */
  public static get anchorElement(): Element | null {
    const selection = window.getSelection();

    if (!selection) {
      return null;
    }

    const anchorNode = selection.anchorNode;

    if (!anchorNode) {
      return null;
    }

    if (!$.isElement(anchorNode)) {
      return anchorNode.parentElement;
    } else {
      return anchorNode;
    }
  }

  /**
   * Returns selection offset according to the anchor node
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Selection/anchorOffset}
   *
   * @returns {number|null}
   */
  public static get anchorOffset(): number | null {
    const selection = window.getSelection();

    return selection ? selection.anchorOffset : null;
  }

  /**
   * Is current selection range collapsed
   *
   * @returns {boolean|null}
   */
  public static get isCollapsed(): boolean | null {
    const selection = window.getSelection();

    return selection ? selection.isCollapsed : null;
  }

  /**
   * Check current selection if it is at Editor's zone
   *
   * @returns {boolean}
   */
  public static get isAtEditor(): boolean {
    return this.isSelectionAtEditor(SelectionUtils.get());
  }

  /**
   * Check if passed selection is at Editor's zone
   *
   * @param selection - Selection object to check
   */
  public static isSelectionAtEditor(selection: Selection | null): boolean {
    if (!selection) {
      return false;
    }

    /**
     * Something selected on document
     */
    let selectedNode = selection.anchorNode || selection.focusNode;

    if (selectedNode && selectedNode.nodeType === Node.TEXT_NODE) {
      selectedNode = selectedNode.parentNode;
    }

    let editorZone = null;

    if (selectedNode && selectedNode instanceof Element) {
      editorZone = selectedNode.closest(`.${SelectionUtils.CSS.editorZone}`);
    }

    /**
     * SelectionUtils is not out of Editor because Editor's wrapper was found
     */
    return editorZone ? editorZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Check if passed range at Editor zone
   *
   * @param range - range to check
   */
  public static isRangeAtEditor(range: Range | null): boolean {
    if (!range) {
      return false;
    }

    let selectedNode: Node | null = range.startContainer;

    if (selectedNode && selectedNode.nodeType === Node.TEXT_NODE) {
      selectedNode = selectedNode.parentNode;
    }

    let editorZone = null;

    if (selectedNode && selectedNode instanceof Element) {
      editorZone = selectedNode.closest(`.${SelectionUtils.CSS.editorZone}`);
    }

    /**
     * SelectionUtils is not out of Editor because Editor's wrapper was found
     */
    return editorZone ? editorZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Methods return boolean that true if selection exists on the page
   */
  public static get isSelectionExists(): boolean {
    const selection = SelectionUtils.get();

    return !!selection?.anchorNode;
  }

  /**
   * Return first range
   *
   * @returns {Range|null}
   */
  public static get range(): Range | null {
    return this.getRangeFromSelection(this.get());
  }

  /**
   * Returns range from passed Selection object
   *
   * @param selection - Selection object to get Range from
   */
  public static getRangeFromSelection(selection: Selection | null): Range | null {
    return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  }

  /**
   * Calculates position and size of selected text
   *
   * @returns {DOMRect}
   */
  public static get rect(): DOMRect {
    let sel: Selection | MSSelection | undefined | null = (document as Document).selection,
        range: TextRange | Range;

    let rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    } as DOMRect;

    if (sel && 'type' in sel && sel.type !== 'Control') {
      sel = sel as MSSelection;
      range = sel.createRange() as TextRange;
      rect.x = range.boundingLeft;
      rect.y = range.boundingTop;
      rect.width = range.boundingWidth;
      rect.height = range.boundingHeight;

      return rect;
    }

    sel = window.getSelection();

    if (!sel || sel.rangeCount === null || isNaN(sel.rangeCount)) {
      if (!sel) {
        _.log('Method window.getSelection returned null', 'warn');
      } else {
        _.log('Method SelectionUtils.rangeCount is not supported', 'warn');
      }

      return rect;
    }

    if (sel.rangeCount === 0) {
      return rect;
    }

    range = sel.getRangeAt(0).cloneRange() as Range;

    rect = range.getBoundingClientRect() as DOMRect;
    // Fall back to inserting a temporary element
    if (rect.x === 0 && rect.y === 0) {
      const span = document.createElement('span');

      // Ensure span has dimensions and position by
      // adding a zero-width space character
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      rect = span.getBoundingClientRect() as DOMRect;

      const spanParent = span.parentNode;

      spanParent?.removeChild(span);

      // Glue any broken text nodes back together
      spanParent?.normalize();
    }

    return rect;
  }

  /**
   * Returns selected text as String
   *
   * @returns {string}
   */
  public static get text(): string {
    const selection = window.getSelection();

    return selection?.toString() ?? '';
  }

  /**
   * Returns window SelectionUtils
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Window/getSelection}
   *
   * @returns {Selection}
   */
  public static get(): Selection | null  {
    return window.getSelection();
  }

  /**
   * Set focus to contenteditable or native input element
   *
   * @param element - element where to set focus
   * @param offset - offset of cursor
   */
  public static setCursor(element: HTMLElement, offset = 0): DOMRect {
    const range = document.createRange();
    const selection = window.getSelection();

    /** if found deepest node is native input */
    if ($.isNativeInput(element)) {
      if (!$.canSetCaret(element)) {
        return element.getBoundingClientRect();
      }

      element.focus();
      element.selectionStart = element.selectionEnd = offset;

      return element.getBoundingClientRect();
    }

    range.setStart(element, offset);
    range.setEnd(element, offset);

    if (!selection) {
      return element.getBoundingClientRect();
    }

    selection.removeAllRanges();
    selection.addRange(range);

    return range.getBoundingClientRect();
  }

  /**
   * Check if current range exists and belongs to container
   *
   * @param container - where range should be
   */
  public static isRangeInsideContainer(container: HTMLElement): boolean {
    const range = SelectionUtils.range;

    if (range === null) {
      return false;
    }

    return container.contains(range.startContainer);
  }

  /**
   * Adds fake cursor to the current range
   */
  public static addFakeCursor(): void {
    const range = SelectionUtils.range;

    if (range === null) {
      return;
    }

    const fakeCursor = $.make('span', 'codex-editor__fake-cursor');

    fakeCursor.dataset.mutationFree = 'true';

    range.collapse();
    range.insertNode(fakeCursor);
  }

  /**
   * Check if passed element contains a fake cursor
   *
   * @param el - where to check
   */
  public static isFakeCursorInsideContainer(el: HTMLElement): boolean {
    return $.find(el, `.codex-editor__fake-cursor`) !== null;
  }

  /**
   * Removes fake cursor from a container
   *
   * @param container - container to look for
   */
  public static removeFakeCursor(container: HTMLElement = document.body): void {
    const fakeCursor = $.find(container, `.codex-editor__fake-cursor`);

    if (!fakeCursor) {
      return;
    }

    fakeCursor.remove();
  }

  /**
   * Removes fake background
   */
  public removeFakeBackground(): void {
    if (!this.isFakeBackgroundEnabled) {
      return;
    }

    this.isFakeBackgroundEnabled = false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const walkerContainer = container.nodeType === Node.TEXT_NODE && container.parentNode
      ? container.parentNode
      : container;
    const walker = document.createTreeWalker(
      walkerContainer,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    const elementsToProcess: HTMLElement[] = [];
    let node: Node | null = walker.currentNode as Node;

    // Collect all elements in the range
    while (node) {
      if (node instanceof HTMLElement && range.intersectsNode(node)) {
        elementsToProcess.push(node);
      }
      node = walker.nextNode();
    }

    // Also check text nodes' parent elements
    if (range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentElement) {
      if (!elementsToProcess.includes(range.startContainer.parentElement)) {
        elementsToProcess.push(range.startContainer.parentElement);
      }
    }
    if (range.endContainer.nodeType === Node.TEXT_NODE && range.endContainer.parentElement) {
      if (!elementsToProcess.includes(range.endContainer.parentElement)) {
        elementsToProcess.push(range.endContainer.parentElement);
      }
    }

    // Remove background-color style from collected elements
    elementsToProcess.forEach((element) => {
      const bgColor = element.style.backgroundColor;
      const isFakeBackground = bgColor === '#a8d6ff' || bgColor === 'rgb(168, 214, 255)';

      if (isFakeBackground) {
        // If it's a span with the fake background color, unwrap it
        if (element.tagName.toLowerCase() === 'span') {
          const parent = element.parentNode;
          if (parent) {
            while (element.firstChild) {
              parent.insertBefore(element.firstChild, element);
            }
            parent.removeChild(element);
            parent.normalize();
          }
        } else {
          // Otherwise, just remove the background-color style
          element.style.backgroundColor = '';
          if (!element.style.cssText.trim()) {
            element.removeAttribute('style');
          }
        }
      }
    });
  }

  /**
   * Sets fake background
   */
  public setFakeBackground(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    // If range is collapsed (no selection), do nothing
    if (range.collapsed) {
      return;
    }

    // Check if selection is already wrapped in a single element
    let contents = range.extractContents();
    const span = document.createElement('span');
    span.style.backgroundColor = '#a8d6ff';
    span.appendChild(contents);
    range.insertNode(span);

    // Normalize to merge adjacent text nodes
    if (span.parentNode) {
      span.parentNode.normalize();
    }

    // Update selection to include the new span
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(newRange);

    this.isFakeBackgroundEnabled = true;
  }

  /**
   * Save SelectionUtils's range
   */
  public save(): void {
    this.savedSelectionRange = SelectionUtils.range;
  }

  /**
   * Restore saved SelectionUtils's range
   */
  public restore(): void {
    if (!this.savedSelectionRange) {
      return;
    }

    const sel = window.getSelection();

    if (!sel) {
      return;
    }

    sel.removeAllRanges();
    sel.addRange(this.savedSelectionRange);
  }

  /**
   * Clears saved selection
   */
  public clearSaved(): void {
    this.savedSelectionRange = null;
  }

  /**
   * Collapse current selection
   */
  public collapseToEnd(): void {
    const sel = window.getSelection();

    if (!sel || !sel.focusNode) {
      return;
    }

    const range = document.createRange();

    range.selectNodeContents(sel.focusNode);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * Looks ahead to find passed tag from current selection
   *
   * @param  {string} tagName       - tag to found
   * @param  {string} [className]   - tag's class name
   * @param  {number} [searchDepth] - count of tags that can be included. For better performance.
   * @returns {HTMLElement|null}
   */
  public findParentTag(tagName: string, className?: string, searchDepth = 10): HTMLElement | null {
    const selection = window.getSelection();
    let parentTag = null;

    /**
     * If selection is missing or no anchorNode or focusNode were found then return null
     */
    if (!selection || !selection.anchorNode || !selection.focusNode) {
      return null;
    }

    /**
     * Define Nodes for start and end of selection
     */
    const boundNodes = [
      /** the Node in which the selection begins */
      selection.anchorNode as HTMLElement,
      /** the Node in which the selection ends */
      selection.focusNode as HTMLElement,
    ];

    /**
     * For each selection parent Nodes we try to find target tag [with target class name]
     * It would be saved in parentTag variable
     */
    boundNodes.forEach((parent) => {
      /** Reset tags limit */
      let searchDepthIterable = searchDepth;

      while (searchDepthIterable > 0 && parent.parentNode) {
        /**
         * Check tag's name
         */
        if (parent.tagName === tagName) {
          /**
           * Save the result
           */
          parentTag = parent;

          /**
           * Optional additional check for class-name mismatching
           */
          if (className && parent.classList && !parent.classList.contains(className)) {
            parentTag = null;
          }

          /**
           * If we have found required tag with class then go out from the cycle
           */
          if (parentTag) {
            break;
          }
        }

        /**
         * Target tag was not found. Go up to the parent and check it
         */
        parent = parent.parentNode as HTMLElement;
        searchDepthIterable--;
      }
    });

    /**
     * Return found tag or null
     */
    return parentTag;
  }

  /**
   * Expands selection range to the passed parent node
   *
   * @param {HTMLElement} element - element which contents should be selected
   */
  public expandToTag(element: HTMLElement): void {
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
