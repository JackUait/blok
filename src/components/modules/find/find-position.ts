/**
 * Where the user parked the find bar.
 *
 * Stored as a relative spot in the free space of the window (0..1 on each
 * axis), not as pixels, so a bar parked in a corner stays in that corner when
 * the window is resized. Stored per viewer in localStorage: it is a personal
 * preference, and a blocked or empty storage just means the default spot.
 */

export interface BarPosition {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

/** Gap kept between the bar and the window edge. */
const MARGIN = 8;
const STORAGE_KEY = 'blok:find-bar-position';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const freeSpace = (size: Size, viewport: Size): Size => ({
  width: Math.max(0, viewport.width - size.width - MARGIN * 2),
  height: Math.max(0, viewport.height - size.height - MARGIN * 2),
});

/**
 * Pixel offsets from the top-left of the window.
 * @param position - relative spot
 * @param size - the bar's size
 * @param viewport - the window's size
 */
export const toPixels = (position: BarPosition, size: Size, viewport: Size): { left: number; top: number } => {
  const free = freeSpace(size, viewport);

  return {
    left: Math.round(MARGIN + clamp01(position.x) * free.width),
    top: Math.round(MARGIN + clamp01(position.y) * free.height),
  };
};

/**
 * The relative spot for a bar whose top-left corner is at `left`, `top`.
 * @param left - offset from the window's left edge
 * @param top - offset from the window's top edge
 * @param size - the bar's size
 * @param viewport - the window's size
 */
export const toPosition = (left: number, top: number, size: Size, viewport: Size): BarPosition => {
  const free = freeSpace(size, viewport);

  return {
    x: free.width === 0 ? 0 : clamp01((left - MARGIN) / free.width),
    y: free.height === 0 ? 0 : clamp01((top - MARGIN) / free.height),
  };
};

const isPosition = (value: unknown): value is BarPosition =>
  typeof value === 'object' && value !== null &&
  'x' in value && typeof value.x === 'number' && value.x >= 0 && value.x <= 1 &&
  'y' in value && typeof value.y === 'number' && value.y >= 0 && value.y <= 1;

/**
 * The stored spot, or null for the default one.
 */
export const loadPosition = (): BarPosition | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

    return isPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Store a spot; null forgets it.
 * @param position - the spot, or null to go back to the default
 */
export const savePosition = (position: BarPosition | null): void => {
  try {
    if (position === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    }
  } catch {
    // Storage blocked (private mode, sandbox): the bar just forgets.
  }
};
