import * as _ from './utils';

/**
 * DOM manipulations helper
 * @todo get rid of class and make separate utility functions
 */
export class Dom {
  /**
   * Check if passed tag has no closed tag
   * @param {HTMLElement} tag - element to check
   * @returns {boolean}
   */
  public static isSingleTag(tag: HTMLElement): boolean {
    return Boolean(tag.tagName) && [
      'AREA',
      'BASE',
      'BR',
      'COL',
      'COMMAND',
      'EMBED',
      'HR',
      'IMG',
      'INPUT',
      'KEYGEN',
      'LINK',
      'META',
      'PARAM',
      'SOURCE',
      'TRACK',
      'WBR',
    ].includes(tag.tagName);
  }

  /**
   * Check if element is BR or WBR
   * @param {HTMLElement} element - element to check
   * @returns {boolean}
   */
  public static isLineBreakTag(element: HTMLElement): element is HTMLBRElement {
    return !!element && ['BR', 'WBR'].includes(element.tagName);
  }

  /**
   * Checks if a class name is valid for use with classList.add()
   * classList.add() throws if class contains whitespace, is empty, or contains invalid characters
   * @param className - class name to validate
   * @returns {boolean} - true if valid for classList.add()
   */
  private static isValidClassName(className: string): boolean {
    if (className === '' || /\s/.test(className)) {
      return false;
    }

    /**
     * Try to validate by creating a temporary element and using classList.add
     * This is more reliable than regex because it follows the actual browser implementation
     */
    try {
      const testEl = document.createElement('div');

      testEl.classList.add(className);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely adds class names to an element, filtering out invalid ones
   * @param element - element to add classes to
   * @param classNames - array of class names to add
   */
  private static safelyAddClasses(element: HTMLElement, classNames: string[]): void {
    const validClasses: string[] = [];
    const invalidClasses: string[] = [];

    for (const className of classNames) {
      if (Dom.isValidClassName(className)) {
        validClasses.push(className);
      } else {
        invalidClasses.push(className);
      }
    }

    if (validClasses.length > 0) {
      element.classList.add(...validClasses);
    }

    /**
     * For invalid class names (e.g. Tailwind arbitrary values with brackets/parentheses),
     * we need to set them via className attribute directly
     */
    if (invalidClasses.length > 0) {
      const existingClasses = element.className;
      const allClasses = existingClasses
        ? `${existingClasses} ${invalidClasses.join(' ')}`
        : invalidClasses.join(' ');

      element.setAttribute('class', allClasses);
    }
  }

  /**
   * Helper for making Elements with class name and attributes
   * @param  {string} tagName - new Element tag name
   * @param  {string[]|string} [classNames] - list or name of CSS class name(s)
   * @param  {object} [attributes] - any attributes
   * @returns {HTMLElement}
   */
  public static make(tagName: string, classNames: string | (string | undefined)[] | null = null, attributes: Record<string, string | number | boolean | null | undefined> = {}): HTMLElement {
    const el = document.createElement(tagName);

    if (Array.isArray(classNames)) {
      const validClassnames = classNames
        .filter((className): className is string => className !== undefined && className !== '')
        .flatMap((className) => className.split(' '))
        .filter((className) => className !== '');

      Dom.safelyAddClasses(el, validClassnames);
    }

    if (typeof classNames === 'string' && classNames !== '') {
      const splitClassNames = classNames.split(' ').filter((className) => className !== '');

      Dom.safelyAddClasses(el, splitClassNames);
    }

    for (const attrName in attributes) {
      if (!Object.prototype.hasOwnProperty.call(attributes, attrName)) {
        continue;
      }

      const value = attributes[attrName];

      if (value === undefined || value === null) {
        continue;
      }

      if (attrName in el) {
        (el as unknown as Record<string, unknown>)[attrName] = value;

        continue;
      }

      el.setAttribute(attrName, String(value));
    }

    return el;
  }

  /**
   * Creates Text Node with the passed content
   * @param {string} content - text content
   * @returns {Text}
   */
  public static text(content: string): Text {
    return document.createTextNode(content);
  }

  /**
   * Append one or several elements to the parent
   * @param  {Element|DocumentFragment} parent - where to append
   * @param  {Element|Element[]|DocumentFragment|Text|Text[]} elements - element or elements list
   */
  public static append(
    parent: Element | DocumentFragment,
    elements: Element | Element[] | DocumentFragment | Text | Text[]
  ): void {
    if (Array.isArray(elements)) {
      elements.forEach((el) => parent.appendChild(el));
    } else {
      parent.appendChild(elements);
    }
  }

  /**
   * Append element or a couple to the beginning of the parent elements
   * @param {Element} parent - where to append
   * @param {Element|Element[]} elements - element or elements list
   */
  public static prepend(parent: Element, elements: Element | Element[]): void {
    if (Array.isArray(elements)) {
      const reversedElements = [ ...elements ].reverse();

      reversedElements.forEach((el) => parent.prepend(el));
    } else {
      parent.prepend(elements);
    }
  }

  /**
   * Selector Decorator
   *
   * Returns first match
   * @param {Element} el - element we searching inside. Default - DOM Document
   * @param {string} selector - searching string
   * @returns {Element}
   */
  public static find(el: Element | Document = document, selector: string): Element | null {
    return el.querySelector(selector);
  }

  /**
   * Get Element by Id
   * @param {string} id - id to find
   * @returns {HTMLElement | null}
   */
  public static get(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  /**
   * Selector Decorator.
   *
   * Returns all matches
   * @param {Element|Document} el - element we searching inside. Default - DOM Document
   * @param {string} selector - searching string
   * @returns {NodeList}
   */
  public static findAll(el: Element | Document = document, selector: string): NodeList {
    return el.querySelectorAll(selector);
  }

  /**
   * Returns CSS selector for all text inputs
   */
  public static get allInputsSelector(): string {
    const allowedInputTypes = ['text', 'password', 'email', 'number', 'search', 'tel', 'url'];

    return '[contenteditable=true], textarea, input:not([type]), ' +
      allowedInputTypes.map((type) => `input[type="${type}"]`).join(', ');
  }

  /**
   * Find all contenteditable, textarea and editable input elements passed holder contains
   * @param holder - element where to find inputs
   */
  public static findAllInputs(holder: Element): HTMLElement[] {
    return _.array(holder.querySelectorAll(Dom.allInputsSelector))
      /**
       * If contenteditable element contains block elements, treat them as inputs.
       */
      .reduce((result, input) => {
        if (Dom.isNativeInput(input) || Dom.containsOnlyInlineElements(input)) {
          return [...result, input];
        }

        return [...result, ...Dom.getDeepestBlockElements(input)];
      }, []);
  }

  /**
   * Search for deepest node which is Leaf.
   * Leaf is the vertex that doesn't have any child nodes
   * @description Method recursively goes throw the all Node until it finds the Leaf
   * @param {Node} node - root Node. From this vertex we start Deep-first search
   *                      {@link https://en.wikipedia.org/wiki/Depth-first_search}
   * @param {boolean} [atLast] - find last text node
   * @returns - it can be text Node or Element Node, so that caret will able to work with it
   *            Can return null if node is Document or DocumentFragment, or node is not attached to the DOM
   */
  public static getDeepestNode(node: Node | null, atLast = false): Node | null {
    /**
     * Current function have two directions:
     * - starts from first child and every time gets first or nextSibling in special cases
     * - starts from last child and gets last or previousSibling
     * @type {string}
     */
    const child: 'lastChild' | 'firstChild' = atLast ? 'lastChild' : 'firstChild';
    const sibling: 'previousSibling' | 'nextSibling' = atLast ? 'previousSibling' : 'nextSibling';

    if (node === null || node.nodeType !== Node.ELEMENT_NODE) {
      return node;
    }

    const nodeChildProperty = node[child];

    if (nodeChildProperty === null) {
      return node;
    }

    const nodeChild = nodeChildProperty as Node;
    const shouldSkipChild = Dom.isSingleTag(nodeChild as HTMLElement) &&
      !Dom.isNativeInput(nodeChild) &&
      !Dom.isLineBreakTag(nodeChild as HTMLElement);

    if (!shouldSkipChild) {
      return this.getDeepestNode(nodeChild, atLast);
    }

    const siblingNode = nodeChild[sibling];

    if (siblingNode) {
      return this.getDeepestNode(siblingNode, atLast);
    }

    const parentSiblingNode = nodeChild.parentNode?.[sibling];

    if (parentSiblingNode) {
      return this.getDeepestNode(parentSiblingNode, atLast);
    }

    return nodeChild.parentNode;
  }

  /**
   * Check if object is DOM node
   * @param {*} node - object to check
   * @returns {boolean}
   */

  public static isElement(node: any): node is Element {
    if (_.isNumber(node)) {
      return false;
    }

    return node != null && node.nodeType != null && node.nodeType === Node.ELEMENT_NODE;
  }

  /**
   * Check if object is DocumentFragment node
   * @param {object} node - object to check
   * @returns {boolean}
   */

  public static isFragment(node: any): node is DocumentFragment {
    if (_.isNumber(node)) {
      return false;
    }

    return node != null && node.nodeType != null && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
  }

  /**
   * Check if passed element is contenteditable
   * @param {HTMLElement} element - html element to check
   * @returns {boolean}
   */
  public static isContentEditable(element: HTMLElement): boolean {
    return element.contentEditable === 'true';
  }

  /**
   * Checks target if it is native input
   * @param {*} target - HTML element or string
   * @returns {boolean}
   */

  public static isNativeInput(target: any): target is HTMLInputElement | HTMLTextAreaElement {
    const nativeInputs = [
      'INPUT',
      'TEXTAREA',
    ];

    return target != null && typeof target.tagName === 'string' ? nativeInputs.includes(target.tagName) : false;
  }

  /**
   * Checks if we can set caret
   * @param {HTMLElement} target - target to check
   * @returns {boolean}
   */
  public static canSetCaret(target: HTMLElement): boolean {
    if (Dom.isNativeInput(target)) {
      const disallowedTypes = new Set([
        'file',
        'checkbox',
        'radio',
        'hidden',
        'submit',
        'button',
        'image',
        'reset',
      ]);

      return !disallowedTypes.has(target.type);
    }

    return Dom.isContentEditable(target);
  }

  /**
   * Checks node if it is empty
   * @description Method checks simple Node without any childs for emptiness
   * If you have Node with 2 or more children id depth, you better use {@link Dom#isEmpty} method
   * @param {Node} node - node to check
   * @param {string} [ignoreChars] - char or substring to treat as empty
   * @returns {boolean} true if it is empty
   */
  public static isNodeEmpty(node: Node, ignoreChars?: string): boolean {
    if (this.isSingleTag(node as HTMLElement) && !this.isLineBreakTag(node as HTMLElement)) {
      return false;
    }

    const baseText = this.isElement(node) && this.isNativeInput(node)
      ? (node as HTMLInputElement).value
      : node.textContent?.replace('\u200B', '');
    const normalizedText = ignoreChars
      ? baseText?.replace(new RegExp(ignoreChars, 'g'), '')
      : baseText;

    return (normalizedText?.length ?? 0) === 0;
  }

  /**
   * checks node if it is doesn't have any child nodes
   * @param {Node} node - node to check
   * @returns {boolean}
   */
  public static isLeaf(node: Node): boolean {
    if (!node) {
      return false;
    }

    return node.childNodes.length === 0;
  }

  /**
   * breadth-first search (BFS)
   * {@link https://en.wikipedia.org/wiki/Breadth-first_search}
   * @description Pushes to stack all DOM leafs and checks for emptiness
   * @param {Node} node - node to check
   * @param {string} [ignoreChars] - char or substring to treat as empty
   * @returns {boolean}
   */
  public static isEmpty(node: Node, ignoreChars?: string): boolean {
    const treeWalker = [ node ];

    while (treeWalker.length > 0) {
      const currentNode = treeWalker.shift();

      if (!currentNode) {
        continue;
      }

      if (this.isLeaf(currentNode) && !this.isNodeEmpty(currentNode, ignoreChars)) {
        return false;
      }

      if (currentNode.childNodes) {
        treeWalker.push(...Array.from(currentNode.childNodes));
      }
    }

    return true;
  }

  /**
   * Check if string contains html elements
   * @param {string} str - string to check
   * @returns {boolean}
   */
  public static isHTMLString(str: string): boolean {
    const wrapper = Dom.make('div');

    wrapper.innerHTML = str;

    return wrapper.childElementCount > 0;
  }

  /**
   * Return length of node`s text content
   * @param {Node} node - node with content
   * @returns {number}
   */
  public static getContentLength(node: Node): number {
    if (Dom.isNativeInput(node)) {
      return (node as HTMLInputElement).value.length;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return (node as Text).length;
    }

    return node.textContent?.length ?? 0;
  }

  /**
   * Return array of names of block html elements
   * @returns {string[]}
   */
  public static get blockElements(): string[] {
    return [
      'address',
      'article',
      'aside',
      'blockquote',
      'canvas',
      'div',
      'dl',
      'dt',
      'fieldset',
      'figcaption',
      'figure',
      'footer',
      'form',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'header',
      'hgroup',
      'hr',
      'li',
      'main',
      'nav',
      'noscript',
      'ol',
      'output',
      'p',
      'pre',
      'ruby',
      'section',
      'table',
      'tbody',
      'thead',
      'tr',
      'tfoot',
      'ul',
      'video',
    ];
  }

  /**
   * Check if passed content includes only inline elements
   * @param {string|HTMLElement} data - element or html string
   * @returns {boolean}
   */
  public static containsOnlyInlineElements(data: string | HTMLElement): boolean {
    const wrapper = _.isString(data)
      ? (() => {
        const container = document.createElement('div');

        container.innerHTML = data;

        return container;
      })()
      : data;

    const check = (element: Element): boolean => {
      return !Dom.blockElements.includes(element.tagName.toLowerCase()) &&
        Array.from(element.children).every(check);
    };

    return Array.from(wrapper.children).every(check);
  }

  /**
   * Find and return all block elements in the passed parent (including subtree)
   * @param {HTMLElement} parent - root element
   * @returns {HTMLElement[]}
   */
  public static getDeepestBlockElements(parent: HTMLElement): HTMLElement[] {
    if (Dom.containsOnlyInlineElements(parent)) {
      return [ parent ];
    }

    return Array.from(parent.children).reduce((result, element) => {
      return [...result, ...Dom.getDeepestBlockElements(element as HTMLElement)];
    }, [] as HTMLElement[]);
  }

  /**
   * Helper for get holder from {string} or return HTMLElement
   * @param {string | HTMLElement} element - holder's id or holder's HTML Element
   * @returns {HTMLElement}
   */
  public static getHolder(element: string | HTMLElement): HTMLElement {
    if (!_.isString(element)) {
      return element;
    }

    const holder = document.getElementById(element);

    if (holder !== null) {
      return holder;
    }

    throw new Error(`Element with id "${element}" not found`);
  }

  /**
   * Returns true if element is anchor (is A tag)
   * @param {Element} element - element to check
   * @returns {boolean}
   */
  public static isAnchor(element: Element): element is HTMLAnchorElement {
    return element.tagName.toLowerCase() === 'a';
  }

  /**
   * Return element's offset related to the document
   * @todo handle case when blok initialized in scrollable popup
   * @param el - element to compute offset
   */
  public static offset(el: Element): { top: number; left: number; right: number; bottom: number } {
    const rect = el.getBoundingClientRect();
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    const top = rect.top + scrollTop;
    const left = rect.left + scrollLeft;

    return {
      top,
      left,
      bottom: top + rect.height,
      right: left + rect.width,
    };
  }

  /**
   * Find text node and offset by total content offset
   * @param {Node} root - root node to start search from
   * @param {number} totalOffset - offset relative to the root node content
   * @returns {{node: Node | null, offset: number}} - node and offset inside node
   */
  public static getNodeByOffset(root: Node, totalOffset: number): { node: Node | null; offset: number } {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    );

    const findNode = (
      nextNode: Node | null,
      accumulatedOffset: number,
      previousNode: Node | null,
      previousNodeLength: number
    ): { node: Node | null; offset: number } => {
      if (!nextNode && previousNode) {
        const baseOffset = accumulatedOffset - previousNodeLength;
        const safeTotalOffset = Math.max(totalOffset - baseOffset, 0);
        const offsetInsidePrevious = Math.min(safeTotalOffset, previousNodeLength);

        return {
          node: previousNode,
          offset: offsetInsidePrevious,
        };
      }

      if (!nextNode) {
        return {
          node: null,
          offset: 0,
        };
      }

      const textContent = nextNode.textContent ?? '';
      const nodeLength = textContent.length;
      const hasReachedOffset = accumulatedOffset + nodeLength >= totalOffset;

      if (hasReachedOffset) {
        return {
          node: nextNode,
          offset: Math.min(totalOffset - accumulatedOffset, nodeLength),
        };
      }

      return findNode(
        walker.nextNode(),
        accumulatedOffset + nodeLength,
        nextNode,
        nodeLength
      );
    };

    const initialNode = walker.nextNode();
    const { node, offset } = findNode(initialNode, 0, null, 0);

    if (!node) {
      return {
        node: null,
        offset: 0,
      };
    }

    const textContent = node.textContent;

    if (!textContent || textContent.length === 0) {
      return {
        node: null,
        offset: 0,
      };
    }

    return {
      node,
      offset,
    };
  }
}

/**
 * Determine whether a passed text content is a collapsed whitespace.
 *
 * In HTML, whitespaces at the start and end of elements and outside elements are ignored.
 * There are two types of whitespaces in HTML:
 * - Visible (&nbsp;)
 * - Invisible (regular trailing spaces, tabs, etc)
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace
 * @see https://www.w3.org/TR/css-text-3/#white-space-processing
 * @param textContent — any string, for ex a textContent of a node
 * @returns True if passed text content is whitespace which is collapsed (invisible) in browser
 */
export const isCollapsedWhitespaces = (textContent: string): boolean => {
  /**
   *  Throughout, whitespace is defined as one of the characters
   *  "\t" TAB \u0009
   *  "\n" LF  \u000A
   *  "\r" CR  \u000D
   *  " "  SPC \u0020
   *
   *  Also \u200B (Zero Width Space) is considered as collapsed whitespace
   */
  return !/[^\t\n\r \u200B]/.test(textContent);
};

/**
 * Calculates the Y coordinate of the text baseline from the top of the element's margin box,
 *
 * The calculation formula is as follows:
 *
 * 1. Calculate the baseline offset:
 * - Typically, the baseline is about 80% of the `fontSize` from the top of the text, as this is a common average for many fonts.
 *
 * 2. Calculate the additional space due to `lineHeight`:
 * - If the `lineHeight` is greater than the `fontSize`, the extra space is evenly distributed above and below the text. This extra space is `(lineHeight - fontSize) / 2`.
 *
 * 3. Calculate the total baseline Y coordinate:
 * - Sum of `marginTop`, `borderTopWidth`, `paddingTop`, the extra space due to `lineHeight`, and the baseline offset.
 * @param element - The element to calculate the baseline for.
 * @returns {number} - The Y coordinate of the text baseline from the top of the element's margin box.
 */
export const calculateBaseline = (element: Element): number => {
  const style = window.getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize);

  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2; // default line-height if not set
  const paddingTop = parseFloat(style.paddingTop);
  const borderTopWidth = parseFloat(style.borderTopWidth);
  const marginTop = parseFloat(style.marginTop);

  /**
   * Typically, the baseline is about 80% of the `fontSize` from the top of the text, as this is a common average for many fonts.
   */

  const baselineOffset = fontSize * 0.8;

  /**
   * If the `lineHeight` is greater than the `fontSize`, the extra space is evenly distributed above and below the text. This extra space is `(lineHeight - fontSize) / 2`.
   */
  const extraLineHeight = (lineHeight - fontSize) / 2;

  /**
   * Calculate the total baseline Y coordinate from the top of the margin box
   */
  const baselineY = marginTop + borderTopWidth + paddingTop + extraLineHeight + baselineOffset;

  return baselineY;
};

/**
 * Toggles the [data-blok-empty] attribute on element depending on its emptiness
 * Used to mark empty inputs with a special attribute for placeholders feature
 * @param element - The element to toggle the [data-blok-empty] attribute on
 */
export const toggleEmptyMark = (element: HTMLElement): void => {
  element.setAttribute('data-blok-empty', Dom.isEmpty(element) ? 'true' : 'false');
};
