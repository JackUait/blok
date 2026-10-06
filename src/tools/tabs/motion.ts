import { DATA_ATTR } from '../../components/constants/data-attributes';
import { prefersReducedMotion } from '../../components/utils/reduced-motion';
import { getElementDirection } from '../../components/utils/direction';

import { TABS_ATTR } from './constants';

/** Where a pill sits, measured from the strip's inline start. */
export interface PillBox {
  start: number;
  width: number;
}

const PANEL_MS = 360;
const ENTER_MS = 300;
// --blok-ease-popover: fast out, long settle. WAAPI cannot read a CSS var.
const EASE_SETTLE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FOLD_MS = 220;
const RISE_MS = 560;
// Under FOLD_MS: the new tab starts up while the old one is still going down.
const RISE_DELAY_MS = 150;
// Short of 90deg: an edge-on tab would vanish and pop back.
const FLAT = 'perspective(240px) rotateX(88deg)';
const UPRIGHT = 'perspective(240px) rotateX(0deg)';
const CASCADE_MS = 520;
const CASCADE_STEP_MS = 70;
// Rows past this land together, so a long tab never makes the reader wait.
const CASCADE_STAGGERED_ROWS = 8;

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

// Only our own animations: cancelling a row's CSS transitions would break the block.
const running = new WeakMap<Element, Animation>();

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
 */
export const moveIndicator = (indicator: HTMLElement, from: PillBox | null, to: PillBox): void => {
  // Read before the cancel below: a tab still rising folds from where it is.
  const tilt = getComputedStyle(indicator).transform;

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
      { transform: tilt === '' || tilt === 'none' ? UPRIGHT : tilt, filter: 'brightness(1)' },
      { transform: FLAT, filter: 'brightness(0.92)' },
    ],
    { duration: FOLD_MS, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' }
  );

  fold.onfinish = (): void => old.remove();
  fold.oncancel = (): void => old.remove();

  indicator.animate(
    [{ transform: FLAT }, { transform: UPRIGHT }],
    { duration: RISE_MS, delay: RISE_DELAY_MS, easing: spring(), fill: 'backwards' }
  );
};

/**
 * Morph the panel area from its old height to the new panel's height.
 * @param panels - the slot holding every tab panel
 * @param fromHeight - the area's height before the switch
 */
export const morphPanelsHeight = (panels: HTMLElement, fromHeight: number): void => {
  const toHeight = panels.offsetHeight;

  if (fromHeight === toHeight || !canAnimate(panels)) {
    return;
  }

  panels.getAnimations().forEach(animation => animation.cancel());
  panels.animate(
    [
      { height: `${fromHeight}px`, overflow: 'clip' },
      { height: `${toHeight}px`, overflow: 'clip' },
    ],
    { duration: PANEL_MS, easing: EASE_SETTLE }
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

/**
 * The rows a tab shows: its child block holders, or the empty hint.
 * @param tabHolder - the holder of a `tab` block
 */
export const panelRows = (tabHolder: HTMLElement): HTMLElement[] => {
  const root = tabHolder.querySelector<HTMLElement>(`[${TABS_ATTR.tab}]`);

  if (root === null) {
    return [];
  }

  return Array.from(root.querySelectorAll<HTMLElement>(
    `:scope > [${TABS_ATTR.tabChildren}] > *, :scope > [${TABS_ATTR.empty}]`
  )).filter(row => !row.classList.contains('hidden'));
};

/**
 * Drop the rows of the tab that just opened in one after another.
 * @param rows - the new tab's rows, top to bottom
 */
export const cascadeIn = (rows: HTMLElement[]): void => {
  rows.forEach((row, index) => {
    running.get(row)?.cancel();

    if (!canAnimate(row)) {
      return;
    }

    const animation = row.animate(
      [
        { opacity: 0, transform: 'translateY(14px) scale(0.98)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      {
        duration: CASCADE_MS,
        delay: Math.min(index, CASCADE_STAGGERED_ROWS - 1) * CASCADE_STEP_MS,
        easing: spring(),
        fill: 'backwards',
      }
    );

    running.set(row, animation);
  });
};

/**
 * What a row draws. A block's content wrapper carries no block id, so two
 * blocks that render the same content give the same picture.
 */
const rowPicture = (row: HTMLElement): string =>
  row.hasAttribute(TABS_ATTR.empty)
    ? TABS_ATTR.empty
    : row.querySelector(`[${DATA_ATTR.elementContent}]`)?.innerHTML ?? row.innerHTML;

/**
 * Whether two tabs show the same thing, e.g. two empty tabs and their hints.
 * Any difference counts, so a doubtful pair still animates.
 * @param from - the closing tab's rows
 * @param to - the opening tab's rows
 */
export const looksTheSame = (from: HTMLElement[], to: HTMLElement[]): boolean =>
  from.length === to.length && from.every((row, index) => rowPicture(row) === rowPicture(to[index]));
