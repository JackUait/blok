/**
 * Playground only: a broken demo image 404s instantly, so Retry flashes the
 * spinner and fails again before you can see it. This holds the first `error`
 * after each retry for `delayMs`, so the loading state stays on screen. Then
 * half the retries fail again and half load `recoverUrl`, so both outcomes show.
 *
 * Works from outside the tool: a capture listener on an ancestor runs before
 * the img's own `error` listener and can stop it. The tool is not changed.
 */
export const slowImageRetries = (
  holder: HTMLElement,
  { delayMs, recoverUrl, random = Math.random }: { delayMs: number; recoverUrl: string; random?: () => number }
): void => {
  const replayed = new WeakSet<Event>();
  const retry = { armed: false };

  // A retry is the card leaving the error state. The tool enters that state
  // asynchronously, so the error event itself cannot tell us.
  new MutationObserver((records) => {
    if (records.some((record) => record.oldValue === 'error' && record.target instanceof Element && record.target.getAttribute('data-state') !== 'error')) {
      retry.armed = true;
    }
  }).observe(holder, { subtree: true, attributes: true, attributeFilter: ['data-state'], attributeOldValue: true });

  holder.addEventListener('error', (event) => {
    const img = event.target;

    if (!retry.armed || !(img instanceof HTMLImageElement) || replayed.has(event)) {
      return;
    }

    retry.armed = false;
    event.stopImmediatePropagation();
    window.setTimeout(() => {
      // The tool's own load handler clears the failure and the toast.
      if (random() < 0.5) {
        img.setAttribute('src', recoverUrl);

        return;
      }

      const replay = new Event('error');

      replayed.add(replay);
      img.dispatchEvent(replay);
    }, delayMs);
  }, true);
};
