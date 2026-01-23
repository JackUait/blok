/**
 * Check if an element is a bold tag (STRONG or B)
 * @param node - The element to check
 */
export const isBoldTag = (node: Element): boolean => {
  const tag = node.tagName;

  return tag === 'B' || tag === 'STRONG';
};

/**
 * Type guard to check if a node is a bold element (STRONG or B)
 * @param node - Node to inspect
 */
export const isBoldElement = (node: Node | null): node is Element => {
  return Boolean(node && node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element));
};

/**
 * Check if an element has no text content
 * @param element - The element to check
 */
export const isElementEmpty = (element: HTMLElement): boolean => {
  return element.textContent.length === 0;
};

/**
 * Recursively check if a node or any of its parents is a bold tag
 * @param node - The node to check
 */
export const hasBoldParent = (node: Node | null): boolean => {
  if (!node) {
    return false;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element)) {
    return true;
  }

  return hasBoldParent(node.parentNode);
};

/**
 * Recursively find a bold element in the parent chain
 * @param node - The node to start searching from
 */
export const findBoldElement = (node: Node | null): HTMLElement | null => {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element)) {
    return ensureStrongElement(node as HTMLElement);
  }

  return findBoldElement(node.parentNode);
};

/**
 * Ensure an element is a STRONG tag, converting from B if needed
 * @param element - The element to ensure is a strong tag
 */
export const ensureStrongElement = (element: HTMLElement): HTMLElement => {
  if (element.tagName === 'STRONG') {
    return element;
  }

  const strong = document.createElement('strong');

  if (element.hasAttributes()) {
    Array.from(element.attributes).forEach((attr) => {
      strong.setAttribute(attr.name, attr.value);
    });
  }

  while (element.firstChild) {
    strong.appendChild(element.firstChild);
  }

  element.replaceWith(strong);

  return strong;
};

/**
 * Ensure there is a text node immediately following the provided bold element
 * @param boldElement - Bold element that precedes the boundary
 * @returns The text node following the bold element or null if it cannot be created
 */
export const ensureTextNodeAfter = (boldElement: HTMLElement): Text | null => {
  const existingNext = boldElement.nextSibling;

  if (existingNext?.nodeType === Node.TEXT_NODE) {
    return existingNext as Text;
  }

  const parent = boldElement.parentNode;

  if (!parent) {
    return null;
  }

  const newNode = boldElement.ownerDocument.createTextNode('');

  parent.insertBefore(newNode, existingNext);

  return newNode;
};

/**
 * Place caret at the provided offset within a text node
 * @param selection - Current selection
 * @param node - Target text node
 * @param offset - Offset within the text node
 */
export const setCaret = (selection: Selection, node: Text, offset: number): void => {
  const newRange = document.createRange();

  newRange.setStart(node, offset);
  newRange.collapse(true);

  selection.removeAllRanges();
  selection.addRange(newRange);
};

/**
 * Position caret immediately after the provided node
 * @param selection - Current selection
 * @param node - Reference node
 */
export const setCaretAfterNode = (selection: Selection, node: Node | null): void => {
  if (!node) {
    return;
  }

  const newRange = document.createRange();

  newRange.setStartAfter(node);
  newRange.collapse(true);

  selection.removeAllRanges();
  selection.addRange(newRange);
};

/**
 * Resolve the boundary text node tracked for a collapsed exit record
 * @param record - Record containing boundary and boldElement
 * @returns The aligned boundary text node or null when it cannot be determined
 */
export const resolveBoundary = (record: { boundary: Text; boldElement: HTMLElement }): { boundary: Text; boldElement: HTMLElement } | null => {
  if (!record.boldElement.isConnected) {
    return null;
  }

  const strong = ensureStrongElement(record.boldElement);
  const boundary = record.boundary;
  const isAligned = boundary.isConnected && boundary.previousSibling === strong;
  const resolvedBoundary = isAligned ? boundary : ensureTextNodeAfter(strong);

  if (!resolvedBoundary) {
    return null;
  }

  return {
    boundary: resolvedBoundary,
    boldElement: strong,
  };
};

/**
 * Check if a node is within the provided container
 * @param target - Node to test
 * @param container - Potential ancestor container
 */
export const isNodeWithin = (target: Node | null, container: Node): boolean => {
  if (!target) {
    return false;
  }

  return target === container || container.contains(target);
};
