/**
 * Trigger a subtle haptic tick (8ms vibration).
 * Used for frequent, repetitive events like adding/removing rows while dragging.
 * No-op on devices that don't support the Vibration API.
 */
export const hapticTick = (): void => {
  navigator.vibrate?.(8);
};

/**
 * Trigger a slightly stronger haptic snap (15ms vibration).
 * Used for discrete state transitions like drag start and drop.
 * No-op on devices that don't support the Vibration API.
 */
export const hapticSnap = (): void => {
  navigator.vibrate?.(15);
};
