import { isIosDevice } from '../utils';

/**
 * Utility allowing to lock body scroll on demand.
 *
 * Locks are reference-counted across all instances (react-remove-scroll style):
 * the DOM lock is applied only on the 0 -> 1 transition and removed only on the
 * 1 -> 0 transition, so independent instances can no longer corrupt each
 * other's state.
 */
export class ScrollLocker {
  /**
   * Tailwind utility classes for styling
   */
  private static CSS = {
    overflowHidden: 'overflow-hidden',
    fixed: 'fixed',
    wFull: 'w-full',
  };

  /**
   * Data attributes for state management
   */
  private static DATA_ATTR = {
    scrollLocked: 'data-blok-scroll-locked',
    scrollLockedHard: 'data-blok-scroll-locked-hard',
  };

  /**
   * Number of active locks held across all instances
   */
  private static lockCount = 0;

  /**
   * Scroll position captured on the 0 -> 1 transition, used for hard scroll lock
   */
  private static scrollPosition: null | number = null;

  /**
   * Body inline padding-right captured before scrollbar-gap compensation
   */
  private static previousPaddingRight: null | string = null;

  /**
   * Whether this particular instance currently holds a lock
   */
  private locked = false;

  /**
   * Whether this instance currently holds a lock
   */
  public get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Locks body element scroll
   */
  public lock(): void {
    if (this.locked) {
      return;
    }

    this.locked = true;
    ScrollLocker.lockCount += 1;

    if (ScrollLocker.lockCount === 1) {
      ScrollLocker.applyLock();
    }
  }

  /**
   * Unlocks body element scroll
   */
  public unlock(): void {
    if (!this.locked) {
      return;
    }

    this.locked = false;
    ScrollLocker.lockCount -= 1;

    if (ScrollLocker.lockCount === 0) {
      ScrollLocker.removeLock();
    }
  }

  /**
   * Applies the DOM lock (runs once, on the 0 -> 1 transition)
   */
  private static applyLock(): void {
    if (isIosDevice) {
      ScrollLocker.lockHard();
    } else {
      ScrollLocker.compensateScrollbarGap();
      document.body.classList.add(ScrollLocker.CSS.overflowHidden);
      document.body.setAttribute(ScrollLocker.DATA_ATTR.scrollLocked, 'true');
    }
  }

  /**
   * Removes the DOM lock (runs once, on the 1 -> 0 transition)
   */
  private static removeLock(): void {
    if (isIosDevice) {
      ScrollLocker.unlockHard();
    } else {
      document.body.classList.remove(ScrollLocker.CSS.overflowHidden);
      document.body.removeAttribute(ScrollLocker.DATA_ATTR.scrollLocked);
      ScrollLocker.restoreScrollbarGap();
    }
  }

  /**
   * Adds padding-right equal to the width of the now-hidden scrollbar so the
   * page content does not shift when the scrollbar disappears
   */
  private static compensateScrollbarGap(): void {
    const gap = window.innerWidth - document.documentElement.clientWidth;

    ScrollLocker.previousPaddingRight = document.body.style.paddingRight;

    if (gap > 0) {
      document.body.style.paddingRight = `${gap}px`;
    }
  }

  /**
   * Restores the body padding-right captured before scrollbar-gap compensation
   */
  private static restoreScrollbarGap(): void {
    if (ScrollLocker.previousPaddingRight !== null) {
      document.body.style.paddingRight = ScrollLocker.previousPaddingRight;
    }
    ScrollLocker.previousPaddingRight = null;
  }

  /**
   * Locks scroll in a hard way (via setting fixed position to body element)
   */
  private static lockHard(): void {
    ScrollLocker.scrollPosition = window.pageYOffset;
    document.documentElement.style.setProperty(
      '--window-scroll-offset',
      `${ScrollLocker.scrollPosition}px`
    );
    document.body.classList.add(
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
  private static unlockHard(): void {
    document.body.classList.remove(
      ScrollLocker.CSS.overflowHidden,
      ScrollLocker.CSS.fixed,
      ScrollLocker.CSS.wFull
    );
    document.body.style.top = '';
    document.body.removeAttribute(ScrollLocker.DATA_ATTR.scrollLockedHard);
    if (ScrollLocker.scrollPosition !== null) {
      window.scrollTo(0, ScrollLocker.scrollPosition);
    }
    ScrollLocker.scrollPosition = null;
  }
}
