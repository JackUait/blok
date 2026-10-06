import { prefersReducedMotion } from '../../components/utils/reduced-motion';
import { getElementDirection } from '../../components/utils/direction';

/** Where a pill sits, measured from the strip's inline start. */
export interface PillBox {
  start: number;
  width: number;
}

const ENTER_MS = 300;
// --blok-ease-popover: fast out, long settle. WAAPI cannot read a CSS var.
const EASE_SETTLE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FOLD_MS = 220;
const RISE_MS = 560;
// Under FOLD_MS: the new tab starts up while the old one is still going down.
const RISE_DELAY_MS = 150;
// Short of 90deg: an edge-on tab would vanish and pop back.
const FLAT = 'perspective(240px) rotateX(88deg)';
// A flat tab still covers the band's bottom line, so it is faded out near flat.
const RISE_SHOWN_AT = 0.2;
const FADE_FROM = 0.15;
const UPRIGHT = 'perspective(240px) rotateX(0deg)';

const springCache: { easing?: string } = {};

const sampleSpring = (): string => {
  const stiffness = 170;
  const damping = 15;
  const substeps = 4;
  const dt = 1 / 60 / substeps;
  const state = { x: 0, v: 0 };
  const points = Array.from({ length: 60 }, () => {
    const sample = Math.round(state.x * 1e4) / 1e4;

    Array.from({ length: substeps }).forEach(() => {
      state.v += (stiffness * (1 - state.x) - damping * state.v) * dt;
      state.x += state.v * dt;
    });

    return sample;
  });

  return `linear(${[...points, 1].join(', ')})`;
};

/**
 * A damped spring sampled into a CSS linear() easing. Engines without
 * linear() get the settle curve, which lands without the overshoot.
 */
const spring = (): string => {
  if (springCache.easing === undefined) {
    const supported = typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('transition-timing-function', 'linear(0, 1)');

    springCache.easing = supported ? sampleSpring() : EASE_SETTLE;
  }

  return springCache.easing;
};

const canAnimate = (element: Element): boolean =>
  typeof (element as HTMLElement).animate === 'function' && !prefersReducedMotion();

/**
 * The pill's box from the inline start of its offset parent (the scroller).
 * Uses offset metrics, so the result ignores transforms and scroll position.
 * @param pill - a tab pill inside the scroller
 */
export const measurePill = (pill: HTMLElement): PillBox => {
  const parent = pill.offsetParent instanceof HTMLElement ? pill.offsetParent : null;
  const isRtl = getElementDirection(pill) === 'rtl';
  const start = isRtl && parent !== null
    ? parent.clientWidth - (pill.offsetLeft + pill.offsetWidth)
    : pill.offsetLeft;

  return { start, width: pill.offsetWidth };
};

/**
 * Swap the open tab like folder dividers: a copy of the old tab folds down
 * flat into the sheet while the indicator unfolds up under the new pill.
 * @param indicator - the shared active-pill backdrop
 * @param from - its current box, or null when it has never been placed
 * @param to - the active pill's box
 * @param onSettled - runs once the folded copy is gone; it held the scroll width until then
 */
export const moveIndicator = (indicator: HTMLElement, from: PillBox | null, to: PillBox, onSettled?: () => void): void => {
  // Read before the cancel below: a tab still rising folds from where it is.
  const { transform: tilt, opacity } = getComputedStyle(indicator);
  const shown = opacity === '' || Number.isNaN(Number(opacity)) ? 1 : Number(opacity);

  indicator.style.setProperty('inset-inline-start', `${to.start}px`);
  indicator.style.setProperty('width', `${to.width}px`);

  const unchanged = from !== null && from.start === to.start && from.width === to.width;

  if (from === null || unchanged || !canAnimate(indicator)) {
    return;
  }

  indicator.getAnimations().forEach(animation => animation.cancel());

  // A shallow clone keeps the indicator's look, corners included. The strip is mutation-free.
  const old = indicator.cloneNode(false) as HTMLElement;

  old.style.setProperty('inset-inline-start', `${from.start}px`);
  old.style.setProperty('width', `${from.width}px`);
  old.style.removeProperty('transform');
  indicator.after(old);

  const fold = old.animate(
    [
      { transform: tilt === '' || tilt === 'none' ? UPRIGHT : tilt, filter: 'brightness(1)', opacity: shown },
      { opacity: shown, offset: FADE_FROM },
      { transform: FLAT, filter: 'brightness(0.92)', opacity: 0 },
    ],
    { duration: FOLD_MS, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' }
  );

  const settle = (): void => {
    old.remove();
    onSettled?.();
  };

  fold.onfinish = settle;
  fold.oncancel = settle;

  indicator.animate(
    [
      { transform: FLAT, opacity: 0 },
      { opacity: 1, offset: RISE_SHOWN_AT },
      { transform: UPRIGHT, opacity: 1 },
    ],
    { duration: RISE_MS, delay: RISE_DELAY_MS, easing: spring(), fill: 'backwards' }
  );
};

/**
 * A new pill grows out of the strip.
 * @param pill - the pill that was just added
 */
export const popInPill = (pill: HTMLElement): void => {
  if (!canAnimate(pill)) {
    return;
  }

  pill.animate(
    [
      { opacity: 0, transform: 'scale(0.6)', filter: 'blur(2px)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    { duration: ENTER_MS, easing: EASE_SETTLE }
  );
};

/**
 * A pill folds away, then `done` runs. Runs `done` at once when motion is off.
 * @param pill - the pill being removed
 * @param done - called after the fold
 */
export const foldPill = (pill: HTMLElement, done: () => void): void => {
  if (!canAnimate(pill)) {
    done();

    return;
  }

  const animation = pill.animate(
    [
      { opacity: 1, width: `${pill.offsetWidth}px`, transform: 'none' },
      { opacity: 0, width: '0px', paddingInline: '0px', marginInline: '0px', transform: 'scale(0.7)' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
  );

  animation.onfinish = done;
  animation.oncancel = done;
};
