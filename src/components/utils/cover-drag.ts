/** Where a cover drag starts: the image's vertical position (0–100 %) and the height a full-range drag spans. */
export interface CoverDragStart {
  position: number;
  height: number;
}

/**
 * Follows a vertical cover drag on `surface`. Dragging down shows more of the
 * image's top, so it lowers the position. The position given to `move` is
 * clamped to 0–100 and not rounded. `start` returns null to ignore a press.
 * Gives back a function that removes the listeners.
 */
export const trackCoverDrag = (
  surface: HTMLElement,
  options: { start(event: PointerEvent): CoverDragStart | null; move(position: number): void }
): (() => void) => {
  const state: { drag: (CoverDragStart & { y: number }) | null } = { drag: null };

  const onPointerDown = (event: PointerEvent): void => {
    const start = event.button === 0 ? options.start(event) : null;

    if (start === null) {
      return;
    }
    event.preventDefault();
    surface.setPointerCapture?.(event.pointerId);
    state.drag = { ...start, height: start.height || 1, y: event.clientY };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (state.drag === null) {
      return;
    }
    const moved = ((event.clientY - state.drag.y) / state.drag.height) * 100;

    options.move(Math.min(100, Math.max(0, state.drag.position - moved)));
  };

  const onEnd = (): void => {
    state.drag = null;
  };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onEnd);
  surface.addEventListener('pointercancel', onEnd);
  // A window blur mid-drag takes the capture without a pointerup.
  surface.addEventListener('lostpointercapture', onEnd);

  return (): void => {
    onEnd();
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onEnd);
    surface.removeEventListener('pointercancel', onEnd);
    surface.removeEventListener('lostpointercapture', onEnd);
  };
};
