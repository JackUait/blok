import { DATA_ATTR } from '../constants/data-attributes';

type Side = 'start' | 'end';

/** Inline tags a fill can sit inside or next to and still touch its neighbor. */
const INLINE_WRAPPERS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'CODE', 'SPAN', 'SUB', 'SUP']);

const isFill = (node: Node): node is HTMLElement => {
  if (!(node instanceof HTMLElement) || node.tagName !== 'MARK') {
    return false;
  }
  const background = node.style.backgroundColor;

  return background !== '' && background !== 'transparent';
};

const isEmptyText = (node: Node): boolean => {
  return node.nodeType === Node.TEXT_NODE && node.nodeValue === '';
};

/**
 * The node right before or after `node` in the line, climbing out of inline wrappers.
 */
const neighborOf = (node: Node, side: Side, root: Node): Node | null => {
  const sibling = side === 'start' ? node.previousSibling : node.nextSibling;

  if (sibling !== null) {
    return isEmptyText(sibling) ? neighborOf(sibling, side, root) : sibling;
  }
  const parent = node.parentElement;

  if (parent === null || parent === root || !INLINE_WRAPPERS.has(parent.tagName)) {
    return null;
  }

  return neighborOf(parent, side, root);
};

const touchesFill = (mark: HTMLElement, side: Side, root: Node): boolean => {
  const edgeOf = (node: Node | null): Node | null => {
    if (node === null || !(node instanceof HTMLElement) || !INLINE_WRAPPERS.has(node.tagName)) {
      return node;
    }
    const child = side === 'start' ? node.lastChild : node.firstChild;

    if (child !== null && isEmptyText(child)) {
      return edgeOf(neighborOf(child, side, node) ?? null);
    }

    return edgeOf(child);
  };
  const neighbor = edgeOf(neighborOf(mark, side, root));

  return neighbor !== null && isFill(neighbor);
};

/**
 * Marks the sides where a background fill touches another one, so the
 * stylesheet can square the shared edge. CSS cannot do this alone: it does not
 * see the text between two sibling marks.
 */
export const joinTouchingMarks = (root: HTMLElement): void => {
  for (const mark of root.getElementsByTagName('mark')) {
    const sides = isFill(mark)
      ? (['start', 'end'] as const).filter((side) => touchesFill(mark, side, root)).join(' ')
      : '';

    if (sides === (mark.getAttribute(DATA_ATTR.markJoined) ?? '')) {
      continue;
    }
    if (sides === '') {
      mark.removeAttribute(DATA_ATTR.markJoined);
    } else {
      mark.setAttribute(DATA_ATTR.markJoined, sides);
    }
  }
};
