const swallow = (event: Event): void => {
  event.stopPropagation();
  event.preventDefault();
};

/**
 * Eats the click the current release makes, if it makes one. On the
 * document: a drop may redraw the view, so the click lands in new DOM.
 * Cleared on the next task, so a release that makes no click never eats a
 * later real one.
 */
export const swallowReleaseClick = (): void => {
  disarm();
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
};

/** A cancelled pointer, a new press or a lost window means no release of this drag is coming. */
export const disarm = (): void => {
  document.removeEventListener('pointerup', swallowReleaseClick, { capture: true });
  document.removeEventListener('pointercancel', disarm, { capture: true });
  document.removeEventListener('pointerdown', disarm, { capture: true });
  window.removeEventListener('blur', disarm);
};

/**
 * After Escape cancels a drag the pointer is still down: its release must
 * not click the item under it (notion-motion.md Round 53 §7, §9C, §9E).
 */
export const swallowClickAfterCancel = (): void => {
  disarm();
  document.addEventListener('pointerup', swallowReleaseClick, { capture: true, once: true });
  document.addEventListener('pointercancel', disarm, { capture: true, once: true });
  document.addEventListener('pointerdown', disarm, { capture: true, once: true });
  window.addEventListener('blur', disarm, { once: true });
};
