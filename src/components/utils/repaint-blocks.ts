import type { BlokModules } from '../../types-internal/blok-modules';

/**
 * Re-renders every mounted block from its own saved data, without the host
 * seeing an edit.
 *
 * Needed because a tool resolves editor-wide state — today, the active locale
 * and the host's message overrides — once while it renders, and writes the
 * result straight into its own DOM. Nothing links that DOM back to the value
 * it came from, so when the state changes at runtime the only way to repaint
 * *all* of it, including tools written years later that cannot be asked to
 * cooperate, is to render again from data.
 *
 * The cycle is deliberately invisible: modifications are muted so `onChange`
 * does not fire, the document (and with it the undo history) is left alone,
 * scroll is restored, and the caret returns to the block that had it — at the
 * end of that block, since a repaint rebuilds the nodes the old offset pointed
 * into. Focus is only restored if the editor held it, so a repaint never
 * steals it from the rest of the page.
 *
 * @param Blok - the editor's module instances
 */
export async function repaintBlocks(Blok: BlokModules): Promise<void> {
  const { ModificationsObserver, Saver, BlockManager, Renderer, Caret } = Blok;

  ModificationsObserver.disable();

  try {
    const currentIndex = BlockManager.currentBlockIndex;
    const hadFocus = editorHasFocus(Blok);

    /*
     * Some tools commit the field the user is typing in only on blur (image
     * and file captions, for two). The repaint replaces that DOM, so blur it
     * first — otherwise the pending edit is saved from data that never
     * received it and is lost. Focus comes back below.
     */
    if (hadFocus && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    /*
     * The editor's own model, not the host's dialect: a legacy-dialect export
     * expresses nesting only as nested `items[]`, so rendering it back drops
     * every list item nested by the flat `data.depth` carrier.
     */
    const savedBlocks = await Saver.save({ dialect: 'internal' });

    if (savedBlocks === undefined) {
      return;
    }

    const savedScrollY = window.scrollY;

    Renderer.markRenderStart();

    try {
      /*
       * View-only: the blocks keep their ids and their data is unchanged, so
       * the Yjs document already describes exactly what is being rendered.
       * Writing to it would clear the undo history — the very thing a repaint
       * exists to preserve.
       */
      await BlockManager.withViewRebuild(async () => {
        await BlockManager.clear(false, { skipYjsSync: true });
        await Renderer.render(savedBlocks.blocks, { skipYjsSync: true });
      });
    } finally {
      Renderer.markRenderEnd();
    }

    const currentBlock = currentIndex >= 0 ? BlockManager.getBlockByIndex(currentIndex) : undefined;

    /*
     * The current block is restored either way, so the next keystroke or
     * toolbar action still targets what the user was working on. Moving the
     * caret is gated on the editor actually holding it — otherwise a repaint
     * would yank focus away from wherever the user is on the page.
     */
    if (currentBlock !== undefined) {
      BlockManager.currentBlockIndex = currentIndex;
    }

    if (currentBlock !== undefined && hadFocus) {
      Caret.setToBlock(currentBlock, Caret.positions.END);
    }

    /*
     * Last, because a browser scrolls a freshly restored caret into view: put
     * the reader back where they were only once nothing else will move them.
     * Unconditional — scrolling to where the page already is costs nothing.
     */
    window.scrollTo(0, savedScrollY);
  } finally {
    ModificationsObserver.enable();
  }
}

/**
 * Whether this editor currently holds the page's focus.
 *
 * The focused element decides it whenever there is one: a caret the user left
 * in a block outlives the focus that put it there, so a stale selection anchor
 * inside the redactor says nothing once some other control — the host's
 * language switcher, say — has taken focus. Reading it as focus made a repaint
 * blur that control mid-interaction and pull the viewport back to the caret.
 *
 * The anchor is the fallback for when nothing is focused, because a
 * contenteditable block can hold the selection while focus rests on the body
 * (and jsdom focuses nothing at all).
 * @param Blok - the editor's module instances
 */
function editorHasFocus(Blok: BlokModules): boolean {
  const redactor = Blok.UI.nodes?.redactor;

  if (redactor === undefined || redactor === null) {
    return false;
  }

  const { activeElement } = document;
  const focusIsParked = activeElement === null
    || activeElement === document.body
    || activeElement === document.documentElement;

  if (!focusIsParked) {
    return redactor.contains(activeElement);
  }

  const anchorNode = window.getSelection()?.anchorNode ?? null;

  return anchorNode !== null && redactor.contains(anchorNode);
}
