import { prefersReducedMotion } from './reduced-motion';

export const HANDOFF_STAGGER = 40;
export const HANDOFF_DURATION = 320;
export const REDUCED_FADE = 150;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Share of a bar's flight it stays solid, so the glide reads before the dissolve. */
const HOLD = 0.4;

// A cancelled animation rejects `finished` with AbortError; the caller's cleanup must still run.
const settle = (animation: Animation): Promise<unknown> => animation.finished.catch(() => undefined);

/**
 * Moves each skeleton bar onto its block and fades the content in.
 * `targets[i]` is the visible content box of block i, the element the bar should land on,
 * not the full-width holder. Always resolves, even when an animation is cancelled.
 */

export const runSkeletonHandoff = async ({ bars, targets, content }: {
  bars: HTMLElement[];
  targets: HTMLElement[];
  content: HTMLElement;
}): Promise<void> => {
  if (typeof content.animate !== 'function') {
    return;
  }

  if (prefersReducedMotion()) {
    await Promise.all([
      ...bars.map(bar => settle(bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE, fill: 'forwards' }))),
      settle(content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE, fill: 'forwards' })),
    ]);

    return;
  }

  // Read every rect before any animation starts, so one layout pass serves all bars.
  const pairs = bars.map((bar, i) => ({
    bar,
    from: bar.getBoundingClientRect(),
    to: targets[i]?.getBoundingClientRect(),
    rtl: getComputedStyle(bar).direction === 'rtl',
    // The CSS breathe animation is mid-cycle; starting from 1 would pop the bar when its delay ends.
    opacity: Number.parseFloat(getComputedStyle(bar).opacity) || 1,
  }));
  const delayOf = (i: number): number => i * HANDOFF_STAGGER;

  // 'both' holds the first keyframe through the stagger delay, so the bar stops breathing instead of popping.
  const barAnimations = pairs.map(({ bar, from, to, rtl, opacity }, i) => {
    if (to === undefined) {
      return settle(bar.animate([{ opacity }, { opacity: 0 }], { duration: HANDOFF_DURATION, delay: delayOf(i), easing: EASE, fill: 'both' }));
    }

    // An RTL bar starts at the right edge, so it must scale from there and land on the target's right edge.
    const dx = rtl ? to.right - from.right : to.left - from.left;
    const dy = to.top - from.top;
    const sx = from.width === 0 ? 1 : Math.min(to.width / from.width, 1.15);

    bar.style.setProperty('transform-origin', rtl ? '100% 0' : '0 0');

    return settle(bar.animate([
      { transform: 'translate(0px, 0px) scaleX(1)', opacity, filter: 'blur(0px)' },
      { opacity, filter: 'blur(0px)', offset: HOLD },
      { transform: `translate(${dx}px, ${dy}px) scaleX(${sx})`, opacity: 0, filter: 'blur(4px)' },
    ], { duration: HANDOFF_DURATION, delay: delayOf(i), easing: EASE, fill: 'both' }));
  });

  // The content arrives as one sheet; the per-bar stagger carries the top-to-bottom feel.
  const contentAnimation = settle(content.animate([
    { opacity: 0, filter: 'blur(6px)' },
    { opacity: 1, filter: 'blur(0px)' },
  ], { duration: HANDOFF_DURATION + delayOf(Math.max(bars.length - 1, 0)), easing: EASE, fill: 'forwards' }));

  await Promise.all([...barAnimations, contentAnimation]);
};
