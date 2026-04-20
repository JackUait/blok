import type { ImageCrop } from '../../../types/tools/image';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const FULL_RECT: ImageCrop = { x: 0, y: 0, w: 100, h: 100 };
const MIN = 5;

export function isFullRect(r: ImageCrop): boolean {
  return r.x === 0 && r.y === 0 && r.w === 100 && r.h === 100;
}

export function clampRect(r: ImageCrop): ImageCrop {
  let { x, y, w, h } = r;
  w = Math.max(MIN, Math.min(100, w));
  h = Math.max(MIN, Math.min(100, h));
  x = Math.max(0, Math.min(100 - w, x));
  y = Math.max(0, Math.min(100 - h, y));
  return { x, y, w, h };
}

export function resizeRect(
  start: ImageCrop,
  handle: Handle,
  dxPct: number,
  dyPct: number
): ImageCrop {
  let { x, y, w, h } = start;
  if (handle.includes('w')) { x += dxPct; w -= dxPct; }
  if (handle.includes('e')) { w += dxPct; }
  if (handle.includes('n')) { y += dyPct; h -= dyPct; }
  if (handle.includes('s')) { h += dyPct; }
  return clampRect({ x, y, w, h });
}

export function applyRatio(rect: ImageCrop, ratio: number | null): ImageCrop {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return rect;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let w = rect.w;
  let h = w / ratio;
  if (h > rect.h) {
    h = rect.h;
    w = h * ratio;
  }
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}
