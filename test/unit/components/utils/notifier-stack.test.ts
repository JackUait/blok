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

  describe('geometry', () => {
    // Layout offsets, not rects: a card mid-animation is translated and its rect would lie.
    const place = (element: HTMLElement, left: number, top: number, width: number, height: number): void => {
      Object.defineProperties(element, {
        offsetLeft: { configurable: true, value: left },
        offsetTop: { configurable: true, value: top },
        offsetWidth: { configurable: true, value: width },
        offsetHeight: { configurable: true, value: height },
        clientWidth: { configurable: true, value: width },
        clientHeight: { configurable: true, value: height },
      });
    };

    const container = (): HTMLElement => document.querySelector<HTMLElement>('[data-blok-testid="notifier-container"]') as HTMLElement;

    it('lines the peeking edges up with the front card, not the wider wrapper', async () => {
      show(card('first'));
      place(container(), 0, 0, 500, 72);
      place(front() as HTMLElement, 60, 8, 380, 64);
      show(card('second'));
      await Promise.resolve();

      const style = container().style;

      expect([ 'left', 'right', 'top', 'bottom' ].map((side) => style.getPropertyValue(`--_blok-toast-peek-${side}`)))
        .toEqual([ '60px', '60px', '8px', '0px' ]);
    });

    it('starts the next card in the closing card\'s peek shape, whatever its own size', async () => {
      show(card('first'));
      show(card('second'));
      const first = front() as HTMLElement;

      closeFront();
      place(first, 60, 8, 380, 64);
      place(front() as HTMLElement, 30, 4, 440, 72);
      await Promise.resolve();

      const style = (front() as HTMLElement).style;

      // The peek is the closing card's box, 12px in on each side and 8px up.
      expect([ 'left', 'right', 'bottom', 'y' ].map((part) => style.getPropertyValue(`--_blok-toast-rise-${part}`)))
        .toEqual([ '42px', '42px', '8px', '-4px' ]);
    });
  });

  describe('a card joining the deck', () => {
    const calls: { card: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];

    const motion = (reduce: boolean): void => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }),
      });
    };

    beforeEach(() => {
      calls.length = 0;
      motion(false);
      // jsdom has no Web Animations API.
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
          calls.push({ card: this, keyframes, options });
        },
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      Reflect.deleteProperty(window, 'matchMedia');
    });

    const dips = (): string[] => calls.flatMap((call) => call.keyframes.map((frame) => String(frame.transform ?? '')))
      .filter((transform) => transform.includes('translateY'));

    it('knocks the front card away from the deck as the new card tucks in behind it', () => {
      show(card('first'));
      const first = front();

      show(card('second'));

      expect(calls).toHaveLength(1);
      expect(calls[0].card).toBe(first);
      expect(dips()[0]).toContain('translateY(3px)');
      // Added on top, so the card's own entrance keeps running underneath.
      expect(calls[0].options.composite).toBe('add');
    });

    it('knocks a top card upward, since its deck peeks out below', () => {
      show(card('first'), 'top-center');
      show(card('second'), 'top-center');

      expect(dips()[0]).toContain('translateY(-3px)');
    });

    it('knocks again for every card that queues later, even past the drawn depth', () => {
      show(card('first'));
      [ 'second', 'third', 'fourth' ].forEach((message) => {
        vi.advanceTimersByTime(1000);
        show(card(message));
      });

      expect(calls).toHaveLength(3);
    });

    it('knocks once for a burst, so the dips do not add up', () => {
      show(card('first'));
      show(card('second'));
      show(card('third'));
      show(card('fourth'));

      expect(calls).toHaveLength(1);
    });

    it('holds the deck until a still-launching front card lands', () => {
      show(card('first'));
      show(card('second'));

      const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="notifier-container"]');

      expect(calls[0].options.delay).toBe(320);
      expect(wrapper?.style.getPropertyValue('--_blok-toast-peek-delay')).toBe('320ms');
    });

    it('waits only for the rest of the launch when the next card comes mid-flight', () => {
      show(card('first'));
      vi.advanceTimersByTime(200);
      show(card('second'));

      expect(calls[0].options.delay).toBe(120);
    });

    it('springs the deck at once behind a card that has landed', () => {
      show(card('first'));
      vi.advanceTimersByTime(1000);
      show(card('second'));

      const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="notifier-container"]');

      expect(calls[0].options.delay).toBe(0);
      expect(wrapper?.style.getPropertyValue('--_blok-toast-peek-delay')).toBe('0ms');
    });

    it('leaves a lone card alone', () => {
      show(card('first'));

      expect(calls).toHaveLength(0);
    });

    it('stays still when the reader asks for less motion', () => {
      motion(true);
      show(card('first'));
      show(card('second'));

      expect(calls).toHaveLength(0);
    });
  });
});
