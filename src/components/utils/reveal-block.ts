import { DATA_ATTR } from '../constants/data-attributes';
import { prefersReducedMotion } from './reduced-motion';

/**
 * Longest wait for a smooth scroll to report its end. Browsers without
 * `scrollend` never report it, so the light comes on after this instead.
 */
export const SCROLL_SETTLE_MS = 700;

/**
 * How long the spotlight stays on: the flash in spotlight.css.
 */
export const SPOTLIGHT_MS = 1200;

const isInView = (el: Element): boolean => {
  const { top, bottom } = el.getBoundingClientRect();

  return top >= 0 && bottom <= window.innerHeight;
};

const light = (target: HTMLElement): void => {
  // Removing first restarts the pulse when Show is pressed again.
  target.removeAttribute(DATA_ATTR.spotlight);
  void target.offsetWidth;
  target.setAttribute(DATA_ATTR.spotlight, 'true');
  window.setTimeout(() => target.removeAttribute(DATA_ATTR.spotlight), SPOTLIGHT_MS);
};

/**
 * Brings a block's point of interest to the middle of the screen, then
 * spotlights it once the user can see it, and focuses its marked control.
 * @param holder - the block holder
 * @param fallback - lit when the tool marks no spotlight target
 */
export const revealBlock = (holder: HTMLElement, fallback: HTMLElement): void => {
  const target = holder.querySelector<HTMLElement>(`[${DATA_ATTR.spotlightTarget}]`) ?? fallback;

  target.querySelector<HTMLElement>(`[${DATA_ATTR.spotlightFocus}]`)?.focus({ preventScroll: true });

  if (isInView(target)) {
    light(target);

    return;
  }

  const state = { done: false };
  const settle = (): void => {
    if (state.done) {
      return;
    }
    state.done = true;
    window.removeEventListener('scrollend', settle);
    light(target);
  };

  window.addEventListener('scrollend', settle, { once: true });
  window.setTimeout(settle, SCROLL_SETTLE_MS);
  target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
};
