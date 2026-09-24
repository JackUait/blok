import { Dom as $ } from '../dom';
import { DATA_ATTR } from '../constants/data-attributes';

const BLOCK_HOLDER_SELECTOR = '[data-blok-element]';
const TABLE_CELL_BLOCKS_SELECTOR = '[data-blok-table-cell-blocks]';
/** Tool UI that is always in the DOM next to the user's content: a toggle's arrow and body placeholder, a list marker, a checkbox, a code block's header and line numbers. */
const CHROME_SELECTOR = `[${DATA_ATTR.chrome}]`;

/**
 * Whether `element` belongs to the block whose holder is `holder`, not to a
 * block nested inside it. A holder that lacks the attribute (unit stubs) still
 * owns everything no nested holder claims.
 * @param holder - the block's holder
 * @param element - an element inside the holder
 */
const isOwnedBy = (holder: Element, element: Element): boolean => {
  const owner = element.closest(BLOCK_HOLDER_SELECTOR);

  return owner === null || owner === holder || !holder.contains(owner);
};

/**
 * The first element matching `selector` that belongs to the block itself.
 *
 * Use this instead of `holder.querySelector` for any marker nested blocks also
 * carry (toggle state, child slots, headings, list attributes). A container's
 * holder holds its children's holders, so a raw query can return a CHILD's
 * marker: a value selector like `[data-blok-toggle-open="false"]` skips the
 * block's own marker, and a container without the marker finds a child's.
 *
 * A selector that matches a nested holder itself counts as that child's.
 * @param holder - the block's holder, or any root the block owns (a tool wrapper)
 * @param selector - CSS selector to match
 */
export const findOwn = (holder: Element, selector: string): Element | null => {
  const first = holder.querySelector(selector);

  if (first === null || isOwnedBy(holder, first)) {
    return first;
  }

  return Array.from(holder.querySelectorAll(selector)).find(element => isOwnedBy(holder, element)) ?? null;
};

/**
 * A copy of a block's element without nested child blocks and without tool
 * chrome: the block's own content only. Blocks in a table cell stay, because
 * they are the table's own cell content.
 * @param root - the block's holder or tool root
 */
export const ownClone = (root: HTMLElement): HTMLElement => {
  const clone = root.cloneNode(true) as HTMLElement;

  clone.querySelectorAll(CHROME_SELECTOR).forEach((chrome) => chrome.remove());
  clone.querySelectorAll(BLOCK_HOLDER_SELECTOR).forEach((nested) => {
    const cell = nested.closest(TABLE_CELL_BLOCKS_SELECTOR);

    if (cell === null || !clone.contains(cell)) {
      nested.remove();
    }
  });

  return clone;
};

/**
 * The text of `root` without tool chrome. Nested child blocks' text stays.
 * @param root - a block's holder, tool root or child container
 */
export const textWithoutChrome = (root: Element): string => {
  const clone = root.cloneNode(true) as Element;

  clone.querySelectorAll(CHROME_SELECTOR).forEach((chrome) => chrome.remove());

  return clone.textContent ?? '';
};

/**
 * Whether `root` holds no text and no single-tag content (img, input, hr…),
 * like `Dom.isEmpty`, but skipping tool chrome. Chrome stays in the DOM (a
 * list marker's "•", a checkbox, an svg's whitespace), so a plain read makes
 * the block look filled. Nested child blocks still count.
 * @param root - the block's holder or tool root
 */
export const isContentEmpty = (root: Node): boolean => {
  const pending: Node[] = [ root ];

  while (pending.length > 0) {
    const node = pending.shift();

    if (node === undefined || (node instanceof Element && node.matches(CHROME_SELECTOR))) {
      continue;
    }

    if ($.isLeaf(node) && !$.isNodeEmpty(node)) {
      return false;
    }

    pending.push(...Array.from(node.childNodes));
  }

  return true;
};

/**
 * Whether `root` holds an element matching `selector` outside tool chrome.
 * @param root - the block's holder or tool root
 * @param selector - CSS selector to match
 */
export const hasContentMatching = (root: Element, selector: string): boolean =>
  Array.from(root.querySelectorAll(selector)).some((element) => element.closest(CHROME_SELECTOR) === null);
