import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const TOP_LAYER = 'data-blok-top-layer';
const OPENED = 'data-blok-popover-opened';

const items = (): PopoverItemParams[] => [
  { title: 'One', name: 'one', onActivate: vi.fn() },
  { title: 'Two', name: 'two', onActivate: vi.fn() },
];

/** A running CSS transition whose end the test decides. */
const controllableAnimation = (): { animation: Animation; end: () => Promise<void>; cancel: () => Promise<void> } => {
  const handlers: { resolve?: (value: Animation) => void; reject?: (reason: unknown) => void } = {};
  const finished = new Promise<Animation>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  const animation = { finished } as unknown as Animation;
  const flush = async (): Promise<void> => {
    await finished.catch(() => undefined);
    await Promise.resolve();
  };

  return {
    animation,
    end: async () => {
      handlers.resolve?.(animation);
      await flush();
    },
    cancel: async () => {
      handlers.reject?.(new DOMException('cancelled', 'AbortError'));
      await flush();
    },
  };
};

const hidePopoverSpy = vi.fn();

/** jsdom has no Popover API; give it one so the top-layer path runs. */
const enablePopoverApi = (): void => {
  Object.defineProperty(HTMLElement.prototype, 'popover', { configurable: true, writable: true, value: null });
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, writable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, writable: true, value: hidePopoverSpy });
};

const disablePopoverApi = (): void => {
  Reflect.deleteProperty(HTMLElement.prototype, 'popover');
  Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
};

const stubAnimations = (popover: PopoverDesktop, animations: Animation[]): void => {
  const container = popover.getElement().querySelector<HTMLElement>('[data-blok-popover-container]');

  if (container === null) {
    throw new Error('popover container missing');
  }
  Object.defineProperty(container, 'getAnimations', { configurable: true, value: () => animations });
};

const open = (params: { animateClose?: boolean } = {}): PopoverDesktop => {
  const trigger = document.createElement('button');

  document.body.appendChild(trigger);

  const popover = new PopoverDesktop({ items: items(), trigger, ...params });

  popover.show();

  return popover;
};

const isInTopLayer = (popover: PopoverDesktop): boolean =>
  popover.getElement().hasAttribute(TOP_LAYER) && popover.getElement().hasAttribute('popover');

const setReducedMotion = (reduce: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
};

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

describe('PopoverDesktop close motion (animateClose)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
    enablePopoverApi();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    disablePopoverApi();
    if (originalMatchMedia === undefined) {
      Reflect.deleteProperty(window, 'matchMedia');
    } else {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    }
    document.body.innerHTML = '';
  });

  it('stays painted in the top layer until the close motion ends, then leaves it', async () => {
    const popover = open({ animateClose: true });
    const motion = controllableAnimation();

    stubAnimations(popover, [motion.animation]);
    popover.hide();

    expect(isInTopLayer(popover)).toBe(true);
    // Keeps its place and its open layout, so the card can fade where it was.
    expect(popover.getElement().style.top).not.toBe('');

    await motion.end();

    expect(isInTopLayer(popover)).toBe(false);
    expect(popover.getElement().style.top).toBe('');
  });

  it('closes logically at once: Closed fires, isShown is false, hidePopover runs now', () => {
    const popover = open({ animateClose: true });
    const onClosed = vi.fn();

    stubAnimations(popover, [controllableAnimation().animation]);
    popover.on(PopoverEvent.Closed, onClosed);
    popover.hide();

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(popover.isShown).toBe(false);
    expect(popover.getElement().hasAttribute(OPENED)).toBe(false);
    expect(popover.getElement().getAttribute('data-state')).toBe('closed');
    expect(hidePopoverSpy).toHaveBeenCalledTimes(1);
  });

  it('moves focus out of the fading card at once', () => {
    const popover = open({ animateClose: true });
    const item = popover.getElement().querySelector<HTMLElement>('[data-blok-popover-item]');

    stubAnimations(popover, [controllableAnimation().animation]);
    item?.setAttribute('tabindex', '-1');
    item?.focus();
    expect(item).toHaveFocus();

    popover.hide();

    expect(item).not.toHaveFocus();
  });

  it('leaves the top layer at once without the opt-in', () => {
    const popover = open();

    stubAnimations(popover, [controllableAnimation().animation]);
    popover.hide();

    expect(isInTopLayer(popover)).toBe(false);
  });

  it('leaves the top layer at once under reduced motion', () => {
    setReducedMotion(true);

    const popover = open({ animateClose: true });

    stubAnimations(popover, [controllableAnimation().animation]);
    popover.hide();

    expect(isInTopLayer(popover)).toBe(false);
  });

  it('leaves the top layer at once when no transition runs', () => {
    const popover = open({ animateClose: true });

    stubAnimations(popover, []);
    popover.hide();

    expect(isInTopLayer(popover)).toBe(false);
  });

  it('a second hide during the close does not cut it short', async () => {
    const popover = open({ animateClose: true });
    const motion = controllableAnimation();

    stubAnimations(popover, [motion.animation]);
    popover.hide();
    popover.hide();

    expect(isInTopLayer(popover)).toBe(true);
    expect(popover.getElement().style.top).not.toBe('');

    await motion.end();

    expect(isInTopLayer(popover)).toBe(false);
  });

  it('destroy from a Closed handler keeps the card until the motion ends, then removes it once', async () => {
    const popover = open({ animateClose: true });
    const motion = controllableAnimation();
    const root = popover.getElement();
    const removeSpy = vi.spyOn(root, 'remove');

    stubAnimations(popover, [motion.animation]);
    // The database menus' pattern: detach first, since destroy() hides and re-emits Closed.
    const owner: { menu: PopoverDesktop | null } = { menu: popover };

    popover.on(PopoverEvent.Closed, () => {
      const menu = owner.menu;

      owner.menu = null;
      menu?.destroy();
    });
    popover.hide();

    expect(root.isConnected).toBe(true);
    expect(isInTopLayer(popover)).toBe(true);

    await motion.end();

    expect(root.isConnected).toBe(false);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('a reopen during the close cancels it, and the old motion ending later does not close the new open', async () => {
    const popover = open({ animateClose: true });
    const motion = controllableAnimation();

    stubAnimations(popover, [motion.animation]);
    popover.hide();
    popover.show();

    expect(popover.isShown).toBe(true);
    expect(isInTopLayer(popover)).toBe(true);

    await motion.cancel();
    await motion.end();

    expect(popover.isShown).toBe(true);
    expect(isInTopLayer(popover)).toBe(true);
    expect(popover.getElement().style.top).not.toBe('');
  });

  it('a reopen during the close is not undone by the fallback timer', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const popover = open({ animateClose: true });

    stubAnimations(popover, [controllableAnimation().animation]);
    popover.hide();
    popover.show();
    vi.advanceTimersByTime(1000);

    expect(popover.isShown).toBe(true);
    expect(isInTopLayer(popover)).toBe(true);
  });

  it('leaves the top layer on the fallback timer when the motion never reports its end', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const popover = open({ animateClose: true });

    stubAnimations(popover, [controllableAnimation().animation]);
    popover.hide();
    vi.advanceTimersByTime(399);
    expect(isInTopLayer(popover)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isInTopLayer(popover)).toBe(false);
  });
});
