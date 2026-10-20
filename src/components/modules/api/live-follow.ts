import { prefersReducedMotion } from '../../utils/reduced-motion';

/** Room kept between a followed word and the window edge. */
const LIVE_ROOM = 16;

/** Frees a glide in a browser that never fires scrollend. */
const GLIDE_MS = 1000;

/**
 * Scrolls just enough to bring a streamed word into the window.
 * More than one window away: a jump, since a long glide outlasts a short stream.
 * Nearer: a glide, not restarted while one already heads to the same place.
 * @param topOffset - the host's sticky header height
 */
export const createLiveFollow = (topOffset: () => number): ((element: HTMLElement) => void) => {
  const glide: { top: number | null; timer: ReturnType<typeof setTimeout> | undefined } = { top: null, timer: undefined };
  const end = (): void => {
    clearTimeout(glide.timer);
    glide.top = null;
    window.removeEventListener('scrollend', end);
  };

  return (element) => {
    const rect = element.getBoundingClientRect();
    const above = rect.top - topOffset() - LIVE_ROOM;
    const delta = above < 0 ? above : Math.max(0, rect.bottom + LIVE_ROOM - window.innerHeight);
    // Stays the same during a glide: scrollY and the rect move together.
    const top = window.scrollY + delta;

    if (prefersReducedMotion() || Math.abs(delta) > window.innerHeight) {
      end();
      window.scrollTo({ top, behavior: 'instant' });

      return;
    }
    if (glide.top !== null && Math.abs(glide.top - top) < 1) {
      return;
    }
    end();
    glide.top = top;
    window.addEventListener('scrollend', end, { once: true });
    glide.timer = setTimeout(end, GLIDE_MS);
    window.scrollTo({ top, behavior: 'smooth' });
  };
};
