import { DRAG_THRESHOLD } from './constants';
import type { ClickHandlerOptions } from './types';

/**
 * ClickDragHandler manages click-vs-drag detection for toolbar elements.
 * Tracks mousedown position and fires callback only if mouse didn't move beyond threshold.
 * Uses document-level mouseup to catch events even if mouse moves off element.
 */
export class ClickDragHandler {
  /**
   * Set of pending document-level mouseup listeners that need cleanup on destroy.
   * Each listener is added on mousedown and removed after mouseup fires.
   */
  private pendingMouseUpListeners = new Set<(event: MouseEvent) => void>();

  /**
   * Sets up a click-vs-drag detection pattern.
   * @param mouseEvent - The mousedown event
   * @param onClickCallback - Callback to fire if it was a click (not a drag)
   * @param options - Optional configuration
   */
  public setup(
    mouseEvent: MouseEvent,
    onClickCallback: (mouseUpEvent: MouseEvent) => void,
    options?: ClickHandlerOptions
  ): void {
    const startPosition = {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
    };

    const onMouseUp = (mouseUpEvent: MouseEvent): void => {
      document.removeEventListener('mouseup', onMouseUp, true);
      this.pendingMouseUpListeners.delete(onMouseUp);

      if (options?.beforeCallback && !options.beforeCallback()) {
        return;
      }

      const wasDragged = (
        Math.abs(mouseUpEvent.clientX - startPosition.x) > DRAG_THRESHOLD ||
        Math.abs(mouseUpEvent.clientY - startPosition.y) > DRAG_THRESHOLD
      );

      if (wasDragged) {
        return;
      }

      onClickCallback(mouseUpEvent);
    };

    this.pendingMouseUpListeners.add(onMouseUp);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  /**
   * Cancels any pending drag tracking.
   * Call this when opening menus to prevent drag from starting when user moves mouse to menu.
   */
  public cancelPending(): void {
    this.clearPendingListeners();
  }

  /**
   * Clean up any pending document-level mouseup listeners.
   * These are added on mousedown and normally removed on mouseup,
   * but if the component is destroyed mid-click, they need manual cleanup.
   */
  public destroy(): void {
    this.clearPendingListeners();
  }

  /**
   * Internal method to clear all pending listeners
   */
  private clearPendingListeners(): void {
    for (const listener of this.pendingMouseUpListeners) {
      document.removeEventListener('mouseup', listener, true);
    }
    this.pendingMouseUpListeners.clear();
  }
}
