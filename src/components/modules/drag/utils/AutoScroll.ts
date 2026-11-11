/**
 * AutoScroll utility for drag operations
 * Handles scrolling the viewport or a scrollable container when the cursor is near edges
 */

import { DRAG_CONFIG } from './drag.constants';

/**
 * Speed-curve mode. Without it, AutoScroll keeps the block drag's fixed
 * 50px zone and 10px per frame.
 */
export interface AutoScrollOptions {
  /** Default 'y'. */
  axis?: 'x' | 'y';
  /** The client-px band whose edges the zones hug. Default: the window. */
  bounds?: () => { start: number; end: number };
  /** px/ms at a distance from the nearest edge; 0 means out of the zone. */
  speed: (distance: number) => number;
  /** Least time between two steps. Default: every frame. */
  stepMs?: number;
  /** After a step that moved the scroller: a still pointer fires no move, so re-run hit tests here. */
  onStep?: () => void;
}

export class AutoScroll {
  private scrollContainer: HTMLElement | null;
  private animationFrameId: number | null = null;
  private scrollDirection: 'up' | 'down' | null = null;
  private readonly options: AutoScrollOptions | undefined;
  /** Latest pointer coordinate on the option's axis. */
  private coord = 0;
  /** Time of the last step; null until the loop's first frame. */
  private lastStep: number | null = null;

  constructor(scrollContainer: HTMLElement | null, options?: AutoScrollOptions) {
    this.scrollContainer = scrollContainer;
    this.options = options;
  }

  /**
   * Starts auto-scrolling based on cursor position
   * @param clientY - Current cursor position: Y, or X with the 'x' axis option
   */
  start(clientY: number): void {
    if (this.options !== undefined) {
      this.coord = clientY;
      if (this.animationFrameId === null) {
        this.animationFrameId = requestAnimationFrame(this.tick);
      }

      return;
    }
    // Determine scroll zones based on viewport
    const viewportHeight = window.innerHeight;
    const scrollUp = clientY < DRAG_CONFIG.autoScrollZone;
    const scrollDown = clientY > viewportHeight - DRAG_CONFIG.autoScrollZone;

    // Stop if we're not in a scroll zone or direction changed
    if (!scrollUp && !scrollDown) {
      this.stop();
      return;
    }

    const newDirection: 'up' | 'down' = scrollUp ? 'up' : 'down';

    // If direction changed, restart
    if (this.scrollDirection !== newDirection) {
      this.stop();
      this.scrollDirection = newDirection;
    }

    // Don't start a new loop if one is already running
    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.scroll.bind(this));
  }

  /**
   * Stops auto-scrolling
   */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.scrollDirection = null;
    this.lastStep = null;
  }

  /** One frame of the speed-curve mode. */
  private readonly tick = (now: number): void => {
    const options = this.options;

    if (options === undefined) {
      return;
    }
    const axis = options.axis ?? 'y';
    const { start, end } = options.bounds?.() ?? { start: 0, end: axis === 'y' ? window.innerHeight : window.innerWidth };
    const toEnd = end - this.coord;
    const toStart = this.coord - start;
    const velocity = toEnd <= toStart ? options.speed(Math.max(0, toEnd)) : -options.speed(Math.max(0, toStart));

    if (velocity === 0) {
      this.animationFrameId = null;
      this.lastStep = null;

      return;
    }
    this.animationFrameId = requestAnimationFrame(this.tick);
    if (this.lastStep === null) {
      this.lastStep = now;

      return;
    }
    const elapsed = now - this.lastStep;

    if (elapsed < (options.stepMs ?? 0)) {
      return;
    }
    this.lastStep = now;
    if (this.scrollBy(axis, velocity * elapsed)) {
      options.onStep?.();
    }
  };

  /** True when the scroll position changed. */
  private scrollBy(axis: 'x' | 'y', delta: number): boolean {
    const el = this.scrollContainer;

    if (el === null) {
      const before = axis === 'y' ? window.scrollY : window.scrollX;

      window.scrollBy(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);

      return (axis === 'y' ? window.scrollY : window.scrollX) !== before;
    }
    const key = axis === 'y' ? 'scrollTop' : 'scrollLeft';
    const before = el[key];

    el[key] = before + delta;

    return el[key] !== before;
  }

  /**
   * Performs the actual scroll operation
   */
  private scroll(): void {
    if (this.scrollDirection === null) {
      return;
    }

    const direction = this.scrollDirection === 'up' ? -1 : 1;
    const scrollAmount = direction * DRAG_CONFIG.autoScrollSpeed;

    if (this.scrollContainer) {
      this.scrollContainer.scrollTop += scrollAmount;
    } else {
      window.scrollBy(0, scrollAmount);
    }

    this.animationFrameId = requestAnimationFrame(this.scroll.bind(this));
  }

  /**
   * Destroys the AutoScroll instance and cleans up
   */
  destroy(): void {
    this.stop();
  }
}
