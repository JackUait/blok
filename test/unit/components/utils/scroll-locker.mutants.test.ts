/**
 * Scroll-locker mutants that the existing suite did not notice.
 *
 * Two of them are provably equivalent, and both are the same dead fallback:
 * the empty string in `previousOverflow ?? ''`, once in `removeLock` (non-iOS)
 * and once in `unlockHard` (iOS). Neither can be observed, because
 * `previousOverflow` is never null when those lines run:
 *
 * - `removeLock` runs only on the 1 -> 0 lock transition, which is always
 *   preceded by the 0 -> 1 transition that ran `applyLock`, and BOTH of
 *   applyLock's branches assign `previousOverflow` from
 *   `document.body.style.overflow` - a string, always.
 * - `removeLock` cannot run twice in a row: `unlock()` returns early unless
 *   that instance holds a lock, so a second unlock would need a second locked
 *   instance, which would have kept the count above zero.
 * - The field is private static, so `lock`, `unlock` and `isLocked` - the whole
 *   public surface - offer no other way to reach it.
 *
 * Everything else here is observable, several only by flipping `isIosDevice`
 * between lock and unlock: that is the one way to run `applyLock` and
 * `removeLock` down opposite branches, which is what leaves the
 * `previousPaddingRight` and `scrollPosition` guards with a null to skip.
 */
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrollLocker } from '../../../../src/components/utils/scroll-locker';

const { getIsIosDeviceValue, setIsIosDeviceValue } = vi.hoisted(() => {
  let value = false;

  return {
    getIsIosDeviceValue: () => value,
    setIsIosDeviceValue: (nextValue: boolean) => {
      value = nextValue;
    },
  };
});

vi.mock('../../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../../src/components/utils');

  return {
    ...actual,
    get isIosDevice() {
      return getIsIosDeviceValue();
    },
  };
});

const HARD_LOCK_TOP = 'calc(-1 * var(--window-scroll-offset))';

const originalScrollTo = Object.getOwnPropertyDescriptor(window, 'scrollTo');
const originalPageYOffset = Object.getOwnPropertyDescriptor(window, 'pageYOffset');
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');

let scrollTo: Mock<(x: number, y: number) => void>;

/**
 * Replace a property jsdom does not let a test assign to.
 * @param target - the object holding the property
 * @param name - the property name
 * @param value - the value reads should return
 */
const override = (target: Window | HTMLElement, name: string, value: unknown): void => {
  Object.defineProperty(target, name, {
    configurable: true,
    value,
  });
};

/**
 * Put a descriptor back, or drop the override when there was none.
 * @param target - the object holding the property
 * @param name - the property name
 * @param descriptor - the descriptor captured before the first override
 */
const restore = (target: Window | HTMLElement, name: string, descriptor: PropertyDescriptor | undefined): void => {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, name);

    return;
  }

  Object.defineProperty(target, name, descriptor);
};

beforeEach(() => {
  vi.clearAllMocks();
  setIsIosDeviceValue(false);
  document.body.removeAttribute('style');
  document.body.className = '';
  document.body.removeAttribute('data-blok-scroll-locked');
  document.body.removeAttribute('data-blok-scroll-locked-hard');
  document.documentElement.style.removeProperty('--window-scroll-offset');
  scrollTo = vi.fn();
  override(window, 'scrollTo', scrollTo);
});

afterEach(() => {
  vi.restoreAllMocks();
  setIsIosDeviceValue(false);
  // The lock leaves fixed-position styling behind whenever apply and remove ran
  // down opposite iOS branches, so the reset has to be total.
  document.body.removeAttribute('style');
  document.body.className = '';
  document.body.removeAttribute('data-blok-scroll-locked');
  document.body.removeAttribute('data-blok-scroll-locked-hard');
  document.documentElement.style.removeProperty('--window-scroll-offset');
  restore(window, 'scrollTo', originalScrollTo);
  restore(window, 'pageYOffset', originalPageYOffset);
  restore(window, 'innerWidth', originalInnerWidth);
  restore(document.documentElement, 'clientWidth', originalClientWidth);
});

describe('ScrollLocker soft lock', () => {
  it('adds the utility class while locked', () => {
    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.classList.contains('overflow-hidden')).toBe(true);

    locker.unlock();
  });

  it('drops the utility class once unlocked', () => {
    const locker = new ScrollLocker();

    locker.lock();
    locker.unlock();

    expect(document.body.classList.contains('overflow-hidden')).toBe(false);
  });
});

describe('ScrollLocker scrollbar gap', () => {
  it('leaves padding alone when the page has no scrollbar to hide', () => {
    override(window, 'innerWidth', 800);
    override(document.documentElement, 'clientWidth', 800);

    const locker = new ScrollLocker();

    locker.lock();

    // A zero gap must not be written out: `0px` is still an inline override the
    // host page did not ask for.
    expect(document.body.style.paddingRight).toBe('');

    locker.unlock();
  });

  it('keeps the host padding when the lock never compensated for a gap', () => {
    document.body.style.paddingRight = '7px';
    setIsIosDeviceValue(true);

    const locker = new ScrollLocker();

    locker.lock();
    // The hard lock skips gap compensation, so the release has nothing captured
    // to put back and must not clear what the host page set.
    setIsIosDeviceValue(false);
    locker.unlock();

    expect(document.body.style.paddingRight).toBe('7px');
  });
});

describe('ScrollLocker hard lock', () => {
  beforeEach(() => {
    setIsIosDeviceValue(true);
    override(window, 'pageYOffset', 120);
  });

  it('adds every hard-lock utility class', () => {
    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.classList.contains('overflow-hidden')).toBe(true);
    expect(document.body.classList.contains('fixed')).toBe(true);
    expect(document.body.classList.contains('w-full')).toBe(true);

    locker.unlock();
  });

  it('drops every hard-lock utility class on release', () => {
    const locker = new ScrollLocker();

    locker.lock();
    locker.unlock();

    expect(document.body.classList.contains('overflow-hidden')).toBe(false);
    expect(document.body.classList.contains('fixed')).toBe(false);
    expect(document.body.classList.contains('w-full')).toBe(false);
  });

  it('offsets the body by the captured scroll position', () => {
    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.style.top).toBe(HARD_LOCK_TOP);

    locker.unlock();
  });

  it('clears the body offset on release', () => {
    const locker = new ScrollLocker();

    locker.lock();
    locker.unlock();

    expect(document.body.style.top).toBe('');
  });

  it('restores a pre-existing inline overflow on release', () => {
    document.body.style.overflow = 'auto';

    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.style.overflow).toBe('hidden');

    locker.unlock();

    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('ScrollLocker scroll restoration', () => {
  it('does not scroll when the lock never captured a position', () => {
    const locker = new ScrollLocker();

    locker.lock();
    // The soft lock captures no scroll position, so the hard release has
    // nothing to restore and must leave the page where it is.
    setIsIosDeviceValue(true);
    locker.unlock();

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
