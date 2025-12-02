import { isIosDevice } from '../utils';

/**
 * Utility allowing to lock body scroll on demand
 */
export default class ScrollLocker {
  /**
   * Style classes
   */
  private static CSS = {
    scrollLocked: 'blok-scroll-locked',
    scrollLockedHard: 'is-hard',
    overflowHidden: 'overflow-hidden',
    fixed: 'fixed',
    wFull: 'w-full',
  };

  /**
   * Data attributes for state checking
   */
  private static DATA_ATTR = {
    scrollLocked: 'data-blok-scroll-locked',
    scrollLockedHard: 'data-blok-scroll-locked-hard',
  };

  /**
   * Stores scroll position, used for hard scroll lock
   */
  private scrollPosition: null | number = null;

  /**
   * Locks body element scroll
   */
  public lock(): void {
    if (isIosDevice) {
      this.lockHard();
    } else {
      document.body.classList.add(ScrollLocker.CSS.scrollLocked, ScrollLocker.CSS.overflowHidden);
      document.body.setAttribute(ScrollLocker.DATA_ATTR.scrollLocked, 'true');
    }
  }

  /**
   * Unlocks body element scroll
   */
  public unlock(): void {
    if (isIosDevice) {
      this.unlockHard();
    } else {
      document.body.classList.remove(ScrollLocker.CSS.scrollLocked, ScrollLocker.CSS.overflowHidden);
      document.body.removeAttribute(ScrollLocker.DATA_ATTR.scrollLocked);
    }
  }

  /**
   * Locks scroll in a hard way (via setting fixed position to body element)
   */
  private lockHard(): void {
    this.scrollPosition = window.pageYOffset;
    document.documentElement.style.setProperty(
      '--window-scroll-offset',
      `${this.scrollPosition}px`
    );
    document.body.classList.add(
      ScrollLocker.CSS.scrollLocked,
      ScrollLocker.CSS.scrollLockedHard,
      ScrollLocker.CSS.overflowHidden,
      ScrollLocker.CSS.fixed,
      ScrollLocker.CSS.wFull
    );
    document.body.style.top = `calc(-1 * var(--window-scroll-offset))`;
    document.body.setAttribute(ScrollLocker.DATA_ATTR.scrollLockedHard, 'true');
  }

  /**
   * Unlocks hard scroll lock
   */
  private unlockHard(): void {
    document.body.classList.remove(
      ScrollLocker.CSS.scrollLocked,
      ScrollLocker.CSS.scrollLockedHard,
      ScrollLocker.CSS.overflowHidden,
      ScrollLocker.CSS.fixed,
      ScrollLocker.CSS.wFull
    );
    document.body.style.top = '';
    document.body.removeAttribute(ScrollLocker.DATA_ATTR.scrollLockedHard);
    if (this.scrollPosition !== null) {
      window.scrollTo(0, this.scrollPosition);
    }
    this.scrollPosition = null;
  }
}
