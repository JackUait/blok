/**
 * Placement is CSS flex on the cell's blocks container, so changing it moves
 * whole block holders. FLIP: measure every holder, apply, measure again, then
 * play each holder from its old box to its new one.
 *
 * Web Animations never touch the DOM, so no MutationObserver sees the glide.
 */

/** Short and without overshoot: longer or springy glides read as lag after the click. */
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';
const DURATION_MS = 200;

const holdersOf = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const movePlacementWithMotion = (containers: HTMLElement[], apply: () => void): void => {
  if (prefersReducedMotion() || typeof HTMLElement.prototype.animate !== 'function') {
    apply();

    return;
  }

  const moves = containers.flatMap(container => holdersOf(container).map(holder => ({
    holder,
    // Measured mid-glide this is where the block is on screen, so a quick second change continues from there.
    before: holder.getBoundingClientRect(),
  })));

  for (const { holder } of moves) {
    holder.getAnimations?.().forEach(animation => animation.cancel());
  }

  apply();

  for (const { holder, before } of moves) {
    const after = holder.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;

    if (dx === 0 && dy === 0) {
      continue;
    }

    holder.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: DURATION_MS, easing: EASE_OUT }
    );
  }
};
