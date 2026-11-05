import { MAX_HEIGHT_PX, MIN_HEIGHT_PX } from '../../image/resizer';

export const DEFAULT_WIDTH = 580;
export const DEFAULT_HEIGHT = 320;

// Registry defaults run from netease (86 / 580, about 0.15) to TikTok
// (580 / 325, about 1.8); these bounds keep all of them.
const MIN_HEIGHT_PER_WIDTH = 0.1;
const MAX_HEIGHT_PER_WIDTH = 4;

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** Keeps a ratio box's height within sane bounds of its width. */
export function clampRatioHeight(width: number, height: number): number {
  return Math.min(Math.max(height, width * MIN_HEIGHT_PER_WIDTH), width * MAX_HEIGHT_PER_WIDTH);
}

/**
 * The frame size a saved block may use. A fixed-height embed is a pixel
 * height in the bottom handle's range; any other embed is a ratio box.
 */
export function embedFrameSize(width: unknown, height: unknown, fixedHeight: boolean): { width: number; height: number } {
  const w = positive(width, DEFAULT_WIDTH);
  const h = positive(height, DEFAULT_HEIGHT);

  return {
    width: w,
    height: fixedHeight
      ? Math.min(Math.max(h, MIN_HEIGHT_PX), MAX_HEIGHT_PX)
      : clampRatioHeight(w, h),
  };
}
