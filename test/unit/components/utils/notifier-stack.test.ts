import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismiss, isClosed, resolve, RESOLVED_HOLD_MS, settle, show } from '../../../../src/components/utils/notifier/index';
import type { NotifierOptions } from '../../../../src/components/utils/notifier/types';

const card = (message: string): NotifierOptions => ({
  message,
  style: 'error',
  actions: [ { label: 'Retry', onClick: (): void => undefined, primary: true } ],
});

const openCards = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-blok-toast="card"][data-state="open"]'));

const front = (): HTMLElement | undefined => openCards()[0];

const frontText = async (): Promise<string | undefined> => {
  await Promise.resolve();

  return front()?.querySelector('[data-blok-testid="notification-message-text"]')?.textContent ?? undefined;
};

const behind = (): string | null =>
  document.querySelector('[data-blok-testid="notifier-container"]')?.getAttribute('data-blok-toast-behind') ?? null;

const closeFront = (): void => {
  front()?.querySelector<HTMLButtonElement>('[data-blok-testid="notification-dismiss"]')?.click();
};

describe('Notifier card stack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((el) => el.remove());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((el) => el.remove());
  });

  it('keeps the first card in front and waits the next one behind it', async () => {
    show(card('first'));
    show(card('second'));

    expect(openCards()).toHaveLength(1);
    expect(await frontText()).toBe('first');
    expect(behind()).toBe('1');
  });

  it('draws at most two cards behind the front one', () => {
    show(card('first'));
    show(card('second'));
    show(card('third'));
    show(card('fourth'));

    expect(behind()).toBe('2');
  });

  it('brings the next card up when the user closes the front one', async () => {
    show(card('first'));
    show(card('second'));
    show(card('third'));
    closeFront();

    expect(openCards()).toHaveLength(1);
    expect(await frontText()).toBe('second');
    expect(behind()).toBe('1');

    closeFront();

    expect(await frontText()).toBe('third');
    expect(behind()).toBeNull();

    closeFront();

    expect(openCards()).toHaveLength(0);
  });

  it('lets the next card rise from behind instead of sliding in', () => {
    show(card('first'));
    show(card('second'));
    closeFront();

    expect(front()?.hasAttribute('data-blok-toast-rise')).toBe(true);
  });

  it('moves focus to the next card when the closed one held it', () => {
    show(card('first'));
    show(card('second'));
    front()?.querySelector<HTMLButtonElement>('[data-blok-testid="notification-dismiss"]')?.focus();
    closeFront();

    expect(front()?.querySelector('[data-blok-testid="notification-dismiss"]')).toHaveFocus();
  });

  it('brings the next card up after the front one shows it was resolved', async () => {
    const first = card('first');

    show(first);
    show(card('second'));
    resolve(first, 'Image restored');

    expect(await frontText()).toBe('Image restored');

    vi.advanceTimersByTime(RESOLVED_HOLD_MS);

    expect(await frontText()).toBe('second');
  });

  it('dismiss takes a waiting card out of the stack', () => {
    const second = card('second');

    show(card('first'));
    show(second);
    dismiss(second);

    expect(behind()).toBeNull();

    closeFront();

    expect(openCards()).toHaveLength(0);
  });

  it('resolve drops a waiting card nobody has seen', () => {
    const second = card('second');

    show(card('first'));
    show(second);
    resolve(second, 'Image restored');
    closeFront();

    expect(openCards()).toHaveLength(0);
  });

  it('isClosed is false for a card still waiting', () => {
    const second = card('second');

    show(card('first'));
    show(second);

    expect(isClosed(second)).toBe(false);
  });

  it('a plain toast still replaces the cards and ends the stack', () => {
    const second = card('second');

    show(card('first'));
    show(second);
    show({ message: 'saved' });

    expect(isClosed(second)).toBe(true);
    expect(behind()).toBeNull();
  });

  it('settle stops a busy action so it can be clicked again', () => {
    const options: NotifierOptions = {
      message: 'first',
      actions: [ { label: 'Retry', onClick: vi.fn(), busyOnClick: true } ],
    };

    show(options);
    const retry = front()?.querySelector<HTMLButtonElement>('[data-blok-testid="notification-action"]');

    retry?.click();
    settle(options);

    expect([ retry?.getAttribute('aria-busy'), retry?.hasAttribute('aria-label'), retry?.querySelector('[data-blok-testid="notification-spinner"]') ])
      .toEqual([ null, false, null ]);
    retry?.click();
    expect(options.actions?.[0].onClick).toHaveBeenCalledTimes(2);
  });

  it('turns a closed card to dust instead of sliding it out', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({ matches: false, media }) });
    show(card('first'));
    const first = front();

    closeFront();
    Reflect.deleteProperty(window, 'matchMedia');

    expect([ first?.hasAttribute('data-blok-toast-dust'), first?.classList.contains('animate-notify-slide-out') ]).toEqual([ true, false ]);
  });
});
