'use strict';

/**
 * Extend Element interface to include prefixed and experimental properties
 */
interface Element {
  matchesSelector: (selector: string) => boolean;
  mozMatchesSelector: (selector: string) => boolean;
  msMatchesSelector: (selector: string) => boolean;
  oMatchesSelector: (selector: string) => boolean;

  prepend: (...nodes: Array<string | Node>) => void;
  append: (...nodes: Array<string | Node>) => void;
}

/**
 * The Element.matches() method returns true if the element
 * would be selected by the specified selector string;
 * otherwise, returns false.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Element/matches#Polyfill}
 * @param {string} s - selector
 */
if (typeof Element.prototype.matches === 'undefined') {
  const proto = Element.prototype as Element & {
    matchesSelector?: (selector: string) => boolean;
    mozMatchesSelector?: (selector: string) => boolean;
    msMatchesSelector?: (selector: string) => boolean;
    oMatchesSelector?: (selector: string) => boolean;
    webkitMatchesSelector?: (selector: string) => boolean;
  };

  Element.prototype.matches = proto.matchesSelector ??
    proto.mozMatchesSelector ??
    proto.msMatchesSelector ??
    proto.oMatchesSelector ??
    proto.webkitMatchesSelector ??
    function (this: Element, s: string): boolean {
      const doc = this.ownerDocument;
      const matches = doc.querySelectorAll(s);
      const index = Array.from(matches).findIndex(match => match === this);

      return index !== -1;
    };
}

/**
 * The Element.closest() method returns the closest ancestor
 * of the current element (or the current element itself) which
 * matches the selectors given in parameter.
 * If there isn't such an ancestor, it returns null.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Element/closest#Polyfill}
 * @param {string} s - selector
 */
if (typeof Element.prototype.closest === 'undefined') {
  Element.prototype.closest = function (this: Element, s: string): Element | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const startEl: Element = this;

    if (!document.documentElement.contains(startEl)) {
      return null;
    }

    const findClosest = (el: Element | null): Element | null => {
      if (el === null) {
        return null;
      }

      if (el.matches(s)) {
        return el;
      }

      const parent: ParentNode | null = el.parentElement || el.parentNode;

      return findClosest(parent instanceof Element ? parent : null);
    };

    return findClosest(startEl);
  };
}

/**
 * The ParentNode.prepend method inserts a set of Node objects
 * or DOMString objects before the first child of the ParentNode.
 * DOMString objects are inserted as equivalent Text nodes.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/ParentNode/prepend#Polyfill}
 * @param {Node | Node[] | string | string[]} nodes - nodes to prepend
 */
if (typeof Element.prototype.prepend === 'undefined') {
  Element.prototype.prepend = function prepend(nodes: Array<Node | string> | Node | string): void {
    const docFrag = document.createDocumentFragment();

    const nodesArray = Array.isArray(nodes) ? nodes : [ nodes ];

    nodesArray.forEach((node: Node | string) => {
      const isNode = node instanceof Node;

      docFrag.appendChild(isNode ? node as Node : document.createTextNode(node as string));
    });

    this.insertBefore(docFrag, this.firstChild);
  };
}

interface Element {
  /**
   * Scrolls the current element into the visible area of the browser window
   *
   * @param centerIfNeeded - true, if the element should be aligned so it is centered within the visible area of the scrollable ancestor.
   */
  scrollIntoViewIfNeeded(centerIfNeeded?: boolean): void;
}

/**
 * ScrollIntoViewIfNeeded polyfill by KilianSSL (forked from hsablonniere)
 *
 * @see {@link https://gist.github.com/KilianSSL/774297b76378566588f02538631c3137}
 * @param centerIfNeeded - true, if the element should be aligned so it is centered within the visible area of the scrollable ancestor.
 */
if (typeof Element.prototype.scrollIntoViewIfNeeded === 'undefined') {
  Element.prototype.scrollIntoViewIfNeeded = function (this: HTMLElement, centerIfNeeded): void {
    const shouldCenter = centerIfNeeded ?? true;

    const parent = this.parentElement;

    if (!parent) {
      return;
    }

    const parentComputedStyle = window.getComputedStyle(parent, null);
    const parentBorderTopWidth = parseInt(parentComputedStyle.getPropertyValue('border-top-width'));
    const parentBorderLeftWidth = parseInt(parentComputedStyle.getPropertyValue('border-left-width'));
    const overTop = this.offsetTop - parent.offsetTop < parent.scrollTop;
    const overBottom = (this.offsetTop - parent.offsetTop + this.clientHeight - parentBorderTopWidth) > (parent.scrollTop + parent.clientHeight);
    const overLeft = this.offsetLeft - parent.offsetLeft < parent.scrollLeft;
    const overRight = (this.offsetLeft - parent.offsetLeft + this.clientWidth - parentBorderLeftWidth) > (parent.scrollLeft + parent.clientWidth);
    const alignWithTop = overTop && !overBottom;

    if ((overTop || overBottom) && shouldCenter) {
      parent.scrollTop = this.offsetTop - parent.offsetTop - parent.clientHeight / 2 - parentBorderTopWidth + this.clientHeight / 2;
    }

    if ((overLeft || overRight) && shouldCenter) {
      parent.scrollLeft = this.offsetLeft - parent.offsetLeft - parent.clientWidth / 2 - parentBorderLeftWidth + this.clientWidth / 2;
    }

    if ((overTop || overBottom || overLeft || overRight) && !shouldCenter) {
      this.scrollIntoView(alignWithTop);
    }
  };
}

/**
 * RequestIdleCallback polyfill (shims)
 *
 * @see https://developer.chrome.com/blog/using-requestidlecallback/
 * @param cb - callback to be executed when the browser is idle
 */
type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

const idleCallbackTimeouts = new Map<number, TimeoutHandle>();

const resolveNumericHandle = (handle: TimeoutHandle): number => {
  const numericHandle = Number(handle);

  if (Number.isFinite(numericHandle) && numericHandle > 0) {
    return numericHandle;
  }

  return Date.now();
};

if (typeof window.requestIdleCallback === 'undefined') {
  window.requestIdleCallback = function (cb) {
    const start = Date.now();
    const handleRef: { value?: number } = {};
    const timeoutHandle = nativeSetTimeout(() => {
      const handle = handleRef.value;

      if (typeof handle === 'number') {
        idleCallbackTimeouts.delete(handle);
      }

      cb({
        didTimeout: false,
        timeRemaining: function () {
          // eslint-disable-next-line @typescript-eslint/no-magic-numbers
          return Math.max(0, 50 - (Date.now() - start));
        },
      });
    }, 1);
    const numericHandle = resolveNumericHandle(timeoutHandle);

    handleRef.value = numericHandle;
    idleCallbackTimeouts.set(numericHandle, timeoutHandle);

    return numericHandle;
  };
}

if (typeof window.cancelIdleCallback === 'undefined') {
  window.cancelIdleCallback = function (id) {
    const timeoutHandle = idleCallbackTimeouts.get(id);

    if (timeoutHandle !== undefined) {
      idleCallbackTimeouts.delete(id);
      nativeClearTimeout(timeoutHandle);
    }

    globalThis.clearTimeout(id);
  };
}
