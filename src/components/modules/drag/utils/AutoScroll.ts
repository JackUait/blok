/**
 * AutoScroll utility for drag operations
 * Handles scrolling the viewport or a scrollable container when the cursor is near edges
 */

import { DRAG_CONFIG } from './drag.constants';

export class AutoScroll {
  private scrollContainer: HTMLElement | null;
  private animationFrameId: number | null = null;
  private scrollDirection: 'up' | 'down' | null = null;

  constructor(scrollContainer: HTMLElement | null) {
    this.scrollContainer = scrollContainer;
  }

  /**
   * Starts auto-scrolling based on cursor Y position
   * @param clientY - Current cursor Y position
   */
  start(clientY: number): void {
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
