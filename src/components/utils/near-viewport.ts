// Starts about a screen early, so media is ready by the time it scrolls in.
const NEAR_MARGIN = '1000px 0px';

/**
 * Runs `run` once, when `el` comes near the viewport. Without
 * IntersectionObserver it runs at once.
 * @returns a cancel; call it when `el` is thrown away, or the observer keeps it alive.
 */
export function whenNearViewport(el: Element, run: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    run();

    return () => undefined;
  }
  const state = { done: false };
  const stop = (): void => {
    state.done = true;
    observer.disconnect();
  };
  // A batch queued before disconnect still arrives, so `done` guards it.
  const observer = new IntersectionObserver((entries) => {
    if (state.done || !entries.some((entry) => entry.isIntersecting)) return;
    stop();
    run();
  }, { rootMargin: NEAR_MARGIN });

  observer.observe(el);

  return stop;
}
