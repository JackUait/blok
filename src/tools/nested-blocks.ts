import { DATA_ATTR } from '../components/constants/data-attributes';
import { moveElementBefore, moveElementToEnd } from '../components/utils/html';

/**
 * The caret, captured as raw primitives.
 *
 * A Range cannot stand in for this: every Range is LIVE, so the removal a
 * non-preserving move performs relocates its boundary points out of the moved
 * subtree before they could be re-applied. The (node, offset) pairs read out
 * beforehand are the only thing that survives.
 */
interface CaretSnapshot {
  /** The focused element, when it sits inside the holder being moved. */
  focused: HTMLElement | null;
  /** Range start, when the range sits inside the holder being moved. */
  start: [Node, number] | null;
  /** Range end, matching {@link CaretSnapshot.start}. */
  end: [Node, number] | null;
}

/**
 * Captures focus + caret, but only the part of it that lives inside `holder` —
 * a selection anywhere else is none of this move's business and must be left
 * exactly as it is.
 * @param holder - the holder about to be moved
 * @returns the snapshot, or null when the caret is elsewhere
 */
const captureCaretWithin = (holder: HTMLElement): CaretSnapshot | null => {
  const ownerDocument = holder.ownerDocument;
  const activeElement = ownerDocument.activeElement;
  const focused =
    activeElement instanceof HTMLElement && holder.contains(activeElement) ? activeElement : null;

  const selection = ownerDocument.defaultView?.getSelection() ?? null;
  const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rangeInside =
    range !== null && holder.contains(range.startContainer) && holder.contains(range.endContainer);

  if (focused === null && !rangeInside) {
    return null;
  }

  return {
    focused,
    start: rangeInside && range !== null ? [range.startContainer, range.startOffset] : null,
    end: rangeInside && range !== null ? [range.endContainer, range.endOffset] : null,
  };
};

/**
 * Re-applies a snapshot, but only where the move actually destroyed it —
 * a browser with the state-preserving move keeps focus and the caret itself,
 * and re-setting an identical range there would emit a spurious
 * `selectionchange` at every container render.
 * @param snapshot - what {@link captureCaretWithin} read, or null
 */
const restoreCaret = (snapshot: CaretSnapshot | null): void => {
  if (snapshot === null) {
    return;
  }

  const { focused, start, end } = snapshot;

  if (focused !== null && focused.isConnected && focused.ownerDocument.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }

  if (start === null || end === null || !start[0].isConnected) {
    return;
  }

  const ownerDocument = start[0].ownerDocument;
  const selection = ownerDocument?.defaultView?.getSelection() ?? null;

  if (ownerDocument === null || selection === null) {
    return;
  }

  const live = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const intact =
    live !== null &&
    live.startContainer === start[0] &&
    live.startOffset === start[1] &&
    live.endContainer === end[0] &&
    live.endOffset === end[1];

  if (intact) {
    return;
  }

  const range = ownerDocument.createRange();

  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Mount child block holders into a container, skipping children that are
 * already in place or claimed by another nested-blocks container.
 *
 * Used by toggle, header, column, and callout tools — and by the React, Vue and
 * Angular block adapters — to reconcile child holders during the `rendered()`
 * lifecycle hook. It is the standing DOM↔model reconciler for container blocks:
 * safe to call on every render, and the only thing that heals a child holder
 * that core parked outside the container while the container's own slot had not
 * been created yet.
 * @param container - the container element child holders belong in; usually the
 *   element carrying `data-blok-nested-blocks`.
 * @param children - the container block's MODEL children, in model order (e.g.
 *   `api.blocks.getChildren(blockId)`).
 */
export const mountChildBlocks = (
  container: HTMLElement,
  children: { holder: HTMLElement }[],
): void => {
  /**
   * Places a holder at its MODEL position: before the first later child that is
   * already mounted here, or at the end when there is none. A plain appendChild
   * would put a reclaimed middle child last — children [A, B, C] with only B
   * stranded would render A, C, B.
   *
   * The move goes through the state-preserving helpers rather than raw
   * insertBefore/appendChild: re-parenting a live node runs the DOM removing
   * steps, which blur the focused contenteditable and relocate every live Range
   * out of the moved subtree — the user's caret vanishes to <body> mid-typing.
   * Where the browser has no state-preserving move, the caret is put back by
   * hand around the move.
   * @param holder - the holder to mount
   * @param index - the holder's position in `children`
   */
  const mountAtModelPosition = (holder: HTMLElement, index: number): void => {
    const anchor = children
      .slice(index + 1)
      .find(next => next.holder.parentElement === container)?.holder ?? null;

    const caret = captureCaretWithin(holder);

    anchor !== null ? moveElementBefore(holder, anchor) : moveElementToEnd(container, holder);

    restoreCaret(caret);
  };

  for (const [index, child] of children.entries()) {
    if (child.holder.parentElement === container) {
      continue;
    }

    const nested = child.holder.closest(`[${DATA_ATTR.nestedBlocks}]`);

    // Claim a holder stranded in an ANCESTOR nested container. Callers pass
    // this container's own MODEL children, and a container that ENCLOSES this
    // one can never be a legitimate home for them — that is model/DOM
    // divergence by definition. Two ways to get there: a drag reparent into a
    // column drops the moved holder directly into the [data-blok-columns] row
    // (where it renders as a rogue extra column), and a newly inserted first
    // child is anchored as the container block's DOM *sibling*, i.e. inside
    // whatever nested container encloses it — permanent when the destination
    // slot had not committed yet (a framework adapter's portal commits a render
    // later than core inserts), because nothing else ever re-runs the mount.
    if (nested !== null && nested !== container && nested.contains(container)) {
      mountAtModelPosition(child.holder, index);
      continue;
    }

    // Otherwise leave holders that already live inside another nested container
    // (a sibling, or a deeper nesting within this one) where they are.
    if (nested !== null) {
      continue;
    }

    mountAtModelPosition(child.holder, index);
  }
};
