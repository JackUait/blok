import { prefersReducedMotion } from '../../components/utils/reduced-motion';
import { getElementDirection } from '../../components/utils/direction';

/** Where a pill sits, measured from the strip's inline start. */
export interface PillBox {
  start: number;
  width: number;
}

const INDICATOR_MS = 420;
const PANEL_MS = 360;
const ENTER_MS = 300;
// --blok-ease-popover: fast out, long settle. WAAPI cannot read a CSS var.
const EASE_SETTLE = 'cubic-bezier(0.16, 1, 0.3, 1)';
// Leading edge: quick and committed. Trailing edge: catches up later.
const EASE_LEAD = 'cubic-bezier(0.3, 0, 0, 1)';
// How far the trailing edge travels by the time the leading edge lands.
const TRAIL_LAG = 0.3;
const LEAD_OFFSET = 0.45;
const ENTER_SHIFT_PX = 14;

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

const boxStyle = (box: PillBox): Keyframe => ({
  insetInlineStart: `${box.start}px`,
  width: `${box.width}px`,
});

/**
 * Glide the indicator to `to`. The edge that leads lands first and the
 * trailing edge catches up, so the pill stretches like a drop of ink.
 * @param indicator - the shared active-pill backdrop
 * @param from - its current box, or null when it has never been placed
 * @param to - the active pill's box
 */
export const moveIndicator = (indicator: HTMLElement, from: PillBox | null, to: PillBox): void => {
  indicator.style.setProperty('inset-inline-start', `${to.start}px`);
  indicator.style.setProperty('width', `${to.width}px`);

  const unchanged = from !== null && from.start === to.start && from.width === to.width;

  if (from === null || unchanged || !canAnimate(indicator)) {
    return;
  }

  const forward = to.start > from.start;
  const fromEnd = from.start + from.width;
  const toEnd = to.start + to.width;
  const midStart = forward ? from.start + (to.start - from.start) * TRAIL_LAG : to.start;
  const midEnd = forward ? toEnd : fromEnd + (toEnd - fromEnd) * TRAIL_LAG;

  indicator.getAnimations().forEach(animation => animation.cancel());
  indicator.animate(
    [
      { ...boxStyle(from), easing: EASE_LEAD },
      { insetInlineStart: `${midStart}px`, width: `${midEnd - midStart}px`, offset: LEAD_OFFSET, easing: EASE_SETTLE },
      boxStyle(to),
    ],
    { duration: INDICATOR_MS }
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
 * Slide the new panel in from the side the user moved toward.
 * Uses the inherited inline sign so RTL slides the mirrored way.
 * @param panel - the tab panel that just became visible
 * @param forward - true when the new tab is after the old one
 */
export const enterPanel = (panel: HTMLElement, forward: boolean): void => {
  if (!canAnimate(panel)) {
    return;
  }

  const sign = getElementDirection(panel) === 'rtl' ? -1 : 1;
  const shift = (forward ? 1 : -1) * sign * ENTER_SHIFT_PX;

  panel.getAnimations().forEach(animation => animation.cancel());
  panel.animate(
    [
      { opacity: 0, transform: `translateX(${shift}px)`, filter: 'blur(3px)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    { duration: ENTER_MS, easing: EASE_SETTLE }
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
