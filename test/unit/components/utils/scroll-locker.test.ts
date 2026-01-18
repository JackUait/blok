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
});
