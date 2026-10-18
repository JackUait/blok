import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isClosed, show } from '../../../../src/components/utils/notifier/index';

const SWAP_MS = 140;
const EXIT_MS = 250;
const MARGIN_MS = 50;

const wrapper = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-testid="notifier-container"]');

const toasts = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-blok-testid="notifier-container"] > [data-blok-testid="notification"]'));

// The message text is written a microtask after the toast mounts.
const texts = async (): Promise<string[]> => {
  await Promise.resolve();

  return toasts().map((el) => el.querySelector('[data-blok-testid="notification-message-text"]')?.textContent ?? '');
};

// jsdom keeps animation longhands from a stylesheet but never runs the animation.
const useExitDurations = (): void => {
  const style = document.createElement('style');

  style.setAttribute('data-test-exit-durations', '');
  style.textContent = [
    `.animate-notify-swap-out { animation-name: notifySwapOut; animation-duration: ${SWAP_MS}ms; }`,
    `.animate-notify-slide-out { animation-name: notifySlideOut; animation-duration: ${EXIT_MS}ms; }`,
  ].join('\n');
  document.head.appendChild(style);
};

describe('Notifier exits that never send animationend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.querySelectorAll('[data-blok-testid="notifier-container"], style[data-test-exit-durations]').forEach((el) => el.remove());
  });

  it('mounts a toast shown right after the previous one closed', async () => {
    show({ message: 'first', time: 5000 });
    vi.advanceTimersByTime(5000);

    show({ message: 'second', time: 5000 });
    vi.advanceTimersByTime(MARGIN_MS);

    expect(await texts()).toEqual([ 'second' ]);
  });

  it('replaces a visible toast at once when its swap has no duration', async () => {
    show({ message: 'first', time: 5000 });
    show({ message: 'second', time: 5000 });

    expect(await texts()).toEqual([ 'second' ]);
  });

  it('replaces a visible toast once the swap duration has passed', async () => {
    useExitDurations();
    show({ message: 'first', time: 5000 });
    show({ message: 'second', time: 5000 });

    vi.advanceTimersByTime(SWAP_MS - 1);
    expect(await texts()).toEqual([ 'first' ]);

    vi.advanceTimersByTime(MARGIN_MS + 1);
    expect(await texts()).toEqual([ 'second' ]);
  });

  it('mounts the replacement once when animationend comes before the timer', async () => {
    useExitDurations();
    show({ message: 'first', time: 5000 });
    show({ message: 'second', time: 5000 });

    toasts()[0].dispatchEvent(new Event('animationend'));
    expect(await texts()).toEqual([ 'second' ]);

    vi.advanceTimersByTime(SWAP_MS + MARGIN_MS);
    expect(await texts()).toEqual([ 'second' ]);
  });

  it('mounts only the latest toast when a swap is superseded mid-way', async () => {
    useExitDurations();
    const second = { message: 'second', time: 5000 };

    show({ message: 'first', time: 5000 });
    show(second);
    vi.advanceTimersByTime(SWAP_MS / 2);
    show({ message: 'third', time: 5000 });

    toasts()[0].dispatchEvent(new Event('animationend'));
    vi.advanceTimersByTime(SWAP_MS + MARGIN_MS);

    expect(await texts()).toEqual([ 'third' ]);
    expect(isClosed(second)).toBe(true);
  });

  it('removes a dismissed toast and releases the top layer when its exit has no duration', () => {
    show({ message: 'bye', time: 5000 });
    const [ toast ] = toasts();

    vi.advanceTimersByTime(5000);

    expect(toast.isConnected).toBe(false);
    expect(wrapper()?.hasAttribute('data-blok-top-layer')).toBe(false);
  });

  it('removes a dismissed toast once its exit duration has passed', () => {
    useExitDurations();
    show({ message: 'bye', time: 5000 });
    const [ toast ] = toasts();

    vi.advanceTimersByTime(5000 + EXIT_MS - 1);
    expect(toast.isConnected).toBe(true);
    expect(wrapper()?.hasAttribute('data-blok-top-layer')).toBe(true);

    vi.advanceTimersByTime(MARGIN_MS + 1);
    expect(toast.isConnected).toBe(false);
    expect(wrapper()?.hasAttribute('data-blok-top-layer')).toBe(false);
  });

  it('removes a dismissed toast once when animationend comes before the timer', () => {
    useExitDurations();
    show({ message: 'bye', time: 5000 });
    const [ toast ] = toasts();
    const remove = vi.spyOn(toast, 'remove');

    vi.advanceTimersByTime(5000);
    toast.dispatchEvent(new Event('animationend'));
    vi.advanceTimersByTime(EXIT_MS + MARGIN_MS);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(wrapper()?.hasAttribute('data-blok-top-layer')).toBe(false);
  });
});
