import type { Block } from '../block';

/**
 * One block's share of a cross-block text selection: the part of the selection
 * that falls inside a single editing host (a `contenteditable` element).
 */
export interface CrossBlockSubRange {
  /** The block owning the editing host. */
  block: Block;
  /** The editing host the sub-range is confined to. */
  input: HTMLElement;
  /** The selection clamped to that host. */
  range: Range;
  /** Whether the sub-range covers the host's entire contents. */
  coversWholeInput: boolean;
}

/**
 * A character-level selection whose endpoints sit in the editing hosts of two
 * DIFFERENT blocks.
 */
export interface CrossBlockTextSelection {
  /** The live spanning range (the one stored in the document Selection). */
  range: Range;
  /** The selection split into one entry per editing host, in DOM order. */
  subRanges: CrossBlockSubRange[];
  /** Block holding the range's start. */
  startBlock: Block;
  /** Block holding the range's end. */
  endBlock: Block;
}

/**
 * A list item renders its bullet/number marker BEFORE the content cell, and any
 * code that toggles editability can flip that marker to `contenteditable="true"`.
 * Every such decoration is stamped `data-blok-mutation-free`, and excluding it
 * is the First-Editable Selector Law: without the guard the marker would be
 * discovered as an editing host and a selection would treat the bullet as a
 * block's text.
 */
const EDITING_HOST_SELECTOR = '[contenteditable="true"]:not([data-blok-mutation-free])';

/**
 * The `contenteditable` element that owns a node, i.e. the node's editing host.
 *
 * Read from the DOM rather than from `block.inputs` on purpose: a block's input
 * list is cached and can include a container's child-block inputs, while the
 * editing host is exactly what the browser clamps a selection to.
 * @param node - node to resolve
 */
export const getEditingHost = (node: Node | null | undefined): HTMLElement | null => {
  if (node === null || node === undefined) {
    return null;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const host = element?.closest(EDITING_HOST_SELECTOR) ?? null;

  return host instanceof HTMLElement ? host : null;
};

/**
 * Whether a subtree holds any editable content — i.e. whether it can take a
 * share of a character range at all.
 * @param root - subtree to test
 */
export const hasEditableContent = (root: Element): boolean => {
  return root.querySelector(EDITING_HOST_SELECTOR) !== null;
};

/**
 * Split a range into one sub-range per editing host it covers, each clamped to
 * that host. Hosts the range only touches (producing an empty sub-range) are
 * dropped, so the result never contains a zero-length entry.
 * @param range - the spanning range
 * @param root - the editor's redactor element, searched for editing hosts
 * @param blockOf - resolves a node to the block owning it
 */
export const collectCrossBlockSubRanges = (
  range: Range,
  root: HTMLElement,
  blockOf: (node: Node) => Block | undefined
): CrossBlockSubRange[] => {
  return splitRangeByEditingHost(range, root).reduce<CrossBlockSubRange[]>((accumulator, entry) => {
    const block = blockOf(entry.input);

    if (block === undefined) {
      return accumulator;
    }

    return [...accumulator, {
      block,
      input: entry.input,
      range: entry.range,
      coversWholeInput: entry.coversWholeInput,
    }];
  }, []);
};

/** One editing host's share of a range. */
export interface HostSubRange {
  /** The editing host. */
  input: HTMLElement;
  /** The range clamped to that host. */
  range: Range;
  /** Whether the sub-range covers the host's entire contents. */
  coversWholeInput: boolean;
}

/**
 * Split a range into one sub-range per editing host it covers, each clamped to
 * that host.
 *
 * A host the range only TOUCHES — a drag that ends at offset 0 of the next
 * block — is kept, with a zero-length share. Dropping it would make a two-block
 * selection resolve as single-block (so nothing would paint) and would lose the
 * block break the user selected, which is what the delete has to consume.
 * Consumers that need actual characters (marks, the clipboard) filter the empty
 * shares out themselves.
 *
 * Anything that EDITS a range has to go through this: a range spanning two
 * contenteditable hosts is not something an engine will edit sanely (the mark
 * engine's own surround/extract on one deletes content outright), and no gesture
 * could produce such a range before cross-block text selection existed.
 * @param range - the range to split
 * @param root - subtree to search for hosts; defaults to the range's own
 *   common ancestor, which is the smallest subtree that can contain them all
 */
export const splitRangeByEditingHost = (range: Range, root?: Element): HostSubRange[] => {
  const container = range.commonAncestorContainer;
  const scope = root ?? (
    container.nodeType === Node.ELEMENT_NODE
      ? container as Element
      : container.parentElement
  );

  if (scope === null || scope === undefined) {
    return [];
  }

  const hosts = Array.from(scope.querySelectorAll<HTMLElement>(EDITING_HOST_SELECTOR));
  const ownHost = getEditingHost(container);

  /**
   * When the range sits inside ONE host, that host is an ancestor of the scope
   * and querySelectorAll would never find it.
   */
  if (ownHost !== null && !hosts.includes(ownHost)) {
    hosts.unshift(ownHost);
  }

  return hosts.reduce<HostSubRange[]>((accumulator, input) => {
    if (!range.intersectsNode(input)) {
      return accumulator;
    }

    const whole = input.ownerDocument.createRange();

    whole.selectNodeContents(input);

    const sub = whole.cloneRange();
    const startsInsideHost = range.compareBoundaryPoints(Range.START_TO_START, whole) > 0;
    const endsInsideHost = range.compareBoundaryPoints(Range.END_TO_END, whole) < 0;

    if (startsInsideHost) {
      sub.setStart(range.startContainer, range.startOffset);
    }

    if (endsInsideHost) {
      sub.setEnd(range.endContainer, range.endOffset);
    }

    if (sub.collapsed) {
      return accumulator;
    }

    return [...accumulator, {
      input,
      range: sub,
      coversWholeInput: !startsInsideHost && !endsInsideHost,
    }];
  }, []);
};

/**
 * Read the document's current selection as a cross-block text selection, or
 * null when it is collapsed, empty, outside `root`, or confined to one block.
 *
 * The spanning Range — never `Selection.anchorNode`/`focusNode` — is the source
 * of truth: WebKit clamps those getters to the anchor's editing host while
 * still storing the full range, so reading them would make every cross-block
 * selection look single-block there.
 * @param root - the editor's redactor element
 * @param blockOf - resolves a node to the block owning it
 */
export const resolveCrossBlockTextSelection = (
  root: HTMLElement,
  blockOf: (node: Node) => Block | undefined
): CrossBlockTextSelection | null => {
  const selection = root.ownerDocument.defaultView?.getSelection() ?? null;

  if (selection === null || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);

  if (range.collapsed) {
    return null;
  }

  const startHost = getEditingHost(range.startContainer);
  const endHost = getEditingHost(range.endContainer);

  if (startHost === null || endHost === null || startHost === endHost) {
    return null;
  }

  if (!root.contains(startHost) || !root.contains(endHost)) {
    return null;
  }

  const startBlock = blockOf(startHost);
  const endBlock = blockOf(endHost);

  if (startBlock === undefined || endBlock === undefined || startBlock === endBlock) {
    return null;
  }

  const subRanges = collectCrossBlockSubRanges(range, root, blockOf);

  if (subRanges.length < 2) {
    return null;
  }

  return {
    range,
    subRanges,
    startBlock,
    endBlock,
  };
};

/**
 * The blocks lying STRICTLY between two same-parent siblings, in document order.
 *
 * Deliberately not `BlockManager.getSelectionSiblingRange`: that lifts both
 * endpoints to siblings under their lowest common ancestor, so two lines of one
 * table cell come back as the TABLE block — and a caller deleting "everything
 * between the endpoints" would delete the table the lines live in.
 * @param blocks - the editor's flat block list, in document order
 * @param from - one endpoint
 * @param to - the other endpoint
 */
export const blocksBetween = (blocks: Block[], from: Block, to: Block): Block[] => {
  if (from.parentId !== to.parentId) {
    return [];
  }

  const siblings = blocks.filter((block) => block.parentId === from.parentId);
  const first = siblings.indexOf(from);
  const last = siblings.indexOf(to);

  if (first === -1 || last === -1) {
    return [];
  }

  return siblings.slice(Math.min(first, last) + 1, Math.max(first, last));
};

/**
 * Whether the document selection is a text range spanning two DIFFERENT editing
 * hosts inside `root`.
 *
 * A container tool needs this wherever it currently asks "is a block inside me
 * selected?" to decide whether the user has a selection of their own: a
 * cross-block text range carries no `data-blok-selected` marker, so a check for
 * that attribute alone reads as "nothing selected" and the tool helpfully steals
 * the caret — collapsing the range the user just made.
 * @param root - the subtree to test within
 */
export const hasCrossHostSelectionWithin = (root: Element): boolean => {
  const selection = root.ownerDocument.defaultView?.getSelection() ?? null;

  if (selection === null || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);

  if (range.collapsed) {
    return false;
  }

  const startHost = getEditingHost(range.startContainer);
  const endHost = getEditingHost(range.endContainer);

  return startHost !== null &&
    endHost !== null &&
    startHost !== endHost &&
    root.contains(startHost) &&
    root.contains(endHost);
};

/**
 * Replace the document selection with a range spanning two points in different
 * editing hosts.
 *
 * `removeAllRanges()` + `addRange()` is the ONLY form that crosses an editing
 * host in every engine: `Selection.extend()` throws in Firefox and silently
 * clamps in WebKit, and `setBaseAndExtent()` clamps in WebKit too.
 * @param anchor - where the gesture started
 * @param focus - where the gesture currently points
 * @returns the applied range, or null when the two points cannot form one
 */
export const applySpanningSelection = (
  anchor: { node: Node; offset: number },
  focus: { node: Node; offset: number }
): Range | null => {
  const document = anchor.node.ownerDocument;
  const selection = document?.defaultView?.getSelection() ?? null;

  if (document === null || selection === null) {
    return null;
  }

  const probe = document.createRange();

  try {
    probe.setStart(anchor.node, anchor.offset);
    probe.setEnd(anchor.node, anchor.offset);
  } catch {
    return null;
  }

  const backwards = probe.comparePoint(focus.node, focus.offset) < 0;
  const range = document.createRange();

  try {
    if (backwards) {
      range.setStart(focus.node, focus.offset);
      range.setEnd(anchor.node, anchor.offset);
    } else {
      range.setStart(anchor.node, anchor.offset);
      range.setEnd(focus.node, focus.offset);
    }
  } catch {
    return null;
  }

  selection.removeAllRanges();
  selection.addRange(range);

  return range;
};

/**
 * The caret position under a viewport point, or null when there is none.
 *
 * `caretPositionFromPoint` is the standard; `caretRangeFromPoint` is the older
 * WebKit-originated form. Every engine ships at least one, and both are needed
 * because the drag focus has to follow the pointer CONTINUOUSLY — mouseover only
 * fires when the pointer crosses an element boundary, which would freeze the
 * focus at whatever character the block was entered on.
 * @param x - viewport x
 * @param y - viewport y
 * @param doc - document to hit-test in
 */
export const caretPointFromCoords = (
  x: number,
  y: number,
  doc: Document
): { node: Node; offset: number } | null => {
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y);

    if (position !== null && position.offsetNode !== null) {
      return { node: position.offsetNode,
        offset: position.offset };
    }
  }

  /**
   * Deprecated in favour of caretPositionFromPoint, but it is the ONLY form
   * Safari shipped before 17 — dropping it would silently disable cross-block
   * drag selection there.
   */
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (typeof doc.caretRangeFromPoint === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const range = doc.caretRangeFromPoint(x, y);

    if (range !== null) {
      return { node: range.startContainer,
        offset: range.startOffset };
    }
  }

  return null;
};

/**
 * The position at an editing host's very start or very end — where a drag focus
 * is clamped when the pointer is past the block's text (in its padding, or in
 * the gap between blocks) and the hit test has no character to offer.
 * @param input - the editing host
 * @param atEnd - true for the end of the host, false for its start
 */
export const pointAtInputBoundary = (
  input: HTMLElement,
  atEnd: boolean
): { node: Node; offset: number } => {
  const range = input.ownerDocument.createRange();

  range.selectNodeContents(input);
  range.collapse(!atEnd);

  return { node: range.startContainer,
    offset: range.startOffset };
};
