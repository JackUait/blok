import { vi } from 'vitest';

/** The hint the shared tooltip shows now, or null. */
export const shownHint = (): { text: string; placement: string | null } | null => {
  const wrapper = document.querySelector('[data-blok-testid="tooltip"]');

  return wrapper?.getAttribute('data-blok-shown') === 'true'
    ? { text: document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent ?? '', placement: wrapper.getAttribute('data-blok-placement') }
    : null;
};

/** jsdom lays out nothing: a box mid-page leaves room on every side, so the hint keeps its placement. */
export const hover = (el: Element | null | undefined): void => {
  if (!(el instanceof HTMLElement)) throw new Error('nothing to hover');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 600, y: 300, width: 120, height: 20 }));
  el.dispatchEvent(new MouseEvent('mouseenter'));
};
