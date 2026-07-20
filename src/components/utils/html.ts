/**
 * HTML manipulation utilities
 */

/**
 * Strips fake background wrapper elements from HTML content.
 * These elements are used by the inline toolbar for visual selection highlighting
 * and should not be persisted in saved data.
 * @param html - HTML content that may contain fake background elements
 * @returns HTML content with fake background wrappers removed but their content preserved
 */
export const stripFakeBackgroundElements = (html: string): string => {
  if (!html || !html.includes('data-blok-fake-background')) {
    return html;
  }

  const tempDiv = document.createElement('div');

  tempDiv.innerHTML = html;

  const fakeBackgrounds = tempDiv.querySelectorAll('[data-blok-fake-background="true"]');

  fakeBackgrounds.forEach((element) => {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  });

  return tempDiv.innerHTML;
};

/**
 * An intersection rather than `interface extends Element`: TypeScript 6's
 * lib.dom.d.ts declares `moveBefore` as a required member of ParentNode, and an
 * interface may not redeclare an inherited member as optional. Intersections
 * skip that declaration-compatibility check, so this compiles on both the 5.9
 * libs (no `moveBefore` at all) and the 6.0 libs (required `moveBefore`).
 */
type StatefulMoveParent = Element & {
  moveBefore?(node: Node, reference: Node | null): void;
};

/**
 * Repositions an already-attached node within `parent`, inserting it before
 * `reference` (or at the end when `reference` is null), while preserving the
 * node's live state — an iframe keeps its loaded document, media keeps playing,
 * form fields keep focus and value.
 *
 * A plain insertBefore/appendChild detaches and re-attaches the node, which
 * resets exactly that state (re-parented iframes reload). The browser's
 * state-preserving move (`moveBefore`, Chrome 133+) avoids the detach; we fall
 * back to insertBefore where it is unavailable or throws (e.g. cross-document
 * moves, or a node that is not connected).
 */
const statefulMove = (parent: StatefulMoveParent, node: Node, reference: Node | null): void => {
  if (reference === node) {
    return;
  }

  if (typeof parent.moveBefore === 'function' && node.isConnected && parent.isConnected) {
    try {
      parent.moveBefore(node, reference);

      return;
    } catch {
      // moveBefore enforces stricter invariants than insertBefore (same
      // document, connected node); fall back to a plain, state-resetting insert.
    }
  }

  parent.insertBefore(node, reference);
};

/**
 * Moves `node` to sit immediately before `reference`, preserving live state.
 * @see statefulMove
 */
export const moveElementBefore = (node: Node, reference: Element): void => {
  const parent = reference.parentNode;

  if (parent instanceof Element) {
    statefulMove(parent, node, reference);
  }
};

/**
 * Moves `node` to sit immediately after `reference`, preserving live state.
 * @see statefulMove
 */
export const moveElementAfter = (node: Node, reference: Element): void => {
  const parent = reference.parentNode;

  if (parent instanceof Element) {
    statefulMove(parent, node, reference.nextSibling);
  }
};

/**
 * Moves `node` to the end of `parent`'s children, preserving live state.
 * @see statefulMove
 */
export const moveElementToEnd = (parent: Element, node: Node): void => {
  statefulMove(parent, node, null);
};
