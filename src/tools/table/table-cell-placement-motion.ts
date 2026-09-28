/**
 * Placement is CSS flex on the cell's blocks container, so changing it moves
 * whole block holders. FLIP: measure every holder, apply, measure again, then
 * play each holder from its old box to its new one.
 *
 * Web Animations never touch the DOM, so no MutationObserver sees the glide.
 */

/**
 * Accelerates from rest, then brakes hard. Kept short and without overshoot:
 * longer or springy glides read as lag after the click.
 */
const EASE_IN_OUT = 'cubic-bezier(0.7, 0, 0.2, 1)';
const DURATION_MS = 240;

/** Horizontal lean at mid-flight: one degree per LEAN_PX of travel, capped. */
const LEAN_PX = 12;
const MAX_LEAN_DEG = 8;

const round = (value: number): number => Number(value.toFixed(2));

/** The block leans into its travel, like text being pulled across. */
const leanFor = (dx: number): number =>
  round(Math.sign(dx) * Math.min(Math.abs(dx) / LEAN_PX, MAX_LEAN_DEG));

/**
 * Only block holders move. A wrapped block is full width in every placement, so
 * its box stays put and its lines snap to the new text-align (see tables.css).
 */
const holdersOf = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-blok-element]'));

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
      [
        { transform: `translate(${dx}px, ${dy}px) skewX(0deg)` },
        { offset: 0.5, transform: `translate(${round(dx / 2)}px, ${round(dy / 2)}px) skewX(${leanFor(dx)}deg)` },
        { transform: 'translate(0px, 0px) skewX(0deg)' },
      ],
      { duration: DURATION_MS, easing: EASE_IN_OUT }
    );
  }
};
