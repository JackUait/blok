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

const originalScrollTo = window.scrollTo;
const originalPageYOffsetDescriptor = Object.getOwnPropertyDescriptor(window, 'pageYOffset');

describe('ScrollLocker', () => {
  beforeEach(() => {
    document.body.removeAttribute('data-blok-scroll-locked');
    document.body.removeAttribute('data-blok-scroll-locked-hard');
    document.body.innerHTML = '';
    document.documentElement?.style.removeProperty('--window-scroll-offset');
    setIsIosDeviceValue(false);
    if (originalPageYOffsetDescriptor) {
      Object.defineProperty(window, 'pageYOffset', originalPageYOffsetDescriptor);
    }
  });

  afterEach(() => {
    if (originalScrollTo) {
      Object.defineProperty(window, 'scrollTo', {
        configurable: true,
        writable: true,
        value: originalScrollTo,
      });
    } else {
      Object.defineProperty(window, 'scrollTo', {
        configurable: true,
        value: window.scrollTo,
      });
    }
    document.body.removeAttribute('data-blok-scroll-locked');
    document.body.removeAttribute('data-blok-scroll-locked-hard');
    document.documentElement?.style.removeProperty('--window-scroll-offset');
    setIsIosDeviceValue(false);
    if (originalPageYOffsetDescriptor) {
      Object.defineProperty(window, 'pageYOffset', originalPageYOffsetDescriptor);
    }
  });

  it('adds and removes body class on non-iOS devices', () => {
    setIsIosDeviceValue(false);
    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body).toHaveAttribute('data-blok-scroll-locked', 'true');

    locker.unlock();

    expect(document.body).not.toHaveAttribute('data-blok-scroll-locked');
  });

  it('performs hard lock on iOS devices and restores scroll position', () => {
    const storedScroll = 160;

    setIsIosDeviceValue(true);
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      value: storedScroll,
    });

    const scrollTo = vi.fn();

    window.scrollTo = scrollTo;

    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body).toHaveAttribute('data-blok-scroll-locked-hard', 'true');
    expect(document.documentElement?.style.getPropertyValue('--window-scroll-offset')).toBe(`${storedScroll}px`);

    locker.unlock();

    expect(document.body).not.toHaveAttribute('data-blok-scroll-locked-hard');
    expect(scrollTo).toHaveBeenCalledWith(0, storedScroll);
  });

  it('does not restore scroll when hard lock was never applied', () => {
    setIsIosDeviceValue(true);
    const scrollTo = vi.fn();

    window.scrollTo = scrollTo;

    const locker = new ScrollLocker();

    locker.unlock();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('reference-counts the lock across instances', () => {
    setIsIosDeviceValue(false);
    const first = new ScrollLocker();
    const second = new ScrollLocker();

    first.lock();
    second.lock();

    expect(document.body).toHaveAttribute('data-blok-scroll-locked', 'true');

    // Unlocking one instance must not release the shared lock
    first.unlock();

    expect(document.body).toHaveAttribute('data-blok-scroll-locked', 'true');

    // Only the final unlock releases it
    second.unlock();

    expect(document.body).not.toHaveAttribute('data-blok-scroll-locked');
  });

  it('reports whether an instance holds a lock', () => {
    setIsIosDeviceValue(false);
    const locker = new ScrollLocker();

    expect(locker.isLocked).toBe(false);

    locker.lock();
    expect(locker.isLocked).toBe(true);

    locker.unlock();
    expect(locker.isLocked).toBe(false);
  });

  it('treats repeated lock/unlock on the same instance as idempotent', () => {
    setIsIosDeviceValue(false);
    const first = new ScrollLocker();
    const second = new ScrollLocker();

    first.lock();
    // Locking twice must not bump the shared count twice
    first.lock();
    second.lock();

    // A single unlock from the second instance should still leave the lock held by first
    second.unlock();
    expect(document.body).toHaveAttribute('data-blok-scroll-locked', 'true');

    first.unlock();
    // Extra unlock is a no-op and must not underflow the count
    first.unlock();
    expect(document.body).not.toHaveAttribute('data-blok-scroll-locked');
  });

  it('locks via inline overflow style so it works on host pages without Blok stylesheet scope', () => {
    // Regression: the lock used to rely solely on the Tailwind `overflow-hidden`
    // class, but Blok's utility CSS is scoped to the editor and never styles
    // document.body on a host page — the class silently did nothing and the
    // page kept scrolling under the open menu.
    setIsIosDeviceValue(false);
    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.style.overflow).toBe('hidden');

    locker.unlock();

    expect(document.body.style.overflow).toBe('');
  });

  it('restores a pre-existing inline overflow value on unlock', () => {
    setIsIosDeviceValue(false);
    document.body.style.overflow = 'auto';
    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.style.overflow).toBe('hidden');

    locker.unlock();

    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('applies the hard lock via inline styles on iOS devices', () => {
    setIsIosDeviceValue(true);
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      value: 40,
    });
    window.scrollTo = vi.fn();

    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.width).toBe('100%');

    locker.unlock();

    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(document.body.style.width).toBe('');
  });

  it('compensates for the scrollbar gap while locked', () => {
    setIsIosDeviceValue(false);
    const originalInnerWidth = window.innerWidth;
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'clientWidth'
    );

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1009,
    });

    const locker = new ScrollLocker();

    locker.lock();

    expect(document.body.style.paddingRight).toBe('15px');

    locker.unlock();

    expect(document.body.style.paddingRight).toBe('');

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
    if (originalClientWidthDescriptor) {
      Object.defineProperty(document.documentElement, 'clientWidth', originalClientWidthDescriptor);
    }
  });
});
