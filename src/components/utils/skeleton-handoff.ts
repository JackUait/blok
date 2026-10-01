import { prefersReducedMotion } from './reduced-motion';

export const HANDOFF_STAGGER = 40;
export const HANDOFF_DURATION = 320;
export const REDUCED_FADE = 150;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

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
      ...bars.map(bar => bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE, fill: 'forwards' }).finished),
      content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE, fill: 'forwards' }).finished,
    ]);

    return;
  }

  // Read every rect before any animation starts, so one layout pass serves all bars.
  const pairs = bars.map((bar, i) => ({
    bar,
    from: bar.getBoundingClientRect(),
    to: targets[i]?.getBoundingClientRect(),
    rtl: getComputedStyle(bar).direction === 'rtl',
  }));
  const delayOf = (i: number): number => i * HANDOFF_STAGGER;

  const barAnimations = pairs.map(({ bar, from, to, rtl }, i) => {
    if (to === undefined) {
      return bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HANDOFF_DURATION, delay: delayOf(i), easing: EASE, fill: 'forwards' }).finished;
    }

    // An RTL bar starts at the right edge, so it must scale from there and land on the target's right edge.
    const dx = rtl ? to.right - from.right : to.left - from.left;
    const dy = to.top - from.top;
    const sx = from.width === 0 ? 1 : Math.min(to.width / from.width, 1.15);

    bar.style.setProperty('transform-origin', rtl ? '100% 0' : '0 0');

    return bar.animate([
      { transform: 'translate(0px, 0px) scaleX(1)', opacity: 1, filter: 'blur(0px)' },
      { transform: `translate(${dx}px, ${dy}px) scaleX(${sx})`, opacity: 0, filter: 'blur(4px)' },
    ], { duration: HANDOFF_DURATION, delay: delayOf(i), easing: EASE, fill: 'forwards' }).finished;
  });

  // The content arrives as one sheet; the per-bar stagger carries the top-to-bottom feel.
  const contentAnimation = content.animate([
    { opacity: 0, filter: 'blur(6px)' },
    { opacity: 1, filter: 'blur(0px)' },
  ], { duration: HANDOFF_DURATION + delayOf(Math.max(bars.length - 1, 0)), easing: EASE, fill: 'forwards' }).finished;

  await Promise.all([...barAnimations, contentAnimation]);
};
