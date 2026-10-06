/**
 * Scroll haze overlays for the Table tool.
 *
 * Adds gradient overlays on the left/right edges of the table wrapper
 * to indicate that the table content is horizontally scrollable.
 * Uses a passive scroll event listener with rAF throttling.
 */

import { DATA_ATTR } from '../../components/constants/data-attributes';
import { getElementDirection, scrollFromInlineStart } from '../../components/utils/direction';

const HAZE_ATTR = 'data-blok-table-haze';
const HAZE_VISIBLE_ATTR = 'data-blok-table-haze-visible';

/** Minimum scrollLeft delta to consider "scrolled" (avoids sub-pixel flicker). */
const SCROLL_THRESHOLD = 1;

const HAZE_CLASSES = [
  'absolute',
  'top-0',
  'bottom-0',
  'w-12',
  'pointer-events-none',
  'opacity-0',
  'transition-opacity',
  'duration-150',
  'z-1',
];

const LEFT_HAZE_CLASSES = [
  'bg-linear-to-r',
  'from-white/80',
  'to-transparent',
];

const RIGHT_HAZE_CLASSES = [
  'bg-linear-to-l',
  'from-white/80',
  'to-transparent',
];

/**
 * Manages left/right gradient haze overlays that indicate
 * the table can be scrolled horizontally.
 */
export class TableScrollHaze {
  private leftHaze: HTMLDivElement | null = null;
  private rightHaze: HTMLDivElement | null = null;
  private scrollContainer: HTMLElement | null = null;
  private wrapper: HTMLElement | null = null;
  private boundOnScroll: (() => void) | null = null;
  private ticking = false;

  /**
   * Create haze overlay elements and attach the scroll listener.
   *
   * @param wrapper - The table wrapper element (position: relative)
   * @param scrollContainer - The scroll container with overflow-x: auto
   */
  public init(wrapper: HTMLElement, scrollContainer: HTMLElement): void {
    this.scrollContainer = scrollContainer;
    this.wrapper = wrapper;

    this.leftHaze = this.createHazeElement('left');
    this.rightHaze = this.createHazeElement('right');

    wrapper.appendChild(this.leftHaze);
    wrapper.appendChild(this.rightHaze);

    this.boundOnScroll = (): void => {
      if (!this.ticking) {
        requestAnimationFrame(() => {
          this.syncVisibility();
          this.ticking = false;
        });
        this.ticking = true;
      }
    };

    scrollContainer.addEventListener('scroll', this.boundOnScroll, { passive: true });

    this.syncVisibility();
  }

  /**
   * Recalculate haze visibility (e.g. after column resize or add/delete).
   */
  public update(): void {
    this.syncVisibility();
  }

  /**
   * Remove overlay elements and detach the scroll listener.
   */
  public destroy(): void {
    if (this.boundOnScroll && this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this.boundOnScroll);
    }

    this.leftHaze?.remove();
    this.rightHaze?.remove();

    this.leftHaze = null;
    this.rightHaze = null;
    this.scrollContainer = null;
    this.wrapper = null;
    this.boundOnScroll = null;
    this.ticking = false;
  }

  private createHazeElement(side: 'left' | 'right'): HTMLDivElement {
    const el = document.createElement('div');

    el.setAttribute(HAZE_ATTR, side);
    // Chrome, not content: showing or placing it on scroll is not an edit.
    el.setAttribute(DATA_ATTR.mutationFree, 'true');
    el.setAttribute('aria-hidden', 'true');
    el.classList.add(...HAZE_CLASSES, ...(side === 'left' ? LEFT_HAZE_CLASSES : RIGHT_HAZE_CLASSES));

    return el;
  }

  private syncVisibility(): void {
    const sc = this.scrollContainer;

    if (!sc) {
      return;
    }

    const { overflowX } = getComputedStyle(sc);
    const canScroll = overflowX === 'auto' || overflowX === 'scroll';

    if (!canScroll) {
      this.setVisible(this.leftHaze, false);
      this.setVisible(this.rightHaze, false);

      return;
    }

    const direction = getElementDirection(sc);
    const fromStart = scrollFromInlineStart(sc, direction);
    const maxScroll = sc.scrollWidth - sc.clientWidth;
    const startHidden = fromStart > SCROLL_THRESHOLD;
    const endHidden = maxScroll > SCROLL_THRESHOLD && fromStart < maxScroll - SCROLL_THRESHOLD;

    this.placeHazes();
    this.setVisible(this.leftHaze, direction === 'rtl' ? endHidden : startHidden);
    this.setVisible(this.rightHaze, direction === 'rtl' ? startHidden : endHidden);
  }

  /**
   * Hazes hug the scroller's clip box. It is not the wrapper's content box:
   * the scroller hangs into the inline-end padding (pill room in tables.css).
   */
  private placeHazes(): void {
    const sc = this.scrollContainer;

    if (!this.leftHaze || !this.rightHaze || !sc || !this.wrapper) {
      return;
    }

    const right = this.wrapper.clientWidth - sc.offsetLeft - sc.offsetWidth;

    this.leftHaze.style.left = `${sc.offsetLeft}px`;
    this.rightHaze.style.right = `${right}px`;
  }

  private setVisible(el: HTMLElement | null, visible: boolean): void {
    if (!el) {
      return;
    }

    if (visible) {
      el.setAttribute(HAZE_VISIBLE_ATTR, '');
    } else {
      el.removeAttribute(HAZE_VISIBLE_ATTR);
    }
  }
}
