/**
 * HTML manipulation utilities
 */

/**
 * Strips editor-only wrapper elements from HTML content: the inline toolbar's
 * fake selection background and the slash menu's pill around "/query". The
 * block stays watched while the slash menu is open, so its saves see the pill.
 * @param html - HTML content that may contain those wrappers
 * @returns HTML content with the wrappers removed but their content preserved
 */
export const stripFakeBackgroundElements = (html: string): string => {
  if (!html || (!html.includes('data-blok-fake-background') && !html.includes('data-blok-slash-search'))) {
    return html;
  }

  const tempDiv = document.createElement('div');

  tempDiv.innerHTML = html;

  const fakeBackgrounds = tempDiv.querySelectorAll('[data-blok-fake-background="true"], span[data-blok-slash-search]');

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

  // Neither move keeps a caret inside the node: insertBefore detaches it, and
  // Chrome's moveBefore moves the caret too (a move redo lost U113's caret).
  const keep = selectionInside(node);

  moveNode(parent, node, reference);

  if (keep !== null) {
    window.getSelection()?.setBaseAndExtent(keep.anchorNode, keep.anchorOffset, keep.focusNode, keep.focusOffset);
  }
};

const moveNode = (parent: StatefulMoveParent, node: Node, reference: Node | null): void => {
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
 * The live selection when both its ends sit inside `node`, else null.
 * @param node - the node about to move
 */
const selectionInside = (node: Node): { anchorNode: Node; anchorOffset: number; focusNode: Node; focusOffset: number } | null => {
  // A detached node cannot hold the selection. Checked first because Chrome
  // forces a whole-page layout on each selection read while nothing is selected.
  if (!node.isConnected) {
    return null;
  }

  const selection = typeof window === 'undefined' ? null : window.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const focusNode = selection?.focusNode ?? null;

  if (selection === null || selection.rangeCount === 0 || anchorNode === null || focusNode === null || !node.contains(anchorNode) || !node.contains(focusNode)) {
    return null;
  }

  return { anchorNode, anchorOffset: selection.anchorOffset, focusNode, focusOffset: selection.focusOffset };
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
