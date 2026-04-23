/**
 * Applies a brief "target" highlight pulse to a block holder after the editor
 * scrolls to it from a `#<block-id>` URL (Notion/Google Docs behaviour).
 *
 * The caller is responsible for choosing the right moment (after scroll + select).
 * We toggle the `blok-block--target` class on the element; removal happens on
 * `animationend` (preferred, avoids timer drift) with a defensive timeout
 * fallback in case the animation is cancelled / never runs (e.g. element
 * detached, reduced-motion stack collapses the keyframes to 0ms).
 */

const TARGET_CLASS = 'blok-block--target';
const FALLBACK_REMOVE_MS = 1800;

/**
 * Briefly highlight the given element to signal arrival from a hash link.
 * Safe to call repeatedly — re-triggers a fresh pulse.
 */
export function highlightBlockArrival(el: Element): void {
  // Re-add: if class is already there (repeat navigation), force a reflow so
  // the keyframes restart.
  el.classList.remove(TARGET_CLASS);
  // Force reflow to guarantee the animation restarts when class is re-added.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(TARGET_CLASS);

  const state = { removed: false };

  const clear = (): void => {
    if (state.removed) {
      return;
    }
    state.removed = true;
    el.classList.remove(TARGET_CLASS);
    el.removeEventListener('animationend', onAnimationEnd);
  };

  const onAnimationEnd = (event: Event): void => {
    // Only react to the holder's own animation, not a descendant's.
    if (event.target === el) {
      clear();
    }
  };

  el.addEventListener('animationend', onAnimationEnd);

  // Fallback: if animationend never fires (reduced motion, detached element,
  // CSS not loaded) remove the class after the animation window.
  window.setTimeout(clear, FALLBACK_REMOVE_MS);
}
