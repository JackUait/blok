import type { BlockAPI as BlockAPIInterface } from '../../../types/api';

/**
 * How long the watch below stays armed. Not a behaviour knob — the placement
 * fires off the MutationObserver, which is precise — purely a leak guard so a
 * block whose DOM never produces an input (a delimiter) drops its observer
 * instead of holding its holder alive for the session.
 */
const RENDER_GRACE_MS = 1000;

/**
 * Put the caret into a freshly inserted child, and put it there AGAIN if the
 * child's editable DOM only shows up after the insert returns.
 *
 * Core's contract says `render()` is synchronous, and for a vanilla tool it is —
 * so the placement below normally lands on the first attempt and the watch is
 * never armed. A PORTAL-rendered tool (every React/Vue/Angular block) breaks
 * that assumption: `render()` hands back an empty, mutation-free host and the
 * framework commits the real content on its next commit. Until then the block
 * has no inputs, so it is not `focusable`, and `Caret.setToBlock` answers a
 * non-focusable block the only way it can — clear the selection, blur the active
 * element, HIGHLIGHT the block. The author is left with a selected empty child
 * and no caret, permanently, because nothing ever re-runs the placement.
 *
 * That is why hosts hand-rolled "insert, wait for `block:childrenMounted`, then
 * set the caret" themselves: Blok shipped the signal but not the helper. This is
 * the helper. The re-application is one-shot, and it stands down when the author
 * has moved focus somewhere else in the meantime — an async caret placement that
 * ignored that would yank the caret out from under them.
 * @param setToBlock - the editor caret API's `setToBlock`
 * @param child - the freshly inserted child's API (read LIVE: `focusable` flips
 *   the moment its DOM commits)
 * @param position - caret position to apply, as `caret.setToBlock` takes it
 * @param offset - caret offset within the resolved input
 */
export const placeCaretInInsertedChild = (
  setToBlock: (id: string, position: 'end' | 'start' | 'default', offset: number) => void,
  child: BlockAPIInterface,
  position: 'end' | 'start' | 'default',
  offset: number
): void => {
  setToBlock(child.id, position, offset);

  /**
   * Landed properly: the child already had an input, which is every vanilla
   * tool. Nothing to watch for.
   */
  if (child.focusable) {
    return;
  }

  const holder = child.holder as HTMLElement | undefined;

  if (!(holder instanceof HTMLElement)) {
    return;
  }

  const ownerDocument = holder.ownerDocument;
  const armedActiveElement = ownerDocument.activeElement;

  /**
   * The author interacting during the gap outranks a caret placement they asked
   * for a frame ago. Compared against the element focused when the watch was
   * armed rather than against `body`, so a container that inserts a child FROM
   * its own editable (a card title taking Enter) still hands the caret over.
   */
  const focusMovedAway = (): boolean => {
    const active = ownerDocument.activeElement;

    return active !== armedActiveElement && active !== null && !holder.contains(active);
  };

  const observer = new MutationObserver(() => {
    if (!child.focusable) {
      return;
    }

    // One-shot: stop watching before placing, so a mutation the placement itself
    // causes cannot re-enter.
    observer.disconnect();
    clearTimeout(graceTimer);

    if (focusMovedAway()) {
      return;
    }

    setToBlock(child.id, position, offset);
  });

  const graceTimer = setTimeout(() => observer.disconnect(), RENDER_GRACE_MS);

  observer.observe(holder, {
    childList: true,
    subtree: true,
  });
};
