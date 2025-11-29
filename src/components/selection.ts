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
 * @typedef {SelectionUtils} SelectionUtils
 */
export default class SelectionUtils {
  /**
   * Selection instances
   * @todo Check if this is still relevant
   */
  public instance: Selection | null = null;
  public selection: Selection | null = null;

  /**
   * This property can store SelectionUtils's range for restoring later
   * @type {Range|null}
   */
  public savedSelectionRange: Range | null = null;

  /**
   * Fake background is active
   * @returns {boolean}
   */
  public isFakeBackgroundEnabled = false;

  /**
   * Elements that currently imitate the selection highlight
   */
  private fakeBackgroundElements: HTMLElement[] = [];

  /**
   * Blok styles
   * @returns {{blokWrapper: string, blokZone: string}}
   */
  public static get CSS(): { blokWrapper: string; blokZone: string } {
    return {
      blokWrapper: 'blok-editor',
      blokZone: 'blok-editor__redactor',
    };
  }

  /**
   * Returns selected anchor
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Selection/anchorNode}
   * @returns {Node|null}
   */
  public static get anchorNode(): Node | null {
    const selection = window.getSelection();

    return selection ? selection.anchorNode : null;
  }

  /**
   * Returns selected anchor element
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
   * @returns {number|null}
   */
  public static get anchorOffset(): number | null {
    const selection = window.getSelection();

    return selection ? selection.anchorOffset : null;
  }

  /**
   * Is current selection range collapsed
   * @returns {boolean|null}
   */
  public static get isCollapsed(): boolean | null {
    const selection = window.getSelection();

    return selection ? selection.isCollapsed : null;
  }

  /**
   * Check current selection if it is at Blok's zone
   * @returns {boolean}
   */
  public static get isAtBlok(): boolean {
    return this.isSelectionAtBlok(SelectionUtils.get());
  }

  /**
   * Check if passed selection is at Blok's zone
   * @param selection - Selection object to check
   */
  public static isSelectionAtBlok(selection: Selection | null): boolean {
    if (!selection) {
      return false;
    }

    /**
     * Something selected on document
     */
    const initialNode = selection.anchorNode || selection.focusNode;
    const selectedNode = initialNode && initialNode.nodeType === Node.TEXT_NODE
      ? initialNode.parentNode
      : initialNode;

    const blokZone = selectedNode && selectedNode instanceof Element
      ? selectedNode.closest(`.${SelectionUtils.CSS.blokZone}`)
      : null;

    /**
     * SelectionUtils is not out of Blok because Blok's wrapper was found
     */
    return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Check if passed range at Blok zone
   * @param range - range to check
   */
  public static isRangeAtBlok(range: Range): boolean | void {
    if (!range) {
      return;
    }

    const selectedNode: Node | null =
      range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentNode
        : range.startContainer;

    const blokZone =
      selectedNode && selectedNode instanceof Element
        ? selectedNode.closest(`.${SelectionUtils.CSS.blokZone}`)
        : null;

    /**
     * SelectionUtils is not out of Blok because Blok's wrapper was found
     */
    return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;
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
   * @returns {Range|null}
   */
  public static get range(): Range | null {
    return this.getRangeFromSelection(this.get());
  }

  /**
   * Returns range from passed Selection object
   * @param selection - Selection object to get Range from
   */
  public static getRangeFromSelection(selection: Selection | null): Range | null {
    return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  }

  /**
   * Calculates position and size of selected text
   * @returns {DOMRect}
   */
  public static get rect(): DOMRect {
    const ieSel: Selection | MSSelection | undefined | null = (document as Document).selection;

    const rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    } as DOMRect;

    if (ieSel && ieSel.type !== 'Control') {
      const msSel = ieSel as MSSelection;
      const range = msSel.createRange() as TextRange;

      rect.x = range.boundingLeft;
      rect.y = range.boundingTop;
      rect.width = range.boundingWidth;
      rect.height = range.boundingHeight;

      return rect;
    }

    const sel = window.getSelection();

    if (!sel) {
      _.log('Method window.getSelection returned null', 'warn');

      return rect;
    }

    if (sel.rangeCount === null || isNaN(sel.rangeCount)) {
      _.log('Method SelectionUtils.rangeCount is not supported', 'warn');

      return rect;
    }

    if (sel.rangeCount === 0) {
      return rect;
    }

    const range = sel.getRangeAt(0).cloneRange() as Range;

    const initialRect = range.getBoundingClientRect() as DOMRect;

    // Fall back to inserting a temporary element
    if (initialRect.x === 0 && initialRect.y === 0) {
      const span = document.createElement('span');

      // Ensure span has dimensions and position by
      // adding a zero-width space character
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      const boundingRect = span.getBoundingClientRect() as DOMRect;

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
   * @returns {string}
   */
  public static get text(): string {
    const selection = window.getSelection();

    return selection?.toString() ?? '';
  }

  /**
   * Returns window SelectionUtils
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Window/getSelection}
   * @returns {Selection}
   */
  public static get(): Selection | null  {
    return window.getSelection();
  }

  /**
   * Set focus to contenteditable or native input element
   * @param element - element where to set focus
   * @param offset - offset of cursor
   */
  public static setCursor(element: HTMLElement, offset = 0): DOMRect {
    const range = document.createRange();
    const selection = window.getSelection();

    const isNativeInput = $.isNativeInput(element);

    /** if found deepest node is native input */
    if (isNativeInput && !$.canSetCaret(element)) {
      return element.getBoundingClientRect();
    }

    if (isNativeInput) {
      const inputElement = element as HTMLInputElement | HTMLTextAreaElement;

      inputElement.focus();
      inputElement.selectionStart = offset;
      inputElement.selectionEnd = offset;

      return inputElement.getBoundingClientRect();
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

    const fakeCursor = $.make('span', 'blok-editor__fake-cursor');

    fakeCursor.setAttribute('data-blok-mutation-free', 'true');

    range.collapse();
    range.insertNode(fakeCursor);
  }

  /**
   * Check if passed element contains a fake cursor
   * @param el - where to check
   */
  public static isFakeCursorInsideContainer(el: HTMLElement): boolean {
    return $.find(el, `.blok-editor__fake-cursor`) !== null;
  }

  /**
   * Removes fake cursor from a container
   * @param container - container to look for
   */
  public static removeFakeCursor(container: HTMLElement = document.body): void {
    const fakeCursor = $.find(container, `.blok-editor__fake-cursor`);

    if (!fakeCursor) {
      return;
    }

    fakeCursor.remove();
  }

  /**
   * Removes fake background
   */
  public removeFakeBackground(): void {
    if (!this.fakeBackgroundElements.length) {
      this.isFakeBackgroundEnabled = false;

      return;
    }

    const firstElement = this.fakeBackgroundElements[0];
    const lastElement = this.fakeBackgroundElements[this.fakeBackgroundElements.length - 1];

    const firstChild = firstElement.firstChild;
    const lastChild = lastElement.lastChild;

    this.fakeBackgroundElements.forEach((element) => {
      this.unwrapFakeBackground(element);
    });

    if (firstChild && lastChild) {
      const newRange = document.createRange();

      newRange.setStart(firstChild, 0);
      newRange.setEnd(lastChild, lastChild.textContent?.length || 0);
      this.savedSelectionRange = newRange;
    }

    this.fakeBackgroundElements = [];
    this.isFakeBackgroundEnabled = false;
  }

  /**
   * Sets fake background
   */
  public setFakeBackground(): void {
    this.removeFakeBackground();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      return;
    }

    const textNodes = this.collectTextNodes(range);

    if (textNodes.length === 0) {
      return;
    }

    const anchorStartNode = range.startContainer;
    const anchorStartOffset = range.startOffset;
    const anchorEndNode = range.endContainer;
    const anchorEndOffset = range.endOffset;

    this.fakeBackgroundElements = [];

    textNodes.forEach((textNode) => {
      const segmentRange = document.createRange();
      const isStartNode = textNode === anchorStartNode;
      const isEndNode = textNode === anchorEndNode;
      const startOffset = isStartNode ? anchorStartOffset : 0;
      const nodeTextLength = textNode.textContent?.length ?? 0;
      const endOffset = isEndNode ? anchorEndOffset : nodeTextLength;

      if (startOffset === endOffset) {
        return;
      }

      segmentRange.setStart(textNode, startOffset);
      segmentRange.setEnd(textNode, endOffset);

      const wrapper = this.wrapRangeWithFakeBackground(segmentRange);

      if (wrapper) {
        this.fakeBackgroundElements.push(wrapper);
      }
    });

    if (!this.fakeBackgroundElements.length) {
      return;
    }

    const visualRange = document.createRange();

    visualRange.setStartBefore(this.fakeBackgroundElements[0]);
    visualRange.setEndAfter(this.fakeBackgroundElements[this.fakeBackgroundElements.length - 1]);

    selection.removeAllRanges();
    selection.addRange(visualRange);

    this.isFakeBackgroundEnabled = true;
  }

  /**
   * Collects text nodes that intersect with the passed range
   * @param range - selection range
   */
  private collectTextNodes(range: Range): Text[] {
    const nodes: Text[] = [];
    const { commonAncestorContainer } = range;

    if (commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      nodes.push(commonAncestorContainer as Text);

      return nodes;
    }

    const walker = document.createTreeWalker(
      commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node): number => {
          if (!range.intersectsNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return node.textContent && node.textContent.length > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text);
    }

    return nodes;
  }

  /**
   * Wraps passed range (that belongs to the single text node) with fake background element
   * @param range - range to wrap
   */
  private wrapRangeWithFakeBackground(range: Range): HTMLElement | null {
    if (range.collapsed) {
      return null;
    }

    const wrapper = $.make('span', 'blok-editor__fake-background');

    wrapper.setAttribute('data-blok-testid', 'fake-background');
    wrapper.setAttribute('data-blok-fake-background', 'true');
    wrapper.setAttribute('data-blok-mutation-free', 'true');
    wrapper.style.backgroundColor = '#a8d6ff';
    wrapper.style.color = 'inherit';
    wrapper.style.display = 'inline';
    wrapper.style.padding = '0';
    wrapper.style.margin = '0';

    const contents = range.extractContents();

    if (contents.childNodes.length === 0) {
      return null;
    }

    wrapper.appendChild(contents);
    range.insertNode(wrapper);

    return wrapper;
  }

  /**
   * Removes fake background wrapper
   * @param element - wrapper element
   */
  private unwrapFakeBackground(element: HTMLElement): void {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
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
   * @param  {string} tagName       - tag to found
   * @param  {string} [className]   - tag's class name
   * @param  {number} [searchDepth] - count of tags that can be included. For better performance.
   * @returns {HTMLElement|null}
   */
  public findParentTag(tagName: string, className?: string, searchDepth = 10): HTMLElement | null {
    const selection = window.getSelection();

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
     * Helper function to find parent tag starting from a given node
     * @param {HTMLElement} startNode - node to start searching from
     * @returns {HTMLElement | null}
     */
    const findTagFromNode = (startNode: HTMLElement): HTMLElement | null => {
      const searchUpTree = (node: HTMLElement, depth: number): HTMLElement | null => {
        if (depth <= 0 || !node) {
          return null;
        }

        /**
         * Check if the current node itself matches the tag (for element nodes).
         * This handles the case when the selection anchor/focus is the target element.
         */
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

    /**
     * For each selection parent Nodes we try to find target tag [with target class name]
     */
    for (const node of boundNodes) {
      const foundTag = findTagFromNode(node);

      if (foundTag) {
        return foundTag;
      }
    }

    /**
     * Return null if tag was not found
     */
    return null;
  }

  /**
   * Expands selection range to the passed parent node
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
